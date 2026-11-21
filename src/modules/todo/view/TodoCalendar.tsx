import { useState } from 'react';
import { todoCompleted, type TodoItem } from '../contract';
import { CountBadge } from '../../../ui/CountBadge';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/Popover';
import { cn } from '../../../ui/cn';
import { dateKey, eventColorStyle, formatMonthDay, formatTime, weekDays } from './calendar';
import { groupTodosByDay, monthGridDays } from './todo-calendar';

function TodoChip({ item, onOpen }: { item: TodoItem; onOpen: (item: TodoItem) => void }) {
  const done = todoCompleted(item.status);
  const time = item.dueAt ? formatTime(new Date(item.dueAt)) : '';
  return (
    <button
      type="button"
      aria-label={`打开 ${item.title}${time ? `，${time}` : ''}${done ? '，已完成' : ''}`}
      className="flex min-h-control-xs w-full min-w-0 items-center gap-1.5 rounded-control px-2 text-left text-ui-caption hover:brightness-95 touch:min-h-control-lg"
      onClick={() => onOpen(item)}
      style={eventColorStyle(item.color ?? 'slate')}
      title={item.title}
    >
      {time && <span className="shrink-0 tabular-nums">{time}</span>}
      <span className={cn('truncate', done && 'line-through')}>{item.title}</span>
    </button>
  );
}

function DayEntries({
  date,
  items,
  compact = false,
  onOpen,
}: {
  date: Date;
  items: readonly TodoItem[];
  compact?: boolean;
  onOpen: (item: TodoItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${formatMonthDay(date)}，查看 ${items.length} 个待办`}
        className={cn(
          'flex min-h-control-xs items-center rounded-control text-ui-caption text-ink-2 hover:bg-hover touch:min-h-control-lg',
          compact ? 'justify-center @md:hidden' : 'hidden px-2 @md:flex',
        )}
      >
        {compact ? <CountBadge count={items.length} /> : `另有 ${items.length - 2} 项`}
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64">
        <p className="px-2.5 py-2 text-ui-headline">{formatMonthDay(date)}</p>
        <ul className="grid gap-1 p-1">
          {items.map((item) => (
            <li key={item.id}>
              <TodoChip
                item={item}
                onOpen={(item) => {
                  setOpen(false);
                  onOpen(item);
                }}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function TodoCalendar({
  items,
  month,
  onOpenItem,
}: {
  items: readonly TodoItem[];
  month: Date;
  onOpenItem: (item: TodoItem) => void;
}) {
  const grouped = groupTodosByDay(items);
  const days = monthGridDays(month);
  const todayKey = dateKey(new Date());

  return (
    <div className="@container">
      <div className="grid grid-cols-7 border-b border-line bg-page/50">
        {weekDays.map((day) => (
          <div className="py-2 text-center text-ui-subhead text-ink-2" key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-b-card">
        {days.map((date) => {
          const key = dateKey(date);
          const dayItems = grouped.get(key) ?? [];
          const currentMonth = date.getMonth() === month.getMonth();
          const today = key === todayKey;
          return (
            <div
              className={cn(
                'flex min-h-calendar-day-compact min-w-0 flex-col border-b border-e border-line p-1 text-left @md:min-h-calendar-day @md:p-2 [&:nth-child(7n)]:border-e-0 [&:nth-last-child(-n+7)]:border-b-0',
                !currentMonth && 'bg-page/60 text-ink-2',
              )}
              key={key}
            >
              <time
                aria-current={today ? 'date' : undefined}
                className={cn(
                  'grid size-6 shrink-0 place-items-center self-center rounded-pill text-ui-subhead tabular-nums @md:self-start',
                  today && 'bg-accent-tint text-accent-ink',
                )}
                dateTime={key}
                title={formatMonthDay(date)}
              >
                {date.getDate()}
              </time>
              {dayItems.length > 0 && (
                <>
                  <DayEntries compact date={date} items={dayItems} onOpen={onOpenItem} />
                  <div className="mt-1 hidden min-w-0 gap-1 @md:grid">
                    {dayItems.slice(0, 2).map((item) => (
                      <TodoChip item={item} key={item.id} onOpen={onOpenItem} />
                    ))}
                    {dayItems.length > 2 && (
                      <DayEntries date={date} items={dayItems} onOpen={onOpenItem} />
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
