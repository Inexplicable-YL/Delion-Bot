import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../../../src/modules/notifications', () => ({ systemNotifyToast: vi.fn() }));

import { provideTestHostPorts } from '../../../core/host-mock';
import { systemNotifyToast } from '../../../../src/modules/notifications';
import { notifyRunFinished } from '../../../../src/modules/settings/main/task-notify';
import { setTaskNotificationPrefs } from '../../../../src/modules/settings/main/prefs';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

provideTestHostPorts({ database: () => database as never });

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
  `);
  insert("INSERT INTO sessions VALUES ('session-1', '整理复习计划')");
  vi.mocked(systemNotifyToast).mockClear();
});

describe('notifyRunFinished', () => {
  it('notifies on failure by default and includes the session title', () => {
    notifyRunFinished('session-1', 'failed');
    expect(systemNotifyToast).toHaveBeenCalledWith('任务失败', '整理复习计划');
  });

  it('does not notify on completion by default (low-noise default)', () => {
    notifyRunFinished('session-1', 'completed');
    expect(systemNotifyToast).not.toHaveBeenCalled();
  });

  it('respects the completed switch once enabled', () => {
    setTaskNotificationPrefs({ completed: true, failed: true });
    notifyRunFinished('session-1', 'completed');
    expect(systemNotifyToast).toHaveBeenCalledWith('任务完成', '整理复习计划');
  });
});
