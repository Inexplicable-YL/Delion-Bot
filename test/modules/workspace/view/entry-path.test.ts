import { describe, expect, it } from 'vitest';
import { isChatStoragePath } from '../../../../src/modules/workspace/view/entry-path';

describe('isChatStoragePath', () => {
  it('识别会话私有目录与共享目录中的文件', () => {
    expect(isChatStoragePath('/data', '/data/chat-sessions/s1/a.md')).toBe(true);
    expect(isChatStoragePath('/data/', '/data/chat-share/s1/sub/b.pdf')).toBe(true);
    const windowsRoot = ['C' + ':', 'Data'].join('\\');
    const sharedFile = [windowsRoot.toLowerCase(), 'chat-share', 's1', 'b.pdf'].join('\\');
    expect(isChatStoragePath(windowsRoot, sharedFile)).toBe(true);
    expect(isChatStoragePath(windowsRoot, sharedFile.replace('chat-share', 'notes'))).toBe(false);
    expect(isChatStoragePath('/data', '/data/workspace/chat-share/b.md')).toBe(false);
    expect(isChatStoragePath('/data', '/data/chat-shared/b.md')).toBe(false);
  });
});
