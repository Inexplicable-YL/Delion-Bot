import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export const apps = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  googledrive: 'Google Drive',
  slack: 'Slack',
  notion: 'Notion',
  github: 'GitHub',
  outlook: 'Outlook',
};
export const toolkit = z.enum(Object.keys(apps) as [keyof typeof apps, ...(keyof typeof apps)[]]);
export const account = z.object({
  id: z.string(),
  alias: z.string().nullish(),
  toolkit: z.object({ slug: z.string() }),
  status: z.string(),
});
export const connectorsContract = defineContract('connectors', {
  configured: { input: z.undefined(), output: z.boolean() },
  setup: { input: z.string().trim().min(1).max(4096), output: z.void() },
  accounts: { input: z.undefined(), output: z.array(account) },
  connect: { input: toolkit, output: z.url({ protocol: /^https$/ }) },
  disconnect: { input: z.string().min(1), output: z.void() },
});
declare module '../../app/module' {
  interface NavTargets {
    connectors: Record<never, never>;
  }
}
