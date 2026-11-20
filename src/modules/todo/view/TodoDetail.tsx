import { CalendarClock, CircleCheckBig, Pencil, Trash2 } from 'lucide-react';
import { todoCompleted, todoStatusLabels, type TodoItem } from '../contract';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import { TodoSheet } from './TodoSheet';
import { dateLabel } from './todo-format';

export function TodoDetail({
  item,
  now,
  onClose,
  onEdit,
  onDelete,
}: {
  item: TodoItem;
  now: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue = !todoCompleted(item.status) && item.dueAt && Date.parse(item.dueAt) < now;
  return (
    <TodoSheet fixedHeight label="待办详情" title={item.title} onClose={onClose}>
      <div className="mt-3 shrink-0 space-y-1.5 text-sm text-ink-3">
        <p className="flex items-center gap-1.5">
          <CircleCheckBig className="size-3.5 shrink-0" />
          {todoStatusLabels[item.status]}
        </p>
        <p className={cn('flex items-center gap-1.5', overdue && 'text-danger')}>
          <CalendarClock className="size-3.5 shrink-0" />
          截止：{dateLabel(item.dueAt)}
        </p>
      </div>
      {item.notes && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-t pt-3 text-sm [scrollbar-width:none]">
          {item.notes}
        </div>
      )}
      <div className="mt-auto flex items-center justify-end gap-2 pt-4">
        <Button variant="ghost" onClick={onDelete}>
          <Trash2 className="size-4" />
          删除
        </Button>
        <Button onClick={onEdit}>
          <Pencil className="size-4" />
          编辑
        </Button>
      </div>
    </TodoSheet>
  );
}
