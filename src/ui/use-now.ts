import { useState, useSyncExternalStore } from 'react';

export function useNow(intervalMs: number, enabled = true): number {
  const [clock] = useState(() => {
    let now = Date.now();
    return {
      snapshot: () => now,
      subscribe: (onChange: () => void) => {
        const timer = window.setInterval(() => {
          now = Date.now();
          onChange();
        }, intervalMs);
        return () => window.clearInterval(timer);
      },
    };
  });
  return useSyncExternalStore(enabled ? clock.subscribe : subscribeWhilePaused, clock.snapshot);
}

const subscribeWhilePaused = () => () => {};
