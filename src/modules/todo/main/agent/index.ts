import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from './skill/SKILL.md?raw';
import { queryTodosTool } from './query';
import { removeTodoTool } from './remove';
import { saveTodoTool } from './save';

export const todoDomain = {
  name: 'todo',
  description: 'Find and manage personal to-dos.',
  skill: { name: 'todo', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    query_todos: queryTodosTool,
    save_todo: saveTodoTool,
    remove_todo: removeTodoTool,
  },
} satisfies CommandDomain;
