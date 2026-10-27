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
    // (also while the editor is hidden behind another page, its effects don't run then: a save that ends there)
    setUnsavedMap(false);
    setEdited(null);
    setBase(null);
    setHistory([]);
    setFuture([]);
    setMergeNote(null);
    if (keep !== 'originals') setOriginals({});
  };
  // what got changed here put together with the change on the mower, see lib/mergeMap. areas both changed keep the
  // version from here, the note names them. the map put together, null when there's nothing to
  const [mergeNote, setMergeNote] = useState<string | null>(null);
  const mergeExternal = () => {
    if (!edited || !base || !liveMap) return null;
    const {map: merged, conflicts} = mergeMaps(base, edited, liveMap);
    // the steps before were on the old map: undone they'd put back what the other side changed, without a warning
    setHistory([]);
    setEdited(merged);
    setFuture([]);
    setBase(liveMap);
    // (one deleted here isn't in the map put together)
    const maps = [merged, liveMap, base];
    const name = (id: string) =>
      maps.some((m) => m.docking_stations.some((d) => d.id === id))
        ? tr('Docking station')
        : maps.map((m) => m.areas.find((a) => a.id === id)).find(Boolean)?.properties.name || tr('unnamed');
    const here = (id: string) => merged.areas.some((a) => a.id === id) || merged.docking_stations.some((d) => d.id === id);
    const changed = conflicts.filter(here);
    const deleted = conflicts.filter((id) => !here(id));
    const note = [
      changed.length ? tr('Changed on both sides: {names}. Your version is kept there.', {names: changed.map(name).join(', ')}) : '',
      deleted.length ? tr('Deleted here, changed on the other side: {names}. They stay deleted.', {names: deleted.map(name).join(', ')}) : '',
    ].filter(Boolean);
    setMergeNote(note.length ? note.join(' ') : null);
    return merged;
  };
  // the mower's map is now this one (a save of ours that answered late): the edits made since go on from it
  const rebase = (m: MowerMap) => setBase(m);
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
    // a step that changed nothing (a field that only got focus) isn't one
    let h = history;
    while (h.length && h[h.length - 1] === map) h = h.slice(0, -1);
    if (!h.length) {
      if (h !== history) setHistory(h);
      return false;
    }
    if (!redoable) setFuture(futureThen.current);
    else if (map) setFuture((f) => [...f.slice(-49), map]);
    put(h[h.length - 1]);
    setHistory(h.slice(0, -1));
    return true;
  };
  // there's a step back that changes something
  const undoable = history.some((h) => h !== map);

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
    base,
    setMap,
    history,
    undoable,
    future,
    remember,
    undoStep,
    redoStep,
    originalOf,
    keepOriginal,
    dirty,
    external,
    dropEdits,
    rebase,
    mergeNote,
    mergeExternal,
  };
}
