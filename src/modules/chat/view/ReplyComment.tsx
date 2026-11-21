import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ChatBubbleLeftEllipsisIcon as MessageSquarePlus,
  QuestionMarkCircleIcon as MessageCircleQuestion,
} from '@heroicons/react/24/outline';
import type { ChatComment } from '../../../core/protocol/agent';
import {
  CommentChip,
  CommentFloat,
  CommentFloatAction,
  CommentInput,
  CommentRail,
} from '../../../ui/agent/Comment';
import { useChatDrafts } from './drafts';

const EDGE_REM = 0.5;
const HIGHLIGHT = 'delion-reply-comment';

export interface FloatingAnchor {
  top: number;
  bottom: number;
  topCenter: number;
  bottomCenter: number;
}

export interface FloatingSpot {
  top: number;
  left: number;
  side: 'top' | 'bottom';
}

function placeFloating(
  anchor: FloatingAnchor,
  box: { width: number; height: number },
  view: { width: number; height: number },
  edge: number,
  pin: boolean,
): FloatingSpot | null {
  if (!pin && (anchor.bottom <= 0 || anchor.top >= view.height)) return null;
  const maxTop = Math.max(edge, view.height - edge - box.height);
  const above = anchor.top - edge - box.height;
  const below = anchor.bottom + edge;
  const side = above >= edge || below > maxTop ? 'top' : 'bottom';
  const top = Math.min(Math.max(side === 'top' ? above : below, edge), maxTop);
  const center = side === 'top' ? anchor.topCenter : anchor.bottomCenter;
  const left = Math.min(
    Math.max(center - box.width / 2, edge),
    Math.max(edge, view.width - edge - box.width),
  );
  return { top, left, side };
}

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

export function commentRange(selection: Selection | null, root: HTMLElement): Range | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const body = elementOf(range.startContainer)?.closest('[data-assistant-body]');
  if (!body || !root.contains(body) || body.closest('[data-reply-live]')) return null;
  if (!body.contains(range.endContainer)) {
    const tail = document.createRange();
    tail.setStart(body, body.childNodes.length);
    tail.setEnd(range.endContainer, range.endOffset);
    if (tail.toString().trim()) return null;
    range.setEnd(body, body.childNodes.length);
  }
  const startMath = elementOf(range.startContainer)?.closest('.katex');
  if (startMath) range.setStartBefore(startMath);
  const endMath = elementOf(range.endContainer)?.closest('.katex');
  if (endMath) range.setEndAfter(endMath);
  return range;
}

function quoteText(range: Range): string {
  const fragment = range.cloneContents();
  for (const math of fragment.querySelectorAll('.katex')) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex == null) continue;
    const display = math.parentElement?.classList.contains('katex-display')
      ? math.parentElement
      : null;
    if (display) {
      const block = document.createElement('div');
      block.textContent = `$$${tex}$$`;
      display.replaceWith(block);
    } else math.replaceWith(`$${tex}$`);
  }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;top:0;left:-200vw;width:40rem';
  holder.append(fragment);
  document.body.append(holder);
  const text = holder.innerText;
  holder.remove();
  return text.trim();
}

interface Target {
  range: Range;
  quote: string;
  editing: boolean;
}

export function ReplyCommentLayer({
  draftKey,
  scrollRef,
  onSidechat,
}: {
  draftKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onSidechat?: (quote: string) => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const inBox = (event: Event) => boxRef.current?.contains(event.target as Node) ?? false;
    const keepEditing = (current: Target | null) => (current?.editing ? current : null);
    const down = (event: PointerEvent) => {
      if (!inBox(event) && event.target !== scroller) setTarget(null);
    };
    const up = (event: PointerEvent) => {
      if (inBox(event)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = commentRange(window.getSelection(), scroller);
        const quote = range && quoteText(range);
        if (range && quote) setTarget({ range, quote, editing: false });
      });
    };
    const collapse = () => {
      if (window.getSelection()?.isCollapsed) setTarget(keepEditing);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTarget(keepEditing);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('selectionchange', collapse);
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('selectionchange', collapse);
      document.removeEventListener('keydown', escape);
    };
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const box = boxRef.current;
    if (!target || !scroller || !box) return;
    const place = () => {
      const rects = [...target.range.getClientRects()].filter((rect) => rect.width || rect.height);
      if (!rects.length) {
        setTarget(null);
        return;
      }
      const view = scroller.getBoundingClientRect();
      const first = rects[0]!;
      const last = rects.at(-1)!;
      const spot = placeFloating(
        {
          top: Math.min(...rects.map((rect) => rect.top)) - view.top,
          bottom: Math.max(...rects.map((rect) => rect.bottom)) - view.top,
          topCenter: (first.left + first.right) / 2 - view.left,
          bottomCenter: (last.left + last.right) / 2 - view.left,
        },
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: scroller.clientWidth, height: scroller.clientHeight },
        EDGE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize),
        target.editing,
      );
      box.style.visibility = spot ? '' : 'hidden';
      if (!spot) return;
      box.style.top = `${spot.top}px`;
      box.style.left = `${spot.left}px`;
      box.style.transformOrigin = spot.side === 'top' ? 'bottom center' : 'top center';
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(box);
    for (const child of scroller.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [scrollRef, target]);

  useEffect(() => {
    if (!target?.editing) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(target.range));
    return () => {
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [target]);

  if (!target) return null;
  const add = (comment: string) => {
    const { drafts, update } = useChatDrafts.getState();
    update(draftKey, {
      comments: [...(drafts[draftKey]?.comments ?? []), { quote: target.quote, comment }],
    });
    setTarget(null);
  };
  return (
    <CommentFloat editing={target.editing} key={target.editing ? 'input' : 'tip'} ref={boxRef}>
      {target.editing ? (
        <CommentInput onCancel={() => setTarget(null)} onSubmit={add} />
      ) : (
        <div className="flex">
          <CommentFloatAction onClick={() => setTarget({ ...target, editing: true })}>
            <MessageSquarePlus aria-hidden />
            添加到对话
          </CommentFloatAction>
          {onSidechat && (
            <CommentFloatAction
              onClick={() => {
                onSidechat(target.quote);
                setTarget(null);
              }}
            >
              <MessageCircleQuestion aria-hidden />
              旁问
            </CommentFloatAction>
          )}
        </div>
      )}
    </CommentFloat>
  );
}

export function ReplyCommentRail({
  comments,
  onChange,
}: {
  comments: ChatComment[];
  onChange: (comments: ChatComment[]) => void;
}) {
  return (
    <CommentRail>
      {comments.map((item, index) => (
        <CommentChip
          item={item}
          key={`${index}:${item.quote}`}
          onRemove={() => onChange(comments.filter((_, at) => at !== index))}
          onSave={(comment) =>
            onChange(comments.map((other, at) => (at === index ? { ...other, comment } : other)))
          }
        />
      ))}
    </CommentRail>
  );
}
