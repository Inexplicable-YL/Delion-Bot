// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  sanitizeHtml,
  sanitizeHtmlWithAssets,
} from '../../../../src/modules/preview/view/sanitize-html';

const body = (html: string) =>
  new DOMParser().parseFromString(sanitizeHtml(html, 'https://example.com/', 14), 'text/html').body;

describe('sanitizeHtml', () => {
  it('drops javascript: links inside svg', () => {
    const doc = body('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>');
    expect(doc.innerHTML).not.toContain('javascript:');
  });

  it('drops script vectors outside a fixed tag list', () => {
    const doc = body(
      '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a>' +
        '<set attributeName="onmouseover" to="alert(1)"/></svg>' +
        '<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>' +
        '<details open ontoggle="alert(1)"></details><form><input></form>',
    );
    expect(doc.querySelector('animate,set,form')).toBeNull();
    expect(doc.innerHTML).not.toMatch(/javascript:|onerror|ontoggle/);
  });

  it('keeps ordinary course markup and inline svg', () => {
    const doc = body(
      '<table><tr><td style="color:red">第1周</td></tr></table><svg><circle r="4"/></svg>',
    );
    expect(doc.querySelector('td')!.getAttribute('style')).toBe('color:red');
    expect(doc.querySelector('svg circle')).not.toBeNull();
  });

  it('resolves relative links and images against the base url', () => {
    const doc = body('<a href="/documents/1">文档</a><img src="/files/2.png">');
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://example.com/documents/1');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('https://example.com/files/2.png');
  });

  it('keeps local previews static and blocks automatic requests', () => {
    const input =
      '<style>p{color:red}</style><meta http-equiv="refresh" content="0; url=https://example.com">' +
      '<script>alert(1)</script><iframe src="https://example.com"></iframe>' +
      '<p onclick="alert(1)">Report</p><img src="https://example.com/pixel" srcset="https://example.com/wide 2x">';
    const doc = new DOMParser().parseFromString(sanitizeHtml(input, '', 14), 'text/html');
    expect(doc.querySelector('p')?.textContent).toBe('Report');
    expect(doc.querySelector('p')?.hasAttribute('onclick')).toBe(false);
    expect(
      doc.querySelector('script, iframe, meta[http-equiv="refresh"], img[src], img[srcset]'),
    ).toBeNull();
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain("img-src data:; script-src 'none'");
  });

  it('embeds local images and stylesheet resources without loading external ones', async () => {
    const readAsset = vi.fn(async (path: string) => {
      if (path === 'styles/report.css')
        return { mime: 'text/css', content: '.cover{background-image:url(../images/cover.png)}' };
      if (path === 'images/cover.png') return { mime: 'image/png', content: 'aW1hZ2U=' };
      return null;
    });
    const input =
      '<link rel="stylesheet" href="styles/report.css"><img src="./images/cover.png">' +
      '<img src="../outside.png"><img src="https://example.com/pixel">';
    const html = await sanitizeHtmlWithAssets(input, 14, readAsset);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aW1hZ2U=');
    expect(doc.querySelectorAll('img[src]')).toHaveLength(1);
    expect(doc.head.textContent).toContain(
      '.cover{background-image:url("data:image/png;base64,aW1hZ2U=")}',
    );
    expect(doc.querySelector('link')).toBeNull();
    expect(readAsset.mock.calls.flat().sort()).toEqual(['images/cover.png', 'styles/report.css']);
  });
});
