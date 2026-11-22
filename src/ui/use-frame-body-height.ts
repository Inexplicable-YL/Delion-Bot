import { useState } from 'react';

const INITIAL_BODY_HEIGHT = 240;

export function useFrameBodyHeight() {
  const [height, setHeight] = useState(INITIAL_BODY_HEIGHT);
  const measureBody = (body: HTMLElement | null) => {
    if (!body) return;
    const update = () => setHeight(body.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  };
  return [height, measureBody] as const;
}
