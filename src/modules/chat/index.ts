// 会话：Agent 交互由 app/main/agent-ipc 注册的 agentContract 承载，本模块提供桌面私有的会话操作与聊天界面。
import { defineModule } from '../../app/module';
import { statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { deleteChatCommand, saveChatCommand } from '../../core/agent/chat-commands';
import { getProjectChatContext, setProjectChatContext } from '../../core/agent/instruction';
import { stageChatMediaFiles } from '../../core/agent/media';
import {
  archiveProjectSessions,
  deleteSession,
  moveSession,
  updateSessionVisibility,
} from '../../core/agent/session/commands';
import {
  locateSessionFile,
  openSessionFile,
  readSessionUncommittedChanges,
  readSessionUncommittedFileChange,
  revealSessionFile,
  uncommittedAvailability,
} from '../../core/agent/session/files';
import { archivedSessions, preloadPi } from '../../core/agent/session/store';
import { invalidateSessions } from '../../core/agent/session/run';
import { exportSession } from '../../core/agent/session-export';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { openInVsCode, workspaceFilePath } from '../workspace';
import { chatContract } from './contract';

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

export const chatModule = defineModule({
  id: 'chat',
  ipc: implement(chatContract, {
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
    openInVsCode: ({ sessionId, path }) => openInVsCode(locateSessionFile(sessionId, path)),
    revealFile: ({ sessionId, path }) => revealSessionFile(sessionId, path),
    openFile: ({ sessionId, path }) => openSessionFile(sessionId, path),
    readUncommittedChanges: readSessionUncommittedChanges,
    readUncommittedFileChange: ({ sessionId, path }) =>
      readSessionUncommittedFileChange(sessionId, path),
    uncommittedAvailability,
  }),
});
