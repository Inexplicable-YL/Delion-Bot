const PAGE_GAP_PX = 32;
const MAX_PAGE_WIDTH_PX = 880;
const MIN_FIT_SCALE = 0.25;

export function fitPageScale(viewportWidth: number, pageWidth: number): number {
  const available = Math.min(viewportWidth - PAGE_GAP_PX * 2, MAX_PAGE_WIDTH_PX);
  return Math.max(MIN_FIT_SCALE, available / pageWidth);
}
