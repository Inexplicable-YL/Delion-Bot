import { pathToFileURL } from 'node:url';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ScopedDirectory } from './mode';

export function virtualizeModelPaths(directories: ScopedDirectory[]) {
  const paths = directories.flatMap(({ host, name, remote }) => {
    const slash = host.replaceAll('\\', '/');
    const aliases = new Set([host, host.replaceAll('\\', '\\\\'), slash]);
    if (!remote) aliases.add(pathToFileURL(host).href);
    if (!remote && process.platform === 'win32') {
      aliases.add(slash.replace(/^([a-z]):\//i, '/$1/'));
      aliases.add(host.replace(/^([a-z]:\\)/i, '\\\\?\\$1'));
    }
    return [...aliases].map((path) => ({
      path,
      name,
      ignoreCase: !remote && process.platform === 'win32',
    }));
  });
  const patterns = paths
    .sort((a, b) => b.path.length - a.path.length)
    .map(({ path, name, ignoreCase }) => ({
      match: new RegExp(
        path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          String.raw`(?=$|[\\/\s"'<>),;:!?\x5d\x7d\x60])`,
        ignoreCase ? 'gi' : 'g',
      ),
      name,
    }));
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = value;
      for (const { match, name } of patterns) text = text.replace(match, name);
      return text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object' || ('type' in value && value.type === 'image'))
      return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
  };
  return (messages: AgentMessage[]) =>
    patterns.length ? (walk(messages) as AgentMessage[]) : messages;
}
