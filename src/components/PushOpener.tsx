'use client';

import {leaveFirst} from '@/lib/leaving';
import {mowerByAddress, mowerList, selectMower, selectedMower} from '@/lib/mowers';
import {pushPlugin, renewEndpoint} from '@/lib/push';
import type {PluginListenerHandle} from '@capacitor/core';
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

// In the Android app: a tapped MowBite message opens its page, on the mower it's about (switching to it reloads the app,
// the page is kept for after). And when the delivering app gives another address, the mowers get the new one, else
// their messages would go nowhere
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
    const handles: PluginListenerHandle[] = [];
    // one after another, a mower isn't told two addresses at once
    let renewing = Promise.resolve();
    const renew = (endpoint: string | null) => {
      if (endpoint) renewing = renewing.then(() => renewEndpoint(endpoint)).catch(() => {});
    };
    // back on the screen: a new address may have come meanwhile, or a mower out of reach before is there now
    const back = () => {
      if (document.visibilityState === 'visible') void native.then(({native: p}) => p.status()).then((st) => renew(st.endpoint));
    };
    void native.then(async ({native: p}) => {
      const opened = await p.addListener('opened', ({path, api}) => {
        const mower = api ? mowerByAddress(api, mowerList()) : undefined;
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
      const changed = await p.addListener('endpoint', ({url}) => renew(url));
      if (gone) return void [opened, changed].forEach((h) => void h.remove());
      handles.push(opened, changed);
      renew((await p.status()).endpoint);
    });
    document.addEventListener('visibilitychange', back);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', back);
      handles.forEach((h) => void h.remove());
    };
  }, [router]);
  return null;
}
