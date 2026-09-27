import {getMqttClient, unprefix, withPrefix} from './mqttClient';
import {RPC, TOPIC} from './openmower';

// json-rpc 2.0 over mqtt: rpc/request -> rpc/response, matched by id

// code: the json-rpc error code, 'timeout' when the mower didn't answer
export class RpcError extends Error {
  constructor(
    public method: string,
    public code: number | 'timeout',
    message: string,
  ) {
    super(message);
  }
}

// a call the mower doesn't know, e.g. another OpenMower version
export const isMissingMethod = (e: unknown) => e instanceof RpcError && e.code === -32601;

let nextId = 1;
const pending = new Map<string, {method: string; resolve: (v: unknown) => void; reject: (e: Error) => void}>();
let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  getMqttClient().subscribe(withPrefix(TOPIC.rpcResponse));
  getMqttClient().on('message', (topic, payload) => {
    if (unprefix(topic) !== TOPIC.rpcResponse) return;
    let msg: {id?: string; result?: unknown; error?: {code?: number; message: string}};
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!msg.id) return;
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if (msg.error) waiting.reject(new RpcError(waiting.method, msg.error.code ?? 0, msg.error.message));
    else waiting.resolve(msg.result);
  });
}

// The mower tells which methods it has (rpc.methods), asked once per page load. Calls it doesn't have
// fail right away instead of after the timeout. Older mowers can't tell, then nothing is checked.
// meta.* is answered by another service (openmower-cli), so it's never on that list.
let methods: Promise<Set<string> | null> | null = null;

export function rpcMethods(): Promise<Set<string> | null> {
  methods ??= send<string[]>(RPC.methods, [], 5000).then(
    (list) => (Array.isArray(list) ? new Set(list) : null),
    () => null,
  );
  return methods;
}

export const unavailable = (known: Set<string> | null, method: string) =>
  !!known && method !== RPC.methods && !method.startsWith('meta.') && !known.has(method);

// params by position (array) or by name (object), json-rpc allows both
export async function callRpc<T = unknown>(method: string, params: unknown[] | object = [], timeoutMs = 10000): Promise<T> {
  if (unavailable(await rpcMethods(), method)) throw new RpcError(method, -32601, 'Method not found');
  return send<T>(method, params, timeoutMs);
}

function send<T>(method: string, params: unknown[] | object, timeoutMs: number): Promise<T> {
  ensureListening();
  const id = String(nextId++);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new RpcError(method, 'timeout', `${method} timed out`));
    }, timeoutMs);

    pending.set(id, {
      method,
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });

    getMqttClient().publish(withPrefix(TOPIC.rpcRequest), JSON.stringify({jsonrpc: '2.0', method, params, id}));
  });
}
