import { useRef, useState, type RefObject } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  Compartment,
  EditorState,
  Facet,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { cn } from '../../../ui/cn';
import type { ConnectorApp } from '../../connectors/view';
import { codeHighlightStyle, markdownHighlightStyle } from '../../preview/view';
import { openLightbox } from '../../../ui/Lightbox';
import { matchChatImageTokens } from '../../../core/protocol/chat-input';
import { getChatMediaPreview } from './media';
import type { ChatReference } from './drafts';
import { matchReferenceTokens } from './reference-tokens';
import { matchConnectorPrompts } from './connector-tokens';

type ComposerMenuApi = {
  onKey: (key: 'down' | 'up' | 'select' | 'close') => boolean;
};

type ComposerCallbacks = {
  onChange: (text: string) => void;
  onSend: () => void;
  onCaret: (text: string, caret: number) => void;
  onFiles: (files: File[], pos: number) => void;
  onDropHandled?: () => void;
  onMenuKey: ComposerMenuApi['onKey'];
};

const composerCallbacks = Facet.define<ComposerCallbacks, ComposerCallbacks>({
  combine: (values) => values[0]!,
});
const callbacksConf = new Compartment();
const handlers = (view: EditorView) => view.state.facet(composerCallbacks);

export type ComposerEditorHandle = {
  focus: () => void;
  insertAt: (pos: number, text: string) => void;
  replaceRange: (from: number, to: number, text: string) => void;
  selectionStart: () => number;
};

class InlineImageWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }

  eq(other: InlineImageWidget) {
    return other.id === this.id;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'delion-chat-image';
    const preview = getChatMediaPreview(this.id);
    if (preview) {
      const image = document.createElement('img');
      image.src = preview;
      image.alt = this.name;
      image.draggable = false;
      image.className = 'cursor-zoom-in';
      image.addEventListener('click', () => openLightbox(preview, this.name));
      wrap.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'delion-chat-image-fallback';
      fallback.textContent = this.name || '图片';
      wrap.appendChild(fallback);
    }
    const remove = document.createElement('button');
    remove.setAttribute('aria-label', `移除图片 ${this.name || ''}`);
    remove.textContent = '×';
    remove.type = 'button';
    remove.addEventListener('mousedown', (event) => event.preventDefault());
    remove.addEventListener('click', () => {
      const text = view.state.doc.toString();
      const match = new RegExp(`!\\[[^\\]\\n]*\\]\\(delion-img:${this.id}\\)`).exec(text);
      if (match)
        view.dispatch({ changes: { from: match.index, to: match.index + match[0].length } });
    });
    wrap.appendChild(remove);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function imageDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of matchChatImageTokens(view.state.doc.toString())) {
    const from = match.index ?? 0;
    builder.add(
      from,
      from + match[0].length,
      Decoration.replace({ widget: new InlineImageWidget(match[2]!, match[1] ?? '') }),
    );
  }
  return builder.finish();
}

const imagePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = imageDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = imageDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

type ReferenceOptions = { files: ChatReference[]; connectors: readonly ConnectorApp[] };

const noConnectors: readonly ConnectorApp[] = [];
const setReferenceOptions = StateEffect.define<ReferenceOptions>();
const referenceField = StateField.define<ReferenceOptions>({
  create: () => ({ files: [], connectors: noConnectors }),
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setReferenceOptions)) return effect.value;
    return value;
  },
});

const FILE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

const SESSION_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

class ReferenceIconWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly session = false,
  ) {
    super();
  }
  eq(other: ReferenceIconWidget) {
    return other.title === this.title && other.session === this.session;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'delion-ref-icon';
    span.setAttribute('aria-hidden', 'true');
    span.title = this.title;
    span.innerHTML = this.session ? SESSION_ICON_SVG : FILE_ICON_SVG;
    return span;
  }
}

class ConnectorWidget extends WidgetType {
  constructor(readonly app: ConnectorApp) {
    super();
  }

  eq(other: ConnectorWidget) {
    return (
      this.app.slug === other.app.slug &&
      this.app.name === other.app.name &&
      this.app.logo === other.app.logo
    );
  }

  toDOM() {
    const chip = document.createElement('span');
    chip.className =
      'delion-connector-token me-1 inline-flex items-center gap-1 align-top font-semibold select-none';
    chip.title = `${this.app.name} 连接器`;
    chip.dataset.connectorName = this.app.name;
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', chip.title);
    const image = document.createElement('img');
    image.className = 'size-4.5 shrink-0 object-contain';
    image.alt = '';
    image.draggable = false;
    image.src = this.app.logo;
    chip.append(image);
    return chip;
  }
}

function referenceDecorations(view: EditorView): DecorationSet {
  const options = view.state.field(referenceField);
  const source = view.state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  for (const token of matchReferenceTokens(source, options.files)) {
    const { start, end, ref } = token;
    const split = ref.session ? -1 : ref.title.lastIndexOf('/');
    const nameStart = start + 1 + (split < 0 ? 0 : split + 1);
    ranges.push(
      Decoration.replace({ widget: new ReferenceIconWidget(ref.title, ref.session) }).range(
        start,
        nameStart,
      ),
      Decoration.mark({ attributes: { title: ref.title }, class: 'cm-ref-name' }).range(
        nameStart,
        end,
      ),
    );
  }
  for (const { from, to, app } of matchConnectorPrompts(source, options.connectors)) {
    ranges.push(Decoration.replace({ widget: new ConnectorWidget(app) }).range(from, to));
  }
  return Decoration.set(ranges, true);
}

const referencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = referenceDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setReferenceOptions)),
        )
      )
        this.decorations = referenceDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

const composerTheme = EditorView.theme({
  '&': { fontSize: 'inherit', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflowY: 'auto',
    maxHeight: 'min(14rem, 38vh)',
    padding: '0',
  },
  '.cm-content': { caretColor: 'inherit', padding: '0' },
  '.cm-line': { padding: '0' },
  '.delion-connector-token::after': { content: 'attr(data-connector-name)' },
  '.delion-connector-token::selection, .delion-connector-token img::selection': {
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '.delion-chat-image': {
    position: 'relative',
    display: 'inline-flex',
    verticalAlign: 'bottom',
    margin: '0.125rem 0',
  },
  '.delion-chat-image img': {
    display: 'block',
    maxHeight: '4.75rem',
    maxWidth: '11.25rem',
    borderRadius: 'var(--radius-window)',
    border: '1px solid var(--line)',
  },
  '.delion-chat-image-fallback': {
    display: 'inline-block',
    maxWidth: '10rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0.25rem 0.625rem',
    borderRadius: 'var(--radius-control)',
    border: '1px dashed var(--line)',
    color: 'var(--ink-3)',
    fontSize: '0.75rem',
  },
  '.delion-chat-image button': {
    position: 'absolute',
    top: '-0.4375rem',
    right: '-0.4375rem',
    display: 'grid',
    placeItems: 'center',
    width: '1rem',
    height: '1rem',
    borderRadius: '9999px',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
    color: 'var(--ink-3)',
    fontFamily: 'inherit',
    fontSize: '0.6875rem',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.delion-chat-image button:hover': { color: 'var(--ink)' },
  '.cm-ref-name': { color: 'var(--accent-ink)', fontWeight: 600 },
  '.delion-ref-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: '0.125rem',
    color: 'var(--ink-2)',
    verticalAlign: '-0.125em',
  },
  '.delion-ref-icon svg': { width: '1em', height: '1em' },
});

function filesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of transfer.items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function ComposerEditor({
  value,
  onChange,
  onSend,
  onCaret,
  onFiles,
  onDropHandled,
  menu,
  menuAria,
  placeholderText,
  handleRef,
  className,
  referenceOptions,
  connectorApps = noConnectors,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onCaret: (text: string, caret: number) => void;
  onFiles: (files: File[], pos: number) => void;
  onDropHandled?: () => void;
  menu: ComposerMenuApi;
  menuAria?: { open: boolean; listId: string; activeId: string | null };
  placeholderText: string;
  handleRef: RefObject<ComposerEditorHandle | null>;
  className?: string;
  referenceOptions: ChatReference[];
  connectorApps?: readonly ConnectorApp[];
}) {
  const view = useRef<EditorView | null>(null);
  const callbacks: ComposerCallbacks = {
    onChange,
    onSend,
    onCaret,
    onFiles,
    onDropHandled,
    onMenuKey: menu.onKey,
  };
  const [attachEditor] = useState(() => (element: HTMLDivElement | null) => {
    if (!element) return;
    const current = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          callbacksConf.of(composerCallbacks.of(callbacks)),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          referenceField,
          imagePlugin,
          referencePlugin,
          EditorView.atomicRanges.of((target) => {
            const image = target.plugin(imagePlugin)?.decorations ?? Decoration.none;
            const refs = target.plugin(referencePlugin)?.decorations ?? Decoration.none;
            if (image === Decoration.none) return refs;
            if (refs === Decoration.none) return image;
            const ranges: Range<Decoration>[] = [];
            for (let it = image.iter(); it.value; it.next())
              ranges.push({ from: it.from, to: it.to, value: it.value });
            for (let it = refs.iter(); it.value; it.next())
              ranges.push({ from: it.from, to: it.to, value: it.value });
            return Decoration.set(ranges, true);
          }),
          Prec.highest(
            keymap.of([
              { key: 'ArrowDown', run: (target) => handlers(target).onMenuKey('down') },
              { key: 'ArrowUp', run: (target) => handlers(target).onMenuKey('up') },
              { key: 'Escape', run: (target) => handlers(target).onMenuKey('close') },
              { key: 'Tab', run: (target) => handlers(target).onMenuKey('select') },
              {
                key: 'Enter',
                run: (target) => {
                  if (target.compositionStarted) return false;
                  if (handlers(target).onMenuKey('select')) return true;
                  handlers(target).onSend();
                  return true;
                },
              },
              { key: 'Shift-Enter', run: insertNewlineContinueMarkup },
              { key: 'Shift-Enter', run: insertNewlineAndIndent },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          composerTheme,
          syntaxHighlighting(codeHighlightStyle),
          syntaxHighlighting(markdownHighlightStyle),
          EditorView.contentAttributes.of({ 'aria-label': '发送给助手', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers(update.view).onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet)
              handlers(update.view).onCaret(
                update.state.doc.toString(),
                update.state.selection.main.head,
              );
          }),
          EditorView.domEventHandlers({
            paste: (event, target) => {
              const files = filesFromTransfer(event.clipboardData);
              if (!files.length) return false;
              event.preventDefault();
              handlers(target).onFiles(files, target.state.selection.main.head);
              return true;
            },
            drop: (event, target) => {
              const files = filesFromTransfer(event.dataTransfer);
              if (!files.length) return false;
              event.preventDefault();
              event.stopPropagation();
              const pos =
                target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                target.state.selection.main.head;
              handlers(target).onFiles(files, pos);
              handlers(target).onDropHandled?.();
              return true;
            },
          }),
        ],
      }),
    });
    view.current = current;
    handleRef.current = {
      focus: () => current.focus(),
      insertAt: (pos, text) =>
        current.dispatch({
          changes: { from: pos, to: pos, insert: text },
          selection: { anchor: pos + text.length },
          scrollIntoView: true,
        }),
      replaceRange: (from, to, text) =>
        current.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        }),
      selectionStart: () => current.state.selection.main.head,
    };
    return () => {
      handleRef.current = null;
      view.current = null;
      current.destroy();
    };
  });
  const menuAriaOpen = menuAria?.open ?? false;
  const menuAriaListId = menuAria?.listId ?? '';
  const menuAriaActiveId = menuAria?.activeId ?? null;
  const syncEditor = (element: HTMLDivElement | null) => {
    const current = view.current;
    if (!element || !current) return;
    if (handlers(current) !== callbacks)
      current.dispatch({ effects: callbacksConf.reconfigure(composerCallbacks.of(callbacks)) });
    if (!current.compositionStarted && value !== current.state.doc.toString())
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    const options = current.state.field(referenceField);
    if (options.files !== referenceOptions || options.connectors !== connectorApps)
      current.dispatch({
        effects: setReferenceOptions.of({ files: referenceOptions, connectors: connectorApps }),
      });
    const content = current.contentDOM;
    content.setAttribute('role', 'combobox');
    content.setAttribute('aria-expanded', String(menuAriaOpen));
    content.setAttribute('aria-controls', menuAriaListId);
    if (menuAriaOpen && menuAriaActiveId)
      content.setAttribute('aria-activedescendant', menuAriaActiveId);
    else content.removeAttribute('aria-activedescendant');
  };
  const empty = value.length === 0;
  return (
    <div ref={syncEditor} className={cn('text-ui-body touch:text-ui-input-touch', className)}>
      <div className="relative" ref={attachEditor}>
        {empty && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 select-none truncate text-ink-2"
          >
            {placeholderText}
          </div>
        )}
      </div>
    </div>
  );
}
