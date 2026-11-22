import { useSyncExternalStore } from 'react';

export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) ? size : 16;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['style'] });
  return () => observer.disconnect();
}

export function useRootFontSize(): number {
  return useSyncExternalStore(subscribe, rootFontSize);
}
