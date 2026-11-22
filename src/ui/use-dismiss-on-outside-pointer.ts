export function useDismissOnOutsidePointer(
  active: boolean,
  keepSelector: string,
  dismiss: () => void,
  { escape = false }: { escape?: boolean } = {},
) {
  return (element: HTMLElement | null) => {
    if (!element || !active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest(keepSelector))) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    if (escape) document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  };
}
