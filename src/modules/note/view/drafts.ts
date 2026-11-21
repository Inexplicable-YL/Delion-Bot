import { create } from 'zustand';
import { parseRemoteNodeId, relocateWorkspacePath } from '../../workspace/contract';
import { workspaceClient } from '../../workspace/view';
import type { NoteDraft } from './DraftSource';
import { errorMessage } from '../../../core/protocol/contract';

type Store = {
  drafts: Record<string, NoteDraft>;
  acquire: (key: string, force?: boolean) => Promise<void>;
  release: (key: string) => Promise<boolean>;
  edit: (key: string, text: string) => void;
  save: (key: string) => Promise<boolean>;
  relocatePaths: (from: string, to: string) => void;
  loading: Record<string, Promise<void>>;
  saving: Record<string, Promise<boolean>>;
  scheduledSaves: Record<string, ReturnType<typeof setTimeout>>;
  refcounts: Record<string, number>;
};

type HandleTable = 'loading' | 'saving' | 'scheduledSaves' | 'refcounts';

export const useNoteDrafts = create<Store>((set, get) => {
  const setHandle = <Table extends HandleTable>(
    table: Table,
    key: string,
    value: Store[Table][string] | undefined,
  ) =>
    set((state) => {
      const rest = Object.fromEntries(
        Object.entries(state[table]).filter(([name]) => name !== key),
      );
      return { [table]: value === undefined ? rest : { ...rest, [key]: value } } as Partial<Store>;
    });

  return {
    drafts: {},
    loading: {},
    saving: {},
    scheduledSaves: {},
    refcounts: {},
    relocatePaths: (from, to) => {
      const drafts: Record<string, NoteDraft> = {};
      for (const [key, draft] of Object.entries(get().drafts)) {
        const next = relocateWorkspacePath(key, from, to);
        drafts[next] =
          next === key
            ? draft
            : {
                ...draft,
                content: {
                  ...draft.content,
                  title: next.split(next.startsWith('/') ? '/' : /[\\/]/).at(-1)!,
                },
              };
      }
      set({ drafts });
    },
    acquire: async (key, force = false) => {
      if (!force) setHandle('refcounts', key, (get().refcounts[key] ?? 0) + 1);
      if (!window.delionBot || (!force && get().drafts[key])) return;
      if (force && get().drafts[key]?.saving) {
        const pending = get().saving[key];
        if (!pending || !(await pending)) return;
      }
      const pending = get().loading[key];
      if (pending) return pending;
      const started = get().drafts[key];
      const work = (async () => {
        const sourceId = key.startsWith('source:') ? key.slice(7) : null;
        const remote = parseRemoteNodeId(key);
        const content = remote
          ? await workspaceClient.readRemoteDocument(remote)
          : sourceId
            ? await workspaceClient.readSource(sourceId)
            : await workspaceClient.read(key);
        const current = get().drafts[key];
        if (
          started &&
          current &&
          (current.text !== started.text ||
            current.content.revision !== started.content.revision ||
            current.saving)
        )
          return;
        set((s) => ({
          drafts: {
            ...s.drafts,
            [key]: {
              content,
              text: content.text ?? '',
              saved: content.text ?? '',
              saving: false,
              error: null,
            },
          },
        }));
      })().finally(() => setHandle('loading', key, undefined));
      setHandle('loading', key, work);
      return work;
    },
    release: async (key) => {
      const refs = get().refcounts[key] ?? 0;
      if (refs > 1) {
        setHandle('refcounts', key, refs - 1);
        return true;
      }
      setHandle('refcounts', key, undefined);
      const timer = get().scheduledSaves[key];
      if (timer) {
        clearTimeout(timer);
        setHandle('scheduledSaves', key, undefined);
      }
      const draft = get().drafts[key];
      if (!draft) return true;
      if (draft.saving || draft.text !== draft.saved) {
        if (!(await get().save(key))) return false;
      }
      const current = get().drafts[key];
      if (!current || current.saving || current.text !== current.saved) return false;
      if (key in get().refcounts) return true;
      set((state) => {
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { drafts };
      });
      return true;
    },
    edit: (key, text) => {
      if (!get().drafts[key]) return;
      set((s) => ({ drafts: { ...s.drafts, [key]: { ...s.drafts[key]!, text, error: null } } }));
      clearTimeout(get().scheduledSaves[key]);
      setHandle(
        'scheduledSaves',
        key,
        setTimeout(() => {
          setHandle('scheduledSaves', key, undefined);
          void get().save(key);
        }, 600),
      );
    },
    save: (key) => {
      const existing = get().saving[key];
      if (existing) return existing;
      const timer = get().scheduledSaves[key];
      if (timer) {
        clearTimeout(timer);
        setHandle('scheduledSaves', key, undefined);
      }
      const task = (async (): Promise<boolean> => {
        while (true) {
          const draft = get().drafts[key];
          if (!draft) return true;
          if (draft.text === draft.saved) return true;
          if (!window.delionBot) return false;
          if (!draft.content.revision) {
            const message = '此文档没有可用的保存版本。';
            set((s) => ({
              drafts: s.drafts[key]
                ? { ...s.drafts, [key]: { ...s.drafts[key]!, saving: false, error: message } }
                : s.drafts,
            }));
            return false;
          }
          const text = draft.text;
          set((s) => ({
            drafts: s.drafts[key]
              ? { ...s.drafts, [key]: { ...s.drafts[key]!, saving: true } }
              : s.drafts,
          }));
          try {
            const revision = await workspaceClient.saveNote({
              id: key,
              text,
              revision: draft.content.revision,
            });
            set((s) => {
              const current = s.drafts[key];
              if (!current) return s;
              return {
                drafts: {
                  ...s.drafts,
                  [key]: {
                    ...current,
                    saved: text,
                    content: { ...current.content, revision },
                    saving: false,
                    error: null,
                  },
                },
              };
            });
          } catch (error) {
            set((s) => ({
              drafts: s.drafts[key]
                ? {
                    ...s.drafts,
                    [key]: { ...s.drafts[key]!, saving: false, error: errorMessage(error) },
                  }
                : s.drafts,
            }));
            return false;
          }
        }
      })();
      setHandle('saving', key, task);
      const settle = () => {
        if (get().saving[key] === task) setHandle('saving', key, undefined);
      };
      void task.then(settle, settle);
      return task;
    },
  };
});
