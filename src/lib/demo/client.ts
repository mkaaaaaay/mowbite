import {Buffer} from 'buffer';
import type {MqttClient} from 'mqtt';
import type {World} from './world';

// Stands in for the connection to a broker while the demo mower is picked: what the app subscribes to and publishes
// goes to lib/demo/world, loaded once it's needed. Only the part of the mqtt client the app uses.

type Listener = (...args: unknown[]) => void;

const matches = (pattern: string, topic: string) => {
  if (pattern === topic) return true;
  const p = pattern.split('/');
  const t = topic.split('/');
  return p.length === t.length && p.every((part, i) => part === '+' || part === t[i]);
};

export function demoClient(): MqttClient {
  const listeners = new Map<string, Set<Listener>>();
  // the wrappers of once(), so off() finds them by the listener it was given
  const wrapped = new Map<Listener, Listener>();
  const subscribed = new Set<string>();
  let world: World | null = null;

  const emit = (event: string, ...args: unknown[]) => [...(listeners.get(event) ?? [])].forEach((l) => l(...args));
  const deliver = (topic: string, text: string) => {
    for (const s of subscribed) {
      if (matches(s, topic)) {
        emit('message', topic, Buffer.from(text));
        return;
      }
    }
  };

  const client = {
    connected: false,
    on(event: string, l: Listener) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(l);
      return client;
    },
    once(event: string, l: Listener) {
      const w: Listener = (...args) => {
        client.off(event, l);
        l(...args);
      };
      wrapped.set(l, w);
      return client.on(event, w);
    },
    off(event: string, l: Listener) {
      listeners.get(event)?.delete(wrapped.get(l) ?? l);
      wrapped.delete(l);
      return client;
    },
    subscribe(topics: string | string[], done?: unknown) {
      for (const t of Array.isArray(topics) ? topics : [topics]) {
        if (subscribed.has(t)) continue;
        subscribed.add(t);
        // like retained messages, right after subscribing
        const now = world?.retained(t) ?? [];
        if (now.length) setTimeout(() => now.forEach(([topic, text]) => deliver(topic, text)), 0);
      }
      if (typeof done === 'function') setTimeout(() => done(null), 0);
      return client;
    },
    publish(topic: string, message: string | Buffer) {
      // the stick's commands are bson, the rest text
      world?.published(topic, typeof message === 'string' ? message : new Uint8Array(message));
      return client;
    },
  };

  void import('./world').then(({createWorld}) => {
    world = createWorld(deliver);
    // the click tests (e2e/) reach the demo mower with this, like another phone would
    if (typeof window !== 'undefined') (window as {mowbiteDemo?: World}).mowbiteDemo = world;
    client.connected = true;
    emit('connect');
  });
  return client as unknown as MqttClient;
}
