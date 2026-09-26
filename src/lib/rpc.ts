import {getMqttClient, unprefix, withPrefix} from './mqttClient';

// json-rpc 2.0 over mqtt: rpc/request -> rpc/response, matched by id
let nextId = 1;
const pending = new Map<string, {resolve: (v: unknown) => void; reject: (e: Error) => void}>();
let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  getMqttClient().subscribe(withPrefix('rpc/response'));
  getMqttClient().on('message', (topic, payload) => {
    if (unprefix(topic) !== 'rpc/response') return;
    let msg: {id?: string; result?: unknown; error?: {message: string}};
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!msg.id) return;
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if (msg.error) waiting.reject(new Error(msg.error.message));
    else waiting.resolve(msg.result);
  });
}

// params by position (array) or by name (object), json-rpc allows both
export function callRpc<T = unknown>(method: string, params: unknown[] | object = [], timeoutMs = 10000): Promise<T> {
  ensureListening();
  const id = String(nextId++);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });

    getMqttClient().publish(withPrefix('rpc/request'), JSON.stringify({jsonrpc: '2.0', method, params, id}));
  });
}
