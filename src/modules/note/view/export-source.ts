import type { Image, Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type LoadedImage = { blob: Blob; width: number; height: number };
export type ImageLoader = (src: string) => Promise<LoadedImage | null>;

export function parseMarkdown(text: string): Root {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(text);
}

export function nodesOf<Type extends Nodes['type']>(
  tree: Nodes,
  type: Type,
): Extract<Nodes, { type: Type }>[] {
  const own = tree.type === type ? [tree as Extract<Nodes, { type: Type }>] : [];
  const children = 'children' in tree ? (tree.children as Nodes[]) : [];
  return [...own, ...children.flatMap((child) => nodesOf(child, type))];
}

export async function loadImages(
  tree: Root,
  load: ImageLoader,
): Promise<Map<Image, LoadedImage | null>> {
  const images = nodesOf(tree, 'image');
  const loaded = await Promise.all(images.map((image) => load(image.url).catch(() => null)));
  return new Map(images.map((image, index) => [image, loaded[index] ?? null]));
}

export function fetchImage(url: string): Promise<LoadedImage | null> {
  if (!url.startsWith('delion-resource:')) return Promise.resolve(null);
  return fetch(url).then(async (response) => {
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const element = new Image();
      element.src = objectUrl;
      await element.decode();
      return { blob, width: element.naturalWidth, height: element.naturalHeight };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });
}
