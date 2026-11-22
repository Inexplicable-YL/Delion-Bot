import { z } from 'zod';
import type { AgentToolResult } from '../../../core/protocol/agent';
import type { ConnectorApp } from '../../connectors/view';
import { composioToolPrefix, connectorAppOf } from './connector-steps';

export type ReplySource = { title: string; domain: string; url?: string; logo?: string };

const record = z.record(z.string(), z.unknown());
const nonempty = z.string().trim().min(1);
const link = z.object({ title: z.string().nullish(), url: z.string() });
const webSearch = z.object({ provider: z.string(), results: z.array(link) });
const webPage = z.object({ title: z.string().nullish(), source: z.object({ url: z.string() }) });
const mcpDetails = z.object({
  source: z.object({ name: z.string(), domain: z.string().optional() }),
  links: z.array(link).optional(),
});
const composioResults = z.object({
  data: z.object({
    results: z.array(z.object({ tool_slug: z.string(), response: z.unknown().optional() })),
  }),
});
const gmailHeaders = z.array(z.object({ name: z.string(), value: z.string() }));
const multiExecute = `${composioToolPrefix}COMPOSIO_MULTI_EXECUTE_TOOL`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function linkSource(rawUrl: string, title?: string | null, logo?: string): ReplySource[] {
  const url = URL.parse(rawUrl);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    return [];
  return [{ title: title?.trim() || url.hostname, domain: url.hostname, url: url.href, logo }];
}

function resultSources(payload: unknown, app?: ConnectorApp, gmail = false): ReplySource[] {
  const sources: ReplySource[] = [];
  const pending = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) pending.push(value[index]);
      continue;
    }
    const item = record.safeParse(value).data;
    if (!item || item.successful === false || item.isError === true) continue;
    const title = nonempty.safeParse(item.title ?? item.subject ?? item.name).data;
    const url = nonempty.safeParse(item.webViewLink ?? item.html_url ?? item.url ?? item.link).data;
    const links = title && url ? linkSource(url, title, app?.logo) : [];
    sources.push(...links);
    if (links.length) continue;
    if (gmail) {
      const id = nonempty.safeParse(item.messageId ?? item.id ?? item.threadId).data;
      const message = record.safeParse(item.payload).data;
      const headers = gmailHeaders.safeParse(message?.headers ?? item.headers).data;
      const subject = title || headers?.find(({ name }) => name.toLowerCase() === 'subject')?.value;
      if (id && subject) {
        sources.push(
          ...linkSource(
            `https://mail.google.com/mail/#all/${encodeURIComponent(id)}`,
            subject,
            app?.logo,
          ),
        );
        continue;
      }
    }
    for (const child of Object.values(item).reverse()) pending.push(child);
  }
  return sources;
}

export function replySources(
  steps: readonly AgentToolResult[],
  catalog: readonly ConnectorApp[],
): ReplySource[] {
  const sources = new Map<string, ReplySource>();
  const add = (items: ReplySource[]) => {
    for (const item of items) {
      const key = item.url ?? `${item.domain}:${item.title}`;
      const existing = sources.get(key);
      sources.set(
        key,
        existing
          ? {
              ...existing,
              title: existing.title !== existing.domain ? existing.title : item.title,
              logo: existing.logo ?? item.logo,
            }
          : item,
      );
    }
  };
  let composioFallback: ReplySource | undefined;
  let usedConnector = false;
  for (const { name, output } of steps) {
    if (!output || output.isError) continue;
    if (name === 'web_search') {
      const search = webSearch.safeParse(parseJson(output.text)).data;
      if (!search) continue;
      const links = search.results.flatMap(({ url, title }) => linkSource(url, title));
      add(links.length ? links : [{ title: '联网搜索', domain: search.provider }]);
    } else if (name === 'web_fetch') {
      const page = webPage.safeParse(parseJson(output.text)).data;
      if (page) add(linkSource(page.source.url, page.title));
    } else if (name.startsWith('mcp_')) {
      const metadata = mcpDetails.safeParse(output.details).data;
      const fallback = {
        title: metadata?.source.name ?? name.slice(4).replaceAll('_', ' '),
        domain: metadata?.source.domain ?? 'MCP',
      };
      if (name.startsWith(composioToolPrefix) && name !== multiExecute) {
        composioFallback ??= { ...fallback, title: 'Composio' };
        continue;
      }
      const payload =
        parseJson(output.text) ?? parseJson(output.text.slice(output.text.lastIndexOf('\n') + 1));
      if (name === multiExecute) {
        const results = composioResults.safeParse(payload).data?.data.results ?? [];
        for (const { tool_slug, response } of results) {
          if (!response) continue;
          const app = connectorAppOf(tool_slug, catalog);
          const gmail = tool_slug.toUpperCase().startsWith('GMAIL_');
          const links = resultSources(response, app, gmail);
          const appName = app?.name ?? (gmail ? 'Gmail' : undefined);
          if (links.length) add(links);
          else if (appName)
            add([
              { title: appName, domain: gmail ? 'mail.google.com' : 'Composio', logo: app?.logo },
            ]);
          usedConnector ||= Boolean(links.length || appName);
        }
        composioFallback ??= { ...fallback, title: 'Composio' };
      } else {
        const links = [
          ...(metadata?.links ?? []).flatMap(({ url, title }) => linkSource(url, title)),
          ...resultSources(payload),
        ];
        add(links.length ? links : [fallback]);
      }
    }
  }
  if (composioFallback && !usedConnector) add([composioFallback]);
  return [...sources.values()];
}
