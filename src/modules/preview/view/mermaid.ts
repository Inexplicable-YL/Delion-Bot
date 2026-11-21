import type { MermaidConfig } from '@streamdown/mermaid';

function interfaceFontFamily(): string {
  return getComputedStyle(document.documentElement).fontFamily;
}

let cached: { dark: boolean; config: MermaidConfig } | null = null;

export function mermaidConfig(): MermaidConfig {
  const dark = document.documentElement.classList.contains('dark');
  if (!cached || cached.dark !== dark)
    cached = {
      dark,
      config: { theme: dark ? 'dark' : 'default', fontFamily: interfaceFontFamily() },
    };
  return cached.config;
}

export async function renderMermaid(id: string, chart: string, config?: MermaidConfig) {
  const { mermaid } = await import('@streamdown/mermaid');
  return mermaid.getMermaid(config ?? mermaidConfig()).render(id, chart);
}
