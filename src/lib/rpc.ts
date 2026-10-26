import {getMqttClient, onTopic, withPrefix} from './mqttClient';
import {RPC, TOPIC} from './openmower';

// json-rpc 2.0 over mqtt: rpc/request -> rpc/response, matched by id

// code: the json-rpc error code, 'timeout' when the mower didn't answer, 'too_large' for a call too big to send (the
// message then says how many bytes)
export class RpcError extends Error {
  constructor(
    public method: string,
    public code: number | 'timeout' | 'too_large',
    message: string,
  ) {
    super(message);
  }
}

// a call the mower doesn't know, e.g. another OpenMower version
export const isMissingMethod = (e: unknown) => e instanceof RpcError && e.code === -32601;

// each copy of the app counts its calls after a random name of its own: two phones, two tabs, a page and the app all
// hear the same answers, and another one's answer must not count for a call of this one (a map saved by nobody)
const instance = Math.random().toString(36).slice(2, 10);
let nextId = 1;
const pending = new Map<string, {method: string; resolve: (v: unknown) => void; reject: (e: Error) => void}>();
let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  onTopic(TOPIC.rpcResponse, (payload) => {
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
// no answer at all: the connection may just have taken longer (phone waking up), so it's asked again after this
// instead of going without the newer features until a reload
let askAgainAt = 0;
const ASK_AGAIN_MS = 15000;

export function rpcMethods(): Promise<Set<string> | null> {
  if (askAgainAt && Date.now() >= askAgainAt) {
    methods = null;
    askAgainAt = 0;
  }
  methods ??= send<string[]>(RPC.methods, [], 5000).then(
    (list) => (Array.isArray(list) ? new Set(list) : null),
    (e) => {
      if (e instanceof RpcError && e.code === 'timeout') askAgainAt = Date.now() + ASK_AGAIN_MS;
      return null;
    },
  );
  return methods;
}

// rpcMethods() had no answer and will ask again
export const methodsUnknown = () => askAgainAt > 0;

export const unavailable = (known: Set<string> | null, method: string) =>
  !!known && method !== RPC.methods && !method.startsWith('meta.') && !known.has(method);

// params by position (array) or by name (object), json-rpc allows both
export async function callRpc<T = unknown>(method: string, params: unknown[] | object = [], timeoutMs = 10000): Promise<T> {
  if (unavailable(await rpcMethods(), method)) throw new RpcError(method, -32601, 'Method not found');
  return send<T>(method, params, timeoutMs);
}

// mosquitto drops a message of about 2 MB without a word (a map with very many points): such a call fails at once
// instead of after its time
export const MAX_RPC_BYTES = 1_900_000;

function send<T>(method: string, params: unknown[] | object, timeoutMs: number): Promise<T> {
  ensureListening();
  const id = `${instance}-${nextId++}`;
  const c = getMqttClient();
  const body = JSON.stringify({jsonrpc: '2.0', method, params, id});
  // (counted in bytes only where it could matter, a short one can't be too big)
  const bytes = body.length > MAX_RPC_BYTES / 3 ? new TextEncoder().encode(body).length : body.length;
  if (bytes > MAX_RPC_BYTES) return Promise.reject(new RpcError(method, 'too_large', String(bytes)));

  return new Promise<T>((resolve, reject) => {
    const publish = () => c.publish(withPrefix(TOPIC.rpcRequest), body);
    // offline the call waits for the connection and is dropped when it times out, so a map save the app
    // reported as failed can't happen later after all. subscribed again first, the answer could beat the
    // subscription right after a reconnect
    const onConnect = () => c.subscribe(withPrefix(TOPIC.rpcResponse), () => pending.has(id) && publish());
    const done = () => {
      clearTimeout(timer);
      c.off('connect', onConnect);
    };
    const timer = setTimeout(() => {
      pending.delete(id);
      c.off('connect', onConnect);
      reject(new RpcError(method, 'timeout', `${method} timed out`));
    }, timeoutMs);

    pending.set(id, {
      method,
      resolve: (v) => {
        done();
        resolve(v as T);
      },
      reject: (e) => {
        done();
        reject(e);
      },
    });

    if (c.connected) publish();
    else c.once('connect', onConnect);
  });
}
