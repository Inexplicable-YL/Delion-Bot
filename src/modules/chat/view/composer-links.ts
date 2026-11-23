import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type ComposerLink = {
  from: number;
  to: number;
  text: string;
  url: string;
  textFrom: number;
  textTo: number;
};

const urlChars = '[\\w\\-.~:/?#[\\]@!$&()*+,;=%]+';
const bareUrl = new RegExp(`https?://${urlChars}`, 'g');
const markdownLink = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g;
const urlTrailer = /[.,;:!?)\]]+$/;
const wholeUrl = /^https?:\/\/[\w\-.~:/?#@!$&*+,;=%]+$/;
const codeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (!codeNodes.has(node.name)) {
    if (!node.parent) return false;
    node = node.parent;
  }
  return true;
}

export function composerLinks(
  state: EditorState,
  taken: readonly [number, number][],
): ComposerLink[] {
  const source = state.doc.toString();
  const links: ComposerLink[] = [];
  const free = (from: number, to: number) =>
    ![...taken, ...links.map(({ from, to }): [number, number] => [from, to])].some(
      ([start, end]) => from < end && to > start,
    ) && !insideCode(state, from);
  for (const match of source.matchAll(markdownLink)) {
    const from = match.index;
    const to = from + match[0].length;
    if (!free(from, to)) continue;
    const text = match[1]!;
    links.push({
      from,
      to,
      text,
      url: match[2]!,
      textFrom: from + 1,
      textTo: from + 1 + text.length,
    });
  }
  for (const match of source.matchAll(bareUrl)) {
    const from = match.index;
    const url = match[0].replace(urlTrailer, '');
    const to = from + url.length;
    if (!free(from, to)) continue;
    links.push({ from, to, text: url, url, textFrom: from, textTo: to });
  }
  return links.sort((a, b) => a.from - b.from);
}

export const isComposerUrl = (url: string) => wholeUrl.test(url);

export function linkSource(text: string, url: string): string {
  const label = text.replace(/[[\]\n]/g, '').trim();
  return !label || label === url ? url : `[${label}](${url})`;
}
