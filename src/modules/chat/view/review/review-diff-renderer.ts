import { VirtualizedFileDiff, type HunkExpansionRegion, type SelectionSide } from '@pierre/diffs';
import { connectCodeScrollbars } from '../../../preview/view';

type ChangeDirection = 'previous' | 'next';

export class ReviewDiffRenderer extends VirtualizedFileDiff {
  private lastJump: { index: number; scrollTop: number } | null = null;
  private horizontalScrollbars?: ReturnType<typeof connectCodeScrollbars> & {
    tracks: HTMLDivElement[];
    panes: HTMLElement[];
  };

  override flushManagers() {
    super.flushManagers();
    this.scrollSyncManager.cleanUp();
  }

  override cleanUp(recycle?: boolean) {
    this.horizontalScrollbars?.disconnect();
    this.horizontalScrollbars = undefined;
    super.cleanUp(recycle);
  }

  syncHorizontalScrollbars(container: HTMLDivElement) {
    const tracks = Array.from(container.querySelectorAll<HTMLDivElement>('[data-code-scrollbar]'));
    const panes =
      this.options.overflow === 'scroll'
        ? Array.from(this.pre?.querySelectorAll<HTMLElement>('code[data-code]') ?? [])
        : [];
    const current = this.horizontalScrollbars;
    if (
      current &&
      current.tracks.length === tracks.length &&
      current.panes.length === panes.length &&
      tracks.every((track, index) => track === current.tracks[index]) &&
      panes.every((pane, index) => pane === current.panes[index])
    ) {
      current.refresh();
      return;
    }
    const left = current?.offset() ?? 0;
    current?.disconnect();
    this.horizontalScrollbars = {
      tracks,
      panes,
      ...connectCodeScrollbars(panes, tracks, '[data-gutter]', '[data-content]', left),
    };
  }

  get contextRegions() {
    const diff = this.getInputDiff();
    if (!diff || diff.isPartial) return [];
    const regions: { index: number; lines: number; oldStart: number; newStart: number }[] = [];
    let oldEnd = 0;
    let newEnd = 0;
    for (const [index, hunk] of diff.hunks.entries()) {
      if (hunk.collapsedBefore > 0)
        regions.push({
          index,
          lines: hunk.collapsedBefore,
          oldStart: oldEnd + 1,
          newStart: newEnd + 1,
        });
      oldEnd = hunk.deletionStart + Math.max(0, hunk.deletionCount - 1);
      newEnd = hunk.additionStart + Math.max(0, hunk.additionCount - 1);
    }
    const trailing = Math.min(
      diff.deletionLines.length - oldEnd,
      diff.additionLines.length - newEnd,
    );
    if (diff.hunks.length && trailing > 0)
      regions.push({
        index: diff.hunks.length,
        lines: trailing,
        oldStart: oldEnd + 1,
        newStart: newEnd + 1,
      });
    return regions;
  }

  isContextExpanded(index: number) {
    return this.hunksRenderer.getExpandedHunk(index).fromStart > 0;
  }

  toggleContext(index: number, control: HTMLButtonElement) {
    const regions = this.contextRegions;
    const region = regions.find((region) => region.index === index);
    if (!region) return false;
    const viewport = this.getEditorViewport();
    const offset =
      viewport instanceof HTMLElement
        ? control.getBoundingClientRect().top - viewport.getBoundingClientRect().top
        : 0;
    const focus = control.matches(':focus-visible');
    const next = new Map(this.hunksRenderer.getExpandedHunksMap());
    if (this.isContextExpanded(index)) next.delete(index);
    else next.set(index, { fromStart: region.lines, fromEnd: 0 });
    this.updateContext(next, index);
    if (viewport instanceof HTMLElement) {
      const position = this.getLinePosition(region.newStart);
      if (position)
        viewport.scrollTo({ top: (this.top ?? 0) + position.top - offset, behavior: 'instant' });
      if (focus)
        this.fileContainer?.shadowRoot
          ?.querySelector<HTMLButtonElement>(`[data-review-fold="${index}"]`)
          ?.focus({ preventScroll: true });
    }
    return regions.every((region) => this.isContextExpanded(region.index));
  }

  toggleAllContext() {
    const regions = this.contextRegions;
    const first = regions[0];
    if (!first) return false;
    const expand = !regions.every((region) => this.isContextExpanded(region.index));
    const next = new Map<number, HunkExpansionRegion>();
    if (expand)
      for (const region of regions) next.set(region.index, { fromStart: region.lines, fromEnd: 0 });
    this.updateContext(next, first.index);
    return expand;
  }

  private updateContext(regions: Map<number, HunkExpansionRegion>, index: number) {
    this.lastJump = null;
    this.hunksRenderer.setExpandedHunksMap(regions);
    this.expandHunk(index, 'up', 0);
    this.render();
  }

  jumpToChange(direction: ChangeDirection) {
    const viewport = this.getEditorViewport();
    const diff = this.getRenderedDiff();
    if (!(viewport instanceof HTMLElement) || !diff) return;
    const changes: { side: SelectionSide; line: number }[] = [];
    for (const hunk of diff.hunks) {
      let oldLine = hunk.deletionStart;
      let newLine = hunk.additionStart;
      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          oldLine += content.lines;
          newLine += content.lines;
        } else {
          changes.push(
            content.deletions > 0
              ? { side: 'deletions', line: oldLine }
              : { side: 'additions', line: newLine },
          );
          oldLine += content.deletions;
          newLine += content.additions;
        }
      }
    }
    if (!changes.length) return;

    const offsetOf = (index: number) => {
      const change = changes[index]!;
      return (this.top ?? 0) + (this.getLinePosition(change.line, change.side)?.top ?? 0);
    };
    const next = direction === 'next';
    const step = next ? 1 : -1;
    let target: number;
    if (this.lastJump?.scrollTop === viewport.scrollTop) {
      target = this.lastJump.index + step;
    } else {
      const edge = viewport.scrollTop + step;
      let start = 0;
      let end = changes.length;
      while (start < end) {
        const middle = Math.floor((start + end) / 2);
        if (offsetOf(middle) < edge) start = middle + 1;
        else end = middle;
      }
      target = next ? start : start - 1;
    }
    const index = (target + changes.length) % changes.length;
    const change = changes[index]!;
    this.setSelectedLines({ start: change.line, end: change.line, side: change.side });
    viewport.scrollTo({ top: offsetOf(index) - viewport.clientHeight / 3, behavior: 'instant' });
    this.lastJump = { index, scrollTop: viewport.scrollTop };
  }
}
