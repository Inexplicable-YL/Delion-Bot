import { useId, useRef, useState, type ReactNode } from 'react';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  ArrowUturnLeftIcon as Undo,
  ArrowUturnRightIcon as Redo,
  DocumentDuplicateIcon as Copy,
} from '@heroicons/react/24/outline';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Annotation, Compartment, EditorState, Facet, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import {
  codeHighlightStyle,
  codeIndentGuides,
  codeLayout,
  CodeScrollbar,
  connectCodeScrollbars,
  markdownHighlightStyle,
  useEditorSettings,
} from '../../preview/view';
import { markdownLivePreview, type ImageResolver } from './live-preview';
import { formatByName } from '../../../core/protocol/files';
import { errorMessage } from '../../../core/protocol/contract';
import { DocumentToolbarButton, DocumentToolbarDivider } from '../../../ui/DocumentToolbar';
import { showToast } from '../../../ui/Toast';
import { selectionFormat, type SelectionFormat } from './markdown-format';
import { SelectionToolbar } from './SelectionToolbar';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: `${codeLayout.fontSize}rem`,
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: String(codeLayout.lineHeight),
    padding: `${codeLayout.inset}rem`,
  },
  '.cm-content': { caretColor: 'var(--syntax-caret)', maxWidth: '60rem', margin: '0 auto' },
  '&.cm-source-file .cm-scroller': { padding: `${codeLayout.inset}rem 0` },
  '&.cm-source-file .cm-content': {
    maxWidth: 'none',
    margin: '0',
    paddingBlock: `${codeLayout.contentBlockPadding}px`,
    paddingRight: `${codeLayout.inset}rem`,
    textAlign: 'left',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--syntax-caret)' },
  '.cm-placeholder': { color: 'var(--ink-3)' },
  '.cm-scroller:has(.cm-gutters)': { paddingLeft: '0' },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'var(--workbench-surface, var(--page))',
    color: 'var(--ink-3)',
    paddingLeft: `${codeLayout.inset}rem`,
  },
  '&.cm-document': { fontSize: 'calc(1rem - 1px)' },
  '&.cm-document .cm-scroller': {
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.75',
    padding: '3rem 2rem 8rem',
    overflowX: 'hidden',
  },
  '&.cm-document .cm-content': { maxWidth: '48rem', minWidth: '0' },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: codeLayout.lineNumberWidth,
    padding: `0 ${codeLayout.lineNumberPaddingEnd}rem 0 ${codeLayout.lineNumberPaddingStart}rem`,
  },
});

type ResolvedLanguage =
  { kind: 'markdown' } | { kind: 'code'; language: LanguageDescription } | { kind: 'text' };

const languageConf = new Compartment();
const placeholderConf = new Compartment();
const wrappingConf = new Compartment();
const layoutConf = new Compartment();
const contentAttributesConf = new Compartment();
const previewConf = new Compartment();
const readOnlyConf = new Compartment();
const externalSync = Annotation.define<boolean>();

type EditorCallbacks = {
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
};

const editorCallbacks = Facet.define<EditorCallbacks, EditorCallbacks>({
  combine: (values) => values[0]!,
});
const callbacksConf = new Compartment();

type EditorOptions = {
  value: string;
  filename: string | undefined;
  wordWrap: boolean;
  readOnly: boolean;
  ariaLabel: string;
  placeholderText: string;
};

type EditorHandlers = {
  onChange: (text: string) => void;
  onSave: () => void;
  finishComposition: () => void;
  onState: (view: EditorView) => void;
};

type EditorSnapshot = {
  canUndo: boolean;
  canRedo: boolean;
  focused: boolean;
  format: SelectionFormat | null;
};

function snapshotOf(view: EditorView): EditorSnapshot {
  const { state } = view;
  return {
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    focused: view.hasFocus,
    format: state.selection.main.empty ? null : selectionFormat(state),
  };
}

function selectionRect(view: EditorView | undefined) {
  if (!view) return new DOMRect();
  const { from, to } = view.state.selection.main;
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  if (!start || !end) return new DOMRect();
  const height = end.bottom - start.top;
  if (end.top === start.top)
    return new DOMRect(start.left, start.top, Math.max(end.right - start.left, 1), height);
  const content = view.contentDOM.getBoundingClientRect();
  return new DOMRect(content.left, start.top, content.width, height);
}

type EditorSession = { state: EditorState; scrollTop: number };

const sessions = new Map<string, EditorSession>();
const noScroll = () => 0;
const handlers = new Map<string, EditorHandlers>();

function replaceDocument(current: string, next: string) {
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) from += 1;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (currentEnd > from && nextEnd > from && current[currentEnd - 1] === next[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }
  return { from, to: currentEnd, insert: next.slice(from, nextEnd) };
}

export function lineSeparatorOf(text: string): '\r\n' | '\n' {
  const first = text.indexOf('\n');
  return first > 0 && text[first - 1] === '\r' ? '\r\n' : '\n';
}

function layoutOf(language: ResolvedLanguage, documentLayout: boolean): Extension {
  if (language.kind === 'markdown' && documentLayout)
    return EditorView.editorAttributes.of({ class: 'cm-document' });
  return [EditorView.editorAttributes.of({ class: 'cm-source-file' }), codeIndentGuides];
}

function languageForFilename(filename: string | undefined): ResolvedLanguage {
  if (!filename) return { kind: 'markdown' };
  if (formatByName(filename) === 'markdown') return { kind: 'markdown' };
  const language = LanguageDescription.matchFilename(languages, filename);
  return language ? { kind: 'code', language } : { kind: 'text' };
}

export function MarkdownEditor({
  value,
  filename,
  onChange,
  onSave,
  onScroll,
  initialScroll = noScroll,
  placeholderText = '开始记录…',
  lineNumbers: showLineNumbers = true,
  ariaLabel = '笔记编辑器',
  saveOnBlur = true,
  editorStateKey,
  livePreview,
  readOnly = false,
  extensions: extraExtensions = [],
  alwaysWrap = false,
  toolbar,
}: {
  value: string;
  filename?: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onScroll: (top: number) => void;
  initialScroll?: () => number;
  placeholderText?: string;
  lineNumbers?: boolean;
  ariaLabel?: string;
  saveOnBlur?: boolean;
  editorStateKey?: string;
  livePreview?: ImageResolver;
  readOnly?: boolean;
  extensions?: Extension[];
  alwaysWrap?: boolean;
  toolbar?: (controls: ReactNode) => ReactNode;
}) {
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const editor = useRef<{
    view: EditorView;
    replaceText: (text: string) => void;
    options: EditorOptions | null;
  } | null>(null);
  const generatedKey = useId();
  const [instanceKey] = useState(editorStateKey ?? generatedKey);
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [anchor] = useState(() => ({
    current: {
      getBoundingClientRect: () => selectionRect(editor.current?.view),
      get contextElement() {
        return editor.current?.view.contentDOM;
      },
    },
  }));
  const documentLayout =
    livePreview !== undefined && languageForFilename(filename).kind === 'markdown';
  const wordWrap = useEditorSettings((state) => state.wordWrap) || alwaysWrap || documentLayout;
  const callbacks = { onChange, onSave, onScroll };
  const [attachEditor] = useState(() => (element: HTMLDivElement | null) => {
    if (!element) return;
    const initial = languageForFilename(filename);
    const persistent = editorStateKey !== undefined;
    const transient: { current?: EditorSession } = {};
    const previous = persistent ? sessions.get(instanceKey) : undefined;
    const extensions: Extension[] = [
      EditorState.lineSeparator.of(lineSeparatorOf(value)),
      history(),
      callbacksConf.of(editorCallbacks.of(callbacks)),
      languageConf.of(
        initial.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      ),
      previewConf.of(
        documentLayout
          ? markdownLivePreview(livePreview)
          : syntaxHighlighting(markdownHighlightStyle),
      ),
      readOnlyConf.of(EditorState.readOnly.of(readOnly)),
      ...extraExtensions,
      ...(showLineNumbers && !documentLayout ? [lineNumbers()] : []),
      wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
      layoutConf.of(layoutOf(initial, documentLayout)),
      placeholderConf.of(placeholder(placeholderText)),
      search({ top: true }),
      keymap.of([
        ...markdownKeymap,
        {
          key: 'Mod-s',
          run: () => {
            handlers.get(instanceKey)?.onSave();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            handlers.get(instanceKey)?.onSave();
            return true;
          },
        },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      editorTheme,
      syntaxHighlighting(codeHighlightStyle),
      contentAttributesConf.of(
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          'aria-label': ariaLabel,
        }),
      ),
      EditorView.updateListener.of((update) => {
        const session = sessions.get(instanceKey) ?? transient.current;
        if (session) session.state = update.state;
        if (update.docChanged || update.selectionSet || update.focusChanged)
          handlers.get(instanceKey)?.onState(update.view);
        if (
          update.docChanged &&
          !update.transactions.some((transaction) => transaction.annotation(externalSync))
        )
          handlers.get(instanceKey)?.onChange(update.state.sliceDoc());
      }),
      EditorView.domEventHandlers({
        blur: () => {
          if (saveOnBlur) handlers.get(instanceKey)?.onSave();
          return false;
        },
        compositionend: () => {
          handlers.get(instanceKey)?.finishComposition();
          return false;
        },
      }),
    ];
    let state = previous?.state;
    if (!state) state = EditorState.create({ doc: value, extensions });
    else if (state.sliceDoc() !== value)
      state = state.update({
        changes: replaceDocument(state.sliceDoc(), value),
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      }).state;
    const session: EditorSession = { state, scrollTop: previous?.scrollTop ?? initialScroll() };
    transient.current = session;
    if (persistent) sessions.set(instanceKey, session);
    const current = new EditorView({ parent: element, state });
    const scrollbars = connectCodeScrollbars(
      [current.scrollDOM],
      [scrollbarRef.current!],
      '.cm-gutters-before',
      '.cm-content',
    );
    let pendingText: string | null = null;
    let compositionFrame = 0;
    const replaceText = (next: string) => {
      const text = current.state.sliceDoc();
      if (next === text) {
        pendingText = null;
        return;
      }
      if (current.compositionStarted) {
        pendingText = next;
        return;
      }
      pendingText = null;
      current.dispatch({
        changes: replaceDocument(text, next),
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      });
    };
    current.scrollDOM.scrollTop = session.scrollTop;
    const handleScroll = () => {
      session.scrollTop = current.scrollDOM.scrollTop;
      current.state.facet(editorCallbacks).onScroll(session.scrollTop);
    };
    const boundHandlers: EditorHandlers = {
      onChange: (text) => {
        pendingText = null;
        current.state.facet(editorCallbacks).onChange(text);
      },
      onSave: () => current.state.facet(editorCallbacks).onSave(),
      finishComposition: () => {
        cancelAnimationFrame(compositionFrame);
        compositionFrame = requestAnimationFrame(() => {
          if (pendingText !== null) replaceText(pendingText);
        });
      },
      onState: (view) => setSnapshot(snapshotOf(view)),
    };
    const startSelecting = () => setSelecting(true);
    const stopSelecting = () => setSelecting(false);
    handlers.set(instanceKey, boundHandlers);
    current.scrollDOM.addEventListener('scroll', handleScroll);
    current.contentDOM.addEventListener('mousedown', startSelecting);
    window.addEventListener('mouseup', stopSelecting);
    editor.current = { view: current, replaceText, options: null };
    setSnapshot(snapshotOf(current));
    return () => {
      scrollbars.disconnect();
      current.contentDOM.removeEventListener('mousedown', startSelecting);
      window.removeEventListener('mouseup', stopSelecting);
      if (!persistent || sessions.get(instanceKey) === session) {
        session.state = current.state;
        session.scrollTop = current.scrollDOM.scrollTop;
      }
      current.scrollDOM.removeEventListener('scroll', handleScroll);
      current.destroy();
      editor.current = null;
      cancelAnimationFrame(compositionFrame);
      if (handlers.get(instanceKey) === boundHandlers) handlers.delete(instanceKey);
    };
  });
  const syncEditor = (element: HTMLDivElement | null) => {
    const mounted = editor.current;
    if (!element || !mounted) return;
    const { view: current, options: previous } = mounted;
    mounted.options = { value, filename, wordWrap, readOnly, ariaLabel, placeholderText };
    const effects = [];
    if (current.state.facet(editorCallbacks) !== callbacks)
      effects.push(callbacksConf.reconfigure(editorCallbacks.of(callbacks)));
    if (previous?.wordWrap !== wordWrap)
      effects.push(wrappingConf.reconfigure(wordWrap ? EditorView.lineWrapping : []));
    if (previous?.readOnly !== readOnly)
      effects.push(readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)));
    if (previous?.ariaLabel !== ariaLabel)
      effects.push(
        contentAttributesConf.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': ariaLabel }),
        ),
      );
    if (previous?.placeholderText !== placeholderText)
      effects.push(placeholderConf.reconfigure(placeholder(placeholderText)));
    if (!previous || previous.filename !== filename) {
      const resolved = languageForFilename(filename);
      effects.push(
        layoutConf.reconfigure(layoutOf(resolved, livePreview !== undefined)),
        languageConf.reconfigure(
          resolved.kind === 'markdown'
            ? markdown({ base: markdownLanguage, codeLanguages: languages })
            : [],
        ),
      );
      if (resolved.kind === 'code')
        void resolved.language.load().then((support) => {
          if (editor.current === mounted && mounted.options?.filename === filename)
            current.dispatch({ effects: languageConf.reconfigure(support) });
        });
    }
    if (effects.length) current.dispatch({ effects });
    if (previous?.value !== value) mounted.replaceText(value);
  };
  const run = (command?: (view: EditorView) => unknown) => {
    const view = editor.current?.view;
    if (!view) return;
    view.focus();
    command?.(view);
  };
  const copy = () => {
    const text = editor.current?.view.state.sliceDoc() ?? value;
    navigator.clipboard
      .writeText(text)
      .catch((cause) =>
        showToast({ variant: 'error', title: '复制失败', description: errorMessage(cause) }),
      );
  };
  return (
    <div
      ref={syncEditor}
      data-code-scroll-surface=""
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <CodeScrollbar ref={scrollbarRef} className="absolute inset-x-0 bottom-0 z-raised" />
      {toolbar?.(
        <>
          <DocumentToolbarButton label="复制全文" onClick={copy}>
            <Copy />
          </DocumentToolbarButton>
          <DocumentToolbarDivider />
          <DocumentToolbarButton
            label="撤销"
            disabled={readOnly || !snapshot?.canUndo}
            onClick={() => run(undo)}
          >
            <Undo />
          </DocumentToolbarButton>
          <DocumentToolbarButton
            label="重做"
            disabled={readOnly || !snapshot?.canRedo}
            onClick={() => run(redo)}
          >
            <Redo />
          </DocumentToolbarButton>
        </>,
      )}
      <div ref={attachEditor} className="min-h-0 w-full flex-1 overflow-hidden" />
      {documentLayout && !readOnly && snapshot?.format && (
        <SelectionToolbar
          anchor={anchor}
          format={snapshot.format}
          visible={snapshot.focused && !selecting}
          run={run}
        />
      )}
    </div>
  );
}
