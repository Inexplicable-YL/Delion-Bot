import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts } from '../../ports';

export function approveTool(
  tool: ToolDefinition,
  session: string,
  title: string,
  fields?: { label: string; value: string }[],
  readOnly?: (input: unknown) => boolean,
): ToolDefinition {
  return {
    ...tool,
    async execute(id, input, signal, onUpdate, context) {
      const args = structuredClone(input);
      const cancellation = signal ?? new AbortController().signal;
      if (
        !cancellation.aborted &&
        (readOnly?.(args) ||
          (await hostPorts().desktop.approveToolAction?.({
            session,
            title,
            fields: [
              ...(fields ?? []),
              { label: '参数', value: JSON.stringify(args ?? {}, null, 2) },
            ],
            signal: cancellation,
          }))) &&
        !cancellation.aborted
      )
        return tool.execute(id, args, cancellation, onUpdate, context);
      return {
        content: [{ type: 'text', text: '操作未获批准或已取消' }],
        details: undefined,
        isError: true,
      };
    },
  };
}
