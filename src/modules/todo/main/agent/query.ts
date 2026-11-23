import { z } from 'zod';
import { getTodoState } from '../store';
import { todoCompleted } from '../../contract';
import {
  coverage,
  freshness,
  limit,
  match,
  offset,
  page,
  query,
  tool,
} from '../../../../core/capabilities/domain-tools';

export const queryTodosTool = tool(
  'Find personal tasks without modifying them. Search titles and notes by keyword or filter by completion status.',
  z.object({ query, completed: z.boolean().optional(), offset, limit }).strict(),
  ({ query, completed, offset, limit }) => {
    const items = getTodoState().items.filter(
      (item) =>
        match(`${item.title} ${item.notes}`, query) &&
        (completed === undefined || todoCompleted(item.status) === completed),
    );
    return {
      ...page(items, offset, limit),
      freshness: freshness('cached'),
      coverage: coverage('personal_todos', true),
    };
  },
);
