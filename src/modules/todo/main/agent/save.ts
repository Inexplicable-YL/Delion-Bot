import { saveTodo } from '../store';
import { todoSaveSchema } from '../../contract';
import { tool, toolError } from '../../../../core/capabilities/domain-tools';

export const saveTodoTool = tool(
  'Create or update a local personal to-do. Pass id to update an existing item, completed to set its completion status, dueAt as a UTC ISO 8601 timestamp, and color to set its calendar color.',
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
