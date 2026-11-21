import type { z } from 'zod';

type Procedures = Record<string, { input: z.ZodType; output: z.ZodType }>;
type Events = Record<string, z.ZodType>;

export interface Contract<P extends Procedures = Procedures, E extends Events = Events> {
  namespace: string;
  procedures: P;
  events: E;
}

type Procedure<C extends Contract, K extends keyof C['procedures']> = C['procedures'][K];

export type Handlers<C extends Contract> = {
  [K in keyof C['procedures']]: (
    input: z.output<Procedure<C, K>['input']>,
  ) => z.output<Procedure<C, K>['output']> | Promise<z.output<Procedure<C, K>['output']>>;
};

export type Client<C extends Contract> = {
  [K in keyof C['procedures']]: (
    ...input: undefined extends z.input<Procedure<C, K>['input']>
      ? [input?: z.input<Procedure<C, K>['input']>]
      : [input: z.input<Procedure<C, K>['input']>]
  ) => Promise<z.output<Procedure<C, K>['output']>>;
};

export interface Implementation {
  contract: Contract;
  call(name: string, input: unknown): unknown;
}

export type EventPayload<C extends Contract, K extends keyof C['events']> = z.output<
  C['events'][K]
>;

export interface Bridge {
  invoke(channel: string, input: unknown): Promise<unknown>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
}

export function defineContract<const P extends Procedures, const E extends Events = {}>(
  namespace: string,
  procedures: P,
  events: E = {} as E,
): Contract<P, E> {
  return { namespace, procedures, events };
}

export function channelsOf(contract: Contract): string[] {
  return Object.keys(contract.procedures).map((name) => `${contract.namespace}:${name}`);
}

export function eventChannelsOf(contract: Contract): string[] {
  return Object.keys(contract.events).map((name) => `${contract.namespace}:${name}`);
}

export function subscribe<C extends Contract, K extends keyof C['events'] & string>(
  contract: C,
  bridge: Bridge | undefined,
  name: K,
  listener: (payload: EventPayload<C, K>) => void,
): () => void {
  if (!bridge) return () => {};
  return bridge.subscribe(`${contract.namespace}:${name}`, (payload) =>
    listener(payload as EventPayload<C, K>),
  );
}

export function implement<C extends Contract>(contract: C, handlers: Handlers<C>): Implementation {
  return {
    contract,
    call(name, input) {
      const procedure = contract.procedures[name];
      if (!procedure) throw new Error(`未知的调用：${contract.namespace}:${name}`);
      const handler = handlers[name] as (input: unknown) => unknown;
      return handler(procedure.input.parse(input));
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createClient<C extends Contract>(
  contract: C,
  bridge: Bridge | undefined,
): Client<C> {
  const call = async (name: string, input: unknown) => {
    if (!bridge) throw new Error('请在 Delion Bot 桌面端使用');
    try {
      return await bridge.invoke(`${contract.namespace}:${name}`, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''));
    }
  };
  return Object.fromEntries(
    Object.keys(contract.procedures).map((name) => [name, (input: unknown) => call(name, input)]),
  ) as Client<C>;
}
