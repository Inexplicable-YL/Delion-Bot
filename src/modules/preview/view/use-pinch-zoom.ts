const WHEEL_STEP = 1.1;
const PIXELS_PER_E_FOLD = 100;
const MAX_PIXELS_PER_EVENT = PIXELS_PER_E_FOLD * Math.log(WHEEL_STEP);

export function wheelZoomFactor(event: WheelEvent): number {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL)
    return event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  const delta = Math.max(-MAX_PIXELS_PER_EVENT, Math.min(MAX_PIXELS_PER_EVENT, event.deltaY));
  return Math.exp(-delta / PIXELS_PER_E_FOLD);
}

export function pinchZoomRef(
  setZoom: (update: (value: number) => number) => void,
  min: number,
  max: number,
) {
  return (element: HTMLDivElement) => {
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = wheelZoomFactor(event);
      setZoom((value) => Math.min(max, Math.max(min, value * factor)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  };
}
