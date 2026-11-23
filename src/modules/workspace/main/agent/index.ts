import type { CommandDomain } from '../../../../core/capabilities/commands';
import { copyFileToProjectTool } from './copy-file';
import { createEntryTool, removeEntryTool, updateEntryTool } from './entries';
import { listWorkspaceEntriesTool } from './list-entries';

export const workspaceDomain = {
  name: 'workspace',
  description:
    'Manage projects and import attachments. Use read, write, edit, or bash for ordinary files.',
  commands: {
    list_workspace_entries: listWorkspaceEntriesTool,
    create_entry: createEntryTool,
    update_entry: updateEntryTool,
    remove_entry: removeEntryTool,
    copy_file_to_project: copyFileToProjectTool,
  },
} satisfies CommandDomain;
