import type { FileChangeSummary } from './agent';

export interface UncommittedChanges {
  available: boolean;
  reason: 'not-git' | 'git-unavailable' | 'remote' | null;
  cwd: string;
  repositoryRoot: string | null;
  head: string | null;
  warnings: string[];
  files: FileChangeSummary[];
}
