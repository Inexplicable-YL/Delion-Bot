import { agentClient } from './client';

const previews = new Map<string, string>();

export function setChatMediaPreview(id: string, url: string | null): void {
  if (url) previews.set(id, url);
}

export function releaseChatMedia(ids: string[]): void {
  if (ids.length) void agentClient['release-media']({ ids }).catch(() => {});
}

export function getChatMediaPreview(id: string): string | undefined {
  return previews.get(id);
}

export async function fetchChatMediaPreview(id: string): Promise<string | null> {
  const url = await agentClient['read-media-preview']({ id });
  setChatMediaPreview(id, url);
  return url;
}
