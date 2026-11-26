import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import {
  CommandOutput,
  commandOutputDirectory,
  maxCommandOutputBytes,
} from '../../../../src/core/agent/sandbox/command-output';

it('saves complete and incomplete captures and skips persistence past the capture cap', async () => {
  const session = randomUUID();
  const directory = commandOutputDirectory(session);
  const partialSession = randomUUID();
  const partialDirectory = commandOutputDirectory(partialSession);
  try {
    const complete = new CommandOutput(session);
    const first = Buffer.from('/host/chat\n');
    const second = Buffer.from('middle\n'.repeat(18_000));
    const last = Buffer.from('last\n');
    for (const chunk of [first, second, last]) complete.append(chunk);
    const result = await complete.result((text) => text.replaceAll('/host/chat', '/privacy'));
    expect(result.output.trimEnd().endsWith(last.toString().trimEnd())).toBe(true);
    expect(result.full_output_path).toBeDefined();
    expect(await readFile(join(directory, basename(result.full_output_path!)), 'utf8')).toBe(
      `/privacy\n${second}${last}`,
    );

    const incompleteCapture = new CommandOutput(partialSession);
    for (const chunk of [first, second]) incompleteCapture.append(chunk);
    const incomplete = await incompleteCapture.result((text) => text, false);
    expect(incomplete.output_truncated).toBe(true);
    expect(incomplete.output_notice).toContain('incomplete');
    expect(incomplete.full_output_path).toBeDefined();
    expect(await readdir(partialDirectory)).toHaveLength(1);

    const oversized = new CommandOutput(session);
    oversized.append(Buffer.alloc(maxCommandOutputBytes));
    oversized.append(last);
    const truncated = await oversized.result((text) => text);
    expect(truncated.output.trimEnd().endsWith(last.toString().trimEnd())).toBe(true);
    expect(truncated.output_truncated).toBe(true);
    expect(truncated.output_notice).toContain('capture limit');
    expect(truncated.full_output_path).toBeUndefined();
    expect(await readdir(directory)).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(partialDirectory, { recursive: true, force: true });
  }
});
