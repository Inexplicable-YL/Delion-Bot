import type { ConnectorApp } from '../../connectors/view';

const connectorInstruction = '处理此请求。请先查找该工具集的可用工具，再调用适合的操作。';

export function connectorPrompt({ name, slug }: ConnectorApp): string {
  return `请通过已连接的 ${name} 连接器（Composio 工具集 ${slug}）${connectorInstruction}`;
}

export function* matchConnectorPrompts(text: string, apps: readonly ConnectorApp[]) {
  if (!apps.length) return;
  const marker = /请通过已连接的 [^\r\n]+? 连接器（Composio 工具集 ([a-z0-9_]+)）/g;
  for (const match of text.matchAll(marker)) {
    const from = match.index;
    const instructionAt = from + match[0].length;
    const app = apps.find(({ slug }) => slug === match[1]);
    if (app && text.startsWith(connectorInstruction, instructionAt)) {
      yield { from, to: instructionAt + connectorInstruction.length, app };
    }
  }
}
