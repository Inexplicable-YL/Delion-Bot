export function connectCodeScrollbars(
  panes: HTMLElement[],
  tracks: HTMLDivElement[],
  gutterSelector: string,
  contentSelector: string,
  left = 0,
) {
  const gutters = panes.map((pane) => pane.querySelector<HTMLElement>(gutterSelector));
  const scrollables = [...panes, ...tracks];
  const maxOffset = (element: HTMLElement) => element.scrollWidth - element.clientWidth;
  const applyOffset = () => {
    for (const element of scrollables) {
      const offset = Math.min(left, maxOffset(element));
      if (element.scrollLeft !== offset) element.scrollLeft = offset;
    }
  };
  const refresh = () => {
    left = Math.min(left, Math.max(0, ...panes.map(maxOffset)));
    for (const [index, track] of tracks.entries()) {
      const pane = panes[index];
      const range = pane ? maxOffset(pane) : 0;
      const gutter = gutters[index];
      const spacer = track.firstElementChild as HTMLDivElement;
      track.hidden = range === 0;
      const codeStart =
        gutter && pane
          ? gutter.getBoundingClientRect().right - pane.getBoundingClientRect().left
          : 0;
      track.style.marginInlineStart = `${codeStart}px`;
      spacer.style.width = `${track.clientWidth + range}px`;
    }
    applyOffset();
  };
  const onScroll = (event: Event) => {
    const element = event.currentTarget as HTMLElement;
    if (element.scrollLeft === Math.min(left, maxOffset(element))) return;
    left = element.scrollLeft;
    applyOffset();
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh);
  for (const [index, pane] of panes.entries()) {
    observer?.observe(pane);
    const gutter = gutters[index];
    const content = pane.querySelector(contentSelector);
    if (gutter) observer?.observe(gutter);
    if (content) observer?.observe(content);
  }
  for (const element of scrollables)
    element.addEventListener('scroll', onScroll, { passive: true });
  refresh();
  return {
    offset: () => left,
    refresh,
    disconnect: () => {
      observer?.disconnect();
      for (const element of scrollables) element.removeEventListener('scroll', onScroll);
      for (const track of tracks) track.hidden = true;
    },
  };
}
