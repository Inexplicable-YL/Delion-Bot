import type { Code, Image, Root } from 'mdast';
import rehypeStringify from 'rehype-stringify';
import remarkRehype, { defaultHandlers, type Options } from 'remark-rehype';
import { unified } from 'unified';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { loadImages, nodesOf, type ImageLoader } from './export-source';
import { renderMath } from './math';

const printStyle = `
@page { size: A4; margin: 20mm 18mm; }
html { color: #1d1d1f; background: #fff; }
body {
  margin: 0;
  font: 11pt/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.35; margin: 1.4em 0 0.6em; break-after: avoid; }
h1 { font-size: 1.8em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; } h4, h5, h6 { font-size: 1em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 0.9em; }
a { color: #1e6ef4; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid #d2d2d7; color: #6e6e73; }
code { font-family: Consolas, 'SFMono-Regular', Menlo, monospace; font-size: 0.9em; background: #f6f8fa; padding: 0.1em 0.3em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 0.8em 1em; border-radius: 6px; white-space: pre-wrap; }
pre code { padding: 0; background: none; }
table { border-collapse: collapse; }
th, td { border: 1px solid #d2d2d7; padding: 0.35em 0.75em; }
th { background: #f5f5f7; font-weight: 600; }
tr, img, svg, pre { break-inside: avoid; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #d2d2d7; margin: 1.5em 0; }
.math-display, .mermaid { text-align: center; margin: 0 0 0.9em; }
.mermaid svg { max-width: 100%; height: auto; }
li > input[type=checkbox] { margin: 0 0.4em 0 0; }
`;

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function renderCharts(tree: Root): Promise<Map<Code, string>> {
  const charts = nodesOf(tree, 'code').filter((node) => node.lang === 'mermaid');
  const config = { ...mermaidConfig(), theme: 'default' as const };
  const rendered = await Promise.all(
    charts.map((node) =>
      renderMermaid(`delion-export-mermaid-${crypto.randomUUID()}`, node.value, config).then(
        ({ svg }) => svg,
        () => null,
      ),
    ),
  );
  return new Map(
    charts.flatMap((node, index) => {
      const svg = rendered[index];
      return svg ? [[node, svg] as const] : [];
    }),
  );
}

export async function markdownToPrintHtml(
  tree: Root,
  title: string,
  loadImage: ImageLoader,
): Promise<string> {
  const [images, charts] = await Promise.all([loadImages(tree, loadImage), renderCharts(tree)]);
  const sources = new Map<Image, string>();
  for (const [node, image] of images) if (image) sources.set(node, await blobToDataUrl(image.blob));
  const handlers: NonNullable<Options['handlers']> = {
    image: (state, node: Image) => {
      const src = sources.get(node) ?? (/^https?:/i.test(node.url) ? node.url : null);
      if (!src) return { type: 'text', value: node.alt ?? '' };
      return {
        type: 'element',
        tagName: 'img',
        properties: { src, alt: node.alt ?? '' },
        children: [],
      };
    },
    code: (state, node: Code) => {
      const svg = charts.get(node);
      if (!svg) return defaultHandlers.code(state, node);
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid'] },
        children: [{ type: 'raw', value: svg }],
      };
    },
    math: (state, node) => ({ type: 'raw', value: renderMath(node.value, true, 'mathml') }),
    inlineMath: (state, node) => ({ type: 'raw', value: renderMath(node.value, false, 'mathml') }),
  };
  const processor = unified()
    .use(remarkRehype, { handlers })
    .use(rehypeStringify, { allowDangerousHtml: true });
  const body = processor.stringify(await processor.run(tree));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${printStyle}</style></head><body>${body}</body></html>`;
}
