import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fontSizeDefault,
  fontSizeMax,
  fontSizeMin,
  type ThemePreference,
  type ZoomPreference,
} from '../../../modules/settings/contract';
import { settingsClient } from '../../../modules/settings/view';

const themeStorageKey = 'delion.theme';
const fontSizeStorageKey = 'delion.font-size';
function clampFontSize(value: number): number {
  return Math.min(fontSizeMax, Math.max(fontSizeMin, Math.round(value)));
}

function initialTheme(): ThemePreference {
  if (window.delionBot) return 'system';
  const theme = localStorage.getItem(themeStorageKey);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function applyResolvedTheme(theme: ThemePreference, systemDark: boolean) {
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
}

export function initializeTheme() {
  applyResolvedTheme(initialTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function initialFontSize(): number {
  const stored = Number(localStorage.getItem(fontSizeStorageKey));
  if (Number.isFinite(stored) && stored > 0) return clampFontSize(stored);
  return fontSizeDefault;
}

export function useAppearance() {
  const queryClient = useQueryClient();
  const enabled = Boolean(window.delionBot);
  const theme =
    useQuery({ queryKey: ['settings', 'theme'], queryFn: () => settingsClient.theme(), enabled })
      .data ?? initialTheme();
  const zoom =
    useQuery({ queryKey: ['settings', 'zoom'], queryFn: () => settingsClient.zoom(), enabled })
      .data ?? 1;
  const fontSize =
    useQuery({
      queryKey: ['settings', 'fontSize'],
      queryFn: () => settingsClient.fontSize(),
      enabled,
    }).data ?? initialFontSize();

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyResolvedTheme(theme, media.matches);
    apply();
    if (!enabled) localStorage.setItem(themeStorageKey, theme);
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, enabled]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem(fontSizeStorageKey, String(fontSize));
    if (!window.delionBot) document.documentElement.style.zoom = String(zoom);
  }, [fontSize, zoom]);

  const changeTheme = async (next: ThemePreference) => {
    queryClient.setQueryData(
      ['settings', 'theme'],
      window.delionBot ? await settingsClient.setTheme(next) : next,
    );
  };

  const changeZoom = async (next: ZoomPreference) => {
    queryClient.setQueryData(
      ['settings', 'zoom'],
      window.delionBot ? await settingsClient.setZoom(next) : next,
    );
  };

  const changeFontSize = async (next: number) => {
    queryClient.setQueryData(
      ['settings', 'fontSize'],
      window.delionBot ? await settingsClient.setFontSize(next) : clampFontSize(next),
    );
  };

  return { theme, zoom, fontSize, changeTheme, changeZoom, changeFontSize };
}
