import { describe, expect, it } from 'vitest';
import { sandboxUnavailableReason } from '../../../../src/core/agent/sandbox/linux';

describe('受限沙箱的平台策略', () => {
  it('Windows 和 macOS 明确写成尚未提供，而不是已生效的隔离', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const reason = sandboxUnavailableReason(platform, '');
      expect(reason).toContain('尚未提供');
      expect(reason).toContain('没有改用本机权限');
      expect(reason).not.toContain('隔离已生效');
    }
  });

  it('Linux 缺失后端时拒绝运行，不暗示已经降级', () => {
    const reason = sandboxUnavailableReason('linux', '未找到 bubblewrap（bwrap）。');
    expect(reason).toContain('没有改用当前用户的本机权限');
    expect(reason).toContain('bubblewrap');
  });
});
