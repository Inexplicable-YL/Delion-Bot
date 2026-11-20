import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type MailPreferences = { foldersCollapsed: boolean };

export const useMailPreferences = create<MailPreferences>()(
  persist((): MailPreferences => ({ foldersCollapsed: true }), {
    name: 'delion.mail.preferences',
    version: 1,
  }),
);
