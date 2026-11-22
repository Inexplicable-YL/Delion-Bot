import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const nodePtyPackage = path.dirname(require.resolve('node-pty/package.json'));

  for (const arch of ['arm64', 'x64']) {
    await chmod(path.join(nodePtyPackage, 'prebuilds', `darwin-${arch}`, 'spawn-helper'), 0o755);
  }
}
