import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onChange);
  };
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
  };
}

const viewportWidth = () => window.innerWidth;

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, viewportWidth);
}
