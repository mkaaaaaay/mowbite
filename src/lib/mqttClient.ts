import mqtt, {type MqttClient} from 'mqtt';

declare global {
  interface Window {
    // from /config.js, written by the container on start
    __MOWER_CONFIG__?: {mqttUrl?: string; mqttPrefix?: string};
  }
}

function config() {
  return typeof window === 'undefined' ? {} : (window.__MOWER_CONFIG__ ?? {});
}

// falls back to the host the app is served from, which is the mower itself when installed there
function mqttUrl(): string {
  return config().mqttUrl || process.env.NEXT_PUBLIC_MOWER_MQTT_WS_URL || `ws://${window.location.hostname}:9001`;
}

export function withPrefix(topic: string): string {
  return (config().mqttPrefix ?? '') + topic;
}

// topic without the prefix, null if it's not one of ours
export function unprefix(topic: string): string | null {
  const prefix = config().mqttPrefix ?? '';
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
