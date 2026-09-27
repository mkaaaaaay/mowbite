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
const page = () => document.querySelector<HTMLElement>('[data-page]');

// a copy of how each page looked last, shown next to the current one while swiping.
// the real page takes over as soon as it's rendered
const shots = new Map<string, HTMLElement>();

function snapshot(path: string) {
  const el = page();
  if (!el) return;
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-page');
  copy.style.translate = '';
  copy.style.opacity = '';
  copy.style.transition = '';
  // a copied radio with the same name would steal the checked state from the real one
  copy.querySelectorAll('[name]').forEach((n) => n.removeAttribute('name'));
  shots.set(path, copy);
}

function showPreview(path: string): HTMLElement | null {
  const shot = shots.get(path);
  if (!shot) return null;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.inert = true;
  Object.assign(box.style, {
    position: 'fixed',
    inset: '0',
    // clear of the sidebar on wide screens
    left: `${page()?.offsetLeft ?? 0}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    background: 'var(--background)',
    zIndex: '1',
  });
  box.appendChild(shot.cloneNode(true));
  document.body.appendChild(box);
  return box;
}

// set when a swipe navigates: which side the next page comes from, and its preview if there was one
let entering: {dir: number; preview: HTMLElement | null} | null = null;

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// optional (settings, per device): swipe left/right between the pages on a phone.
// the page follows the finger with the next one right beside it, like turning pages
export default function SwipeNav() {
  const router = useRouter();
  const path = usePathname().replace(/(.)\/$/, '$1');

  // the new page is rendered: drop the preview, or slide it in when there was none
  useEffect(() => {
    const el = page();
    const e = entering;
    entering = null;
    if (e && el) {
      el.style.transition = 'none';
      el.style.translate = '';
      el.style.opacity = '';
      if (e.preview) {
        e.preview.remove();
      } else {
        el.style.translate = `${e.dir * window.innerWidth * 0.3}px 0`;
        el.style.opacity = '0';
        void el.offsetWidth;
        el.style.transition = `translate 0.28s ${EASE}, opacity 0.22s ease-out`;
        el.style.translate = '';
        el.style.opacity = '';
      }
    }
    // keep a fresh picture of this page for swiping back to it, once its data is in
    const t = setTimeout(() => snapshot(path), 1500);
    return () => clearTimeout(t);
  }, [path]);

  useEffect(() => {
    // not while recording, the stick is in use there
    if (path === '/record') return;
    const i = ORDER.indexOf(path);
    const neighbour = (dx: number) => {
      const n = i === -1 ? -1 : i + (dx < 0 ? 1 : -1);
      return n >= 0 && n < ORDER.length ? ORDER[n] : null;
    };
    let drag: {
      x: number;
      y: number;
      t: number;
      axis: 'x' | 'y' | null;
      el: HTMLElement | null;
      preview: HTMLElement | null;
      side: number;
    } | null = null;
    let dx = 0;
    const w = () => window.innerWidth;

    const dropPreview = (d: NonNullable<typeof drag>) => {
      d.preview?.remove();
      d.preview = null;
      d.side = 0;
    };
    // back to where it was
    const settle = (d: NonNullable<typeof drag>) => {
      const {el, preview, side} = d;
      const t = `translate 0.3s ${EASE}, opacity 0.2s`;
      if (el) {
        el.style.transition = t;
        el.style.translate = '';
        el.style.opacity = '';
      }
      if (preview) {
        preview.style.transition = t;
        preview.style.translate = `${side * w()}px 0`;
        setTimeout(() => preview.remove(), 320);
      }
    };

    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      drag = null;
      // the screen edges are android's back gesture
      if (!swipeEnabled() || e.touches.length > 1 || t.clientX < 24 || t.clientX > w() - 24) return;
      if (claimsSwipe(e.target as Element)) return;
      drag = {x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null, el: page(), preview: null, side: 0};
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
        if (drag.axis === 'x') {
          snapshot(path);
          ORDER.forEach((p, n) => Math.abs(n - i) === 1 && router.prefetch(p));
        }
      }
      if (drag.axis !== 'x') return;
      e.preventDefault();
      if (!drag.el || calm()) return;
      const next = neighbour(dx);
      // the next page sits right of the current one, the previous left of it
      const side = dx < 0 ? 1 : -1;
      if (drag.side !== side) {
        dropPreview(drag);
        if (next) {
          drag.preview = showPreview(next);
          drag.side = side;
        }
      }
      // at the first/last page it only gives a little
      const shown = next ? dx : dx * 0.25;
      drag.el.style.transition = 'none';
      drag.el.style.translate = `${shown}px 0`;
      // no picture of the next page yet: fade instead
      drag.el.style.opacity = next && !drag.preview ? String(1 - Math.min(Math.abs(dx) / w(), 1) * 0.4) : '';
      if (drag.preview) {
        drag.preview.style.transition = 'none';
        drag.preview.style.translate = `${shown + side * w()}px 0`;
      }
    };
    const up = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d || d.axis !== 'x') return;
      const next = neighbour(dx);
      const quick = e.timeStamp - d.t < 400;
      const go = next && (Math.abs(dx) > w() * 0.3 || (quick && Math.abs(dx) > 60));
      if (!go) {
        settle(d);
        return;
      }
      const dir = dx < 0 ? 1 : -1;
      if (!d.el || calm()) {
        dropPreview(d);
        router.push(next);
        return;
      }
      // the rest of the way, a bit quicker the faster the flick
      const left = 1 - Math.min(Math.abs(dx) / w(), 1);
      const ms = Math.round(120 + 180 * left);
      d.el.style.transition = `translate ${ms}ms ${EASE}, opacity ${ms}ms`;
      d.el.style.translate = `${-dir * w()}px 0`;
      if (d.preview) {
        d.preview.style.transition = `translate ${ms}ms ${EASE}`;
        d.preview.style.translate = '0px 0';
      } else {
        d.el.style.opacity = '0';
      }
      const {preview, el} = d;
      setTimeout(() => {
        entering = {dir, preview};
        router.push(next);
        // in case the page never changes, don't leave it hidden
        setTimeout(() => {
          if (entering?.preview === preview) {
            entering = null;
            preview?.remove();
            el.style.transition = '';
            el.style.translate = '';
            el.style.opacity = '';
          }
        }, 2000);
      }, ms);
    };
    const cancel = () => {
      if (drag?.axis === 'x') settle(drag);
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
