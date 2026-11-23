import DOMPurify from 'dompurify';
import { isRelativeAssetPath } from '../../workspace/contract';
import { renderPreviewHtml } from './preview-html';

function sanitizedDocument(
  text: string | null | undefined,
  baseUrl: string,
  localAssets = false,
): Document {
  const clean = DOMPurify.sanitize(text || '<p>此内容没有正文。</p>', {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ADD_TAGS: localAssets ? ['link'] : [],
    FORBID_TAGS: [
      'base',
      'form',
      'iframe',
      'meta',
      'object',
      'embed',
      ...(localAssets ? [] : ['link']),
    ],
    FORBID_ATTR: [
      'data-preview-href',
      'download',
      'ping',
      'target',
      'xlink:href',
      ...(localAssets ? [] : ['srcset']),
    ],
  });
  const doc = document.implementation.createHTMLDocument();
  doc.replaceChild(doc.adoptNode(clean), doc.documentElement);
  doc.querySelectorAll('a[href],img[src]').forEach((el) => {
    const attr = el.localName === 'a' ? 'href' : 'src';
    const value = el.getAttribute(attr)!;
    if (attr === 'href' && value.startsWith('#')) return;
    if (attr === 'src' && /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(value)) return;
    if (attr === 'src' && !baseUrl) {
      if (!localAssets || !isRelativeAssetPath(value.trim())) el.removeAttribute(attr);
      return;
    }
    try {
      const url = new URL(value, baseUrl || undefined);
      if (!['https:', 'http:'].includes(url.protocol)) el.removeAttribute(attr);
      else if (attr === 'href' && !baseUrl) {
        el.setAttribute('data-preview-href', url.href);
        el.setAttribute('href', '#');
      } else el.setAttribute(attr, url.href);
    } catch {
      el.removeAttribute(attr);
    }
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = `default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; img-src data:${baseUrl ? ' https: http:' : ''}; script-src 'none'; font-src data:; form-action 'none'`;
  doc.head.prepend(csp);
  return doc;
}

export function sanitizeHtml(
  text: string | null | undefined,
  baseUrl: string,
  rootSize: number,
  htmlScrollY: 'hidden' | 'auto' = 'hidden',
): string {
  return renderPreviewHtml(sanitizedDocument(text, baseUrl), true, rootSize, htmlScrollY);
}

type Asset = { mime: string; content: string };

export async function sanitizeHtmlWithAssets(
  text: string | null | undefined,
  rootSize: number,
  readAsset: (path: string) => Promise<Asset | null>,
): Promise<string> {
  const doc = sanitizedDocument(text, '', true);
  const assets = new Map<string, Promise<Asset | null>>();
  const base = new URL('https://preview.invalid/assets/');
  const assetPath = (ref: string, from = '') => {
    if (!isRelativeAssetPath(ref.trim())) return null;
    try {
      const relativeBase = from.split('/').map(encodeURIComponent).join('/');
      const url = new URL(ref, new URL(relativeBase, base));
      return url.origin === base.origin && url.pathname.startsWith(base.pathname)
        ? decodeURIComponent(url.pathname.slice(base.pathname.length))
        : null;
    } catch {
      return null;
    }
  };
  const load = (path: string) => {
    const existing = assets.get(path);
    if (existing) return existing;
    const result = readAsset(path).catch(() => null);
    assets.set(path, result);
    return result;
  };
  const dataUrl = async (ref: string, from?: string) => {
    const path = assetPath(ref, from);
    const asset = path && (await load(path));
    return asset && asset.mime !== 'text/css' ? `data:${asset.mime};base64,${asset.content}` : null;
  };
  const inlineCss = async (css: string, from?: string) => {
    const urls = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
    let end = 0;
    let result = '';
    for (const match of urls) {
      const ref = (match[1] ?? match[2] ?? match[3]!).trim();
      const replacement =
        ref.startsWith('#') || /^data:(?:image|font)\//i.test(ref)
          ? match[0]
          : `url("${(await dataUrl(ref, from)) ?? ''}")`;
      result += css.slice(end, match.index) + replacement;
      end = match.index + match[0].length;
    }
    return result + css.slice(end);
  };
  await Promise.all([
    ...Array.from(doc.querySelectorAll('img[src]'), async (image) => {
      const ref = image.getAttribute('src')!;
      if (/^data:image\//i.test(ref)) return;
      const src = await dataUrl(ref);
      if (src) image.setAttribute('src', src);
      else image.removeAttribute('src');
    }),
    ...Array.from(doc.querySelectorAll('img[srcset],picture source[srcset]'), async (image) => {
      const candidates = image.getAttribute('srcset')!;
      image.removeAttribute('srcset');
      if (/(?:^|[\s,])data:/i.test(candidates)) return;
      const sources = await Promise.all(
        candidates.split(',').map(async (candidate) => {
          const [ref, descriptor] = candidate.trim().split(/\s+/);
          const src = ref && (await dataUrl(ref));
          return src ? `${src}${descriptor ? ` ${descriptor}` : ''}` : null;
        }),
      );
      if (sources.some(Boolean)) image.setAttribute('srcset', sources.filter(Boolean).join(', '));
    }),
    ...Array.from(doc.querySelectorAll('link'), async (link) => {
      const ref = link.getAttribute('href');
      const path = link.rel.toLowerCase() === 'stylesheet' && ref && assetPath(ref);
      const asset = path && (await load(path));
      if (!asset || asset.mime !== 'text/css') {
        link.remove();
        return;
      }
      const style = doc.createElement('style');
      style.media = link.media;
      style.textContent = (await inlineCss(asset.content, path)).replaceAll('<', '\\3c ');
      link.replaceWith(style);
    }),
    ...Array.from(doc.querySelectorAll('style'), async (style) => {
      style.textContent = (await inlineCss(style.textContent)).replaceAll('<', '\\3c ');
    }),
    ...Array.from(doc.querySelectorAll('[style]'), async (element) => {
      element.setAttribute('style', await inlineCss(element.getAttribute('style')!));
    }),
  ]);
  return renderPreviewHtml(doc, true, rootSize, 'auto');
}
