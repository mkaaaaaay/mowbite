'use client';

import {usePathname, useRouter} from 'next/navigation';
import {useEffect, useSyncExternalStore} from 'react';

// the pages in the order of the tab bar
const ORDER = ['/', '/map', '/sensors', '/schedule', '/activity', '/settings'];
const KEY = 'swipePages';

export const swipeEnabled = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

const listeners = new Set<() => void>();

export const setSwipeEnabled = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
};

export function useSwipeEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    swipeEnabled,
    () => false,
  );
}

// things that want horizontal swipes themselves: the map, the stick, sliders, fields, chip rows
function claimsSwipe(el: Element | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.matches('svg, input, textarea, select, [role=slider], [data-no-swipe]')) return true;
    const x = getComputedStyle(e).overflowX;
    if ((x === 'auto' || x === 'scroll') && e.scrollWidth > e.clientWidth) return true;
  }
  return false;
}

// optional (settings, per device): swipe left/right between the pages on a phone
export default function SwipeNav() {
  const router = useRouter();
  const path = usePathname().replace(/(.)\/$/, '$1');

  useEffect(() => {
    // not while recording, the stick is in use there
    if (path === '/record') return;
    let start: {x: number; y: number; t: number} | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      // the screen edges are android's back gesture
      if (!swipeEnabled() || e.touches.length > 1 || t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
      start = claimsSwipe(e.target as Element) ? null : {x: t.clientX, y: t.clientY, t: e.timeStamp};
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = e.timeStamp - start.t < 600;
      start = null;
      if (!quick || Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
      const i = ORDER.indexOf(path);
      const next = i === -1 ? -1 : i + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < ORDER.length) router.push(ORDER[next]);
    };
    window.addEventListener('touchstart', down, {passive: true});
    window.addEventListener('touchend', up, {passive: true});
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchend', up);
    };
  }, [path, router]);

  return null;
}
