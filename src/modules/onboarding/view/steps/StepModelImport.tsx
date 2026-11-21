import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Card } from '../../../../ui/Card';
import { Checkbox } from '../../../../ui/Checkbox';
import { Input } from '../../../../ui/Input';
import { LLM_MODEL_LIMIT } from '../../../../core/protocol/llm-models';
import { capModels, selectedModels } from './model-import';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../../ui/Dialog';

export function StepModelImportDialog({
  open,
  onOpenChange,
  options,
  preselected,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: string[];
  preselected: string[];
  onConfirm: (picked: string[]) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-dialog">
        <DialogTitle>导入模型</DialogTitle>
        <DialogDescription>勾选要加入配置的模型，最多保留 {LLM_MODEL_LIMIT} 个。</DialogDescription>
        <Picker
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
          options={options}
          preselected={preselected}
        />
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  options,
  preselected,
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  options: string[];
  preselected: string[];
  onConfirm: (picked: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState(() => new Set(preselected));
  const picked = selectedModels(options, checked);
  const dropped = picked.length - capModels(picked).models.length;
  const keyword = query.trim().toLowerCase();
  const visible = options.filter((id) => id.toLowerCase().includes(keyword));

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-4 grid gap-3">
      <Input
        aria-label="搜索模型 ID"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`搜索 ${options.length} 个模型…`}
        value={query}
      />
      <Card className="max-h-64 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-ui-subhead text-ink-2">没有匹配的模型</p>
        ) : (
          visible.map((id) => (
            <label
              className="flex min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-hover"
              key={id}
            >
              <Checkbox checked={checked.has(id)} onChange={() => toggle(id)} />
              <span className="min-w-0 flex-1 truncate font-mono text-ui-subhead" title={id}>
                {id}
              </span>
            </label>
          ))
        )}
      </Card>
      <p className="text-ui-subhead text-ink-2" role="status">
        已选 {picked.length} 个{dropped > 0 ? `，超出的 ${dropped} 个不会被导入` : ''}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" variant="secondary">
          取消
        </Button>
        <Button disabled={picked.length === 0} onClick={() => onConfirm(picked)} size="sm">
          导入所选 {picked.length} 个
        </Button>
      </div>
    </div>
  );
}
