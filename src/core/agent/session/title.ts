import { summarizeSessionTitle } from '../pi';
import { live, sessionBranch } from './live';
import { publish, splitMeta, textOf } from './projection';
import {
  completeTemporaryTitle,
  defaultModelChoice,
  modelChoice,
  preloadPi,
  recentTemporaryTitleSessions,
  row,
} from './store';

const generating = new Set<string>();

async function generateTitle(id: string, question?: string): Promise<boolean> {
  if (generating.has(id)) return false;
  const meta = row(id);
  if (!meta.title_temporary || meta.archived) return false;
  if (question === undefined) {
    const first = sessionBranch(id).branch.find(
      (entry) => entry.type === 'message' && entry.message.role === 'user',
    );
    if (first?.type !== 'message' || first.message.role !== 'user') return false;
    question = splitMeta(textOf(first.message.content)).text.trim();
  }
  if (!question) return false;
  const sessionChoice = modelChoice(meta);
  const choice = sessionChoice.kind === 'unavailable' ? defaultModelChoice() : sessionChoice;
  if (choice.kind !== 'ready') return false;

  generating.add(id);
  try {
    const title = await summarizeSessionTitle(
      { ...choice.selection, effort: choice.effortLevels[0] ?? null },
      question,
    );
    const saved = title && completeTemporaryTitle(id, title);
    if (saved && saved.title !== meta.title && !live.get(id)?.run) publish(id);
  } catch {
  } finally {
    generating.delete(id);
  }
  return true;
}

async function backfillTitles(excludeId: string) {
  const sessions = recentTemporaryTitleSessions(excludeId);
  if (!sessions.length) return;
  await preloadPi();
  let remaining = 3;
  for (const { id } of sessions) {
    if (await generateTitle(id).catch(() => false)) {
      remaining--;
      if (!remaining) break;
    }
  }
}

export function generateSessionTitles(id: string, question: string) {
  void generateTitle(id, question).catch(() => {});
  void backfillTitles(id).catch(() => {});
}
