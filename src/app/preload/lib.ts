import { ipcRenderer } from 'electron';

export const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    if (String(error).includes(`No handler registered for '${channel}'`))
      throw new Error('该功能在当前版本中未启用');
    throw error;
  });

export const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

export function on<T = void>(channel: string, listener: (payload: T) => void): () => void {
  const subscription = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, subscription);
  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
}
