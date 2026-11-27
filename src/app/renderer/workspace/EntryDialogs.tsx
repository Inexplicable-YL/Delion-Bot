import { useState, type FormEvent } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { CloudIcon as Cloud, FolderOpenIcon as FolderOpen } from '@heroicons/react/24/outline';
import { sourceTitle } from '../../views';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/Select';
import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import { parseRemoteNodeId } from '../../../modules/remotes/contract';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import { useNoteDrafts } from '../../../modules/note/view';
import { updateEntry, type EntryAction } from './entry-actions';
import { NewRemoteProjectDialog } from './remote/NewRemoteProjectDialog';
import { ErrorText } from '../../../ui/Alert';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../ui/Dialog';
import { Field } from '../../../ui/Field';
import { errorMessage } from '../../../core/protocol/contract';

const ROOT_SELECT_VALUE = '__root__';

export interface EntryDialogRequest {
  action: EntryAction | 'link';
  id: string | null;
  ids?: string[];
  text?: string;
  initialTarget?: string;
}

const titles: Partial<Record<EntryDialogRequest['action'], string>> = {
  folder: '新建文件夹',
  project: '新建项目',
  note: '新建文件',
  rename: '重命名',
  move: '移动到',
  remove: '移除内容',
  link: '添加到项目',
};

export function titleOf(key: string, client: QueryClient): string {
  const { workspace } = useWorkspaceStore.getState();
  const remote = parseRemoteNodeId(key);
  if (remote) return remote.path.slice(remote.path.lastIndexOf('/') + 1);
  return (
    workspace.entries.find((e) => e.id === key)?.name ??
    (key.startsWith('source:') ? sourceTitle(key.slice(7), client) : undefined) ??
    useNoteDrafts.getState().drafts[key]?.content.title ??
    (/[\\/]/.test(key)
      ? key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1) || key
      : '资料')
  );
}

export function EntryDialogs({
  request,
  onClose,
  onCreated,
  onRemoved,
  onOpenProject,
}: {
  request: EntryDialogRequest | null;
  onClose: () => void;
  onCreated?: (entry: WorkspaceEntry) => void;
  onRemoved?: (liveIds: Set<string>) => void;
  onOpenProject?: (id: string) => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const queryClient = useQueryClient();
  const nameOf = (next: EntryDialogRequest | null) =>
    next?.action === 'rename'
      ? (useWorkspaceStore.getState().workspace.entries.find((e) => e.id === next.id)?.name ?? '')
      : next?.action === 'note' && next.text !== undefined
        ? '新笔记.md'
        : '';
  const [shownRequest, setShownRequest] = useState(request);
  const [name, setName] = useState(() => nameOf(request));
  const [target, setTarget] = useState(request?.initialTarget ?? '');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const subjects = request?.ids ?? (request?.id ? [request.id] : []);

  if (request !== shownRequest) {
    setShownRequest(request);
    setName(nameOf(request));
    setTarget(request?.initialTarget ?? '');
    setModalError(null);
  }

  const projects = workspace.entries.filter((entry) => entry.kind === 'project' && !entry.remoteId);
  let targetProject = workspace.entries.find((entry) => entry.id === target);
  while (targetProject && targetProject.kind !== 'project')
    targetProject = workspace.entries.find((entry) => entry.id === targetProject!.parentId);
  const linkTarget =
    target === '__new__'
      ? target
      : (projects.find((entry) => entry.id === targetProject?.id)?.id ?? '');

  const pathName = (entry: WorkspaceEntry): string => {
    const names = [entry.name];
    let parent = workspace.entries.find((e) => e.id === entry.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = workspace.entries.find((e) => e.id === parent!.parentId);
    }
    return names.join(' / ');
  };

  const importFolder = async () => {
    if (!window.delionBot || busy) return;
    setBusy(true);
    setModalError(null);
    const importAndOpen = async () => {
      const created = await workspaceClient.importProjectFolder();
      if (!created) return;
      await useWorkspaceStore.getState().refresh();
      onClose();
      onOpenProject?.(created.id);
      onCreated?.(created);
    };
    try {
      await importAndOpen();
    } catch (error) {
      setModalError(errorMessage(error));
    }
    setBusy(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || !window.delionBot) return;
    if (request.action === 'promote' || request.action === 'import' || request.action === 'archive')
      return;
    setBusy(true);
    setModalError(null);
    const save = async () => {
      let created: WorkspaceEntry | undefined;
      if (request.action === 'rename') await updateEntry(request.id!, { name });
      else if (request.action === 'move')
        for (const id of subjects) await updateEntry(id, { parentId: target || null });
      else if (request.action === 'remove') {
        for (const id of subjects) await workspaceClient.remove(id);
        const remaining = (await workspaceClient.state()).entries;
        onRemoved?.(new Set(remaining.map((e) => e.id)));
      } else if (request.action === 'link') {
        const sourceId = request.id!.startsWith('source:')
          ? request.id!.slice(7)
          : workspace.entries.find((e) => e.id === request.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        if (!linkTarget) throw new Error('请选择项目');
        let parentId = linkTarget;
        if (linkTarget === '__new__')
          parentId = (await workspaceClient.create({ name, parentId: null, kind: 'project' })).id;
        created = await workspaceClient.create({
          name: titleOf(request.id!, queryClient),
          parentId,
          kind: 'source',
          sourceId,
        });
      } else if (
        request.action === 'folder' ||
        request.action === 'project' ||
        request.action === 'note'
      )
        created = await workspaceClient.create({
          name,
          parentId: request.id,
          kind: request.action === 'note' ? 'file' : request.action,
          text: request.text,
        });
      await useWorkspaceStore.getState().refresh();
      onClose();
      if (created) {
        if (created.kind === 'project') onOpenProject?.(created.id);
        onCreated?.(created);
      }
    };
    try {
      await save();
    } catch (error) {
      setModalError(errorMessage(error));
      if (subjects.length > 1) await useWorkspaceStore.getState().refresh();
    }
    setBusy(false);
  };

  const removalOf = (entry: WorkspaceEntry | undefined) =>
    entry?.kind === 'project'
      ? entry.remoteId
        ? '从 Delion Bot 移除项目并删除其全部聊天记录；远端目录与文件保留。'
        : '从 Delion Bot 移除项目并删除其全部聊天记录；目录与文件保留。'
      : entry?.kind === 'source'
        ? '解除此处的资料关联，原始资料保留。'
        : '将文件或文件夹移至系统回收站。';
  const removal =
    subjects.length > 1
      ? `移除选中的 ${subjects.length} 项。${[
          ...new Set(
            subjects.map((id) => removalOf(workspace.entries.find((entry) => entry.id === id))),
          ),
        ].join('')}`
      : removalOf(workspace.entries.find((entry) => entry.id === request?.id));

  return (
    <Dialog
      open={request !== null && !wizard}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{request ? (titles[request.action] ?? '') : ''}</DialogTitle>
        <DialogDescription>
          {request?.action === 'remove'
            ? removal
            : request?.action === 'link'
              ? '在项目根目录引用资料，原位置保持不变。'
              : request?.action === 'note'
                ? '文件名原样使用，笔记请以 .md 结尾；可用 / 写子路径，如 研究/会议记录.md。'
                : request?.action === 'project'
                  ? '新建空项目，或导入电脑上已有的文件夹。'
                  : '按自己的主题组织内容。'}
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
          {(request?.action === 'link' || request?.action === 'move') && (
            <div className="grid gap-2 text-ui-body">
              {request.action === 'link' ? '项目' : '位置'}
              <Select
                onValueChange={(value) => setTarget(value === ROOT_SELECT_VALUE ? '' : value)}
                value={request.action === 'link' ? linkTarget : target || ROOT_SELECT_VALUE}
              >
                <SelectTrigger
                  aria-label={request.action === 'link' ? '目标项目' : '目标文件夹'}
                  className="w-full"
                >
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {request.action === 'move' && (
                    <SelectItem value={ROOT_SELECT_VALUE}>我的内容</SelectItem>
                  )}
                  {(request.action === 'link'
                    ? projects
                    : workspace.entries.filter(
                        (e) =>
                          (e.kind === 'folder' || e.kind === 'project') && !subjects.includes(e.id),
                      )
                  ).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {request.action === 'link' ? e.name : pathName(e)}
                    </SelectItem>
                  ))}
                  {request.action === 'link' && <SelectItem value="__new__">新建项目…</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          {request &&
            !['move', 'remove'].includes(request.action) &&
            (request.action !== 'link' || target === '__new__') && (
              <Field label="名称">
                <Input
                  autoFocus
                  autoComplete="off"
                  aria-label="名称"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
          {request?.action === 'project' && (
            <div className="grid gap-2">
              <div aria-hidden="true" className="flex items-center gap-3 text-ui-subhead">
                <span className="h-px flex-1 bg-line" />
                <span className="text-ink-2">或</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button
                disabled={busy}
                onClick={() => void importFolder()}
                type="button"
                variant="secondary"
              >
                <FolderOpen />
                导入已有文件夹
              </Button>
              <Button
                disabled={busy}
                onClick={() => setWizard(true)}
                type="button"
                variant="secondary"
              >
                <Cloud />
                新建远程项目
              </Button>
            </div>
          )}
          {modalError && <ErrorText>{modalError}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || (request?.action === 'link' && !linkTarget)}
              variant={request?.action === 'remove' ? 'destructive' : undefined}
            >
              {busy ? '处理中…' : request?.action === 'remove' ? '移除' : '确定'}
            </Button>
          </div>
        </form>
      </DialogContent>
      <NewRemoteProjectDialog
        open={wizard}
        onClose={() => setWizard(false)}
        onImported={(entry) => {
          setWizard(false);
          onClose();
          onOpenProject?.(entry.id);
          onCreated?.(entry);
        }}
      />
    </Dialog>
  );
}
