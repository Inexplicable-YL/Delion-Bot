import { useRef, useState } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { useEditorSettings } from './editor-settings';
import { codeHighlightStyle } from './syntax-highlight';

const viewerTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.625',
    padding: '1.5rem 0',
  },
  '.cm-content': {
    caretColor: 'var(--syntax-caret)',
    margin: '0',
    paddingRight: '1.5rem',
    textAlign: 'left',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--line)',
    backgroundColor: 'var(--surface)',
    color: 'var(--ink-3)',
    paddingLeft: '1.5rem',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 0.5rem 0 0.25rem' },
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
          wrappingConf.of(wordWrap ? EditorView.lineWrapping : []),
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap]),
          viewerTheme,
          syntaxHighlighting(codeHighlightStyle),
        ],
      }),
    });
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
    <div ref={syncViewer} className="min-h-0 w-full flex-1 overflow-hidden">
      <div ref={attachViewer} className="size-full" />
    </div>
  );
}
