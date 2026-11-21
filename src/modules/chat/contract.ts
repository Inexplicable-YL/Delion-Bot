import { z } from 'zod';
import type {
  ChatCommandView,
  ChatMediaView,
  ChatSessionSummary,
  FileChangeDetail,
} from '../../core/protocol/agent';
import type { UncommittedChanges } from '../../core/protocol/changes';
import { defineContract } from '../../core/protocol/contract';

const sessionId = z.uuid();
const sessionFile = z.object({ sessionId, path: z.string().min(1).max(32_767) });
const projectId = z.uuid();
const filePath = z.string().min(1).max(32_767);
const projectContext = z.object({ instruction: z.string(), files: z.array(filePath) });

export const chatContract = defineContract('chat', {
  projectContext: { input: projectId, output: projectContext },
  setProjectInstruction: {
    input: z.object({ projectId, instruction: z.string().trim().max(2000) }),
    output: projectContext,
  },
  addProjectFiles: {
    input: z.object({
      projectId,
      files: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('pick') }),
        z.object({ kind: z.literal('paths'), paths: z.array(filePath).min(1).max(100) }),
        z.object({ kind: z.literal('entry'), id: filePath }),
      ]),
    }),
    output: projectContext,
  },
  removeProjectFile: { input: z.object({ projectId, path: filePath }), output: projectContext },
  archived: { input: z.undefined(), output: z.custom<ChatSessionSummary[]>() },
  update: {
    input: z.object({
      id: sessionId,
      patch: z
        .object({ archived: z.boolean().optional(), pinned: z.boolean().optional() })
        .strict(),
    }),
    output: z.void(),
  },
  move: { input: z.object({ id: sessionId, projectId: z.uuid().nullable() }), output: z.void() },
  archiveProject: { input: z.uuid().nullable(), output: z.custom<string[]>() },
  export: { input: sessionId, output: z.custom<{ saved: boolean; missing: string[] }>() },
  remove: { input: sessionId, output: z.void() },
  pickMedia: { input: z.undefined(), output: z.custom<ChatMediaView[]>() },
  saveCommand: {
    input: z.custom<{ id?: string; name: string; prompt: string }>(),
    output: z.custom<ChatCommandView>(),
  },
  deleteCommand: { input: z.uuid(), output: z.void() },
  locateFile: { input: sessionFile, output: z.string() },
  openInVsCode: { input: sessionFile, output: z.void() },
  revealFile: { input: sessionFile, output: z.void() },
  openFile: { input: sessionFile, output: z.void() },
  readUncommittedChanges: { input: projectId, output: z.custom<UncommittedChanges>() },
  readUncommittedFileChange: {
    input: z.object({ projectId, path: filePath }),
    output: z.custom<FileChangeDetail>(),
  },
});

declare module '../../app/module' {
  interface NavTargets {
    chat: { projectId: string | null; sessionId?: string };
  }
}
