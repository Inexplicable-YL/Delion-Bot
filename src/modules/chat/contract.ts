import { z } from 'zod';
import type {
  ChatCommandView,
  ChatMediaView,
  ChatSessionSummary,
  FileChangeDetail,
} from '../../core/protocol/agent';
import { agentContract, chatMessageSchema } from '../../core/protocol/agent';
import type { UncommittedChanges } from '../../core/protocol/changes';
import { defineContract } from '../../core/protocol/contract';

const sessionId = z.uuid();
const sessionFile = z.object({ sessionId, path: z.string().min(1).max(32_767) });
const projectId = z.uuid();
const filePath = z.string().min(1).max(32_767);
const projectContext = z.object({ instruction: z.string(), files: z.array(filePath) });
const replyImageSource = z.union([
  z.object({ path: filePath }),
  z.object({ url: z.url({ protocol: /^https?$/ }) }),
]);
const replyImage = z.object({ sessionId, image: replyImageSource });
const chatImage = z.object({ id: z.uuid(), name: z.string().min(1).max(255) });
const permissionDecision = z.enum(['once', 'always', 'directory', 'deny']);
const permissionRequest = z.object({
  id: z.uuid(),
  kind: z.enum(['full', 'operation']),
  title: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
  grant: z
    .object({
      label: z.string(),
      scope: z.enum(['session', 'project']),
      directoryLabel: z.string().optional(),
    })
    .optional(),
});

export type PermissionDecision = z.infer<typeof permissionDecision>;
export type PermissionRequest = z.infer<typeof permissionRequest>;

export type ReplyImageSource = z.infer<typeof replyImageSource>;

const imagePreview = z.object({
  url: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const imagePreviewSource = z.union([replyImage, z.object({ id: z.uuid() })]);

export type ImagePreview = z.infer<typeof imagePreview>;
export type ImagePreviewSource = z.infer<typeof imagePreviewSource>;

const compactionHistoryMessage = chatMessageSchema.extend({
  compaction: z
    .object({ mode: z.enum(['manual', 'auto']), releasedTokens: z.number().optional() })
    .optional(),
});
const compactionTranscript = z.object({
  entryId: z.string(),
  messages: z.array(chatMessageSchema),
});

export type CompactionHistoryMessage = z.infer<typeof compactionHistoryMessage>;

const localCommandReply = z.object({
  input: z.string(),
  reply: z.string(),
  sentAt: z.number(),
  repliedAt: z.number(),
});
export type LocalCommandReply = z.infer<typeof localCommandReply>;

const fileTimeline = z.object({
  sessionId,
  path: filePath,
  entries: z.array(
    z.object({
      eventId: z.uuid(),
      at: z.string(),
      status: z.enum(['added', 'modified', 'deleted']),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('user') }),
        z.object({ kind: z.literal('revert') }),
        z.object({ kind: z.literal('turn'), sessionId, title: z.string().nullable() }),
        z.object({ kind: z.literal('branch'), sessionId, title: z.string().nullable() }),
      ]),
    }),
  ),
});

const procedures = {
  listSessions: agentContract.procedures['list-sessions'],
  permissionRequests: { input: sessionId, output: z.array(permissionRequest) },
  decidePermissionRequest: {
    input: z.object({
      sessionId,
      id: z.uuid(),
      decision: permissionDecision,
      note: z.string().trim().max(2000).optional(),
    }),
    output: z.boolean(),
  },
  localCommandReplies: { input: sessionId, output: z.array(localCommandReply) },
  runLocalCommand: {
    input: z.object({
      sessionId,
      name: z.enum(['compact', 'autocompact', 'name', 'reload']),
      args: z.string().trim().max(2000),
    }),
    output: z.array(localCommandReply),
  },
  compactionHistory: {
    input: sessionId,
    output: compactionTranscript.extend({ history: z.array(compactionHistoryMessage) }).nullable(),
  },
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
  referenceFilePath: { input: sessionFile, output: z.string() },
  referenceFileInfo: {
    input: sessionFile,
    output: z.object({ path: filePath, directory: z.boolean(), workspaceFolder: z.boolean() }),
  },
  openReferenceDirectory: { input: sessionFile, output: z.void() },
  readReferenceFile: { input: sessionFile, output: z.string() },
  hasVsCode: { input: z.undefined(), output: z.boolean() },
  openInVsCode: { input: sessionFile, output: z.void() },
  revealFile: { input: sessionFile, output: z.void() },
  openFile: { input: sessionFile, output: z.void() },
  saveReplyImage: { input: replyImage, output: z.boolean() },
  imagePreview: {
    input: imagePreviewSource,
    output: z
      .union([imagePreview, z.object({ bytes: z.instanceof(ArrayBuffer), mime: z.string() })])
      .nullable(),
  },
  stageReplyImage: { input: replyImage, output: z.custom<ChatMediaView>() },
  saveChatImage: { input: chatImage, output: z.boolean() },
  readUncommittedChanges: { input: projectId, output: z.custom<UncommittedChanges>() },
  readUncommittedFileChange: {
    input: z.object({ projectId, path: filePath }),
    output: z.custom<FileChangeDetail>(),
  },
  fileTimeline: { input: z.object({ path: filePath }), output: fileTimeline.nullable() },
  readFileVersion: {
    input: z.object({ sessionId, eventId: z.uuid(), path: filePath }),
    output: z.custom<FileChangeDetail>(),
  },
};

export const chatContract = defineContract('chat', procedures, {
  permissionRequestsChanged: z.object({ sessionId, requests: z.array(permissionRequest) }),
  permissionRequestOpened: z.object({ sessionId, projectId: projectId.nullable() }),
  compactionChanged: compactionTranscript.extend({ sessionId }),
  compactionStream: z.object({ sessionId, entryId: z.string(), message: chatMessageSchema }),
});

declare module '../../app/module' {
  interface NavTargets {
    chat: { projectId: string | null; sessionId?: string };
  }
}
