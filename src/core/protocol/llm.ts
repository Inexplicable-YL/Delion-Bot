import { z } from 'zod';
import { defineContract } from './contract';

export interface LlmModelSettings {
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
  effortLevels?: string[];
  effort?: string;
}

export interface LlmProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  piProvider: string | null;
  enabled: boolean;
}

export interface LlmSaveInput {
  id?: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  piProvider?: string | null;
}

export interface LlmVerifyInput {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}

export interface LlmVerifyResult {
  ok: boolean;
  message: string;
  models?: string[];
  baseUrl?: string;
}

export interface LlmCatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  vision: boolean;
  effortLevels: string[];
}

export interface LlmCatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: LlmCatalogModel[];
}

const providerId = z.uuid();

export const llmContract = defineContract('llm', {
  catalog: { input: z.undefined(), output: z.custom<LlmCatalogProvider[]>() },
  list: { input: z.undefined(), output: z.custom<LlmProviderView[]>() },
  save: { input: z.custom<LlmSaveInput>(), output: z.custom<LlmProviderView>() },
  remove: { input: providerId, output: z.void() },
  setEnabled: { input: z.object({ id: providerId, enabled: z.boolean() }), output: z.void() },
  verify: {
    input: z.object({
      id: providerId.optional(),
      baseUrl: z.string(),
      apiKey: z.string().optional(),
    }),
    output: z.custom<LlmVerifyResult>(),
  },
  verifyModel: {
    input: z.custom<{
      id?: string;
      piProvider?: string | null;
      baseUrl?: string;
      apiKey?: string;
      model: string;
      settings?: LlmModelSettings;
    }>(),
    output: z.custom<LlmVerifyResult>(),
  },
});
