'use client';

import {getMqttClient, unprefix, withPrefix} from '@/lib/mqttClient';
import {useCallback, useEffect, useState} from 'react';
import {TOPIC} from '@/lib/openmower';

interface ActionInfo {
  action_id: string;
  action_name: string;
  // 1/0, not a bool
  enabled: boolean | 0 | 1;
}

// module level cache, actions/json is retained and won't come again on remount
let cachedActions: Record<string, boolean> = {};

export function useMowerActions(): {
  hasAction: (id: string) => boolean;
  publishAction: (id: string) => void;
} {
  const [actions, setActions] = useState<Record<string, boolean>>(cachedActions);

  useEffect(() => {
    const c = getMqttClient();

    const onConnect = () => c.subscribe(withPrefix(TOPIC.actions));
    const onMessage = (topic: string, payload: Buffer) => {
      if (unprefix(topic) !== TOPIC.actions) return;
      try {
        const list: ActionInfo[] = JSON.parse(payload.toString());
        const next: Record<string, boolean> = {};
        for (const a of list) next[a.action_id] = !!a.enabled;
        cachedActions = next;
        setActions(next);
      } catch {
        // ignore malformed payloads
      }
    };

    c.on('connect', onConnect);
    c.on('message', onMessage);
    if (c.connected) onConnect();

    return () => {
      c.off('connect', onConnect);
      c.off('message', onMessage);
    };
  }, []);

  const hasAction = useCallback((id: string) => !!actions[id], [actions]);

  // plain text, not json
  const publishAction = useCallback((id: string) => {
    getMqttClient().publish(withPrefix(TOPIC.action), id);
  }, []);

  return {hasAction, publishAction};
}
