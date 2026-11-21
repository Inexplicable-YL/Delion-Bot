export function pinchZoomRef(
  setZoom: (update: (value: number) => number) => void,
  min: number,
  max: number,
  step: number,
) {
  return (element: HTMLDivElement) => {
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? Math.exp(-event.deltaY / 100)
          : event.deltaY < 0
            ? 1 + step
            : 1 / (1 + step);
      setZoom((value) => Math.min(max, Math.max(min, value * factor)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  };
}
