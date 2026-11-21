import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { vi } from 'vitest';
import { provideHostPorts, type BundledResource, type HostPorts } from '../../src/core/ports';

const scratch = mkdtempSync(join(tmpdir(), 'delion-test-'));
const secrets = new Map<string, string>();
const bundledInRepo: Record<BundledResource, string> = {
  'delion-helper': 'vendor/delion-helper',
  'remote-rg': '.build/remote-rg',
  openssh: 'vendor/openssh',
};

const testPorts: HostPorts = {
  paths: {
    userData: () => scratch,
    home: () => scratch,
    documents: () => scratch,
    temp: () => scratch,
    storage: () => scratch,
    bundled: (name) => resolve(bundledInRepo[name]),
    bash: () => 'bash',
  },
  secrets: {
    write: (namespace, plaintext) => void secrets.set(namespace, plaintext),
    read: (namespace) => secrets.get(namespace) ?? null,
    remove: (namespace) => void secrets.delete(namespace),
  },
  notifier: {
    notifyRunFinished: vi.fn(),
    show: vi.fn(),
  },
  broadcaster: {
    subscribe: vi.fn(),
    send: vi.fn(),
  },
  imageCodec: {
    previewDataUrl: vi.fn(() => null),
  },
  desktop: {
    pickFiles: vi.fn(async () => []),
    pickSavePath: vi.fn(async () => null),
    reveal: vi.fn(),
    open: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    sendToWindows: vi.fn(),
  },
  network: {
    fetch: vi.fn(() => Promise.reject(new Error('单元测试不访问网络'))),
  },
  database: () => {
    throw new Error('用例未提供数据库：provideTestHostPorts({ database })');
  },
  workspaceClient: () => null,
  projects: { find: () => null, local: () => [], remoteOf: () => null },
};

provideHostPorts(testPorts);

export function provideTestHostPorts({
  paths,
  ...overrides
}: Partial<Omit<HostPorts, 'paths'>> & { paths?: Partial<HostPorts['paths']> }): void {
  provideHostPorts({ ...testPorts, ...overrides, paths: { ...testPorts.paths, ...paths } });
}
