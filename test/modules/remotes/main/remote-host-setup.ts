import { existsSync } from 'node:fs';

export default function setup(): void {
  if (!process.env.DELION_REMOTE_HOST) {
    throw new Error(
      '真机远程套件需要 DELION_REMOTE_HOST（例如 root@1.2.3.4），可选 DELION_REMOTE_KEY 指定私钥',
    );
  }
  if (!existsSync('.build/remote-rg/rg-linux-amd64'))
    throw new Error('真机远程套件需要随包 rg，先运行 pnpm fetch:remote-rg');
}
