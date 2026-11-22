import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

function initialFontSize(): number {
  const stored = Number(localStorage.getItem(fontSizeStorageKey));
  if (Number.isFinite(stored) && stored > 0) return clampFontSize(stored);
  return fontSizeDefault;
}

export function connectAppearance(client: QueryClient) {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const apply = () => {
    const theme = client.getQueryData<ThemePreference>(['settings', 'theme']) ?? initialTheme();
    const fontSize = client.getQueryData<number>(['settings', 'fontSize']) ?? initialFontSize();
    applyResolvedTheme(theme, systemTheme.matches);
    root.style.fontSize = `${fontSize}px`;
    localStorage.setItem(fontSizeStorageKey, String(fontSize));
    if (!window.delionBot) {
      localStorage.setItem(themeStorageKey, theme);
      root.style.zoom = String(client.getQueryData<ZoomPreference>(['settings', 'zoom']) ?? 1);
    }
  };
  apply();
  systemTheme.addEventListener('change', apply);
  client.getQueryCache().subscribe(({ type, query }) => {
    const [namespace, setting] = query.queryKey;
    if (
      type === 'updated' &&
      namespace === 'settings' &&
      (setting === 'theme' || setting === 'fontSize' || setting === 'zoom')
    )
      apply();
  });
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
