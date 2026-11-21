import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { codeHighlightStyle, markdownHighlightStyle, useEditorSettings } from '../../preview/view';
import { markdownLivePreview, type ImageResolver } from './live-preview';
import { formatByName } from '../../../core/protocol/files';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.625',
    padding: '1.5rem',
  },
  '.cm-content': { caretColor: 'var(--syntax-caret)', maxWidth: '60rem', margin: '0 auto' },
  '&.cm-source-file .cm-scroller': { padding: '1.5rem 0' },
  '&.cm-source-file .cm-content': {
    maxWidth: 'none',
    margin: '0',
    paddingRight: '1.5rem',
    textAlign: 'left',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--syntax-caret)' },
  '.cm-placeholder': { color: 'var(--ink-3)' },
  '.cm-scroller:has(.cm-gutters)': { paddingLeft: '0' },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'var(--surface)',
    color: 'var(--ink-3)',
    paddingLeft: '1.5rem',
  },
  '&.cm-source-file .cm-gutters': { borderRight: '1px solid var(--line)' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 0.5rem 0 0.25rem' },
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

type EditorHandlers = {
  onChange: (text: string) => void;
  onSave: () => void;
  sync: () => void;
  onCursor: (cursor: { line: number; column: number }) => void;
};

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
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const generatedKey = useId();
  const [instanceKey] = useState(editorStateKey ?? generatedKey);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const wordWrap = useEditorSettings((state) => state.wordWrap) || alwaysWrap;
  const latestValue = useRef(value);
  const lastPublishedValue = useRef<string | null>(null);
  const publishChange = useEffectEvent((text: string) => {
    lastPublishedValue.current = text;
    latestValue.current = text;
    onChange(text);
  });
  const save = useEffectEvent(() => onSave());
  const reportScroll = useEffectEvent((top: number) => onScroll(top));
  const syncValue = () => {
    const current = view.current;
    if (!current) return;
    if (latestValue.current === lastPublishedValue.current) return;
    const text = current.state.sliceDoc();
    if (latestValue.current === text) return;
    if (current.compositionStarted) {
      return;
    }
    lastPublishedValue.current = null;
    current.dispatch({
      changes: replaceDocument(text, latestValue.current),
      annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
    });
  };
  const appliedFilename = useRef(filename);
  const loadLanguage = (
    current: EditorView,
    language: LanguageDescription,
    name: string | undefined,
  ) => {
    void language.load().then((support) => {
      if (view.current === current && appliedFilename.current === name)
        current.dispatch({ effects: languageConf.reconfigure(support) });
    });
  };
  useEffect(() => {
    const initial = languageForFilename(filename);
    const persistent = editorStateKey !== undefined;
    const transient: { current?: EditorSession } = {};
    const previous = persistent ? sessions.get(instanceKey) : undefined;
    const extensions: Extension[] = [
      EditorState.lineSeparator.of(lineSeparatorOf(value)),
      history(),
      languageConf.of(
        initial.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      ),
      previewConf.of(
        livePreview && initial.kind === 'markdown'
          ? markdownLivePreview(livePreview)
          : syntaxHighlighting(markdownHighlightStyle),
      ),
      readOnlyConf.of(EditorState.readOnly.of(readOnly)),
      ...extraExtensions,
      ...(showLineNumbers ? [lineNumbers()] : []),
      wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
      layoutConf.of(
        EditorView.editorAttributes.of({
          class: initial.kind === 'markdown' ? '' : 'cm-source-file',
        }),
      ),
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
        if (update.selectionSet) {
          const position = update.state.doc.lineAt(update.state.selection.main.head);
          handlers.get(instanceKey)?.onCursor({
            line: position.number,
            column: update.state.selection.main.head - position.from + 1,
          });
        }
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
          window.setTimeout(() => handlers.get(instanceKey)?.sync(), 0);
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
    const current = new EditorView({ parent: host.current!, state });
    current.scrollDOM.scrollTop = session.scrollTop;
    const updateCursor = () => {
      const position = current.state.doc.lineAt(current.state.selection.main.head);
      setCursor({
        line: position.number,
        column: current.state.selection.main.head - position.from + 1,
      });
    };
    const handleScroll = () => {
      session.scrollTop = current.scrollDOM.scrollTop;
      reportScroll(current.scrollDOM.scrollTop);
    };
    const boundHandlers: EditorHandlers = {
      onChange: publishChange,
      onSave: save,
      sync: syncValue,
      onCursor: setCursor,
    };
    handlers.set(instanceKey, boundHandlers);
    current.scrollDOM.addEventListener('scroll', handleScroll);
    view.current = current;
    updateCursor();
    current.dispatch({
      effects: languageConf.reconfigure(
        initial.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      ),
    });
    if (initial.kind === 'code') loadLanguage(current, initial.language, filename);
    return () => {
      if (!persistent || sessions.get(instanceKey) === session) {
        session.state = current.state;
        session.scrollTop = current.scrollDOM.scrollTop;
      }
      current.scrollDOM.removeEventListener('scroll', handleScroll);
      current.destroy();
      view.current = null;
      if (handlers.get(instanceKey)?.sync === boundHandlers.sync) handlers.delete(instanceKey);
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: wrappingConf.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);
  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({
      effects: contentAttributesConf.reconfigure(
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          'aria-label': ariaLabel,
        }),
      ),
    });
  }, [ariaLabel]);
  useEffect(() => {
    view.current?.dispatch({
      effects: layoutConf.reconfigure(
        EditorView.editorAttributes.of({
          class: languageForFilename(filename).kind === 'markdown' ? '' : 'cm-source-file',
        }),
      ),
    });
  }, [filename]);
  useEffect(() => {
    latestValue.current = value;
    syncValue();
  }, [value]);
  useEffect(() => {
    const current = view.current;
    if (!current || appliedFilename.current === filename) return;
    appliedFilename.current = filename;
    const apply = (extension: Extension) => {
      if (view.current === current && appliedFilename.current === filename)
        current.dispatch({ effects: languageConf.reconfigure(extension) });
    };
    const resolved = languageForFilename(filename);
    if (resolved.kind === 'code') {
      apply([]);
      loadLanguage(current, resolved.language, filename);
    } else {
      apply(
        resolved.kind === 'markdown'
          ? markdown({ base: markdownLanguage, codeLanguages: languages })
          : [],
      );
    }
  }, [filename]);
  useEffect(() => {
    view.current?.dispatch({
      effects: placeholderConf.reconfigure(placeholder(placeholderText)),
    });
  }, [placeholderText]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />
      {editorStateKey !== undefined && (
        <div className="flex h-6 shrink-0 items-center justify-end border-t px-3 text-ui-subhead text-ink-2">
          行 {cursor.line}，列 {cursor.column}
        </div>
      )}
    </div>
  );
}
