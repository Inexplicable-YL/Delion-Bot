import { defineModule } from '../../app/module';
import { statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { readUncommittedChanges, readUncommittedFileChange } from '../../core/agent/changes';
import { deleteChatCommand, saveChatCommand } from '../../core/agent/chat-commands';
import { watchChatFiles } from '../../core/agent/chat-files';
import { getProjectChatContext, setProjectChatContext } from '../../core/agent/instruction';
import { stageChatMediaFiles } from '../../core/agent/media';
import {
  archiveProjectSessions,
  deleteSession,
  moveSession,
  runLocalSessionCommand,
  updateSessionVisibility,
} from '../../core/agent/session/commands';
import {
  chatFileTimeline,
  locateSessionFile,
  openSessionFile,
  readChatFileVersionChange,
  revealSessionFile,
} from '../../core/agent/session/files';
import {
  archivedSessions,
  listSessions,
  localCommandReplies,
  preloadPi,
  row,
} from '../../core/agent/session/store';
import { invalidateSessions } from '../../core/agent/session/run';
import { live, sessionBranch } from '../../core/agent/session/live';
import {
  projectAfterCompaction,
  projectCompactionHistory,
} from '../../core/agent/session/projection';
import { exportSession } from '../../core/agent/session-export';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { hasVsCode, registerPreviewHost, workspaceFilePath } from '../workspace';
import { chatContract } from './contract';
import { decidePermissionRequest, permissionRequests } from './main/permission-requests';
import {
  chatMediaResponse,
  readImagePreview,
  replyImageResponse,
  saveChatImage,
  saveReplyImage,
  stageReplyImage,
} from './main/reply-image';
import {
  openReferenceDirectory,
  openReferenceInVsCode,
  readReferenceFile,
  referenceFileInfo,
  referenceFilePath,
} from './main/reference-file';

function withPi<I, O>(fn: (input: I) => O | Promise<O>): (input: I) => Promise<O> {
  return async (input) => {
    await preloadPi();
    return fn(input);
  };
}

function updateProjectContext(
  projectId: string,
  patch: Parameters<typeof setProjectChatContext>[1],
) {
  if (!hostPorts().projects.find(projectId)) throw new Error('项目不存在');
  const context = setProjectChatContext(projectId, patch);
  invalidateSessions();
  return context;
}

function localProjectDirectory(projectId: string): string {
  const projects = hostPorts().projects;
  const directory = projects.find(projectId)?.path;
  if (!directory) throw new Error('项目目录不存在');
  if (projects.remoteOf(projectId)) throw new Error('远程项目暂不支持变更审阅');
  return directory;
}

export { chatContract };
export { requestChatPermission } from './main/permission-requests';
export { notifyAwaitingAnswer } from './main/awaiting-answer';

export function liveCompactionTranscript(sessionId: string, streaming = false) {
  const session = live.get(sessionId)?.session;
  return (
    session && projectAfterCompaction(sessionId, session.sessionManager.getBranch(), streaming)
  );
}

export const chatModule = defineModule({
  id: 'chat',
  register: () => {
    registerPreviewHost('reply-image', replyImageResponse);
    registerPreviewHost('chat-media', chatMediaResponse);
  },
  ipc: implement(chatContract, {
    listSessions: ({ projectId, query }) => listSessions(projectId, query, true),
    permissionRequests,
    decidePermissionRequest,
    localCommandReplies: (id) => {
      row(id);
      return localCommandReplies(id);
    },
    runLocalCommand: withPi(({ sessionId, name, args }) =>
      runLocalSessionCommand(sessionId, name, args),
    ),
    compactionHistory: withPi((id) => {
      const { branch } = sessionBranch(id);
      const transcript = projectAfterCompaction(id, branch);
      return transcript && { ...transcript, history: projectCompactionHistory(branch) };
    }),
    projectContext: getProjectChatContext,
    setProjectInstruction: ({ projectId, instruction }) =>
      updateProjectContext(projectId, { instruction }),
    addProjectFiles: async ({ projectId, files }) => {
      if (hostPorts().projects.remoteOf(projectId)) throw new Error('远程项目无法引用本机文件');
      const owner = hostPorts().workspaceClient();
      const paths =
        files.kind === 'entry'
          ? [await workspaceFilePath(files.id)]
          : files.kind === 'paths'
            ? files.paths
            : owner
              ? await hostPorts().desktop.pickFiles(owner)
              : [];
      const current = getProjectChatContext(projectId);
      if (!paths.length) return current;
      const references = paths.map((path) => {
        if (!isAbsolute(path) || !statSync(path, { throwIfNoEntry: false })?.isFile())
          throw new Error('请选择可读取的文件');
        return normalize(path);
      });
      return updateProjectContext(projectId, {
        files: [...new Set([...current.files, ...references])],
      });
    },
    removeProjectFile: ({ projectId, path }) =>
      updateProjectContext(projectId, {
        files: getProjectChatContext(projectId).files.filter((file) => file !== path),
      }),
    archived: archivedSessions,
    update: withPi(({ id, patch }) => updateSessionVisibility(id, patch)),
    move: withPi(({ id, projectId }) => moveSession(id, projectId)),
    archiveProject: withPi(archiveProjectSessions),
    export: (id) => exportSession(id, hostPorts().workspaceClient()),
    remove: withPi(async (id) => {
      if (!archivedSessions().some((session) => session.id === id))
        throw new Error('请先归档，再从设置中永久删除');
      await deleteSession(id);
    }),
    pickMedia: async () => {
      const owner = hostPorts().workspaceClient();
      return owner ? stageChatMediaFiles(await hostPorts().desktop.pickFiles(owner)) : [];
    },
    saveCommand: saveChatCommand,
    deleteCommand: deleteChatCommand,
    locateFile: ({ sessionId, path }) => locateSessionFile(sessionId, path),
    referenceFilePath: ({ sessionId, path }) => referenceFilePath(sessionId, path),
    referenceFileInfo: ({ sessionId, path }) => referenceFileInfo(sessionId, path),
    openReferenceDirectory: ({ sessionId, path }) => openReferenceDirectory(sessionId, path),
    readReferenceFile: ({ sessionId, path }) => readReferenceFile(sessionId, path),
    hasVsCode,
    openInVsCode: ({ sessionId, path }) => openReferenceInVsCode(sessionId, path),
    revealFile: ({ sessionId, path }) => revealSessionFile(sessionId, path),
    openFile: ({ sessionId, path }) => openSessionFile(sessionId, path),
    saveReplyImage: ({ sessionId, image }) => saveReplyImage(sessionId, image),
    imagePreview: readImagePreview,
    stageReplyImage: ({ sessionId, image }) => stageReplyImage(sessionId, image),
    saveChatImage: ({ id, name }) => saveChatImage(id, name),
    readUncommittedChanges: (projectId) => readUncommittedChanges(localProjectDirectory(projectId)),
    readUncommittedFileChange: ({ projectId, path }) =>
      readUncommittedFileChange(localProjectDirectory(projectId), path),
    fileTimeline: ({ path }) => chatFileTimeline(path),
    readFileVersion: ({ sessionId, fromEventId, toEventId, path }) =>
      readChatFileVersionChange(sessionId, fromEventId, toEventId, path),
  }),
  start: () =>
    watchChatFiles((id) =>
      Boolean(
        hostPorts()
          .database()
          .prepare('SELECT 1 FROM sessions WHERE id=? AND project_id IS NULL AND parent_id IS NULL')
          .get(id),
      ),
    ),
});
