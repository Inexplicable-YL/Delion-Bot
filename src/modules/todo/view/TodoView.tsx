import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDaysIcon as CalendarDays,
  CheckCircleIcon as CircleCheckBig,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  ListBulletIcon as List,
  MinusCircleIcon as Circle,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash2,
  XMarkIcon as X,
} from '@heroicons/react/24/outline';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import {
  todoCompleted,
  todoContract,
  todoStatusLabels,
  type CalendarEventColor,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
} from '../contract';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/Dialog';
import { Textarea } from '../../../ui/Textarea';
import { useNow } from '../../../ui/use-now';
import { CountBadge } from '../../../ui/CountBadge';
import { EmptyState } from '../../../ui/EmptyState';
import { Card } from '../../../ui/Card';
import { Input } from '../../../ui/Input';
import { Field } from '../../../ui/Field';
import { IconButton } from '../../../ui/IconButton';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { Switch } from '../../../ui/Switch';
import { cn } from '../../../ui/cn';
import { showToast } from '../../../ui/Toast';
import { EventColorRow } from './EventColorRow';
import { dateKey, startOfDay } from './calendar';
import { TodoCalendar } from './TodoCalendar';
import { monthLabel } from './todo-calendar';
import { TodoDetail } from './TodoDetail';
import { TodoSheet } from './TodoSheet';
import { useTodoPreferences } from './preferences';
import { dateLabel } from './todo-format';
import { ErrorText } from '../../../ui/Alert';
import type { NavTargets } from '../../../app/module';

const views = ['calendar', 'list'] as const;

const todo = createClient(todoContract, window.delionBot?.bridge);

export function useTodoState() {
  return useQuery({ queryKey: ['todo', 'state'], queryFn: () => todo.state() });
}

function deadlineFields(date: Date) {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return { date: dateKey(date), time: `${hour}:${minute}` };
}

function defaultDeadline() {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return deadlineFields(date);
}

const rowActionClass =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100';

function TodoComposer({
  item,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  item?: TodoItem;
  busy: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (input: TodoSaveInput) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [deadline, setDeadline] = useState(() =>
    item ? (item.dueAt ? deadlineFields(new Date(item.dueAt)) : null) : defaultDeadline(),
  );
  const [color, setColor] = useState<CalendarEventColor>(item?.color ?? 'slate');
  return (
    <TodoSheet title={item ? '编辑待办' : '新建待办'} onClose={onCancel}>
      <form
        className="mt-app-gap flex flex-col gap-app-gap"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            id: item?.id,
            title,
            notes,
            dueAt: deadline ? new Date(`${deadline.date}T${deadline.time}`).toISOString() : null,
            color,
          });
        }}
      >
        <Field label="标题">
          <Input
            aria-label="标题"
            autoFocus
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：准备周会材料"
            value={title}
          />
        </Field>
        <fieldset className="min-w-0">
          <legend className="text-ui-body">截止时间</legend>
          {deadline ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                aria-label="截止日期"
                className="w-auto flex-2"
                max="9999-12-31"
                min="0001-01-01"
                onChange={(event) => setDeadline({ ...deadline, date: event.target.value })}
                required
                type="date"
                value={deadline.date}
              />
              <Input
                aria-label="截止时刻"
                className="w-auto flex-1"
                onChange={(event) => setDeadline({ ...deadline, time: event.target.value })}
                required
                type="time"
                value={deadline.time}
              />
              <IconButton
                aria-label="清除截止时间"
                title="清除截止时间"
                onClick={() => setDeadline(null)}
              >
                <X />
              </IconButton>
            </div>
          ) : (
            <Button
              className="mt-2"
              variant="secondary"
              onClick={() => setDeadline(defaultDeadline())}
            >
              <Plus />
              设置截止时间
            </Button>
          )}
        </fieldset>
        <EventColorRow onColorChange={setColor} value={color} />
        <Field label="备注">
          <Textarea
            className="min-h-20 resize-y"
            maxLength={10000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="添加备注"
            rows={3}
            value={notes}
          />
        </Field>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          {item && onDelete ? (
            <Button
              variant="ghost"
              aria-label="删除待办"
              title="删除待办"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              取消
            </Button>
            <Button disabled={busy || !title.trim()} type="submit" variant="accent">
              保存
            </Button>
          </div>
        </div>
      </form>
    </TodoSheet>
  );
}

export function TodoView({ target }: { target: NavTargets['todo'] }) {
  const now = useNow(60_000);
  const query = useTodoState();
  const state = query.data ?? null;
  const error = query.error ? errorMessage(query.error) : null;
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<(typeof views)[number]>('calendar');
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const showCompleted = useTodoPreferences((state) => state.showCompleted);
  const [detailId, setDetailId] = useState<string | null>(target.todoId ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TodoItem | null>(null);
  const [shownTarget, setShownTarget] = useState(target);
  if (target !== shownTarget) {
    setShownTarget(target);
    if (target.todoId) {
      setCreating(false);
      setEditingId(null);
      setDetailId(target.todoId);
    }
  }
  const run = async (
    operation: () => Promise<TodoState>,
    options?: { after?: () => void; failTitle?: string },
  ) => {
    setBusy(true);
    const after = options?.after;
    const failTitle = options?.failTitle ?? '待办操作失败';
    try {
      await operation();
      if (after) after();
    } catch (reason) {
      showToast({
        variant: 'error',
        title: failTitle,
        description: errorMessage(reason),
      });
    }
    setBusy(false);
  };
  const detail = state?.items.find((item) => item.id === detailId);
  const editing = state?.items.find((item) => item.id === editingId);
  const items = state?.items.filter((item) => showCompleted || !todoCompleted(item.status)) ?? [];
  const pendingCount = state?.items.filter((item) => !todoCompleted(item.status)).length ?? 0;
  const stepMonth = (amount: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-page">
      <div className="mx-auto grid w-full max-w-todo gap-app-gap p-app">
        <header className="flex flex-wrap items-start justify-between gap-app-gap">
          <div className="grid gap-1">
            <h1 className="text-ui-large-title">待办</h1>
            <p className="flex items-center gap-2 text-ui-callout text-ink-2">
              未完成 <CountBadge count={pendingCount} />
            </p>
          </div>
          <Button
            variant="accent"
            disabled={!window.delionBot}
            onClick={() => {
              setCreating(true);
              setEditingId(null);
              setDetailId(null);
            }}
          >
            <Plus />
            新建待办
          </Button>
        </header>
        {error && <ErrorText size="sm">{error}</ErrorText>}
        <div className="flex flex-wrap items-center justify-between gap-app-gap">
          <SegmentedControl
            aria-label="待办视图"
            icons={{ calendar: CalendarDays, list: List }}
            labels={{ calendar: '日历', list: '列表' }}
            onChange={setView}
            options={views}
            value={view}
          />
          <div className="flex items-center gap-2 text-ui-callout text-ink-2">
            显示已完成
            <Switch
              checked={showCompleted}
              label="显示已完成"
              onChange={(showCompleted) => useTodoPreferences.setState({ showCompleted })}
            />
          </div>
        </div>
        {!state ? (
          <p className="py-8 text-center text-ui-body text-ink-2">
            {window.delionBot ? '正在加载…' : '请在 Delion Bot 桌面端使用 TODO'}
          </p>
        ) : view === 'calendar' ? (
          <Card className="overflow-visible" asChild>
            <section aria-labelledby="todo-calendar-month">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-card-ui py-2">
                <h2 className="text-ui-title-2 tabular-nums" id="todo-calendar-month">
                  {monthLabel(month)}
                </h2>
                <div aria-label="切换月份" className="flex items-center gap-1" role="group">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMonth(startOfDay(new Date()))}
                  >
                    今天
                  </Button>
                  <IconButton aria-label="上个月" title="上个月" onClick={() => stepMonth(-1)}>
                    <ChevronLeft />
                  </IconButton>
                  <IconButton aria-label="下个月" title="下个月" onClick={() => stepMonth(1)}>
                    <ChevronRight />
                  </IconButton>
                </div>
              </div>
              <TodoCalendar
                items={items}
                month={month}
                onOpenItem={(item) => setDetailId(item.id)}
              />
            </section>
          </Card>
        ) : !items.length ? (
          <EmptyState title="暂无符合条件的待办" />
        ) : (
          <ul className="overflow-hidden rounded-card bg-surface shadow-card">
            {items.map((item) => {
              const done = todoCompleted(item.status);
              const overdue = !done && item.dueAt && Date.parse(item.dueAt) < now;
              return (
                <li
                  key={item.id}
                  className="group flex items-start gap-3 min-h-row-regular border-b border-line px-3 py-2.5 transition-colors duration-base last:border-0 hover:bg-hover"
                >
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-0.5 shrink-0 text-ink-2 hover:text-ink"
                    aria-label={done ? `重新打开 ${item.title}` : `完成 ${item.title}`}
                    onClick={() =>
                      void run(() =>
                        todo.save({
                          id: item.id,
                          title: item.title,
                          completed: !done,
                        }),
                      )
                    }
                  >
                    {done ? <CircleCheckBig className="size-5" /> : <Circle className="size-5" />}
                  </button>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setDetailId(item.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('break-words text-ui-headline', done && 'text-ink-2')}>
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-1 text-ui-subhead text-ink-2">
                      {todoStatusLabels[item.status]}
                    </p>
                    <p
                      className={cn('mt-1 text-ui-subhead', overdue ? 'text-danger' : 'text-ink-2')}
                    >
                      {overdue ? '已过截止时间 · ' : ''}
                      {dateLabel(item.dueAt)}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 self-center">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      className={rowActionClass}
                      aria-label={`编辑 ${item.title}`}
                      title="编辑"
                      onClick={() => {
                        setDetailId(null);
                        setEditingId(item.id);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      className={rowActionClass}
                      aria-label={`删除 ${item.title}`}
                      title="删除"
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {detail && (
        <TodoDetail
          item={detail}
          now={now}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditingId(detail.id);
          }}
          onDelete={() => setDeleting(detail)}
        />
      )}
      {(creating || editing) && (
        <TodoComposer
          key={editing ? editing.id : 'new'}
          item={editing}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onDelete={editing ? () => setDeleting(editing) : undefined}
          onSave={(input) =>
            void run(() => todo.save(input), {
              after: () => {
                setCreating(false);
                setEditingId(null);
              },
              failTitle: '保存待办失败',
            })
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
        title="删除待办？"
        description={deleting ? `将永久删除「${deleting.title}」。` : ''}
        confirmLabel="删除待办"
        busy={busy}
        destructive
        onConfirm={() => {
          if (!deleting) return;
          void run(() => todo.remove(deleting.id), {
            after: () => {
              if (detailId === deleting.id) setDetailId(null);
              if (editingId === deleting.id) setEditingId(null);
              setDeleting(null);
            },
            failTitle: '删除待办失败',
          });
        }}
      />
    </div>
  );
}
