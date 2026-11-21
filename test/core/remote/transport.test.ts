import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import { shellQuote } from '../../../src/core/remote/transport';

describe('shellQuote', () => {
  it('包裹单引号并转义内部单引号', () => {
    expect(shellQuote('/root/a b')).toBe("'/root/a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
