import { saveTodo } from '../store';
import { todoSaveSchema } from '../../contract';
import { tool, toolError } from '../../../../core/capabilities/domain-tools';

export const saveTodoTool = tool(
  '新建或修改个人待办（本地写）。提供 id 时更新已有条目；completed 控制完成状态；dueAt 为 UTC ISO 8601，color 设置日历颜色。',
  todoSaveSchema,
  (input) => {
    try {
      return saveTodo(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('待办不存在')) throw toolError('NOT_FOUND', message);
      throw error;
    }
  },
);
