import { z } from 'zod';
import { copyResourceToProject } from '../resources';
import { resourceRefSchema, workspaceEntryIdSchema } from '../../contract';
import { tool } from '../../../../core/capabilities/domain-tools';

export const copyFileToProjectTool = tool(
  'Copy a referenced file into the destination workspace entry. Returns the new entry and its workspace reference.',
  z.object({ source: resourceRefSchema, parentId: workspaceEntryIdSchema }).strict(),
  copyResourceToProject,
);
