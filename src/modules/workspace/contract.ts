import type { FileFormat } from '../../core/protocol/files';
import type { RemoteDirectoryEntry, RemotePortsState } from '../remotes/contract';
import { workbenchLayoutSchema, type WorkbenchLayout } from './layout';
import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export * from './layout';
export * from './note-files';
export { parseRemoteNodeId } from '../remotes/contract';

export const workspaceEntryIdSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine(
    (value) =>
      z.uuid().safeParse(value).success || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i.test(value),
    { message: '请选择工作区文件路径或有效的条目' },
  );

export const resourceRefSchema = z
  .object({ type: z.literal('workspace'), id: workspaceEntryIdSchema })
  .strict();

export type ResourceRef = z.infer<typeof resourceRefSchema>;

export interface DocumentContent {
  title: string;
  format: FileFormat | 'html';
  text?: string;
  readOnly?: boolean;
  truncated?: boolean;
  bytes?: Uint8Array;
  previewUrl?: string;
  mime?: string;
  url?: string;
  updatedAt?: string | null;
  revision?: string;
  office?: { export?: OfficeExportInfo };
}

export interface OfficeExportInfo {
  previewUrl: string;
  title: string;
  stale: boolean;
}

export interface OfficeExportProgress {
  phase: 'preparing' | 'converting' | 'writing';
  bytes?: number;
}

export interface OfficeExportEvent extends OfficeExportProgress {
  ref: ResourceRef;
}

export interface WorkspaceEntryUpdate {
  id: string;
  fromPath?: string;
  toPath?: string;
}

export function relocateWorkspacePath(path: string, from: string, to: string): string {
  if (path === from) return to;
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(from);
  if (path.startsWith(`${from}/`) || (windows && path.startsWith(`${from}\\`)))
    return `${to}${path.slice(from.length)}`;
  return path;
}

export interface WorkspaceEntry {
  gitIgnored?: boolean;
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'file' | 'source';
  sourceId: string | null;
  path?: string;
  remoteId?: string | null;
  updatedAt: string;
}

export const workspaceArchiveId = '00000000-0000-4000-8000-000000000001';

export const hiddenWorkspaceNames = new Set(['.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']);

export interface WorkspaceState {
  entries: WorkspaceEntry[];
  directory: string;
  archivePath?: string;
}

export interface WorkspaceCreateInput {
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'file' | 'source';
  sourceId?: string;
  text?: string;
}

const entryId = workspaceEntryIdSchema;
const projectId = workspaceEntryIdSchema;
const remotePath = z.string().min(1).max(4096);
const localPaths = z.array(z.string().min(1).max(32_767)).max(100);
const port = z.number().int().min(1).max(65535);
const entries = z.custom<WorkspaceEntry[]>();
const document = z.custom<DocumentContent>();
const resourceRef = z.custom<ResourceRef>();

export const workspaceContract = defineContract(
  'workspace',
  {
    state: { input: z.undefined(), output: z.custom<WorkspaceState>() },
    listLocalDirectory: { input: entryId.nullable(), output: entries },
    searchLocal: {
      input: z.object({ rootId: entryId.nullable(), query: z.string().max(200) }),
      output: entries,
    },
    localReferenceFiles: { input: entryId, output: entries },
    localAncestors: { input: entryId, output: entries },
    create: { input: z.custom<WorkspaceCreateInput>(), output: z.custom<WorkspaceEntry>() },
    update: {
      input: z.object({
        id: entryId,
        patch: z.custom<{ name?: string; parentId?: string | null; kind?: 'folder' | 'project' }>(),
      }),
      output: z.custom<WorkspaceEntryUpdate>(),
    },
    remove: { input: entryId, output: z.void() },
    read: { input: entryId, output: document },
    readHtmlAsset: {
      input: z.object({
        documentId: z.string().min(1).max(32_767),
        path: z.string().min(1).max(4096),
      }),
      output: z.object({ mime: z.string(), content: z.string() }).nullable(),
    },
    readSource: { input: z.string().max(512), output: document },
    saveNote: {
      input: z.object({
        id: entryId,
        text: z.string().max(2_000_000),
        revision: z.string().length(64),
      }),
      output: z.string(),
    },
    saveNoteImage: {
      input: z.object({
        id: entryId,
        name: z
          .string()
          .min(1)
          .max(200)
          .refine((value) => !value.includes('/') && !value.includes('\\')),
        bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
      }),
      output: z.string(),
    },
    openProjectDirectory: {
      input: z.object({ id: projectId, target: z.enum(['vscode', 'explorer']) }),
      output: z.void(),
    },
    projectBranch: { input: projectId, output: z.custom<string | null>() },
    projectBranches: { input: projectId, output: z.custom<string[]>() },
    switchProjectBranch: {
      input: z.object({
        id: projectId,
        branch: z
          .string()
          .min(1)
          .max(255)
          .refine((value) => !value.startsWith('-')),
      }),
      output: z.void(),
    },
    exportOfficePdf: { input: resourceRef, output: z.void() },
    openResourceFile: { input: resourceRef, output: z.void() },
    importFiles: { input: entryId.nullable(), output: z.void() },
    importDroppedFiles: {
      input: z.object({ parentId: entryId.nullable(), paths: localPaths.min(1) }),
      output: z.void(),
    },
    importProjectFolder: { input: z.undefined(), output: z.custom<WorkspaceEntry | null>() },
    importRemoteProject: {
      input: z.object({ remoteId: z.string(), path: z.string(), name: z.string().optional() }),
      output: z.custom<WorkspaceEntry>(),
    },
    listRemoteDirectory: {
      input: z.object({ projectId, path: remotePath }),
      output: z.custom<RemoteDirectoryEntry[]>(),
    },
    readRemoteDocument: { input: z.object({ projectId, path: remotePath }), output: document },
    downloadRemoteFile: {
      input: z.object({ projectId, path: remotePath }),
      output: z.custom<string | null>(),
    },
    openRemoteFile: { input: z.object({ projectId, path: remotePath }), output: z.void() },
    uploadRemoteFiles: {
      input: z.object({ projectId, directory: remotePath, paths: localPaths.nullable() }),
      output: z.custom<string[]>(),
    },
    remotePorts: { input: projectId, output: z.custom<RemotePortsState>() },
    openRemotePort: {
      input: z.object({ projectId, port }),
      output: z.custom<{ localPort: number }>(),
    },
    closeRemotePort: { input: z.object({ projectId, port }), output: z.void() },
    watchRemoteDirectories: {
      input: z.object({ projectId, paths: z.array(remotePath).max(4096) }),
      output: z.custom<{ watching: number }>(),
    },
    remoteReferences: { input: projectId, output: z.custom<{ key: string; title: string }[]>() },
    openLocal: { input: entryId, output: z.void() },
    openFile: { input: entryId, output: z.void() },
    downloadFile: { input: entryId, output: z.custom<string | null>() },
    chooseDirectory: { input: z.undefined(), output: z.string() },
    layout: { input: z.uuid().nullable(), output: z.custom<WorkbenchLayout | null>() },
    saveLayout: {
      input: z.object({ projectId: z.uuid().nullable(), layout: workbenchLayoutSchema }),
      output: z.void(),
    },
  },
  {
    changed: z.custom<string[]>(),
    officeExportProgress: z.custom<OfficeExportEvent>(),
    remoteChange: z.string(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    projects: { entryId: string };
    sources: { sourceId: string };
  }
}
