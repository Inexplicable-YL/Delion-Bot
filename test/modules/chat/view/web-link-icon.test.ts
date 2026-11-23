import { expect, it } from 'vitest';
import { siteIcon } from '../../../../src/modules/chat/view/WebLinkIcon';

it('按域名和子域名匹配站点图标，其余网址使用默认图标', () => {
  expect(siteIcon('https://github.com/a/b')?.title).toBe('GitHub');
  expect(siteIcon('https://zh.wikipedia.org/wiki/x')?.title).toBe('Wikipedia');
  expect(siteIcon('https://www.bilibili.com/video/1')?.title).toBe('Bilibili');
  expect(siteIcon('https://notgithub.com')).toBeUndefined();
  expect(siteIcon('https://example.com')).toBeUndefined();
});
