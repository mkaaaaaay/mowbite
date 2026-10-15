'use client';

import {apiBase, mowerList, selectMower, selectedMower} from '@/lib/mowers';
import {addPush, removePush} from '@/lib/notify';
import {pushPlugin, rememberEndpoint, sentEndpoint} from '@/lib/push';
import {mowerHas} from '@/lib/updates';
import type {PluginListenerHandle} from '@capacitor/core';
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

// In the Android app: a tapped MowBite message opens its page, on the mower it's about (switching to it reloads the app,
// the page is kept for after). And when the delivering app gave another address while MowBite was closed, the mower
// gets the new one, else its messages would go nowhere
const PAGE_KEY = 'pushPage';

export default function PushOpener() {
  const router = useRouter();
  useEffect(() => {
    const native = pushPlugin();
    if (!native) return;
    try {
      const page = sessionStorage.getItem(PAGE_KEY);
      if (page) {
        sessionStorage.removeItem(PAGE_KEY);
        router.push(page);
      }
    } catch {}
    let gone = false;
    let handle: PluginListenerHandle | undefined;
    void native.then(async ({native: p}) => {
      const h = await p.addListener('opened', ({path, api}) => {
        const mower = api ? mowerList().find((m) => `http://${m.host}:${m.appPort ?? 8082}` === api.replace(/\/+$/, '')) : undefined;
        if (mower && mower.id !== selectedMower()?.id) {
          try {
            sessionStorage.setItem(PAGE_KEY, path);
          } catch {}
          selectMower(mower.id);
          return;
        }
        router.push(path);
      });
      if (gone) return void h.remove();
      handle = h;
      const api = apiBase();
      const sent = api ? sentEndpoint(api) : null;
      const {endpoint} = await p.status();
      // (an older container would take the address for its settings)
      if (!sent || !endpoint || endpoint === sent || !(await mowerHas('phones'))) return;
      await removePush(sent).catch(() => {});
      await addPush(endpoint).then(
        () => rememberEndpoint(api, endpoint),
        () => {},
      );
    });
    return () => {
      gone = true;
      void handle?.remove();
    };
  }, [router]);
  return null;
}
