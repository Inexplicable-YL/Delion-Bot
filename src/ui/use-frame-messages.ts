export function useFrameMessages(onMessage: (event: MessageEvent) => void) {
  return (frame: HTMLIFrameElement | null) => {
    if (!frame) return;
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  };
}
