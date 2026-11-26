import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostPorts } from '../../ports';
import type { ScopedCommandResult } from '../../remote/helper';
import { loadPi } from '../pi';

const previewWindowBytes = 100 * 1024;
export const maxCommandOutputBytes = 8 * 1024 * 1024;
const captureLimitNotice = `Output exceeded the ${maxCommandOutputBytes / (1024 * 1024)} MiB capture limit. Showing the tail.`;
const incompleteNotice = 'The command output is incomplete. Only the received content is kept.';

export function commandOutputDirectory(session: string) {
  return join(hostPorts().paths.userData(), 'command-output', session);
}

export class CommandOutput {
  private readonly tail = Buffer.allocUnsafe(previewWindowBytes);
  private totalBytes = 0;
  private log?: Buffer;

  constructor(private readonly session: string) {}

  append(chunk: Buffer) {
    if (!chunk.length) return;
    const total = this.totalBytes + chunk.length;
    if (total > maxCommandOutputBytes) this.log = undefined;
    else if (total > previewWindowBytes) {
      if (!this.log || this.log.length < total) {
        const capacity = Math.min(
          maxCommandOutputBytes,
          Math.max(total, 2 * (this.log?.length ?? previewWindowBytes)),
        );
        const next = Buffer.allocUnsafe(capacity);
        (this.log ?? this.tail).copy(next, 0, 0, this.totalBytes);
        this.log = next;
      }
      chunk.copy(this.log, this.totalBytes);
    }
    const tail = chunk.subarray(-previewWindowBytes);
    const start = (total - tail.length) % previewWindowBytes;
    const copied = tail.copy(this.tail, start);
    tail.copy(this.tail, 0, copied);
    this.totalBytes = total;
  }

  async result(
    redact: (text: string) => string,
    complete = true,
  ): Promise<
    Pick<ScopedCommandResult, 'output' | 'full_output_path' | 'output_truncated' | 'output_notice'>
  > {
    const { truncateTail } = await loadPi();
    const start = this.totalBytes % previewWindowBytes;
    const tail =
      this.totalBytes > previewWindowBytes
        ? Buffer.concat([this.tail.subarray(start), this.tail.subarray(0, start)])
        : this.tail.subarray(0, this.totalBytes);
    const preview = truncateTail(redact(tail.toString('utf8')));
    const result = { output: preview.content };
    if (this.totalBytes <= previewWindowBytes && !preview.truncated)
      return complete
        ? result
        : { ...result, output_truncated: true, output_notice: incompleteNotice };
    if (this.totalBytes > maxCommandOutputBytes)
      return {
        ...result,
        output_truncated: true,
        output_notice: captureLimitNotice,
      };
    const name = `${randomUUID()}.log`;
    const directory = commandOutputDirectory(this.session);
    const path = join(directory, name);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        path,
        redact((this.log?.subarray(0, this.totalBytes) ?? tail).toString('utf8')),
        { flag: 'wx', mode: 0o600 },
      );
      return {
        ...result,
        ...(!complete && { output_truncated: true, output_notice: incompleteNotice }),
        full_output_path: `/command-output/${name}`,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        await rm(path, { force: true }).catch(() => {});
      return {
        ...result,
        output_truncated: true,
        output_notice: 'Unable to save the full output. Showing the tail.',
      };
    }
  }
}
