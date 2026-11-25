import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hostPorts, type Approval, type ApprovalGrant } from '../../ports';

export const deniedMessage = (message: string, approval: Approval | undefined) =>
  approval && !approval.approved && approval.note
    ? `${message}。用户说明：${approval.note}`
    : message;

export async function approveNonPublicRead(session: string, url: URL, signal: AbortSignal) {
  const approval = await hostPorts().desktop.approveToolAction?.({
    session,
    title: '读取非公开网络地址',
    fields: [{ label: '地址', value: url.toString() }],
    signal,
  });
  if (!approval?.approved) throw new Error(deniedMessage('网络访问未获批准', approval));
}

export function approveTool(
  tool: ToolDefinition,
  session: string,
  title: string,
  fields?: { label: string; value: string }[],
  readOnly?: (input: unknown) => boolean,
  grant: (input: unknown) => ApprovalGrant | undefined = () => ({
    keys: [`tool:${tool.name}`],
    label: title,
  }),
): ToolDefinition {
  return {
    ...tool,
    async execute(id, input, signal, onUpdate, context) {
      const args = structuredClone(input);
      const cancellation = signal ?? new AbortController().signal;
      if (cancellation.aborted) return denied('操作未获批准或已取消', undefined);
      if (readOnly?.(args)) return tool.execute(id, args, cancellation, onUpdate, context);
      const approval = await hostPorts().desktop.approveToolAction?.({
        session,
        title,
        fields: [...(fields ?? []), { label: '参数', value: JSON.stringify(args ?? {}) }],
        grant: grant(args),
        signal: cancellation,
      });
      if (approval?.approved && !cancellation.aborted)
        return tool.execute(id, args, cancellation, onUpdate, context);
      return denied('操作未获批准或已取消', approval);
    },
  };
}

const denied = (message: string, approval: Approval | undefined) => ({
  content: [{ type: 'text' as const, text: deniedMessage(message, approval) }],
  details: undefined,
  isError: true,
});
