import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { connectorsClient as client } from './use-connector-accounts';

export function ComposioDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>配置 Composio</DialogTitle>
          <DialogClose aria-label="关闭 Composio 配置" />
        </DialogHeader>
        <DialogDescription>
          在 Composio 的 Project Settings → API Keys 获取项目密钥。
          <a
            className="mt-1 block w-fit text-accent-ink underline-offset-4 hover:underline"
            href="https://dashboard.composio.dev/"
            rel="noreferrer"
            target="_blank"
          >
            前往 Composio ↗
          </a>
        </DialogDescription>
        <KeyForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** 只在弹窗打开时挂载，关闭后输入与错误随之清空。 */
function KeyForm({ onDone }: { onDone: () => void }) {
  const cache = useQueryClient();
  const [key, setKey] = useState('');
  const setup = useMutation({
    mutationFn: () => client.setup(key),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['connectors'] });
      onDone();
    },
  });
  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!setup.isPending && key.trim()) setup.mutate();
      }}
    >
      <Field label="项目密钥" error={setup.error ? errorMessage(setup.error) : undefined}>
        <Input
          autoComplete="off"
          autoFocus
          disabled={setup.isPending}
          placeholder="粘贴项目 API Key"
          type="password"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            if (setup.isError) setup.reset();
          }}
        />
      </Field>
      <details className="text-ui-subhead text-ink-2">
        <summary className="cursor-pointer">受限项目密钥需要哪些权限？</summary>
        <ul className="grid gap-1 pt-2">
          <li>Session management · Write only</li>
          <li>Session tool execution · Write only</li>
          <li>Connected accounts · Read and write</li>
          <li>Toolkits · Read only</li>
        </ul>
      </details>
      <DialogFooter className="mt-0">
        <Button disabled={setup.isPending} onClick={onDone} type="button" variant="secondary">
          取消
        </Button>
        <Button disabled={setup.isPending || !key.trim()} type="submit" variant="accent">
          {setup.isPending ? '正在验证…' : '验证并保存'}
        </Button>
      </DialogFooter>
    </form>
  );
}
