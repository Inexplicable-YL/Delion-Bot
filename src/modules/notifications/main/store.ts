import { emit, hostPorts } from '../../../core/ports';
import {
  notificationsContract,
  type NotificationItem,
  type NotificationState,
  type NotificationTarget,
} from '../contract';
import { armSystemNotifications, NOTIFICATIONS_SNOOZE_KEY, showSystemNotice } from './system';

export interface NoticeSource {
  id: string;
  /** 当前账号键，未登录时为 null；换账号后旧账号的通知不再显示。 */
  account(): string | null;
  /** 抛出的错误记为该来源的刷新错误；成功时由来源自行调用 saveNotificationRefresh。 */
  refresh(account: string, force: boolean): Promise<void>;
  /** 解释来源自己写入的 href；返回 null 的行视为损坏，不显示。 */
  link(href: Record<string, unknown>, id: string): NoticeLink | null;
  /** 标记一条通知已读前调用，抛出时该条保持未读并记为来源错误。 */
  markRead?(id: string, account: string): void | Promise<void>;
  /** 全部已读前调用，失败语义同 markRead。 */
  markAllRead?(account: string): Promise<void>;
}

export interface NoticeLink {
  target: NotificationTarget;
}

export interface StoredNotice {
  id: string;
  source: string;
  title: string;
  href: object;
}

const noticeSources = new Map<string, NoticeSource>();
let activeRefresh: Promise<NotificationState> | null = null;

export function registerNoticeSource(source: NoticeSource): void {
  noticeSources.set(source.id, source);
}

interface NotificationRow {
  id: string;
  source: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  href: string;
}

const database = () => hostPorts().database();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentAccounts(): Map<string, string> {
  const accounts = new Map<string, string>();
  for (const source of noticeSources.values()) {
    try {
      const key = source.account();
      if (key) accounts.set(source.id, key);
    } catch {
      // 损坏的凭据视同未登录，不能连带隐藏其他来源的通知。
    }
  }
  return accounts;
}

function linkOf(source: string, href: object, id: string): NoticeLink | null {
  return noticeSources.get(source)?.link(href as Record<string, unknown>, id) ?? null;
}

/** 新到达通知的系统提醒；body 用于合并后的摘要，缺省不显示正文。 */
export function systemNotifyItem(notice: StoredNotice, body = ''): void {
  const link = linkOf(notice.source, notice.href, notice.id);
  if (link) showSystemNotice(notice.id, notice.title, body, link.target);
}

export function notificationState(sources?: readonly string[]): NotificationState {
  const db = database();
  const accounts = currentAccounts();
  const active = [...accounts].filter(([source]) => !sources || sources.includes(source));
  const where = active.length
    ? active.map(() => '(source = ? AND account_key = ?)').join(' OR ')
    : '0';
  const bindings = active.flat();
  const rows = db
    .prepare(
      `SELECT id, source, title, body, created_at, read_at, href FROM notifications
       WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 200`,
    )
    .all(...bindings) as NotificationRow[];
  const items = rows.flatMap((row): NotificationItem[] => {
    try {
      const link = linkOf(row.source, JSON.parse(row.href) as object, row.id);
      if (!link) return [];
      return [
        {
          id: row.id,
          source: row.source,
          title: row.title,
          body: row.body,
          createdAt: row.created_at,
          readAt: row.read_at,
          target: link.target,
        },
      ];
    } catch {
      // 损坏的行不能让整个通知中心不可用。
      return [];
    }
  });
  const { totalCount, unreadCount } = db
    .prepare(
      `SELECT COUNT(*) AS totalCount, COALESCE(SUM(read_at IS NULL), 0) AS unreadCount
       FROM notifications WHERE ${where}`,
    )
    .get(...bindings) as { totalCount: number; unreadCount: number };
  const snooze = (
    db
      .prepare('SELECT value FROM workspace_settings WHERE key = ?')
      .get(NOTIFICATIONS_SNOOZE_KEY) as { value: string } | undefined
  )?.value;
  const refresh: NotificationState['refresh'] = {};
  for (const [source, key] of accounts) {
    const row = db
      .prepare(
        'SELECT last_success_at, error FROM notification_refreshes WHERE source = ? AND account_key = ?',
      )
      .get(source, key) as { last_success_at: string | null; error: string | null } | undefined;
    refresh[source] = { lastSuccessAt: row?.last_success_at ?? null, error: row?.error ?? null };
  }
  return {
    items,
    totalCount,
    unreadCount,
    snoozedUntil: snooze && Date.parse(snooze) > Date.now() ? snooze : null,
    refresh,
  };
}

export function publishNotificationState(): NotificationState {
  const state = notificationState();
  emit(notificationsContract, 'state', state);
  return state;
}

export function saveNotificationRefresh(source: string, key: string, error: string | null): void {
  const now = new Date().toISOString();
  database()
    .prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error) VALUES (?, ?, ?, ?)
       ON CONFLICT(source, account_key) DO UPDATE SET
         last_success_at = CASE WHEN excluded.error IS NULL THEN excluded.last_success_at ELSE notification_refreshes.last_success_at END,
         error = excluded.error`,
    )
    .run(source, key, error === null ? now : null, error);
}

export function upsertNotification(
  source: string,
  accountKey: string,
  id: string,
  title: string,
  body: string,
  createdAt: string,
  href: object,
): void {
  database()
    .prepare(
      `INSERT INTO notifications (id, source, account_key, title, body, created_at, href)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
         created_at = excluded.created_at, href = excluded.href`,
    )
    .run(id, source, accountKey, title, body, createdAt, JSON.stringify(href));
}

export function existingNotifications(source: string, key: string): Set<string> {
  const rows = database()
    .prepare('SELECT id FROM notifications WHERE source = ? AND account_key = ?')
    .all(source, key) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

export function refreshNotifications(force = false): Promise<NotificationState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    const accounts = currentAccounts();
    await Promise.all(
      [...noticeSources.values()].map(async (source) => {
        const key = accounts.get(source.id);
        if (!key) return;
        try {
          await source.refresh(key, force);
        } catch (error) {
          saveNotificationRefresh(source.id, key, errorText(error));
        }
      }),
    );
    // 首轮刷新构成启动基线；此后新增的通知才弹系统桌面通知。
    armSystemNotifications();
    return publishNotificationState();
  })().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

function markNotificationRowsRead(id: string | null, accounts: Array<[string, string]>): void {
  if (accounts.length === 0) return;
  database()
    .prepare(
      `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE (? IS NULL OR id = ?)
       AND (${accounts.map(() => '(source = ? AND account_key = ?)').join(' OR ')})`,
    )
    .run(new Date().toISOString(), id, id, ...accounts.flat());
}

export async function markNotificationRead(id: string): Promise<NotificationState> {
  const row = database()
    .prepare('SELECT source, account_key FROM notifications WHERE id = ?')
    .get(id) as { source: string; account_key: string } | undefined;
  if (!row || currentAccounts().get(row.source) !== row.account_key)
    return publishNotificationState();
  try {
    await noticeSources.get(row.source)?.markRead?.(id, row.account_key);
    markNotificationRowsRead(id, [[row.source, row.account_key]]);
  } catch (error) {
    saveNotificationRefresh(row.source, row.account_key, errorText(error));
  }
  return publishNotificationState();
}

export async function markAllNotificationsRead(
  sources?: readonly string[],
): Promise<NotificationState> {
  const accounts = [...currentAccounts()].filter(
    ([source]) => !sources || sources.includes(source),
  );
  const marked = await Promise.all(
    accounts.map(async ([source, key]): Promise<Array<[string, string]>> => {
      try {
        await noticeSources.get(source)?.markAllRead?.(key);
        return [[source, key]];
      } catch (error) {
        saveNotificationRefresh(source, key, errorText(error));
        return [];
      }
    }),
  );
  markNotificationRowsRead(null, marked.flat());
  return publishNotificationState();
}

export function setNotificationSnooze(until: string | null): NotificationState {
  const db = database();
  if (until === null)
    db.prepare('DELETE FROM workspace_settings WHERE key = ?').run(NOTIFICATIONS_SNOOZE_KEY);
  else
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      NOTIFICATIONS_SNOOZE_KEY,
      until,
    );
  return publishNotificationState();
}
