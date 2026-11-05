import {getMqttClient, mqtt5, onTopic, responseTopic, withPrefix} from './mqttClient';
import {RPC, TOPIC} from './openmower';

// json-rpc 2.0 over mqtt: rpc/request -> rpc/response, matched by id

// code: the json-rpc error code, 'timeout' when the mower didn't answer, 'too_large' for a call too big to send (the
// message then says how many bytes). data: what the mower adds to its error, MowBite OS e.g. {reason, until}
export class RpcError extends Error {
  constructor(
    public method: string,
    public code: number | 'timeout' | 'too_large',
    message: string,
    public data?: Record<string, unknown>,
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
  const answer = (payload: Buffer) => {
    let msg: {id?: string; result?: unknown; error?: {code?: number; message: string; data?: unknown}};
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!msg.id) return;
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if (msg.error) {
      const data = msg.error.data;
      const fields = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
      waiting.reject(new RpcError(waiting.method, msg.error.code ?? 0, msg.error.message, fields));
    } else waiting.resolve(msg.result);
  };
  // with MQTT 5 the answers come to this client's own topic, from an older MowBite OS (after going back) still to all
  onTopic(TOPIC.rpcResponse, answer);
  const own = responseTopic();
  if (own) onTopic(own, answer);
}

// The mower tells which methods it has (rpc.methods), asked once per page load. Calls it doesn't have
// fail right away instead of after the timeout. Older mowers can't tell, then nothing is checked.
// meta.* is answered by another service (openmower-cli), so it's never on that list.
let methods: Promise<Set<string> | null> | null = null;
// the same once it came, undefined before
let methodsNow: Set<string> | null | undefined;
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
    (list) => (methodsNow = Array.isArray(list) ? new Set(list) : null),
    (e) => {
      if (e instanceof RpcError && e.code === 'timeout') askAgainAt = Date.now() + ASK_AGAIN_MS;
      else methodsNow = null;
      return null;
    },
  );
  return methods;
}

// what rpc.methods said, without waiting: undefined while it hasn't answered, null for a mower that can't tell
export const knownMethods = () => methodsNow;

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

// calls that set a whole state (the map, parameters, the planner's settings), sent twice they leave the same: the
// connection dropping before their answer sends them again once it's back, the call or its answer may have gone with it
// (a map save at the station over a weak wifi, the app reconnecting the same second). the others aren't sent twice
const AGAIN = new Set<string>([RPC.replaceMap, RPC.setParams, RPC.plannerSettingsSet, RPC.plannerAngleReset]);

// A command to the mower as a call (MowBite OS, masterplan App ↔ OS): never sent again by itself and never waiting for
// the connection, a start that went out minutes later would drive off then. an answer after the time still comes to
// late for a minute (accepted after all, or why not), the call has failed by then
export const LATE_MS = 60000;

export function callCommand<T = unknown>(method: string, params: object, timeoutMs: number, late?: (answer: T | RpcError) => void): Promise<T> {
  if (!getMqttClient().connected) return Promise.reject(new RpcError(method, 'timeout', 'offline'));
  return send<T>(method, params, timeoutMs, late);
}

function send<T>(method: string, params: unknown[] | object, timeoutMs: number, late?: (answer: T | RpcError) => void): Promise<T> {
  ensureListening();
  const id = `${instance}-${nextId++}`;
  const c = getMqttClient();
  const body = JSON.stringify({jsonrpc: '2.0', method, params, id});
  // (counted in bytes only where it could matter, a short one can't be too big)
  const bytes = body.length > MAX_RPC_BYTES / 3 ? new TextEncoder().encode(body).length : body.length;
  if (bytes > MAX_RPC_BYTES) return Promise.reject(new RpcError(method, 'too_large', String(bytes)));

  return new Promise<T>((resolve, reject) => {
    // with MQTT 5 the answer is asked to this client's topic alone (the connection it goes out on counts)
    const publish = () => {
      const own = mqtt5() ? responseTopic() : null;
      c.publish(withPrefix(TOPIC.rpcRequest), body, own ? {properties: {responseTopic: withPrefix(own)}} : {});
    };
    // offline the call waits for the connection and is dropped when it times out, so a map save the app
    // reported as failed can't happen later after all. subscribed again first, the answer could beat the
    // subscription right after a reconnect
    const topics = [TOPIC.rpcResponse, ...(responseTopic() ? [responseTopic()!] : [])].map(withPrefix);
    const onConnect = () => c.subscribe(topics, () => pending.has(id) && publish());
    // (every failed try to connect again closes once more, it still goes out once)
    const onClose = () => {
      c.off('connect', onConnect);
      c.once('connect', onConnect);
    };
    const done = () => {
      clearTimeout(timer);
      c.off('connect', onConnect);
      c.off('close', onClose);
    };
    const timer = setTimeout(() => {
      pending.delete(id);
      done();
      reject(new RpcError(method, 'timeout', `${method} timed out`));
      if (!late) return;
      const drop = setTimeout(() => pending.delete(id), LATE_MS);
      const after = (a: T | RpcError) => {
        clearTimeout(drop);
        late(a);
      };
      pending.set(id, {method, resolve: (v) => after(v as T), reject: (e) => after(e as RpcError)});
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

    if (AGAIN.has(method)) c.on('close', onClose);
    if (c.connected) publish();
    else c.once('connect', onConnect);
  });
}
