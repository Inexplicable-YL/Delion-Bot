import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFilePath } from '../../../../src/modules/workspace/main/api';
import { copyResourceToProject } from '../../../../src/modules/workspace/main/resources';
import { provideTestHostPorts } from '../../../core/host-mock';
import { workspaceResourceResolver } from '../../../../src/modules/workspace/main/read-resource';
import { registerResourceResolver } from '../../../../src/core/capabilities/resources';

vi.mock('../../../../src/modules/preview', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../../../../src/modules/workspace/main/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/modules/workspace/main/api')>()),
  importWorkspaceFiles: vi.fn(),
  workspaceFilePath: vi.fn(),
}));

registerResourceResolver('workspace', workspaceResourceResolver);

const parentId = 'a03d4e01-ae55-4168-8572-ef88cb9f2e10';
afterEach(() => vi.resetAllMocks());
provideTestHostPorts({ paths: { temp: () => 'temp' } });

describe('copyResourceToProject', () => {
  it('rejects raw paths before accessing a resource', async () => {
    await expect(
      copyResourceToProject({
        parentId,
        source: { type: 'workspace', id: parentId, path: 'private' },
      }),
    ).rejects.toThrow();
    expect(workspaceFilePath).not.toHaveBeenCalled();
  });
});
