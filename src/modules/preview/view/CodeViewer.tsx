import { useRef, useState } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { useEditorSettings } from './editor-settings';
import { codeHighlightStyle, codeIndentGuides, codeLayout } from './syntax-highlight';
import { CodeScrollbar } from './CodeScrollbar';
import { connectCodeScrollbars } from './code-scrollbars';

const viewerTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: `${codeLayout.fontSize}rem`,
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: String(codeLayout.lineHeight),
    padding: `${codeLayout.inset}rem 0`,
  },
  '.cm-content': {
    caretColor: 'var(--syntax-caret)',
    margin: '0',
    paddingBlock: `${codeLayout.contentBlockPadding}px`,
    paddingRight: `${codeLayout.inset}rem`,
    textAlign: 'left',
  },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'var(--workbench-surface, var(--page))',
    color: 'var(--ink-3)',
    paddingLeft: `${codeLayout.inset}rem`,
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: codeLayout.lineNumberWidth,
    padding: `0 ${codeLayout.lineNumberPaddingEnd}rem 0 ${codeLayout.lineNumberPaddingStart}rem`,
  },
});

const wrappingConf = new Compartment();

function languageForFilename(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, filename);
}

export function CodeViewer({
  value,
  filename,
  initialScroll,
  onScroll,
}: {
  value: string;
  filename: string;
  initialScroll: () => number;
  onScroll: (top: number) => void;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const wordWrap = useEditorSettings((state) => state.wordWrap);

  const [attachViewer] = useState(() => (element: HTMLDivElement | null) => {
    if (!element) return;
    const languageConf = new Compartment();
    const view = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorState.readOnly.of(true),
          languageConf.of([]),
          lineNumbers(),
          codeIndentGuides,
          wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap]),
          viewerTheme,
          syntaxHighlighting(codeHighlightStyle),
        ],
      }),
    });
    const scrollbars = connectCodeScrollbars(
      [view.scrollDOM],
      [scrollbarRef.current!],
      '.cm-gutters-before',
      '.cm-content',
    );
    view.scrollDOM.scrollTop = initialScroll();
    const handleScroll = () => onScroll(view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener('scroll', handleScroll);
    viewRef.current = view;
    const language = languageForFilename(filename);
    if (language) {
      void language.load().then((support) => {
        if (viewRef.current === view) view.dispatch({ effects: languageConf.reconfigure(support) });
      });
    }
    return () => {
      scrollbars.disconnect();
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      viewRef.current = null;
      view.destroy();
    };
  });
  const syncViewer = (element: HTMLDivElement | null) => {
    const view = viewRef.current;
    if (!element || !view) return;
    const wrapping = wrappingConf.get(view.state);
    if ((wrapping === EditorView.lineWrapping) !== wordWrap)
      view.dispatch({ effects: wrappingConf.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
    const current = view.state.doc.toString();
    if (current === value) return;
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    view.scrollDOM.scrollTop = scrollTop;
  };

  return (
    <div ref={syncViewer} className="relative min-h-0 w-full flex-1 overflow-hidden">
      <CodeScrollbar ref={scrollbarRef} className="absolute inset-x-0 bottom-0 z-raised" />
      <div ref={attachViewer} className="size-full" />
    </div>
  );
}
