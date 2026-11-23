import type { Point, Rectangle } from 'electron';

export function trayMenuPosition(
  cursor: Point,
  workArea: Rectangle,
  size: { width: number; height: number },
  inset: number,
): { x: number; y: number } {
  const taskbarRight = cursor.x >= workArea.x + workArea.width;
  const taskbarTop = cursor.y < workArea.y;
  const x = taskbarRight ? cursor.x - size.width + inset : cursor.x - inset;
  const y = taskbarTop ? cursor.y - inset : cursor.y - size.height + inset;
  return {
    x: Math.round(clamp(x, workArea.x - inset, workArea.x + workArea.width - size.width + inset)),
    y: Math.round(clamp(y, workArea.y - inset, workArea.y + workArea.height - size.height + inset)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
