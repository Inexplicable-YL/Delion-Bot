import { useRef, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../../ui/Button';
import { IconButton } from '../../../../ui/IconButton';
import { Input } from '../../../../ui/Input';
import { Textarea } from '../../../../ui/Textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../ui/Select';
import type { McpServerView, McpTransportConfig } from '../../../../core/protocol/capabilities';
import { mcpUpdatePatch, parseMcpForm } from './mcp-logic';
import { ErrorText } from '../../../../ui/Alert';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../ui/Dialog';
import { Field } from '../../../../ui/Field';
import { capabilitiesClient } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

export type McpEditState = { mode: 'create' } | { mode: 'edit'; server: McpServerView } | null;

const codeAreaClass = 'min-h-20 resize-y py-2 font-mono text-ui-subhead';
const transportLabels = { stdio: '本地命令（stdio）', http: '远程 HTTP' };
const secretHint = '值经系统钥匙串加密保存在本机，不会再显示在界面上。';

export function McpFormDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Exclude<McpEditState, null>;
  onClose: () => void;
  onSaved: (views: McpServerView[]) => void;
}) {
  const isEdit = editing.mode === 'edit';
  const [transport, setTransport] = useState<McpTransportConfig['transport']>(
    isEdit ? editing.server.transport : 'http',
  );
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(isEdit ? editing.server.name : '');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState([{ id: 'first', name: '', value: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!window.delionBot || busy) return;
    const parsed = parseMcpForm(
      { transport, name, command, argsText, envText, url, headers },
      { isEdit },
    );
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    const saveServer = async () => {
      const views = isEdit
        ? await capabilitiesClient.updateMcpServer({
            id: editing.server.id,
            patch: mcpUpdatePatch(parsed.value),
          })
        : await capabilitiesClient.addMcpServer(parsed.value);
      onSaved(views);
      onClose();
    };
    try {
      await saveServer();
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
  };

  return (
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent
        className="flex flex-col overflow-hidden p-0"
        size="lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
      >
        <div className="shrink-0 px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? `编辑 ${editing.server.name}` : '添加自定义连接器'}</DialogTitle>
            <DialogClose disabled={busy} />
          </DialogHeader>
          <DialogDescription>
            {isEdit
              ? '留空的连接字段会保留原值。保存后会重新连接。'
              : transport === 'http'
                ? '使用 Streamable HTTP 连接。需要访问令牌时，可填写 Authorization 标头。'
                : '保存后，Delion Bot 会启动本地命令并连接。'}
          </DialogDescription>
        </div>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="min-h-0 overflow-y-auto">
            <fieldset className="grid min-w-0 gap-4 px-6 pt-2 pb-6" disabled={busy}>
              <Field label="名称">
                <Input
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="输入连接器名称"
                  ref={nameInput}
                  required
                  value={name}
                />
              </Field>
              {!isEdit && (
                <Field label="类型">
                  <Select
                    disabled={busy}
                    value={transport}
                    onValueChange={(value) => {
                      if (value === 'http' || value === 'stdio') {
                        setTransport(value);
                        setError(null);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full text-ui-body">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">{transportLabels.http}</SelectItem>
                      <SelectItem value="stdio">{transportLabels.stdio}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {transport === 'stdio' ? (
                <>
                  <Field label="命令">
                    <Input
                      autoComplete="off"
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder={isEdit ? '留空保持不变' : 'npx'}
                      required={!isEdit}
                      spellCheck={false}
                      value={command}
                    />
                  </Field>
                  <Field label="参数（每行一个）">
                    <Textarea
                      className={codeAreaClass}
                      onChange={(event) => setArgsText(event.target.value)}
                      placeholder={'-y\n@modelcontextprotocol/server-weather'}
                      rows={3}
                      spellCheck={false}
                      value={argsText}
                    />
                  </Field>
                  <Field
                    label="环境变量（每行 KEY=VALUE）"
                    hint={<>子进程默认继承 Delion Bot 进程的环境变量；{secretHint}</>}
                  >
                    <Textarea
                      className={codeAreaClass}
                      onChange={(event) => setEnvText(event.target.value)}
                      placeholder={'WEATHER_API_KEY=…'}
                      rows={3}
                      spellCheck={false}
                      value={envText}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="服务器 URL">
                    <Input
                      autoComplete="off"
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder={isEdit ? '留空保持不变' : 'https://example.com/mcp'}
                      required={!isEdit}
                      spellCheck={false}
                      value={url}
                    />
                  </Field>
                  <fieldset className="grid min-w-0 gap-2">
                    <legend className="mb-2 text-ui-body">HTTP 标头</legend>
                    {headers.map((header, index) => (
                      <div className="flex items-start gap-2" key={header.id}>
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                          <Input
                            aria-label={`标头 ${index + 1} 名称`}
                            autoComplete="off"
                            onChange={(event) => {
                              const name = event.target.value;
                              setHeaders((rows) =>
                                rows.map((row) => (row.id === header.id ? { ...row, name } : row)),
                              );
                            }}
                            placeholder="名称"
                            spellCheck={false}
                            value={header.name}
                          />
                          <Input
                            aria-label={`标头 ${index + 1} 值`}
                            autoComplete="off"
                            onChange={(event) => {
                              const value = event.target.value;
                              setHeaders((rows) =>
                                rows.map((row) => (row.id === header.id ? { ...row, value } : row)),
                              );
                            }}
                            placeholder="值"
                            spellCheck={false}
                            value={header.value}
                          />
                        </div>
                        {headers.length > 1 && (
                          <IconButton
                            aria-label={`移除标头 ${index + 1}`}
                            onClick={() =>
                              setHeaders((rows) => rows.filter(({ id }) => id !== header.id))
                            }
                          >
                            <TrashIcon />
                          </IconButton>
                        )}
                      </div>
                    ))}
                    <p className="text-ui-subhead text-ink-2">{secretHint}</p>
                    <Button
                      className="justify-self-start"
                      onClick={() => {
                        const id = crypto.randomUUID();
                        setHeaders((rows) => [...rows, { id, name: '', value: '' }]);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <PlusIcon />
                      添加标头
                    </Button>
                  </fieldset>
                </>
              )}
            </fieldset>
          </div>
          <DialogFooter className="mt-0 shrink-0 justify-between border-t border-line px-6 py-4">
            {error && <ErrorText className="basis-full wrap-anywhere">{error}</ErrorText>}
            <Button disabled={busy} onClick={onClose} variant="secondary">
              取消
            </Button>
            <Button
              disabled={
                busy || !name.trim() || (!isEdit && !(transport === 'http' ? url : command).trim())
              }
              type="submit"
              variant="accent"
            >
              {busy ? '保存中…' : isEdit ? '保存' : '添加连接器'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
