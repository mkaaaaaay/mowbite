'use client';

import PageError from '@/app/error';
import {useMowerMap} from '@/hooks/useMowerMap';
import {useMowerParams} from '@/hooks/useMowerParams';
import {useMowerBody} from '@/lib/mowerBody';
import {holdMessages, passMessages} from '@/lib/mqttClient';
import {settingsStore} from '@/lib/settings';
import {usePathname} from 'next/navigation';
import {Activity, Component, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';

const MapEditorPage = lazy(() => import('@/app/map/MapEditor'));

// the map editor failed: the page's error in its place, the rest of the app goes on
class Caught extends Component<{children: ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) {
    return {error};
  }
  render() {
    return this.state.error ? <PageError error={this.state.error} retry={() => this.setState({error: null})} /> : this.props.children;
  }
}

// f once the page idles, delay ms from now at the earliest. what it returns calls it off
function whenIdle(f: () => void, delay: number): () => void {
  let idle: number | undefined;
  const wait = setTimeout(() => {
    idle = window.requestIdleCallback?.(f, {timeout: 8000});
    if (idle === undefined) f();
  }, delay);
  return () => {
    clearTimeout(wait);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

// The map editor stays when another page is opened: hidden (React's Activity, its effects stop and nothing of it is
// drawn meanwhile) and shown again at once from its tab, the /map route itself is empty. Before it was first opened it's
// drawn ahead in the background once the app idles. What it's drawn from (the map, the settings, the mower's body and
// params) draws it again while hidden, so it's up to date when it's shown
export default function MapKeeper() {
  const on = usePathname().replace(/(.)\/$/, '$1') === '/map';
  const [kept, setKept] = useState(on);
  if (on && !kept) setKept(true);
  const keptNow = useRef(kept);
  useEffect(() => {
    keptNow.current = kept;
  }, [kept]);
  // drawn ahead, unless the app started on the map
  useEffect(() => {
    if (keptNow.current) return;
    let stop = false;
    let offLayOut = () => {};
    const page = document.querySelector<HTMLElement>('[data-page]');
    // drawn, laid out once off screen while it's hidden: the browser reads all its paths then, the first time it's shown
    // it only lays them out again (hidden, it isn't laid out at all)
    const layOut = () => {
      const el = page?.querySelector<HTMLElement>(':scope > [data-map-editor]');
      if (stop || !page || !el || el.style.display !== 'none') return;
      const was = el.getAttribute('style') ?? '';
      el.style.cssText = `display: block !important; position: fixed; top: 0; left: -300vw; width: ${page.clientWidth}px; visibility: hidden`;
      void el.getBoundingClientRect();
      el.setAttribute('style', was);
    };
    // the mower's messages wait until it's drawn (lib/mqttClient): every one draws the page that's open again, and
    // react starts drawing this one over then, it would never get done
    const watch = new MutationObserver(() => {
      if (!page?.querySelector(':scope > [data-map-editor]')) return;
      watch.disconnect();
      passMessages();
      offLayOut = whenIdle(layOut, 500);
    });
    const ahead = () =>
      void import('@/app/map/MapEditor')
        .then(() => {
          if (stop || keptNow.current) return;
          holdMessages();
          if (page) watch.observe(page, {childList: true});
          setKept(true);
        })
        .catch(() => {});
    const offAhead = whenIdle(ahead, 2000);
    return () => {
      stop = true;
      watch.disconnect();
      offAhead();
      offLayOut();
    };
  }, []);
  // opened from its tab it starts at the top, like the other pages
  useLayoutEffect(() => {
    if (on) window.scrollTo(0, 0);
  }, [on]);
  const map = useMowerMap();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const body = useMowerBody();
  const params = useMowerParams();
  // a new one when one of them changes, the editor is drawn again then. the same otherwise: showing and hiding it
  // doesn't draw it again
  const page = useMemo(
    () => (
      <Caught>
        <Suspense>
          <MapEditorPage />
        </Suspense>
      </Caught>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, settings, body, params],
  );
  if (!kept) return null;
  return <Activity mode={on ? 'visible' : 'hidden'}>{page}</Activity>;
}
