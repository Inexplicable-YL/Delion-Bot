type Listener = (path: string) => void;

const listeners = new Set<Listener>();

export function onRemoteChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyRemoteChange(path: string): void {
  for (const listener of listeners) listener(path);
}
