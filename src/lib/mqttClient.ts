import mqtt, {type MqttClient} from 'mqtt';
import {selectedMower} from './mowers';

declare global {
  interface Window {
    // from /config.js, written by the container on start
    __MOWER_CONFIG__?: {mqttUrl?: string; mqttPrefix?: string};
  }
}

function config() {
  return typeof window === 'undefined' ? {} : (window.__MOWER_CONFIG__ ?? {});
}

// another mower picked in the app, or the one it runs on. that falls back to the host the app is
// served from, which is the mower itself when installed there
function mqttUrl(): string {
  const other = selectedMower();
  if (other) return `ws://${other.host}:${other.wsPort ?? 9001}`;
  return config().mqttUrl || process.env.NEXT_PUBLIC_MOWER_MQTT_WS_URL || `ws://${window.location.hostname}:9001`;
}

function topicPrefix(): string {
  const other = typeof window === 'undefined' ? null : selectedMower();
  return other ? (other.prefix ?? '') : (config().mqttPrefix ?? '');
}

export function withPrefix(topic: string): string {
  return topicPrefix() + topic;
}

// topic without the prefix, null if it's not one of ours
export function unprefix(topic: string): string | null {
  const prefix = topicPrefix();
  return topic.startsWith(prefix) ? topic.slice(prefix.length) : null;
}

// one shared connection for the whole app
let client: MqttClient | null = null;

export function getMqttClient(): MqttClient {
  if (!client) {
    client = mqtt.connect(mqttUrl(), {reconnectPeriod: 2000});
  }
  return client;
}
