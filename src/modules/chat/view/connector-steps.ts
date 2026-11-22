import type { ConnectorApp } from '../../connectors/view';

export const composioToolPrefix = 'mcp_Composio_';

export type ConnectorStep = {
  doing: string;
  done: string;
  target: string;
  apps: ConnectorApp[];
};

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value !== '');
}

export function connectorAppOf(slug: string, catalog: readonly ConnectorApp[]) {
  const lower = slug.toLowerCase();
  return catalog
    .filter((app) => lower === app.slug || lower.startsWith(`${app.slug}_`))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
}

function appsOf(slugs: string[], catalog: readonly ConnectorApp[]) {
  return [
    ...new Set(
      slugs.map((slug) => connectorAppOf(slug, catalog)).filter((app) => app !== undefined),
    ),
  ];
}

function readable(slug: string) {
  return slug.toLowerCase().replaceAll('_', ' ').trim();
}

function actionOf(slug: string, catalog: readonly ConnectorApp[]) {
  const app = connectorAppOf(slug, catalog);
  return readable(app ? slug.slice(app.slug.length + 1) : slug);
}

export function connectorStep(
  name: string,
  input: unknown,
  catalog: readonly ConnectorApp[],
): ConnectorStep {
  const tool = name.slice(composioToolPrefix.length);
  switch (tool) {
    case 'COMPOSIO_SEARCH_TOOLS': {
      const useCases = strings([
        ...list(field(input, 'queries')).map((query) => field(query, 'use_case')),
        field(input, 'use_case'),
      ]);
      return {
        doing: '正在查找连接器工具',
        done: '查找连接器工具',
        target: useCases.join('；'),
        apps: [],
      };
    }
    case 'COMPOSIO_MULTI_EXECUTE_TOOL': {
      const slugs = strings(list(field(input, 'tools')).map((item) => field(item, 'tool_slug')));
      const apps = appsOf(slugs, catalog);
      const names = apps.length ? ` ${apps.map((app) => app.name).join('、')}` : '连接器';
      return {
        doing: `正在使用${names}`,
        done: `使用${names}`,
        target: slugs.map((slug) => actionOf(slug, catalog)).join('、'),
        apps,
      };
    }
    case 'COMPOSIO_MANAGE_CONNECTIONS': {
      const apps = appsOf(strings(list(field(input, 'toolkits'))), catalog);
      return {
        doing: '正在管理连接',
        done: '管理连接',
        target: apps.map((app) => app.name).join('、'),
        apps,
      };
    }
    case 'COMPOSIO_GET_TOOL_SCHEMAS': {
      const slugs = strings(list(field(input, 'tool_slugs')));
      return {
        doing: '正在读取工具说明',
        done: '读取工具说明',
        target: slugs.map((slug) => actionOf(slug, catalog)).join('、'),
        apps: appsOf(slugs, catalog),
      };
    }
    default:
      return { doing: '正在使用连接器', done: '使用连接器', target: readable(tool), apps: [] };
  }
}
