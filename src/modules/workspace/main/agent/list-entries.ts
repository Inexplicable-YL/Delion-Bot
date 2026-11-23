import { z } from 'zod';
import { getWorkspaceState } from '../api';
import { workspaceEntryIdSchema } from '../../contract';
import {
  limit,
  match,
  offset,
  page,
  query,
  tool,
} from '../../../../core/capabilities/domain-tools';

export const listWorkspaceEntriesTool = tool(
  'Browse or loosely filter workspace entries by name. This read-only command covers projects, folders, notes, source references, and local files. Leave query empty to browse. Pass parentId to list only its direct children or omit it to list all entries. Returns entries and references readable with delion read_resource.',
  z
    .object({ query, parentId: workspaceEntryIdSchema.nullable().optional(), offset, limit })
    .strict(),
  async ({ query, parentId, offset, limit }) =>
    page(
      getWorkspaceState()
        .entries.filter(
          (item) =>
            (parentId === undefined || item.parentId === parentId) && match(item.name, query),
        )
        .map((item) => ({ ...item, ref: { type: 'workspace', id: item.id } })),
      offset,
      limit,
    ),
);
