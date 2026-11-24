import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Shimmer } from '../Shimmer';
import { useNow } from '../use-now';
import { TraceDisclosure } from './Trace';

const sentencePattern = /[^\n。！？；!?;]+(?:[。！？；]+|[.!?;]+(?=\s)|(?=\n))/g;
const snippetMinLength = 8;
const snippetDwellMs = 2000;
const snippetTickMs = 500;

export function latestSentence(text: string, finished: boolean): string | undefined {
  const source = finished ? `${text}\n` : text;
  const sentences = source.match(sentencePattern) ?? [];
  return sentences
    .map((sentence) =>
      sentence
        .replace(/[*`]/g, '')
        .replace(/^\s*(?:#+|[-+>]|\d+\.)\s+/, '')
        .trim(),
    )
    .findLast((sentence) => sentence.replace(/[\p{P}\s]/gu, '').length >= snippetMinLength);
}

export function useReasoningSnippet(
  text: string | undefined,
  finished: boolean,
): string | undefined {
  const now = useNow(snippetTickMs, text !== undefined);
  const latest = text === undefined ? undefined : latestSentence(text, finished);
  const [shown, setShown] = useState({ at: now, sentence: latest });
  const due =
    now - shown.at >= snippetDwellMs || shown.sentence === undefined || latest === undefined;
  if (latest !== shown.sentence && due) setShown({ at: now, sentence: latest });
  return latest === undefined ? undefined : shown.sentence;
}

export function Reasoning({
  streaming,
  label,
  children,
}: {
  streaming: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="my-1">
      <TraceDisclosure
        defaultOpen={streaming}
        head={streaming ? <Shimmer>Thinking</Shimmer> : <span>{label}</span>}
      >
        <div
          data-reasoning-body
          className={cn(
            'overflow-y-auto text-ui-chat whitespace-pre-wrap text-ink-2',
            streaming ? 'flex max-h-40 flex-col-reverse' : 'max-h-72',
          )}
        >
          <div>{children}</div>
        </div>
      </TraceDisclosure>
    </div>
  );
}
