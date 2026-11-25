import { z } from 'zod';

export type AskOption = { label: string; description?: string };
export type AskGroup = { question: string; options: AskOption[]; multiple?: boolean };

export const ASK_CARD_LANGUAGE = 'ask';

const optionMarker =
  /^(?:(?:[-*+•]|\d{1,2}[.)]|[A-Za-z][.)])\s+|(?:\d{1,2}|[A-Za-z])、\s*)(?:\[[ xX]\]\s*)?(.*)$/;
const questionPrefix = /^(?:#{1,6}\s+|(?:问题|question|q)\s*\d*\s*[:：]\s*)/i;
const descriptionSeparator = /\s*[|｜]\s*|\s+[—–]\s+/;
const multipleMarker = /\s*\[(?:multi|多选)\]$/i;
const freeformOption = /^(?:其他|其它|other)(?:\s*[（(：:].*)?$/i;
const answerSeparator = '：';
const choiceSeparator = '、';

const jsonGroup = z.object({
  question: z.string(),
  multiple: z.boolean().optional(),
  options: z.array(
    z.union([z.string(), z.object({ label: z.string(), description: z.string().optional() })]),
  ),
});
const jsonCard = z.union([
  jsonGroup.transform((group) => [group]),
  z.array(jsonGroup),
  z.object({ questions: z.array(jsonGroup) }).transform(({ questions }) => questions),
]);

function plain(text: string): string {
  return text
    .trim()
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^`(.*)`$/, '$1')
    .trim();
}

function option(text: string): AskOption {
  const [label = '', ...rest] = text.split(descriptionSeparator);
  const description = plain(rest.join(' '));
  return description ? { label: plain(label), description } : { label: plain(label) };
}

function parseJson(source: string): AskGroup[] | null {
  try {
    const parsed = jsonCard.safeParse(JSON.parse(source));
    if (!parsed.success) return null;
    return parsed.data.map(({ question, multiple, options }) => ({
      question,
      options: options.map((item) => (typeof item === 'string' ? { label: item } : item)),
      ...(multiple && { multiple }),
    }));
  } catch {
    return null;
  }
}

function parseLines(source: string): AskGroup[] {
  const groups: AskGroup[] = [];
  let gap = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      gap = true;
      continue;
    }
    const current = groups.at(-1);
    const marked = optionMarker.exec(line);
    if (marked?.[1]) {
      if (!current) groups.push({ question: '', options: [option(marked[1])] });
      else
        groups[groups.length - 1] = {
          ...current,
          options: [...current.options, option(marked[1])],
        };
    } else if (current?.options.length && !gap && /^\s/.test(raw)) {
      const last = current.options.at(-1)!;
      const description = [last.description, plain(line)].filter(Boolean).join(' ');
      groups[groups.length - 1] = {
        ...current,
        options: [...current.options.slice(0, -1), { ...last, description }],
      };
    } else {
      const question = plain(plain(line).replace(questionPrefix, ''));
      if (current && !current.options.length)
        groups[groups.length - 1] = { ...current, question: `${current.question}\n${question}` };
      else groups.push({ question, options: [] });
    }
    gap = false;
  }
  return groups;
}

function cleanGroup({ question, options, multiple }: AskGroup): AskGroup | null {
  const seen = new Set<string>();
  const kept = options.filter(({ label }) => {
    if (!label || freeformOption.test(label) || seen.has(label)) return false;
    seen.add(label);
    return true;
  });
  const trimmed = question.trim();
  const text = trimmed.replace(multipleMarker, '');
  if (!text || !kept.length) return null;
  return multiple || text !== trimmed
    ? { question: text, options: kept, multiple: true }
    : { question: text, options: kept };
}

export function parseAskCard(source: string): AskGroup[] | null {
  const trimmed = source.trim();
  const groups = (/^[[{]/.test(trimmed) && parseJson(trimmed)) || parseLines(trimmed);
  const valid = groups.flatMap((group) => cleanGroup(group) ?? []);
  return valid.length ? valid : null;
}

const questionLine = (question: string) => question.replace(/\s+/g, ' ').replace(/[:：]$/, '');

const skippedAnswer = '（跳过）';
const answerPrefix = (group: AskGroup) => `${questionLine(group.question)}${answerSeparator}`;

export function formatAskAnswer(groups: AskGroup[], answers: string[][]): string {
  return groups
    .map((group, index) => {
      const picked = answers[index] ?? [];
      return `${answerPrefix(group)}${picked.length ? picked.join(choiceSeparator) : skippedAnswer}`;
    })
    .join('\n');
}

function pickedLabels(group: AskGroup, answer: string): string[] {
  if (!group.multiple) return [answer];
  const wrapped = (text: string) => `${choiceSeparator}${text}${choiceSeparator}`;
  const labels = group.options
    .map(({ label }) => label)
    .filter((label) => wrapped(answer).includes(wrapped(label)));
  const custom = labels
    .reduce((rest, label) => rest.replace(wrapped(label), choiceSeparator), wrapped(answer))
    .split(choiceSeparator)
    .filter(Boolean)
    .join(choiceSeparator);
  return custom ? [...labels, custom] : labels;
}

export function parseAskAnswer(groups: AskGroup[], text: string): string[][] {
  const lines = text.split(/\r?\n/);
  return groups.map((group) => {
    const prefix = answerPrefix(group);
    const answer = lines
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length)
      .trim();
    return answer && answer !== skippedAnswer ? pickedLabels(group, answer) : [];
  });
}
