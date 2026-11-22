import { createContext, useContext } from 'react';

export type ReplyImageContextValue = {
  sessionId: string;
  cwd: string | null;
  ask?: (text: string, context: string[]) => Promise<void>;
};

export const ReplyImageContext = createContext<ReplyImageContextValue | null>(null);

export function useReplyImageContext(): ReplyImageContextValue | null {
  return useContext(ReplyImageContext);
}
