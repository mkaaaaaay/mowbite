'use client';

import {leaveFirst} from '@/lib/leaving';
import {mowerBase, mowerList, selectMower, selectedMower} from '@/lib/mowers';
import {addPush, removePush} from '@/lib/notify';
import {pushPlugin, rememberEndpoint, sentEndpoint} from '@/lib/push';
import {mowerAtHas} from '@/lib/updates';
import type {PluginListenerHandle} from '@capacitor/core';
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

// In the Android app: a tapped MowBite message opens its page, on the mower it's about (switching to it reloads the app,
// the page is kept for after). And when the delivering app gave another address while MowBite was closed, the mowers
// get the new one, else their messages would go nowhere
const PAGE_KEY = 'pushPage';
// a page of the app's own, never another site
const inApp = (path: string) => (/^\/(?![/\\])/.test(path) ? path : '/');

export default function PushOpener() {
  const router = useRouter();
  useEffect(() => {
    const native = pushPlugin();
    if (!native) return;
    try {
      const page = sessionStorage.getItem(PAGE_KEY);
      if (page) {
        sessionStorage.removeItem(PAGE_KEY);
        router.push(inApp(page));
      }
    } catch {}
    let gone = false;
    let handle: PluginListenerHandle | undefined;
    void native.then(async ({native: p}) => {
      const h = await p.addListener('opened', ({path, api}) => {
        const mower = api ? mowerList().find((m) => mowerBase(m) === api.replace(/\/+$/, '')) : undefined;
        if (mower && mower.id !== selectedMower()?.id) {
          // something unsaved asks first, the page is kept only for a switch that happens
          const wait = leaveFirst();
          if (wait === false) return;
          try {
            sessionStorage.setItem(PAGE_KEY, path);
          } catch {}
          selectMower(mower.id, wait);
          return;
        }
        router.push(inApp(path));
      });
      if (gone) return void h.remove();
      handle = h;
      const {endpoint} = await p.status();
      if (!endpoint) return;
      // every mower in the list that was told an older one, all at once so one out of reach doesn't hold up the others
      await Promise.all(
        mowerList()
          .map(mowerBase)
          .map(async (api) => {
            const sent = sentEndpoint(api);
            // (an older container would take the address for its settings)
            if (!sent || endpoint === sent || !(await mowerAtHas(api, 'phones'))) return;
            await removePush(sent, api).catch(() => {});
            await addPush(endpoint, api).then(
              () => rememberEndpoint(api, endpoint),
              () => {},
            );
          }),
      );
    });
    return () => {
      gone = true;
      void handle?.remove();
    };
  }, [router]);
  return null;
}
