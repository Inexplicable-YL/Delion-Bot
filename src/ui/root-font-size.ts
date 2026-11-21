import { useEffect, useState } from 'react';

export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) ? size : 16;
}

export function useRootFontSize(): number {
  const [size, setSize] = useState(rootFontSize);
  useEffect(() => {
    const observer = new MutationObserver(() => setSize(rootFontSize()));
    observer.observe(document.documentElement, { attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return size;
}
