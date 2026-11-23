import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  nativeImage,
  net,
  safeStorage,
  shell,
  type WebContents,
} from 'electron';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CredentialDecryptionError,
  type BundledResource,
  type ClientHandle,
  type Desktop,
  type HostPorts,
  type SecretNamespace,
} from '../../core/ports';
import { getDatabase } from './database';
import { agentContract } from '../../core/protocol/agent';
import type { EventPayload } from '../../core/protocol/contract';
import { chatContract, liveCompactionTranscript } from '../../modules/chat';
import { withoutToolImages } from '../../core/agent/session/projection';
import { workspaceWindow } from './window';
import { notifyRunFinished } from '../../modules/settings';
import { storageDirectory } from './storage';
import { locateBash } from '../../modules/terminal';
import { workspaceProjects } from '../../modules/workspace';

const secretPath = (namespace: SecretNamespace) =>
  join(app.getPath('userData'), `${namespace}.bin`);

function writeSealed(namespace: SecretNamespace, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  const path = secretPath(namespace);
  const sealed = safeStorage.encryptString(plaintext);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if (existsSync(path)) {
      try {
        safeStorage.decryptString(readFileSync(path));
      } catch {
        copyFileSync(path, `${path}.unreadable-${randomUUID()}.bak`);
      }
    }
    writeFileSync(temporary, sealed);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function readSealed(namespace: SecretNamespace): string | null {
  const path = secretPath(namespace);
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  try {
    return safeStorage.decryptString(readFileSync(path));
  } catch (cause) {
    throw new CredentialDecryptionError(namespace, cause);
  }
}

const bundledInRepo: Record<BundledResource, string> = {
  'delion-helper': join('vendor', 'delion-helper'),
  'remote-rg': join('.build', 'remote-rg'),
  openssh: join('vendor', 'openssh'),
};

const clients = new Set<WebContents>();

const windowOf = (owner: ClientHandle) => BrowserWindow.fromWebContents(owner as WebContents);

const desktop: Desktop = {
  async pickFiles(owner) {
    const window = windowOf(owner);
    if (!window) return [];
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文件', extensions: ['*'] }],
    });
    return result.canceled ? [] : result.filePaths;
  },
  async pickSavePath(owner, { title, defaultPath, extension }) {
    const options = {
      title,
      defaultPath,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    };
    const window = owner && windowOf(owner);
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  },
  reveal: (path) => shell.showItemInFolder(path),
  async open(path) {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
  trash: (path) => shell.trashItem(path),
  sendToWindows(channel) {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel);
  },
};

export const electronPorts: HostPorts = {
  paths: {
    userData: () => app.getPath('userData'),
    home: () => app.getPath('home'),
    documents: () => app.getPath('documents'),
    temp: () => app.getPath('temp'),
    storage: storageDirectory,
    bundled: (name) =>
      app.isPackaged
        ? join(process.resourcesPath, name)
        : join(app.getAppPath(), bundledInRepo[name]),
    bash: locateBash,
  },
  secrets: {
    write: writeSealed,
    read: readSealed,
    remove(namespace) {
      const path = secretPath(namespace);
      if (existsSync(path)) unlinkSync(path);
    },
  },
  notifier: {
    notifyRunFinished,
    show(title, body, onClick) {
      const window = workspaceWindow();
      if (!Notification.isSupported() || !window || window.isFocused()) return;
      const toast = new Notification({ title, body });
      toast.on('click', () => {
        const target = workspaceWindow();
        if (!target) return;
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
        onClick?.();
      });
      toast.show();
    },
  },
  broadcaster: {
    subscribe(client) {
      const target = client as WebContents;
      if (clients.has(target)) return;
      clients.add(target);
      target.once('destroyed', () => clients.delete(target));
    },
    send(channel, ...args) {
      if (clients.size && channel === `${agentContract.namespace}:session-update`) {
        const { sessionId, chat } = args[0] as EventPayload<typeof agentContract, 'session-update'>;
        const transcript = chat.messages[0]?.compacted ? liveCompactionTranscript(sessionId) : null;
        if (transcript) {
          const payload: EventPayload<typeof chatContract, 'compactionChanged'> = {
            sessionId,
            ...transcript,
          };
          for (const client of clients)
            if (!client.isDestroyed())
              client.send(`${chatContract.namespace}:compactionChanged`, payload);
        }
      } else if (clients.size && channel === `${agentContract.namespace}:session-stream`) {
        const { sessionId } = args[0] as EventPayload<typeof agentContract, 'session-stream'>;
        const transcript = liveCompactionTranscript(sessionId, true);
        const message = transcript?.messages.at(-1);
        if (transcript && message?.role === 'assistant') {
          const payload: EventPayload<typeof chatContract, 'compactionStream'> = {
            sessionId,
            entryId: transcript.entryId,
            message: withoutToolImages(message),
          };
          for (const client of clients)
            if (!client.isDestroyed())
              client.send(`${chatContract.namespace}:compactionStream`, payload);
        }
      }
      for (const client of clients) if (!client.isDestroyed()) client.send(channel, ...args);
    },
  },
  imageCodec: {
    preview(source) {
      const image =
        typeof source === 'string'
          ? nativeImage.createFromPath(source)
          : nativeImage.createFromBuffer(source);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      const scale = 480 / Math.max(width, height);
      const thumbnail =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
            })
          : image;
      return { url: thumbnail.toDataURL(), width, height };
    },
  },
  desktop,
  network: { fetch: (url, init) => net.fetch(url, init) },
  database: getDatabase,
  workspaceClient: () => workspaceWindow()?.webContents ?? null,
  projects: workspaceProjects,
};
