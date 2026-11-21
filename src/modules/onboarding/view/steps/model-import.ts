import { LLM_MODEL_LIMIT } from '../../../../core/protocol/llm-models';

export function selectedModels(options: string[], checked: ReadonlySet<string>): string[] {
  return options.filter((id) => checked.has(id));
}

export function capModels(
  picked: string[],
  limit = LLM_MODEL_LIMIT,
): { models: string[]; notice: string } {
  if (picked.length <= limit) return { models: picked, notice: `已导入 ${picked.length} 个模型` };
  return {
    models: picked.slice(0, limit),
    notice: `模型数量过多，最多保留 ${limit} 个，${picked.length - limit} 个未导入`,
  };
}
