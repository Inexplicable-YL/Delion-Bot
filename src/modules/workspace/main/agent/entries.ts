import { z } from 'zod';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  removeWorkspaceEntry,
  updateWorkspaceEntry,
} from '../api';
import { workspaceEntryIdSchema } from '../../contract';
import { name, tool, toolError } from '../../../../core/capabilities/domain-tools';

export const createEntryTool = tool(
  'Create a local project, folder, or file. Use null for parentId to create it at the workspace root. File names are used as given, so include .md for notes. Use text to supply initial content. For files and folders, name may include a subpath such as notes/week1.md. Missing parent folders are created. A name conflict returns an error without overwriting or renaming anything.',
  z
    .object({
      parentId: workspaceEntryIdSchema.nullable(),
      kind: z.enum(['project', 'folder', 'file']),
      name,
      text: z.string().max(2_000_000).optional(),
    })
    .strict(),
  async (input) => {
    const entry = createWorkspaceEntry(input);
    return { ref: { type: 'workspace', id: entry.id }, entry };
  },
);

export const updateEntryTool = tool(
  'Rename or move a local workspace entry, or change its type between folder and project in place. Type conversion preserves the directory and its children. Returns the updated entry and path mappings.',
  z
    .object({
      id: workspaceEntryIdSchema,
      name: name.optional(),
      parentId: workspaceEntryIdSchema.nullable().optional(),
      kind: z.enum(['folder', 'project']).optional(),
    })
    .strict(),
  async ({ id, ...changes }) => {
    const update = updateWorkspaceEntry(id, changes);
    return {
      ref: { type: 'workspace', id: update.id },
      ...(update.fromPath ? { fromPath: update.fromPath, toPath: update.toPath } : {}),
      entry: getWorkspaceState().entries.find((e) => e.id === update.id),
    };
  },
);

export const removeEntryTool = tool(
  'Remove a local workspace entry. Ordinary files and folders go to the system trash. Removing a project deletes all its sessions, including archived ones, and preserves its directory and files. Removing a source reference only unlinks it. Archived folders cannot be removed.',
  z.object({ id: workspaceEntryIdSchema }).strict(),
  async ({ id }) => {
    try {
      await removeWorkspaceEntry(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('不存在'))
        throw toolError('NOT_FOUND', error.message);
      throw error;
    }
    return { removed: true, ref: { type: 'workspace', id } };
  },
);
