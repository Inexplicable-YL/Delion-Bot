import { z } from 'zod';
import { getTodoState, removeTodo } from '../store';
import { tool, toolError } from '../../../../core/capabilities/domain-tools';

export const removeTodoTool = tool(
  '删除个人待办（本地写）。未知 id 返回 NOT_FOUND。',
  z.object({ id: z.string().min(1).max(512) }).strict(),
  ({ id }) => {
    const target = getTodoState().items.find((item) => item.id === id);
    if (!target) throw toolError('NOT_FOUND', '待办不存在或已删除');
    return { removedId: id, ...removeTodo(id) };
  },
);
