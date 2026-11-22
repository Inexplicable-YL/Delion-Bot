import { app } from 'electron';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { locateBash, prependRuntimePath } from '../src/modules/terminal';
import { locateSsh } from '../src/core/remote/transport';
import { loadPi } from '../src/core/agent/pi';
import { closeDomainBridge, domainBridge } from '../src/core/agent/environment';
import { COMMAND_BRIDGE } from '../src/core/capabilities/command-server';
import { closeDatabase } from '../src/app/main/database';
import { provideHostPorts } from '../src/core/ports';
import { electronPorts } from '../src/app/main/host-electron';
import { previewModule } from '../src/modules/preview';
import { todoModule } from '../src/modules/todo';
import { workspaceModule } from '../src/modules/workspace';

const root = resolve('.');
const profile = mkdtempSync(join(tmpdir(), 'delion-runtime-中文-'));
(app as typeof app & { setAppPath(path: string): void }).setAppPath(root);
for (const name of ['userData', 'documents', 'home'] as const) app.setPath(name, profile);
process.env.PI_CODING_AGENT_DIR = join(profile, 'pi');
process.env.PI_OFFLINE = '1';
if (process.platform === 'darwin') process.env.PATH = '/usr/bin:/bin';

const text = (result: { content: { type: string; text?: string }[]; isError?: boolean }) => {
  assert.notEqual(result.isError, true);
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
};
const timeout = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    provideHostPorts(electronPorts);
    todoModule.register?.();
    workspaceModule.register?.();
    previewModule.register?.();
    prependRuntimePath();
    const tools = join(
      root,
      'vendor',
      'bin',
      ...(process.platform === 'darwin' ? [`darwin-${process.arch}`] : []),
    );
    const separator = process.platform === 'win32' ? ';' : ':';
    assert.equal(process.env.PATH!.split(separator)[0], tools);
    for (const tool of ['rg', 'fd']) {
      const found = execFileSync(
        process.platform === 'win32' ? 'where' : '/usr/bin/which',
        [tool],
        { encoding: 'utf8' },
      )
        .trim()
        .split(/\r?\n/)[0];
      assert.equal(found, join(tools, `${tool}${process.platform === 'win32' ? '.exe' : ''}`));
    }
    execFileSync(locateSsh(), ['-V'], { stdio: 'pipe', timeout: 5000 });
    const bridge = await domainBridge();
    const pi = await loadPi();
    const bash = pi.createBashTool(profile, {
      shellPath: locateBash(),
      commandPrefix: `export DELION_COMMAND_URL='${bridge.url}' DELION_COMMAND_TOKEN='${bridge.token}'\n${COMMAND_BRIDGE}`,
    });
    const response = JSON.parse(
      text(await bash.execute('smoke-bash', { command: 'delion help', timeout: 5 })),
    );
    assert.equal(response.ok, true);
    assert.ok(response.result.some((command: { name: string }) => command.name === 'query_todos'));
    writeFileSync(join(profile, 'fixture 测试.txt'), 'delion-runtime-needle 中文\n');
    assert.match(
      text(
        await pi
          .createGrepTool(profile)
          .execute('smoke-grep', { pattern: 'delion-runtime-needle' }),
      ),
      /delion-runtime-needle/,
    );
    assert.match(
      text(await pi.createFindTool(profile).execute('smoke-find', { pattern: '*.txt' })),
      /fixture 测试\.txt/,
    );
    console.log(
      'Runtime smoke passed: platform Bash/SSH, bundled rg/fd, Pi bash/grep/find, real delion help bridge.',
    );
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    closeDomainBridge();
    closeDatabase();
    if (process.platform !== 'win32') rmSync(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
