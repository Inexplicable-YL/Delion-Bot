import { existsSync } from 'node:fs';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentToolResult, ChatAskInput, WorkspaceChat } from '../../protocol/agent';
import type { TaskNotice } from '../tasks';
import { requirePiSync, row } from './store';

export interface Live {
  session: AgentSession;
  cwd: string;
  providerId: string;
  run?: Run;
  unsubscribe: () => void;
  stale?: boolean;
  compactedTokens?: number;
  extraCompacting?: boolean;
  captureDisabled?: boolean;
}

export interface Run {
  id: string;
  tool?: string;
  cancelled?: boolean;
  finishing?: boolean;
  steers: { prompt: string; input: ChatAskInput }[];
  notices: TaskNotice[];
  captured?: Promise<void>;
  done: Promise<void>;
}

export const live = new Map<string, Live>();

export const liveSteps = new Map<string, Map<string, AgentToolResult>>();

export type ThinkingTime = { startedAt: number; finishedAt?: number };

export const liveThinking = new Map<string, Map<string, ThinkingTime>>();

type ChatMessage = WorkspaceChat['messages'][number];

export const liveProjection = new Map<
  string,
  { source: AgentMessage[]; messages: ChatMessage[] }
>();

export const publishedRevisions = new Map<string, number>();

export const publishedMessages = new Map<string, ChatMessage[]>();

export const sessionRunning = (id: string) => Boolean(live.get(id)?.run);

export function sessionBranch(id: string): { branch: SessionEntry[]; runningTurn?: string } {
  const entry = live.get(id);
  if (entry)
    return { branch: entry.session.sessionManager.getBranch(), runningTurn: entry.run?.id };
  const { file } = row(id);
  if (!file || !existsSync(file)) return { branch: [] };
  return { branch: requirePiSync().SessionManager.open(file).getBranch() };
}
