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

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// set when a swipe navigates, so the next page slides in from the right side
let entering = 0;

// optional (settings, per device): swipe left/right between the pages on a phone.
// the page follows the finger, the next one slides in after it
export default function SwipeNav() {
  const router = useRouter();
  const path = usePathname().replace(/(.)\/$/, '$1');

  // the new page is rendered, bring it in
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-page]');
    if (!entering || !el) return;
    const from = entering;
    entering = 0;
    el.style.transition = 'none';
    el.style.translate = `${from * window.innerWidth * 0.3}px 0`;
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = 'translate 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease-out';
    el.style.translate = '';
    el.style.opacity = '';
    const done = setTimeout(() => (el.style.transition = ''), 300);
    return () => clearTimeout(done);
  }, [path]);

  useEffect(() => {
    // not while recording, the stick is in use there
    if (path === '/record') return;
    const i = ORDER.indexOf(path);
    const neighbour = (dx: number) => {
      const n = i === -1 ? -1 : i + (dx < 0 ? 1 : -1);
      return n >= 0 && n < ORDER.length ? ORDER[n] : null;
    };
    let drag: {x: number; y: number; t: number; axis: 'x' | 'y' | null; el: HTMLElement | null} | null = null;
    let dx = 0;

    const settle = (el: HTMLElement) => {
      el.style.transition = 'translate 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 0.2s';
      el.style.translate = '';
      el.style.opacity = '';
    };

    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      drag = null;
      // the screen edges are android's back gesture
      if (!swipeEnabled() || e.touches.length > 1 || t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
      if (claimsSwipe(e.target as Element)) return;
      drag = {x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, el: document.querySelector('[data-page]')};
      dx = 0;
    };
    const move = (e: TouchEvent) => {
      if (!drag) return;
      const t = e.touches[0];
      dx = t.clientX - drag.x;
      const dy = t.clientY - drag.y;
      if (!drag.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
        const next = neighbour(dx);
        if (drag.axis === 'x' && next) router.prefetch(next);
      }
      if (drag.axis !== 'x') return;
      e.preventDefault();
      if (!drag.el || calm()) return;
      // at the first/last page it only gives a little
      const shown = neighbour(dx) ? dx : dx * 0.25;
      drag.el.style.transition = 'none';
      drag.el.style.translate = `${shown}px 0`;
      drag.el.style.opacity = neighbour(dx) ? String(1 - Math.min(Math.abs(dx) / window.innerWidth, 1) * 0.4) : '';
    };
    const up = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d || d.axis !== 'x') return;
      const next = neighbour(dx);
      const quick = e.timeStamp - d.t < 400;
      const go = next && (Math.abs(dx) > window.innerWidth * 0.3 || (quick && Math.abs(dx) > 60));
      if (!go) {
        if (d.el) settle(d.el);
        return;
      }
      const dir = dx < 0 ? 1 : -1;
      if (!d.el || calm()) {
        router.push(next);
        return;
      }
      d.el.style.transition = 'translate 0.15s ease-in, opacity 0.15s ease-in';
      d.el.style.translate = `${-dir * window.innerWidth * 0.5}px 0`;
      d.el.style.opacity = '0';
      const el = d.el;
      setTimeout(() => {
        entering = dir;
        router.push(next);
        // in case the page never changes, don't leave it hidden
        setTimeout(() => {
          if (entering) {
            entering = 0;
            settle(el);
          }
        }, 1500);
      }, 140);
    };
    const cancel = () => {
      if (drag?.axis === 'x' && drag.el) settle(drag.el);
      drag = null;
    };
    window.addEventListener('touchstart', down, {passive: true});
    // not passive: a sideways drag must not also scroll the page
    window.addEventListener('touchmove', move, {passive: false});
    window.addEventListener('touchend', up, {passive: true});
    window.addEventListener('touchcancel', cancel, {passive: true});
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [path, router]);

  return null;
}
