import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';

export function checkWorkspaceSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('不允许的调用来源');
  const url = new URL(frame.url);
  if (url.protocol !== 'file:' && (app.isPackaged || url.origin !== 'http://127.0.0.1:5173')) {
    throw new Error('不允许的调用来源');
  }
}

function isWorkspaceWindow(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html')) ||
      url.origin === 'http://127.0.0.1:5173'
    );
  } catch {
    return false;
  }
}

export function workspaceWindow(): BrowserWindow | null {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL())) return window;
  }
  return null;
}
