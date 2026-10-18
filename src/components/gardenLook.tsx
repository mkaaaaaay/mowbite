'use client';

import type {MapArea} from '@/hooks/useMowerMap';
import {tr} from '@/lib/i18n';
import {useEffect, useId} from 'react';
import {createPortal} from 'react-dom';
import {BY_NAME, GROUPS, PICTURE_KEYS, PICTURES, type Box} from './gardenPictures';
import styles from './MapLookSettings.module.css';

// The garden map style, drawn from above like the pictures in the guides: the lawn mown in stripes along each area's
// mowing direction, an area not mowed as meadow, ways and obstacles as the picture picked for them, else from their
// name (a way as gravel, an obstacle as a pond, a tree, a house ... or a bed). The pictures are in gardenPictures.

export type Look = string;
export type {Box};

export const isThing = (look: Look) => !!PICTURES[look]?.thing;

// what a way or an obstacle is drawn as: the picture picked for it, else from its name, a way only as a ground (gravel
// unless the name says otherwise), an obstacle as anything (a bed unless the name says otherwise)
export function areaLook(area: MapArea, looks?: Record<string, string>): Look {
  const picked = looks?.[area.id];
  if (picked && PICTURES[picked]) return picked;
  const name = area.properties.name ?? '';
  const way = area.properties.type === 'nav';
  return BY_NAME.find(([look, re]) => (!way || !isThing(look)) && re.test(name))?.[0] ?? (way ? 'gravel' : 'bed');
}

// the texture an area is filled with: the ground itself, or the one around a thing
export const groundOf = (look: Look): Look => (isThing(look) ? (PICTURES[look].around ?? 'meadow') : look);

export const drawThing = (look: Look, box: Box) => PICTURES[look]?.thing?.(box);

// a ground as a texture with this id, m: svg units per meter
function texture(look: Look, id: string, m: number) {
  const tile = PICTURES[look]?.tile;
  if (!tile) return null;
  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={tile.w * m} height={tile.h * m}>
      <rect width={tile.w * m} height={tile.h * m} fill={tile.base} />
      {tile.draw(m)}
    </pattern>
  );
}

// the textures and outlines to cut things to, once per map. lawns: each mowing area's direction in radians, the area's
// lawn is {uid}lawn{its index}, every ground {uid}{its name}, the outline of thing i {uid}clip{i}. ids start with uid,
// several maps can be on one page
export function GardenDefs({uid, m, lawns, clips}: {uid: string; m: number; lawns: number[]; clips: string[]}) {
  return (
    <defs>
      {/* stripes a meter wide along the mowing direction (svg y points down, the angle counts the other way round) */}
      {lawns.map((angle, i) => (
        <pattern
          key={i}
          id={`${uid}lawn${i}`}
          patternUnits="userSpaceOnUse"
          width={2 * m}
          height={2 * m}
          patternTransform={`rotate(${(-angle * 180) / Math.PI})`}
        >
          <rect width={2 * m} height={2 * m} fill="#4a873b" />
          <rect width={2 * m} height={m} fill="#539340" />
        </pattern>
      ))}
      {PICTURE_KEYS.map((look) => texture(look, uid + look, m))}
      {clips.map((points, i) => (
        <clipPath key={i} id={`${uid}clip${i}`}>
          <polygon points={points} />
        </clipPath>
      ))}
    </defs>
  );
}

// a picture as a small square: its ground, a thing drawn on top
export function LookSwatch({look, size = 44}: {look: Look; size?: number}) {
  const id = 'look' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>{texture(groundOf(look), id, 40)}</defs>
      <rect width={40} height={40} rx={7} fill={`url(#${id})`} />
      {isThing(look) && drawThing(look, {x: 4, y: 4, w: 32, h: 32})}
    </svg>
  );
}

// all pictures to pick from, by group, over the page like the map settings. value: the one picked, auto: what the
// area is drawn as without one
export function LookPicker({value, auto, onPick, onClose}: {value?: string; auto: Look; onPick: (look: Look | undefined) => void; onClose: () => void}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();
  const choice = (look: Look | undefined, label: string) => (
    <button key={look ?? 'auto'} className={[styles.icon, value === look ? styles.iconOn : ''].join(' ')} onClick={() => onPick(look)}>
      <LookSwatch look={look ?? auto} />
      <span>{label}</span>
    </button>
  );
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} onPointerDown={keep} onWheel={keep} onTouchStart={keep}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label={tr('Picture on the map')} onClick={keep}>
        <div className={styles.panelHead}>
          <h2>{tr('Picture on the map')}</h2>
          <button className={styles.close} onClick={onClose} aria-label={tr('Close')}>
            ✕
          </button>
        </div>
        <section className={styles.section}>
          <div className={styles.icons}>{choice(undefined, tr('Auto ({what})', {what: tr(PICTURES[auto].label)}))}</div>
          <p className={styles.dim}>{tr('Auto goes by the name of the area.')}</p>
        </section>
        {GROUPS.map((g) => (
          <section key={g.key} className={styles.section}>
            <h3>{tr(g.label)}</h3>
            <div className={styles.icons}>{PICTURE_KEYS.filter((k) => PICTURES[k].group === g.key).map((k) => choice(k, tr(PICTURES[k].label)))}</div>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
