'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { Card } from '../Card';
import { cn } from '../cn';

export type AskCardOption = { label: string; description?: string };
export type AskCardGroup = { question: string; options: AskCardOption[]; multiple?: boolean };

type Choice = (number | 'other')[];

const letter = (index: number) => String.fromCharCode(65 + index);

const rowClass = cn(
  'flex w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 py-1 text-left transition-colors duration-base',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
);

function OptionLetter({ index, checked }: { index: number; checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-chip text-ui-subhead tabular-nums transition-colors duration-base',
        checked ? 'bg-accent-fill text-on-accent' : 'bg-inset text-ink-2 shadow-hairline',
      )}
    >
      {letter(index)}
    </span>
  );
}

function OptionRow({
  autoFocus,
  index,
  option,
  checked,
  multiple,
  disabled,
  onSelect,
}: {
  autoFocus: boolean;
  index: number;
  option: AskCardOption;
  checked: boolean;
  multiple: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      autoFocus={autoFocus}
      className={cn(
        rowClass,
        option.description && 'items-start',
        'enabled:hover:bg-hover enabled:aria-checked:bg-selected disabled:cursor-default',
      )}
      disabled={disabled}
      onClick={onSelect}
      role={multiple ? 'checkbox' : 'radio'}
      type="button"
    >
      <OptionLetter checked={checked} index={index} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui-body text-ink">{option.label}</span>
        {option.description && (
          <span className="text-ui-callout text-ink-2">{option.description}</span>
        )}
      </span>
    </button>
  );
}

function OtherRow({
  index,
  checked,
  disabled,
  value,
  onChange,
}: {
  index: number;
  checked: boolean;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <div
      aria-checked={checked}
      className={cn(
        rowClass,
        'items-start',
        !disabled && 'cursor-text hover:bg-hover aria-checked:bg-selected',
      )}
      onClick={() => input.current?.focus()}
    >
      <OptionLetter checked={checked} index={index} />
      {disabled ? (
        <span
          className={cn(
            'min-w-0 flex-1 py-0.5 break-words text-ui-body',
            value ? 'text-ink' : 'text-ink-2',
          )}
        >
          {value || '其他'}
        </span>
      ) : (
        <textarea
          aria-label="其他回答"
          className="min-w-0 flex-1 resize-none bg-transparent py-0.5 text-ui-body text-ink outline-none [field-sizing:content] placeholder:text-ink-2"
          onChange={(event) => onChange(event.target.value.replace(/\n/g, ' '))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
          }}
          placeholder="其他"
          ref={input}
          rows={1}
          value={value}
        />
      )}
    </div>
  );
}

function StepDots({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">
        第 {current + 1} 题，共 {count} 题
      </span>
      {Array.from({ length: count }, (_, index) => (
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-pill transition-colors duration-base',
            index === current ? 'bg-ink-2' : 'bg-fill',
          )}
          key={index}
        />
      ))}
    </div>
  );
}

function replaced<T>(list: T[], length: number, index: number, value: T): T[] {
  return Array.from({ length }, (_, at) => (at === index ? value : (list[at] as T)));
}

export function AskCard({
  groups,
  onSubmit,
}: {
  groups: AskCardGroup[];
  onSubmit: (answers: string[][]) => Promise<void>;
}) {
  const id = useId();
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [customs, setCustoms] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<boolean[]>([]);
  const [sending, setSending] = useState(false);
  const current = Math.min(page, groups.length - 1);
  const group = groups[current]!;
  const last = current === groups.length - 1;
  const multiple = group.multiple === true;
  const choice = choices[current] ?? [];
  const custom = customs[current] ?? '';
  const pickedAt = (index: number) => {
    const picked = choices[index] ?? [];
    if (skipped[index]) return [];
    const labels = groups[index]!.options.flatMap(({ label }, at) =>
      picked.includes(at) ? [label] : [],
    );
    const other = picked.includes('other') ? customs[index]?.trim() : undefined;
    return other ? [...labels, other] : labels;
  };
  const choose = (next: number | 'other', on: boolean) => {
    const rest = choice.filter((item) => item !== next);
    const nextChoice = !on ? rest : multiple ? [...rest, next] : [next];
    setChoices(replaced(choices, groups.length, current, nextChoice));
    setSkipped(replaced(skipped, groups.length, current, false));
  };
  const submit = (finalSkipped: boolean[]) => {
    if (sending) return;
    setSending(true);
    const result = groups.map((_, index) => (finalSkipped[index] ? [] : pickedAt(index)));
    void onSubmit(result).finally(() => setSending(false));
  };
  const advance = (skip: boolean) => {
    const nextSkipped = replaced(skipped, groups.length, current, skip);
    setSkipped(nextSkipped);
    if (last) submit(nextSkipped);
    else setPage(current + 1);
  };
  const questionId = `${id}-question`;

  return (
    <Card asChild variant="surface">
      <section
        aria-label="询问"
        className="grid gap-3"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          submit(groups.map(() => true));
        }}
      >
        <div className="grid gap-1">
          <div className="whitespace-pre-wrap text-ui-headline text-ink" id={questionId}>
            {group.question}
          </div>
          {multiple && <div className="text-ui-subhead text-ink-2">选择所有符合的选项</div>}
        </div>
        <div
          aria-labelledby={questionId}
          className="-mx-2.5 grid gap-0.5"
          key={current}
          role={multiple ? 'group' : 'radiogroup'}
        >
          {group.options.map((option, index) => (
            <OptionRow
              autoFocus={current === 0 && index === 0}
              checked={choice.includes(index)}
              disabled={sending}
              index={index}
              key={option.label}
              multiple={multiple}
              onSelect={() => choose(index, !multiple || !choice.includes(index))}
              option={option}
            />
          ))}
          <OtherRow
            checked={choice.includes('other')}
            disabled={sending}
            index={group.options.length}
            onChange={(value) => {
              setCustoms(replaced(customs, groups.length, current, value));
              choose('other', value.trim() !== '');
            }}
            value={custom}
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          {groups.length > 1 && <StepDots count={groups.length} current={current} />}
          <span className="text-ui-caption text-ink-2">Esc 全部跳过</span>
          <div className="ml-auto flex items-center gap-2">
            {current > 0 && (
              <Button disabled={sending} onClick={() => setPage(current - 1)} variant="secondary">
                返回
              </Button>
            )}
            <Button disabled={sending} onClick={() => advance(true)} variant="secondary">
              跳过
            </Button>
            <Button disabled={sending || !pickedAt(current).length} onClick={() => advance(false)}>
              {last ? '发送' : '下一步'}
            </Button>
          </div>
        </div>
      </section>
    </Card>
  );
}
