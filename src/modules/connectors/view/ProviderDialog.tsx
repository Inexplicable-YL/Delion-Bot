import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { infer as Infer } from 'zod';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../ui/Dialog';
import { Field } from '../../../ui/Field';
import { Input } from '../../../ui/Input';
import { providerNames, type credentials } from '../contract';
import { connectorsClient as client, type ConnectorProvider } from './use-connector-accounts';

const guides = {
  composio: {
    text: '在 Composio 的 Project Settings → API Keys 获取项目密钥。',
    url: 'https://dashboard.composio.dev/',
  },
  pipedream: {
    text: '在 Pipedream 的 Settings → API 创建 OAuth 客户端，并从项目设置复制项目 ID。',
    url: 'https://pipedream.com/settings/api',
  },
};

export function ProviderDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: ConnectorProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const name = providerNames[provider];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>配置 {name}</DialogTitle>
          <DialogClose aria-label={`关闭 ${name} 配置`} />
        </DialogHeader>
        <DialogDescription>
          {guides[provider].text}
          <a
            className="mt-1 block w-fit text-accent-ink underline-offset-4 hover:underline"
            href={guides[provider].url}
            rel="noreferrer"
            target="_blank"
          >
            前往 {name} ↗
          </a>
        </DialogDescription>
        {provider === 'composio' ? (
          <ComposioForm onDone={() => onOpenChange(false)} />
        ) : (
          <PipedreamForm onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function useSetup(onDone: () => void) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: Infer<typeof credentials>) => client.setup(input),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['connectors'] });
      onDone();
    },
  });
}

function FormFooter({
  disabled,
  pending,
  onCancel,
}: {
  disabled: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <DialogFooter className="mt-0">
      <Button disabled={pending} onClick={onCancel} type="button" variant="secondary">
        取消
      </Button>
      <Button disabled={pending || disabled} type="submit" variant="accent">
        {pending ? '正在验证…' : '验证并保存'}
      </Button>
    </DialogFooter>
  );
}

function ComposioForm({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  const setup = useSetup(onDone);
  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!setup.isPending && key.trim()) setup.mutate({ provider: 'composio', key });
      }}
    >
      <Field label="项目密钥" error={setup.error ? errorMessage(setup.error) : undefined}>
        <Input
          aria-label="Composio 项目密钥"
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
      <FormFooter disabled={!key.trim()} onCancel={onDone} pending={setup.isPending} />
    </form>
  );
}

function PipedreamForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState({ clientId: '', clientSecret: '', projectId: '' });
  const setup = useSetup(onDone);
  const complete = Object.values(values).every((value) => value.trim());
  const fields = [
    { key: 'clientId', label: 'Client ID', type: 'text', placeholder: '粘贴 OAuth Client ID' },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'password',
      placeholder: '粘贴 OAuth Client Secret',
    },
    { key: 'projectId', label: '项目 ID', type: 'text', placeholder: 'proj_…' },
  ] as const;
  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!setup.isPending && complete) setup.mutate({ provider: 'pipedream', ...values });
      }}
    >
      {fields.map((field, index) => (
        <Field
          error={setup.error && index === fields.length - 1 ? errorMessage(setup.error) : undefined}
          key={field.key}
          label={field.label}
        >
          <Input
            aria-label={`Pipedream ${field.label}`}
            autoComplete="off"
            autoFocus={index === 0}
            disabled={setup.isPending}
            placeholder={field.placeholder}
            type={field.type}
            value={values[field.key]}
            onChange={(event) => {
              setValues({ ...values, [field.key]: event.target.value });
              if (setup.isError) setup.reset();
            }}
          />
        </Field>
      ))}
      <FormFooter disabled={!complete} onCancel={onDone} pending={setup.isPending} />
    </form>
  );
}
