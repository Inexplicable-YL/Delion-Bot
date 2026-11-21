import type { LlmModelSettings } from '../protocol/llm';
import { hostPorts } from '../ports';

export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  piProvider: string | null;
  enabled: boolean;
}

export interface StoredLlmConfig {
  providers: StoredLlmProvider[];
}

function validProvider(value: unknown): value is StoredLlmProvider {
  if (typeof value !== 'object' || value === null) return false;
  const provider = value as Partial<StoredLlmProvider>;
  return (
    typeof provider.id === 'string' &&
    typeof provider.name === 'string' &&
    typeof provider.baseUrl === 'string' &&
    typeof provider.apiKey === 'string' &&
    Array.isArray(provider.models) &&
    provider.models.every((model) => typeof model === 'string') &&
    typeof provider.enabled === 'boolean'
  );
}

export function saveLlmConfig(config: StoredLlmConfig): void {
  hostPorts().secrets.write('llm-providers', JSON.stringify(config));
}

export function loadLlmConfig(): StoredLlmConfig {
  const payload = hostPorts().secrets.read('llm-providers');
  if (payload === null) return { providers: [] };
  return parseLlmConfig(payload);
}

function parseLlmConfig(payload: string): StoredLlmConfig {
  const parsed = JSON.parse(payload) as Partial<StoredLlmConfig>;
  const providers = Array.isArray(parsed.providers) ? parsed.providers.filter(validProvider) : [];
  return {
    providers: providers.map((provider) => ({
      ...provider,
      piProvider: typeof provider.piProvider === 'string' ? provider.piProvider : null,
    })),
  };
}
