import {
  CalendarDateRangeIcon as CalendarClock,
  CheckCircleIcon as CircleCheckBig,
  PencilIcon as Pencil,
  TrashIcon as Trash2,
} from '@heroicons/react/24/outline';
import { todoCompleted, todoStatusLabels, type TodoItem } from '../contract';
import { Button } from '../../../ui/Button';
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
    <TodoSheet title={item.title} onClose={onClose}>
      <div className="mt-3 shrink-0 space-y-1.5 text-ui-body text-ink-2">
        <p className="flex items-center gap-1.5">
          <CircleCheckBig className="size-4 shrink-0" />
          {todoStatusLabels[item.status]}
        </p>
        <p className={cn('flex items-center gap-1.5', overdue && 'text-danger')}>
          <CalendarClock className="size-4 shrink-0" />
          {overdue ? `已逾期 · ${dateLabel(item.dueAt)}` : dateLabel(item.dueAt)}
        </p>
      </div>
      {item.notes && (
        <div className="mt-3 whitespace-pre-wrap wrap-anywhere border-t pt-3 text-ui-body [scrollbar-width:none]">
          {item.notes}
        </div>
      )}
      <div className="mt-auto flex items-center justify-end gap-2 pt-4">
        <Button variant="ghost" onClick={onDelete}>
          <Trash2 className="size-4" />
          删除
        </Button>
        <Button onClick={onEdit} variant="accent">
          <Pencil className="size-4" />
          编辑
        </Button>
      </div>
    </TodoSheet>
  );
}
