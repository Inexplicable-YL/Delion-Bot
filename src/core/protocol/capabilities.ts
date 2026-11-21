import { z } from 'zod';
import { defineContract } from './contract';

export type SkillOrigin = 'builtin' | 'user' | 'project';

export interface SkillDependency {
  status: 'missing' | 'installing' | 'ready' | 'error';
  phase?: string;
  received?: number;
  total?: number;
  error?: string;
}

export interface SkillView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  path: string;
  origin: SkillOrigin;
  group?: { id: string; label: string };
  dependency?: SkillDependency;
}

export type McpConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type McpTransportConfig =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> };

export type McpServerConfig = { id: string; name: string; enabled: boolean } & McpTransportConfig;

export type McpServerInput = { name: string } & McpTransportConfig;

export interface McpServerPatch {
  name?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerView {
  id: string;
  name: string;
  transport: McpTransportConfig['transport'];
  enabled: boolean;
  status: McpConnectionStatus;
  toolCount: number | null;
  error: string | null;
}

export interface AgentCapabilityView {
  name: string;
  label: string;
  domain: string;
  domainLabel: string;
  description: string;
  enabled: boolean;
  lockedReason?: string;
}

export type WebSearchEntry =
  | { id: string; name: string; provider: 'brave'; apiKey: string }
  | { id: string; name: string; provider: 'google'; apiKey: string; cx: string }
  | {
      id: string;
      name: string;
      provider: 'custom';
      url: string;
      body?: string;
      headers?: Record<string, string>;
    }
  | { id: string; name: string; provider: 'deepseek'; apiKey: string; useForFetch: boolean };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WebSearchEntryInput = DistributiveOmit<WebSearchEntry, 'id'> & { id?: string };

export interface WebSearchEntrySummary {
  id: string;
  name: string;
  provider: WebSearchEntry['provider'];
}

export interface WebSearchKeySource {
  id: string;
  name: string;
}

export interface RemoteSkillUpload {
  path: string;
  files: number;
}

const id = z.uuid();
const name = z.string().trim().min(1).max(100);
const skillId = z.string().min(1).max(32_767);
const skills = z.custom<SkillView[]>();
const mcpServers = z.custom<McpServerView[]>();
const builtins = z.custom<AgentCapabilityView[]>();
const webSearchEntries = z.custom<WebSearchEntry[]>();

export const capabilitiesContract = defineContract(
  'capabilities',
  {
    listSkills: { input: z.undefined(), output: skills },
    setSkillEnabled: { input: z.object({ id: skillId, enabled: z.boolean() }), output: skills },
    installSkillDependencies: { input: z.string(), output: skills },
    cancelSkillInstallation: { input: z.string(), output: z.void() },
    readSkill: { input: skillId, output: z.string() },
    revealSkill: { input: skillId, output: z.void() },
    uploadSkillToRemote: {
      input: z.object({
        id: skillId,
        remotePath: z.string().trim().min(1).max(4096),
        overwrite: z.boolean(),
      }),
      output: z.custom<RemoteSkillUpload>(),
    },
    listMcpServers: { input: z.undefined(), output: mcpServers },
    addMcpServer: { input: z.custom<McpServerInput>(), output: mcpServers },
    updateMcpServer: {
      input: z.object({ id, patch: z.custom<McpServerPatch>() }),
      output: mcpServers,
    },
    removeMcpServer: { input: id, output: mcpServers },
    refreshMcpServer: { input: id, output: mcpServers },
    listBuiltinCapabilities: { input: z.undefined(), output: builtins },
    setBuiltinCapability: { input: z.object({ name, enabled: z.boolean() }), output: builtins },
    setBuiltinDomain: { input: z.object({ domain: name, enabled: z.boolean() }), output: builtins },
    subagentLimit: { input: z.undefined(), output: z.number() },
    setSubagentLimit: { input: z.number(), output: z.number() },
    listWebSearchEntries: { input: z.undefined(), output: webSearchEntries },
    listWebSearchOptions: {
      input: z.undefined(),
      output: z.custom<{ entries: WebSearchEntrySummary[]; selectedId: string | null }>(),
    },
    saveWebSearchEntry: { input: z.custom<WebSearchEntryInput>(), output: webSearchEntries },
    removeWebSearchEntry: { input: id, output: webSearchEntries },
    selectWebSearchEntry: { input: id.nullable(), output: z.void() },
    listWebSearchKeySources: { input: z.undefined(), output: z.custom<WebSearchKeySource[]>() },
    readWebSearchKey: { input: id, output: z.custom<string | null>() },
  },
  {
    webSearchChanged: z.undefined(),
  },
);
