import { useState, useSyncExternalStore, type SetStateAction } from 'react';
import { createStore } from 'zustand/vanilla';
import type { ChatMediaView } from '../../../core/protocol/agent';
import { releaseChatMedia } from './media';

export function useChatAttachments() {
  const [store] = useState(() => {
    const attachments = createStore<ChatMediaView[]>(() => []);
    return {
      subscribe: attachments.subscribe,
      snapshot: attachments.getState,
      update: (next: SetStateAction<ChatMediaView[]>) => attachments.setState(next, true),
      hasAttachments: () => attachments.getState().length > 0,
      release: () => releaseChatMedia(attachments.getState().map((item) => item.id)),
    };
  });
  const attachments = useSyncExternalStore(store.subscribe, store.snapshot);
  return {
    attachments,
    update: store.update,
    hasAttachments: store.hasAttachments,
    release: store.release,
  };
}
