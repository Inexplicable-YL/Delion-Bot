const showDelay = 500;
const warmWindow = 300;
const gap = 6;
const edge = 8;
const edgeZone = 0.2;

const sides = ['top', 'bottom', 'right', 'left'] as const;
const opposite = { top: 'bottom', bottom: 'top', right: 'left', left: 'right' } as const;

type Side = (typeof sides)[number];
type Placement = { left: number; top: number; clipped: number; misaligned: number };

function sideOrder(anchor: DOMRect): readonly Side[] {
  const x = (anchor.left + anchor.width / 2) / window.innerWidth;
  const y = (anchor.top + anchor.height / 2) / window.innerHeight;
  const distance = { top: y, bottom: 1 - y, right: 1 - x, left: x };
  const nearest = sides.reduce((a, b) => (distance[b] < distance[a] ? b : a));
  if (distance[nearest] > edgeZone) return sides;
  const preferred = opposite[nearest];
  return [preferred, ...sides.filter((side) => side !== preferred)];
}

function place(anchor: DOMRect, tip: DOMRect, side: Side): Placement {
  const vertical = side === 'top' || side === 'bottom';
  const centered = vertical
    ? anchor.left + (anchor.width - tip.width) / 2
    : anchor.top + (anchor.height - tip.height) / 2;
  const crossMax =
    (vertical ? window.innerWidth - tip.width : window.innerHeight - tip.height) - edge;
  const cross = Math.max(edge, Math.min(centered, crossMax));
  const main = {
    top: anchor.top - gap - tip.height,
    bottom: anchor.bottom + gap,
    right: anchor.right + gap,
    left: anchor.left - gap - tip.width,
  }[side];
  const mainMax =
    (vertical ? window.innerHeight - tip.height : window.innerWidth - tip.width) - edge;
  return {
    left: vertical ? cross : main,
    top: vertical ? main : cross,
    clipped: Math.max(0, edge - main) + Math.max(0, main - mainMax),
    misaligned: Math.abs(cross - centered),
  };
}

function better(a: Placement, b: Placement): Placement {
  if (b.clipped !== a.clipped) return b.clipped < a.clipped ? b : a;
  return b.misaligned < a.misaligned ? b : a;
}

export function installTitleTooltips() {
  const tip = document.createElement('div');
  tip.setAttribute('role', 'tooltip');
  tip.className =
    'pointer-events-none fixed top-0 left-0 z-tooltip w-fit max-w-80 rounded-chip bg-(--tooltip-bg) px-2 py-1 text-ui-subhead break-words whitespace-pre-line text-(--tooltip-fg) shadow-tooltip animate-pop-in';
  tip.hidden = true;
  document.body.append(tip);

  let anchor: Element | null = null;
  let title = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hiddenAt = 0;

  const show = () => {
    if (!anchor) return;
    tip.textContent = title;
    tip.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const best = sideOrder(anchorRect)
      .map((side) => place(anchorRect, tipRect, side))
      .reduce(better);
    tip.style.left = `${best.left}px`;
    tip.style.top = `${best.top}px`;
  };

  const release = () => {
    clearTimeout(timer);
    if (!anchor) return;
    if (!anchor.hasAttribute('title')) anchor.setAttribute('title', title);
    anchor = null;
    if (!tip.hidden) {
      tip.hidden = true;
      hiddenAt = performance.now();
    }
  };

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
    const next = event.target.closest('[title]');
    if (anchor?.contains(event.target) && !(next && anchor.contains(next))) return;
    release();
    const text = next?.getAttribute('title');
    if (!next || !text) return;
    anchor = next;
    title = text;
    next.removeAttribute('title');
    timer = setTimeout(show, performance.now() - hiddenAt < warmWindow ? 0 : showDelay);
  });
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) release();
  });
  for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll'] as const) {
    document.addEventListener(type, release, { capture: true, passive: true });
  }
  window.addEventListener('blur', release);
}
