import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {useKeptState} from '@/hooks/useKeptState';
import {tr} from '@/lib/i18n';
import {mergeMaps} from '@/lib/mergeMap';
import {sameMap} from '@/lib/sameMap';
import {setUnsavedMap} from '@/lib/unsavedMap';
import {useEffect, useMemo, useRef, useState} from 'react';

// the same points, also when they came back from the mower after a save
const sameOutline = (a: Point[], b: Point[]) => a === b || (a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y));

// The map being edited: the live map until the first edit, after that a copy of our own so updates don't overwrite
// edits, with undo and redo steps. Kept while the app runs, a look at another tab doesn't lose them. Also notices when
// the map on the mower changed meanwhile and can put both together.
export function useMapEdits(liveMap: MowerMap | null) {
  const [edited, setEdited] = useKeptState<MowerMap | null>('map:edited', null);
  // the mower's map the edits started from, to notice when it gets changed somewhere else meanwhile
  const [base, setBase] = useKeptState<MowerMap | null>('map:base', null);
  const map = edited ?? liveMap;
  const put = (next: MowerMap | null | ((m: MowerMap | null) => MowerMap | null)) => {
    if (!edited) setBase(liveMap);
    setEdited((prev) => (typeof next === 'function' ? next(prev ?? liveMap) : next));
  };
  const [history, setHistory] = useKeptState<MowerMap[]>('map:history', []);
  // the steps undone, newest last, until something else gets changed
  const [future, setFuture] = useKeptState<MowerMap[]>('map:future', []);
  const setMap: typeof put = (next) => {
    put(next);
    if (future.length) setFuture([]);
  };
  // per area its outlines before the first reduce and the ones it got reduced to, newest last, so the slider can go back
  // up while the area still has one of those (again after an undo), not after any other change
  const [originals, setOriginals] = useKeptState<Record<string, {from: Point[]; to: Point[]}[]>>('map:originals', {});
  // what reducing the points of an area starts from
  const originalOf = (a: MapArea) => {
    const list = originals[a.id];
    return [...(Array.isArray(list) ? list : [])].reverse().find((o) => sameOutline(o.to, a.outline))?.from ?? a.outline;
  };
  // an area's points reduced, from the one outline to the other, the last 20 times
  const keepOriginal = (id: string, from: Point[], to: Point[]) =>
    setOriginals((o) => ({...o, [id]: [...(Array.isArray(o[id]) ? o[id] : []), {from, to}].slice(-20)}));

  // really changed, not just a field that got focus (that already makes an undo step)
  const dirty = useMemo(() => !!edited && (!base || !sameMap(edited, base)), [edited, base]);
  // the map on the mower isn't the one the edits started from: another app, device or a recording changed it.
  // saving would put the edited copy in its place and that change would be gone
  const external = useMemo(() => !!base && !!liveMap && !sameMap(base, liveMap), [base, liveMap]);
  // back to the mower's map. keep: the outlines from before reducing points stay (only after a save, they
  // still match then)
  const dropEdits = (keep?: 'originals') => {
    setEdited(null);
    setBase(null);
    setHistory([]);
    setFuture([]);
    setMergeNote(null);
    if (keep !== 'originals') setOriginals({});
  };
  // what got changed here put together with the change on the mower, see lib/mergeMap. areas both changed keep the
  // version from here, the note names them
  const [mergeNote, setMergeNote] = useState<string | null>(null);
  const mergeExternal = () => {
    if (!edited || !base || !liveMap) return;
    const {map: merged, conflicts} = mergeMaps(base, edited, liveMap);
    remember();
    setEdited(merged);
    setFuture([]);
    setBase(liveMap);
    const name = (id: string) =>
      merged.docking_stations.some((d) => d.id === id)
        ? tr('Docking station')
        : merged.areas.find((a) => a.id === id)?.properties.name || tr('unnamed');
    setMergeNote(conflicts.length ? tr('Changed on both sides: {names}. Your version is kept there.', {names: conflicts.map(name).join(', ')}) : null);
  };
  useEffect(() => setUnsavedMap(dirty), [dirty]);
  // nothing of ours in the copy: follow the mower's map again
  useEffect(() => {
    if (external && !dirty) dropEdits();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dropEdits only uses setters
  }, [external, dirty]);

  // the steps to redo when the last change got remembered, a change called off gives them back
  const futureThen = useRef(future);
  // call before every change so it can be undone. the same map twice in a row is one step (a field that got focus
  // and then the first change after a save)
  const remember = () => {
    futureThen.current = future;
    if (map) setHistory((h) => (h[h.length - 1] === map ? h : [...h.slice(-49), map]));
  };

  // one step back, false when there's none. redoable: it can be redone (not a drag that was called off, that one
  // leaves what could be redone before it)
  const undoStep = (redoable = true) => {
    if (!history.length) return false;
    if (!redoable) setFuture(futureThen.current);
    else if (map) setFuture((f) => [...f.slice(-49), map]);
    put(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    return true;
  };

  // the last step undone done again, false when there's none
  const redoStep = () => {
    if (!future.length) return false;
    if (map) setHistory((h) => (h[h.length - 1] === map ? h : [...h.slice(-49), map]));
    put(future[future.length - 1]);
    setFuture((f) => f.slice(0, -1));
    return true;
  };

  return {
    map,
    edited,
    setMap,
    history,
    future,
    remember,
    undoStep,
    redoStep,
    originalOf,
    keepOriginal,
    dirty,
    external,
    dropEdits,
    mergeNote,
    mergeExternal,
  };
}
