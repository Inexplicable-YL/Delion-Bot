import { describe, expect, it } from 'vitest';
import { trayMenuPosition } from '../../../src/app/main/tray-menu-position';

const size = { width: 152, height: 162 };
const inset = 12;

describe('trayMenuPosition', () => {
  it('opens to the upper right of the cursor above a bottom taskbar', () => {
    expect(
      trayMenuPosition(
        { x: 1500, y: 2030 },
        { x: 0, y: 0, width: 3120, height: 1984 },
        size,
        inset,
      ),
    ).toEqual({ x: 1488, y: 1834 });
  });

  it('opens to the lower right of the cursor below a top taskbar', () => {
    expect(
      trayMenuPosition({ x: 1500, y: 40 }, { x: 0, y: 96, width: 3120, height: 1984 }, size, inset),
    ).toEqual({ x: 1488, y: 84 });
  });

  it('keeps the menu inside the work area near the right screen edge', () => {
    expect(
      trayMenuPosition(
        { x: 3100, y: 2030 },
        { x: 0, y: 0, width: 3120, height: 1984 },
        size,
        inset,
      ),
    ).toEqual({ x: 2980, y: 1834 });
  });

  it('opens to the left of the cursor beside a right taskbar', () => {
    expect(
      trayMenuPosition(
        { x: 3060, y: 1000 },
        { x: 0, y: 0, width: 3024, height: 2080 },
        size,
        inset,
      ),
    ).toEqual({ x: 2884, y: 850 });
  });
});
