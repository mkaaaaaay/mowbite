'use client';

import {TitleMark} from '@/components/Logo';
import InfoTip from '@/components/InfoTip';
import MapView from '@/components/MapView';
import TrackPicker from '@/components/TrackPicker';
import {saveMap, useMowerMap, type MowerMap, type Point} from '@/hooks/useMowerMap';
import {useMowerSensors} from '@/hooks/useMowerSensors';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useMowerState} from '@/hooks/useMowerState';
import {useMowerTrack} from '@/hooks/useMowerTrack';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {loadJobTrack, useJobList, useMowHistory, type TrackSegment} from '@/hooks/useMowHistory';
import {measuredStripeAngle, stripeAngleDiff} from '@/lib/mowDirection';
import {autoMowAngle, mowStripes} from '@/lib/mowStripes';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {polygonArea} from '@/lib/geometry';
import {mergeOutlines} from '@/lib/mergeAreas';
import {generateId, splitByPath} from '@/lib/splitPolygon';
import {isDocked} from '@/lib/status';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useState} from 'react';
import styles from './page.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';

const AREA_TYPES = [
  {value: 'mow', label: 'Mowing area', hint: 'driven on and mowed'},
  {value: 'nav', label: 'Navigation area', hint: 'driven on but not mowed, e.g. a path between two lawns'},
  {value: 'obstacle', label: 'Obstacle', hint: 'no-go zone, keep it inside a mowing area'},
  {value: 'draft', label: 'Draft', hint: 'ignored by the mower'},
];

const DEG = Math.PI / 180;

// wraps into -180..180
function normDeg(d: number) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// useSearchParams needs a suspense boundary in a static export
export default function MapPage() {
  return (
    <Suspense>
      <MapEditor />
    </Suspense>
  );
}

function MapEditor() {
  useLang();
  const {state} = useMowerState();
  const position = useMowerPosition() ?? state?.pose;
  const {values: sensorValues} = useMowerSensors();
  const docked = isDocked(state, sensorValues['om_v_charge']);
  const track = useMowerTrack();
  const liveMap = useMowerMap();
  const params = useMowerParams();
  const [showStripes, setShowStripes] = useState(true);
  const pastJobs = useMowHistory();
  const jobList = useJobList();
  // null = live trail, otherwise a recorded job shown instead
  // ?job=<id> (from the activity page) opens that job's track until another one is picked
  const search = useSearchParams();
  const urlJob = search.get('job');
  // ?at=x,y&msg=... from a problem on the activity page: marked on the map with its message
  const at = search.get('at')?.split(',').map(Number);
  const [spotClosed, setSpotClosed] = useState(false);
  const spot = !spotClosed && at?.length === 2 && at.every(Number.isFinite) ? {x: at[0], y: at[1], msg: search.get('msg') ?? ''} : null;
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const jobId = picked === undefined ? urlJob : picked;
  const [loaded, setLoaded] = useState<{id: string; segments: TrackSegment[]} | null>(null);
  const viewJob = jobId ? {id: jobId, segments: loaded?.id === jobId ? loaded.segments : null} : null;
  const showJob = (id: string) => setPicked(id || null);
  const loadingJob = viewJob && !viewJob.segments ? viewJob.id : null;
  useEffect(() => {
    if (!loadingJob) return;
    void loadJobTrack(loadingJob).then((segments) => setLoaded({id: loadingJob, segments}));
  }, [loadingJob]);
  // extra rotation for the preview when the mower drives differently than calculated
  const [previewCorrection, setPreviewCorrection] = useState(0);

  // shows the live map until the first edit, after that our own copy so updates don't overwrite edits
  const [edited, setEdited] = useState<MowerMap | null>(null);
  const map = edited ?? liveMap;
  const setMap = (next: MowerMap | null | ((m: MowerMap | null) => MowerMap | null)) =>
    setEdited((prev) => (typeof next === 'function' ? next(prev ?? liveMap) : next));
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState(false);
  const [mode, setMode] = useState<'idle' | 'split' | 'draw' | 'merge'>('idle');
  const [mergeWithId, setMergeWithId] = useState<string | null>(null);
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  // tolerance in cm while the simplify preview is open
  const [simplifyCm, setSimplifyCm] = useState<number | null>(null);
  const [history, setHistory] = useState<MowerMap[]>([]);
  // delete needs a second click, id of the area that's armed
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // outlines before the first reduce, so the slider can go back up
  const [originals, setOriginals] = useState<Record<string, Point[]>>({});

  const selectedArea = map?.areas.find((a) => a.id === selectedAreaId) ?? null;
  const baseOutline = selectedArea ? (originals[selectedArea.id] ?? selectedArea.outline) : null;
  const simplified =
    baseOutline && simplifyCm !== null
      ? simplifyCm === 0
        ? baseOutline
        : simplifyPolygon(baseOutline, simplifyCm / 100)
      : null;
  const shownMap =
    map && selectedArea && simplified
      ? {...map, areas: map.areas.map((a) => (a.id === selectedArea.id ? {...a, outline: simplified} : a))}
      : map;

  const toolWidth = numParam(params, '/mower_logic/tool_width');
  const angleOffset = numParam(params, '/mower_logic/mow_angle_offset') ?? 0;
  const offsetIsAbsolute = params['/mower_logic/mow_angle_offset_is_absolute'] === true;
  const angleIncrement = numParam(params, '/mower_logic/mow_angle_increment') ?? 0;
  const shownArea = shownMap?.areas.find((a) => a.id === selectedAreaId) ?? null;
  const isMowArea = shownArea?.properties.type === 'mow';
  const autoAngle = shownArea ? autoMowAngle(shownArea.outline) : 0;

  // the angle the planner actually gets, see MowingBehavior.cpp
  const plannedAngle = (area: {properties: {angle?: number}; outline: Point[]}) =>
    offsetIsAbsolute ? angleOffset * DEG : (area.properties.angle ?? autoMowAngle(area.outline)) + angleOffset * DEG;
  const effectiveAngle = shownArea ? plannedAngle(shownArea) + previewCorrection * DEG : 0;

  // check against the last real mow here, a leftover angle increment in checkpoint.bag isn't
  // published anywhere and rotates everything. saved area, not the edited one
  const savedArea = liveMap?.areas.find((a) => a.id === selectedAreaId);
  let mismatch: {measured: number; planned: number; diff: number; date: string} | null = null;
  if (savedArea?.properties.type === 'mow' && pastJobs) {
    const passes = savedArea.properties.outline_count ?? numParam(params, '/mower_logic/outline_count') ?? 0;
    const margin = passes * (toolWidth ?? 0.2) + 0.2;
    // newest mowing stretch first, a job that got interrupted can resume with different settings
    const stretches = pastJobs.flatMap((job) => [...job.segments].reverse().map((seg) => ({job, seg})));
    for (const {job, seg} of stretches) {
      const m = measuredStripeAngle([seg], savedArea.outline, margin);
      if (!m) continue;
      const planned = (((plannedAngle(savedArea) / DEG) % 180) + 180) % 180;
      const diff = stripeAngleDiff(planned, m.angleDeg);
      if (Math.abs(diff) > 8) {
        mismatch = {measured: m.angleDeg, planned, diff, date: new Date(job.timestamp * 1000).toLocaleDateString()};
      }
      break;
    }
  }

  let stripes: [Point, Point][] | undefined;
  if (shownMap && shownArea && isMowArea && showStripes && toolWidth) {
    const holes = shownMap.areas
      .filter((a) => a.properties.type === 'obstacle' && a.properties.active !== false && a.outline.length > 2)
      .map((a) => a.outline);
    stripes = mowStripes(shownArea.outline, holes, effectiveAngle, toolWidth);
  }

  const globalValue = (key: string) => {
    const v = numParam(params, '/mower_logic/' + key);
    return v === undefined ? 'global' : `global ${v}`;
  };

  const setOverride = (key: 'outline_count' | 'outline_overlap_count' | 'outline_offset', raw: string) => {
    const v = raw.trim() === '' ? undefined : Number(raw);
    if (v !== undefined && !Number.isFinite(v)) return;
    updateProperties({[key]: v}, false);
  };

  const selectArea = (id: string) => {
    if (mode === 'merge') {
      if (id !== selectedAreaId) setMergeWithId(id);
      return;
    }
    setSelectedAreaId(id);
    setSimplifyCm(null);
  };

  const deselect = () => {
    if (mode !== 'idle') return;
    setSelectedAreaId(null);
    setSimplifyCm(null);
  };

  // call before every change so it can be undone
  const remember = () => {
    if (map) setHistory((h) => [...h.slice(-49), map]);
  };

  const undo = () => {
    if (!history.length) return;
    setMap(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSimplifyCm(null);
    setMode('idle');
    setPendingPoints([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
        if (mode !== 'idle') cancelPicking();
        else deselect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const applySimplify = () => {
    if (shownMap && selectedArea) {
      remember();
      if (!originals[selectedArea.id]) setOriginals({...originals, [selectedArea.id]: selectedArea.outline});
      setMap(shownMap);
    }
    setSimplifyCm(null);
  };

  const updateProperties = (patch: Partial<MowerMap['areas'][number]['properties']>, undoable = true) => {
    if (!map || !selectedArea) return;
    if (undoable) remember();
    setMap({
      ...map,
      areas: map.areas.map((a) => (a.id === selectedArea.id ? {...a, properties: {...a.properties, ...patch}} : a)),
    });
  };

  const deleteArea = () => {
    if (!map || !selectedArea) return;
    if (confirmDelete !== selectedArea.id) {
      setConfirmDelete(selectedArea.id);
      return;
    }
    remember();
    setMap({...map, areas: map.areas.filter((a) => a.id !== selectedArea.id)});
    setSelectedAreaId(null);
    setConfirmDelete(null);
  };

  // the mower goes through the mow areas in the order they have in map.json
  const mowAreas = map?.areas.filter((a) => a.properties.type === 'mow') ?? [];

  const moveInOrder = (id: string, by: number) => {
    if (!map || !docked) return;
    const order = [...mowAreas];
    const i = order.findIndex((a) => a.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    // only the mow areas swap places, everything else stays where it is
    const slots = map.areas.flatMap((a, k) => (a.properties.type === 'mow' ? [k] : []));
    const areas = [...map.areas];
    slots.forEach((slot, k) => (areas[slot] = order[k]));
    remember();
    setMap({...map, areas});
  };

  const toggleActive = () => updateProperties({active: selectedArea?.properties.active === false});

  const moveVertex = (areaId: string, vertexIndex: number, x: number, y: number) => {
    setMap((prev) =>
      prev
        ? {
            ...prev,
            areas: prev.areas.map((a) =>
              a.id === areaId ? {...a, outline: a.outline.map((p, i) => (i === vertexIndex ? {x, y} : p))} : a,
            ),
          }
        : prev,
    );
  };

  const insertVertex = (areaId: string, vertexIndex: number, x: number, y: number) => {
    remember();
    setMap((prev) =>
      prev
        ? {
            ...prev,
            areas: prev.areas.map((a) =>
              a.id === areaId ? {...a, outline: a.outline.toSpliced(vertexIndex, 0, {x, y})} : a,
            ),
          }
        : prev,
    );
  };

  const deleteVertex = (areaId: string, vertexIndex: number) => {
    remember();
    setMap((prev) =>
      prev
        ? {
            ...prev,
            areas: prev.areas.map((a) => (a.id === areaId ? {...a, outline: a.outline.toSpliced(vertexIndex, 1)} : a)),
          }
        : prev,
    );
  };

  const startSplit = () => {
    setSimplifyCm(null);
    setMode('split');
    setPendingPoints([]);
  };

  const startDraw = () => {
    setSelectedAreaId(null);
    setSimplifyCm(null);
    setMode('draw');
    setPendingPoints([]);
  };

  function cancelPicking() {
    setMode('idle');
    setPendingPoints([]);
    setMergeWithId(null);
  }

  const mergeWith = map?.areas.find((a) => a.id === mergeWithId) ?? null;
  const merged = mode === 'merge' && selectedArea && mergeWith ? mergeOutlines(selectedArea.outline, mergeWith.outline) : null;

  const applyMerge = () => {
    if (!map || !selectedArea || !mergeWith || !merged) return;
    const area = {...selectedArea, id: generateId(), outline: merged.outline};
    remember();
    setMap({
      ...map,
      areas: [...map.areas.filter((a) => a.id !== selectedArea.id && a.id !== mergeWith.id), area],
    });
    setSelectedAreaId(area.id);
    cancelPicking();
  };

  const finishDraw = () => {
    if (!map || pendingPoints.length < 3) return;
    const newArea = {
      id: generateId(),
      properties: {type: 'mow', active: true},
      outline: pendingPoints,
    };
    remember();
    setMap({...map, areas: [...map.areas, newArea]});
    setSelectedAreaId(newArea.id);
    setMode('idle');
    setPendingPoints([]);
  };

  const handleCanvasClick = (x: number, y: number) => {
    if (mode === 'draw') {
      setPendingPoints((prev) => [...prev, {x, y}]);
      return;
    }

    if (mode === 'split') setPendingPoints((prev) => [...prev, {x, y}]);
  };

  const splitPreview = mode === 'split' && selectedArea ? splitByPath(selectedArea.outline, pendingPoints) : null;

  const applySplit = () => {
    if (!map || !selectedArea || !splitPreview) return;
    const [outlineA, outlineB] = splitPreview;
    const name = selectedArea.properties.name;
    const areaA = {...selectedArea, id: generateId(), outline: outlineA};
    const areaB = {
      ...selectedArea,
      id: generateId(),
      outline: outlineB,
      properties: {...selectedArea.properties, name: name ? `${name} 2` : name},
    };
    remember();
    setMap({
      ...map,
      areas: map.areas.flatMap((a) => (a.id === selectedArea.id ? [areaA, areaB] : [a])),
    });
    setSelectedAreaId(areaA.id);
    setMode('idle');
    setPendingPoints([]);
  };

  const handleSave = async () => {
    if (!map) return;
    // saving while the mower is out can make it lose track of the area it's on, ask first
    if (!docked && !saveWarning) {
      setSaveWarning(true);
      return;
    }
    setSaveWarning(false);
    setSaving(true);
    setSaveError(null);
    try {
      await saveMap(map);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tr('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>
          <TitleMark />
          {tr('Map')}
        </h1>

        <div className={styles.editor}>
          <div className={styles.mapCol}>
            {spot && (
              <div className={styles.spot}>
                <span>{spot.msg || tr('Marked spot')}</span>
                <button onClick={() => setSpotClosed(true)} aria-label="close">
                  ×
                </button>
              </div>
            )}
            {shownMap && (
              <MapView
                zoomable
                map={shownMap}
                mower={position}
                track={viewJob ? undefined : track}
                pastTrack={viewJob?.segments?.map((s) => ({
                  points: s.points.map(([x, y]) => ({x, y})),
                  blades: !!s.attributes.blades,
                }))}
                selectedAreaId={selectedAreaId}
                onSelectArea={selectArea}
                onMoveVertex={simplifyCm === null && mode === 'idle' ? moveVertex : undefined}
                onDragStart={remember}
                onInsertVertex={simplifyCm === null ? insertVertex : undefined}
                onDeleteVertex={simplifyCm === null ? deleteVertex : undefined}
                pickingPoints={mode === 'split' || mode === 'draw'}
                onClickEmpty={deselect}
                datum={datumFromParams(params)}
                orderLabels={
                  mowAreas.length > 1 && !selectedArea
                    ? Object.fromEntries(mowAreas.map((a, i) => [a.id, i + 1]))
                    : undefined
                }
                pendingPoints={pendingPoints}
                onCanvasClick={handleCanvasClick}
                onMovePending={(i, x, y) => setPendingPoints((prev) => prev.map((p, j) => (j === i ? {x, y} : p)))}
                onInsertPending={(i, x, y) => setPendingPoints((prev) => prev.toSpliced(i, 0, {x, y}))}
                stripes={stripes}
                preview={splitPreview ?? (merged ? [merged.outline] : undefined)}
                markers={spot ? [spot] : undefined}
                focus={spot ?? undefined}
              />
            )}

            {!map && <p className={styles.dim}>{tr('waiting for map…')}</p>}
          </div>

          <div className={styles.panel}>
            {map && (
              <div className={styles.inlineRow}>
                {mode === 'idle' && (
                  <>
                    <button className={styles.pillButton} onClick={startDraw}>
                      {tr('Draw area')}
                    </button>
                    {/* recording adds the area on the mower, unsaved edits here would overwrite it */}
                    {history.length ? (
                      <span className={[styles.pillButton, styles.disabledLink].join(' ')} title={tr('Save or undo your changes first')}>
                        {tr('Record by driving')}
                      </span>
                    ) : (
                      <Link href="/record" className={styles.pillButton}>
                        {tr('Record by driving')}
                      </Link>
                    )}
                  </>
                )}
                <button className={styles.pillButton} onClick={undo} disabled={!history.length}>
                  {tr('Undo')}
                </button>
                <button className={styles.pillButton} onClick={() => void handleSave()} disabled={saving}>
                  {saving ? tr('saving…') : saveWarning && !docked ? tr('Save anyway') : tr('Save map')}
                </button>
                {saveError && <span className={styles.error}>{saveError}</span>}
              </div>
            )}

            {saveWarning && !docked && (
              <div className={styles.warning}>
                <p>
                  {tr("The mower isn't idle in the dock. Changing the map during a job can make it lose track of the area it's mowing and stop the job. Better save once it's back in the dock.")}
                </p>
                <a onClick={() => setSaveWarning(false)}>{tr("don't save for now")}</a>
              </div>
            )}

            {map && !selectedArea && mode === 'idle' && (
              <>
                <p className={styles.dim}>{tr('Click an area to edit it.')}</p>
                {jobList && jobList.length > 0 && (
                  <TrackPicker
                    jobs={jobList}
                    selected={viewJob?.id ?? null}
                    segments={viewJob?.segments}
                    onSelect={(id) => showJob(id ?? '')}
                  />
                )}
                {mowAreas.length > 1 && (
                  <div className={styles.orderBox}>
                    <span className={styles.orderTitle}>
                      {tr('Mowing order')}
                      <InfoTip>
                        {tr("The mower mows the areas in this order. Can only be changed while it's idle in the dock.")}
                      </InfoTip>
                    </span>
                    {!docked && (
                      <span className={styles.dim}>{tr('Can only be changed while the mower is idle in the dock.')}</span>
                    )}
                    {mowAreas.map((a, i) => (
                      <div key={a.id} className={styles.orderRow}>
                        <span className={styles.orderNum}>{i + 1}</span>
                        <a onClick={() => selectArea(a.id)}>
                          {a.properties.name || tr('unnamed')}
                          {a.properties.active === false && <span className={styles.dim}> ({tr('inactive')})</span>}
                        </a>
                        <button
                          className={styles.pillButton}
                          onClick={() => moveInOrder(a.id, -1)}
                          disabled={i === 0 || !docked}
                          aria-label="earlier"
                        >
                          ↑
                        </button>
                        <button
                          className={styles.pillButton}
                          onClick={() => moveInOrder(a.id, 1)}
                          disabled={i === mowAreas.length - 1 || !docked}
                          aria-label="later"
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {mode === 'split' && (
              <div className={styles.splitBox}>
                <p className={styles.dim}>
                  {tr("Click points to draw a cut line across the area, it can bend. Start and end outside of it. Drag points to move them, drag the middle of a segment to add one.")}
                </p>
                {splitPreview ? (
                  <p>
                    <span className={styles.pieceA}>{fmt(polygonArea(splitPreview[0]), 1)} m²</span> {tr('and')}{' '}
                    <span className={styles.pieceB}>{fmt(polygonArea(splitPreview[1]), 1)} m²</span>
                  </p>
                ) : (
                  pendingPoints.length >= 2 && <p className={styles.dim}>{tr("The line doesn't cut through the area yet.")}</p>
                )}
                <div className={styles.inlineRow}>
                  <button className={styles.pillButton} onClick={applySplit} disabled={!splitPreview}>
                    {tr('Apply split')}
                  </button>
                  <button
                    className={styles.pillButton}
                    onClick={() => setPendingPoints(pendingPoints.slice(0, -1))}
                    disabled={!pendingPoints.length}
                  >
                    {tr('Remove last point')}
                  </button>
                  <button className={styles.pillButton} onClick={cancelPicking}>
                    {tr('Cancel')}
                  </button>
                </div>
              </div>
            )}

            {mode === 'merge' && selectedArea && (
              <div className={styles.splitBox}>
                <p className={styles.dim}>
                  {tr("Click the area to merge into {name}. The result keeps its name, type and settings.", {name: selectedArea.properties.name || tr('this one')})}
                </p>
                {mergeWith && merged && (
                  <p>
                    {selectedArea.properties.name || tr('unnamed')} + {mergeWith.properties.name || tr('unnamed')} ={' '}
                    <span className={styles.pieceA}>{fmt(polygonArea(merged.outline), 1)} m²</span>
                    {merged.holesFilled > 0 && tr(', the gap enclosed between them gets filled in')}
                    {mergeWith.properties.type !== selectedArea.properties.type &&
                      tr(', careful: {name} is a different type', {name: mergeWith.properties.name || tr('it')})}
                  </p>
                )}
                {mergeWith && !merged && (
                  <p className={styles.error}>{tr("These two don't touch, there'd be two separate pieces.")}</p>
                )}
                <div className={styles.inlineRow}>
                  <button className={styles.pillButton} onClick={applyMerge} disabled={!merged}>
                    {tr('Apply merge')}
                  </button>
                  <button className={styles.pillButton} onClick={cancelPicking}>
                    {tr('Cancel')}
                  </button>
                </div>
              </div>
            )}

            {mode === 'draw' && (
              <div className={styles.inlineRow}>
                <span className={styles.dim}>{tr('Click points to draw the outline ({n} so far), drag them to move', {n: pendingPoints.length})}</span>
                <button className={styles.pillButton} onClick={finishDraw} disabled={pendingPoints.length < 3}>
                  {tr('Finish')}
                </button>
                <button className={styles.pillButton} onClick={cancelPicking}>
                  {tr('Cancel')}
                </button>
              </div>
            )}

            {selectedArea && mode === 'idle' && (
              <div className={styles.areaEditor}>
                <input
                  className={styles.nameInput}
                  value={selectedArea.properties.name ?? ''}
                  placeholder={tr('unnamed')}
                  // one undo step per rename, not per keystroke
                  onFocus={remember}
                  onChange={(e) => updateProperties({name: e.target.value}, false)}
                />
                <select
                  className={styles.typeSelect}
                  value={selectedArea.properties.type ?? 'draft'}
                  onChange={(e) => updateProperties({type: e.target.value})}
                >
                  {AREA_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {tr(t.label)}
                    </option>
                  ))}
                </select>
                <span className={styles.dim}>{tr('{n} points', {n: selectedArea.outline.length})}</span>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={selectedArea.properties.active !== false} onChange={toggleActive} />
                  {tr('active')}
                  <InfoTip>
                    {tr("Inactive areas are ignored by the mower. Careful with mowing areas: an inactive one is also no longer drivable, so the mower gets stuck if it stands on it.")}
                  </InfoTip>
                </label>
                <span className={styles.withTip}>
                  <button className={styles.pillButton} onClick={startSplit}>
                    {tr('Split zone')}
                  </button>
                  <InfoTip>
                    {tr("Cuts the area in two along a line through two points you click. Both halves keep the type and settings.")}
                  </InfoTip>
                </span>
                <span className={styles.withTip}>
                  <button
                    className={styles.pillButton}
                    onClick={() => {
                      setSimplifyCm(null);
                      setMode('merge');
                    }}
                  >
                    {tr('Merge')}
                  </button>
                  <InfoTip>
                    {tr("Joins this area with another one you click, e.g. two halves of a lawn. They need to overlap or touch.")}
                  </InfoTip>
                </span>
                <button
                  className={[styles.pillButton, styles.danger].join(' ')}
                  onClick={deleteArea}
                  onBlur={() => setConfirmDelete(null)}
                >
                  {confirmDelete === selectedArea.id ? tr('Really delete?') : tr('Delete area')}
                </button>
                {simplifyCm === null && (
                  <span className={styles.withTip}>
                    <button className={styles.pillButton} onClick={() => setSimplifyCm(5)}>
                      {tr('Reduce points')}
                    </button>
                    <InfoTip>
                      {tr("Recorded outlines have a point every few cm. This drops the ones that hardly change the shape, you pick how far the new outline may be off. You can go back up with the slider until you reload the page.")}
                    </InfoTip>
                  </span>
                )}
              </div>
            )}

            {selectedArea && mode === 'idle' && (
              <p className={styles.dim}>
                {tr(AREA_TYPES.find((t) => t.value === (selectedArea.properties.type ?? 'draft'))?.hint ?? '')}
              </p>
            )}

            {selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow' && (
              <div className={styles.mowSettings}>
                <label>
                  <span>
                    {tr('Outline passes')}
                    <InfoTip>
                      {tr("How many rounds the mower drives along the edge before it mows the inside in stripes. Empty means the mower's global setting.")}
                    </InfoTip>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={selectedArea.properties.outline_count ?? ''}
                    placeholder={globalValue('outline_count')}
                    onFocus={remember}
                    onChange={(e) => setOverride('outline_count', e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {tr('Overlapping passes')}
                    <InfoTip>
                      {tr("How many of the edge rounds the stripes reach into, so no uncut strip is left between the edge and the stripes.")}
                    </InfoTip>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={selectedArea.properties.outline_overlap_count ?? ''}
                    placeholder={globalValue('outline_overlap_count')}
                    onFocus={remember}
                    onChange={(e) => setOverride('outline_overlap_count', e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {tr('Outline offset (m)')}
                    <InfoTip>
                      {tr("Moves the mowing boundary in (positive, more distance to beds and walls) or out (negative). -1 to 1 m.")}
                    </InfoTip>
                  </span>
                  <input
                    type="number"
                    step={0.05}
                    value={selectedArea.properties.outline_offset ?? ''}
                    placeholder={globalValue('outline_offset')}
                    onFocus={remember}
                    onChange={(e) => setOverride('outline_offset', e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {tr('Mow angle (°)')}
                    <InfoTip>
                      {tr("Direction of the stripes, 0° is east, counter-clockwise. Empty means auto: the direction from the first outline point to the first one more than 2 m away. The mower adds its mow_angle_offset on top.")}
                    </InfoTip>
                  </span>
                  <input
                    type="number"
                    step={1}
                    min={-180}
                    max={180}
                    value={selectedArea.properties.angle !== undefined ? Math.round(selectedArea.properties.angle / DEG) : ''}
                    placeholder={tr('auto {n}', {n: Math.round(autoAngle / DEG)})}
                    onFocus={remember}
                    onChange={(e) =>
                      updateProperties(
                        {angle: e.target.value.trim() === '' ? undefined : normDeg(Number(e.target.value)) * DEG},
                        false,
                      )
                    }
                  />
                </label>
                <div className={styles.angleRow}>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round((selectedArea.properties.angle ?? autoAngle) / DEG)}
                    onPointerDown={remember}
                    onChange={(e) => updateProperties({angle: Number(e.target.value) * DEG}, false)}
                  />
                  <button
                    className={styles.pillButton}
                    disabled={selectedArea.properties.angle === undefined}
                    onClick={() => updateProperties({angle: undefined})}
                  >
                    {tr('Auto')}
                  </button>
                </div>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={showStripes} onChange={() => setShowStripes(!showStripes)} />
                  {tr('show mowing direction')}
                  {toolWidth ? ` (${tr('{n} cm apart', {n: Math.round(toolWidth * 100)})})` : ''}
                  <InfoTip>
                    {tr("Stripes one mower width apart, direction and spacing like the real plan. The rounds along the edge aren't drawn, so the stripes go all the way to the outline here.")}
                  </InfoTip>
                </label>
                {mismatch && (
                  <div className={styles.warning}>
                    <p>
                      {tr("The last mow here ({date}) ran at about {measured}°, but with the saved settings it should be {planned}° ({diff}°).", {
                        date: mismatch.date,
                        measured: Math.round(mismatch.measured),
                        planned: Math.round(mismatch.planned),
                        diff: (mismatch.diff > 0 ? '+' : '') + Math.round(mismatch.diff),
                      })}
                    </p>
                    <p>
                      {tr("If you changed the angle since then, ignore this. Otherwise the mower most likely still has an angle increment summed up in checkpoint.bag from a time when mow_angle_increment was set. It adds that on top and never shows it anywhere. To get rid of it, while the mower is docked and idle: delete")}{' '}
                      <code>~/ros/checkpoint.bag</code> {tr("on the mower and run")}{' '}
                      <code>openmower restart</code>.
                    </p>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={previewCorrection !== 0}
                        onChange={() => setPreviewCorrection(previewCorrection ? 0 : Math.round(mismatch.diff))}
                      />
                      {tr('turn the preview by {n}° to match', {n: Math.round(mismatch.diff)})}
                    </label>
                  </div>
                )}
                {(angleOffset !== 0 || offsetIsAbsolute || angleIncrement !== 0) && (
                  <p className={styles.dim}>
                    {offsetIsAbsolute
                      ? tr('mow_angle_offset_is_absolute is set on the mower, it always mows at {n}° and ignores this angle.', {n: angleOffset})
                      : angleOffset !== 0
                        ? tr('The mower adds its mow_angle_offset of {n}°, the preview includes it.', {n: angleOffset})
                        : ''}
                    {angleIncrement !== 0 && ' ' + tr('It also turns by {n}° after every full mow, the preview shows the first one.', {n: angleIncrement})}
                  </p>
                )}
              </div>
            )}

            {selectedArea && simplified && simplifyCm !== null && (
              <div className={styles.inlineRow}>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={simplifyCm}
                  onChange={(e) => setSimplifyCm(Number(e.target.value))}
                />
                <span className={styles.dim}>
                  {simplifyCm === 0 ? tr('all points') : tr('max. {n} cm off', {n: simplifyCm})} · {baseOutline?.length} →{' '}
                  {tr('{n} points', {n: simplified.length})}
                </span>
                <button className={styles.pillButton} onClick={applySimplify}>
                  {tr('Apply')}
                </button>
                <button className={styles.pillButton} onClick={() => setSimplifyCm(null)}>
                  {tr('Cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
