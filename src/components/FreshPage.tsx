'use client';

import {useMowerStateValue} from '@/hooks/useMowerState';
import {leavingLoses} from '@/lib/leaving';
import {isApp} from '@/lib/native';
import {useEffect, useRef} from 'react';

// The container's web server sends no cache headers, so a phone's browser may keep showing an older build for a
// while after an update. The build on the mower says its version in version.json: when that differs from the one
// running here, the page is fetched again past the cache and reloaded. Once per version and page, so it can't loop.
// Not while the mower does something other than wait (mowing, docking, recording, driving or calibrating by hand) or
// something unsaved would be lost: then the next time the page is shown again.
export default function FreshPage() {
  const state = useMowerStateValue((l) => l.state?.current_state);
  const busy = useRef(false);
  useEffect(() => {
    busy.current = !!state && state !== 'IDLE';
  }, [state]);
  useEffect(() => {
    // the android app brings its own build
    if (isApp()) return;
    const check = async () => {
      try {
        const res = await fetch('/version.json', {cache: 'no-store'});
        if (!res.ok) return;
        const {version} = (await res.json()) as {version?: string};
        if (!version || version === process.env.APP_VERSION) return;
        // per page, the browser keeps each one on its own
        const key = `reloadedFor:${location.pathname}`;
        const held = () => busy.current || leavingLoses();
        if (sessionStorage.getItem(key) === version || held()) return;
        await fetch(location.href, {cache: 'reload'}).catch(() => {});
        if (held()) return;
        sessionStorage.setItem(key, version);
        location.reload();
      } catch {}
    };
    void check();
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return null;
}
