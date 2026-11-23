import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { expect, it } from 'vitest';
import {
  composerLinks,
  isComposerUrl,
  linkSource,
} from '../../../../src/modules/chat/view/composer-links';

const links = (doc: string) =>
  composerLinks(EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) }), []);

it('识别网址与 Markdown 链接，网址不吞掉后面的标点和中文', () => {
  expect(links('见 https://a.com/x，和 [文档](https://b.com).')).toEqual([
    { from: 2, to: 17, text: 'https://a.com/x', url: 'https://a.com/x', textFrom: 2, textTo: 17 },
    { from: 20, to: 39, text: '文档', url: 'https://b.com', textFrom: 21, textTo: 23 },
  ]);
});

it('代码里的网址不算链接', () => {
  expect(links('`https://a.com` 与\n```\nhttps://b.com\n```')).toEqual([]);
});

it('文本为空或等于地址时写回纯网址，否则写成 Markdown 链接', () => {
  expect(linkSource('', 'https://a.com')).toBe('https://a.com');
  expect(linkSource('https://a.com', 'https://a.com')).toBe('https://a.com');
  expect(linkSource(' [文]档 ', 'https://a.com')).toBe('[文档](https://a.com)');
  expect(isComposerUrl('https://a.com/x?y=1')).toBe(true);
  expect(isComposerUrl('a.com')).toBe(false);
  expect(isComposerUrl('https://a.com/(x)')).toBe(false);
});
