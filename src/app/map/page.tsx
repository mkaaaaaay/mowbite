'use client';

import {TitleMark} from '@/components/Logo';
import MapView from '@/components/MapView';
import TrackPicker from '@/components/TrackPicker';
import {saveMap, useMowerMap, type MowerMap, type Point} from '@/hooks/useMowerMap';
import {useMowerSensors} from '@/hooks/useMowerSensors';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useMowerState} from '@/hooks/useMowerState';
import {clearTrack, useMowerTrack} from '@/hooks/useMowerTrack';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {loadJobTrack, useJobList, useMowHistory, type TrackSegment} from '@/hooks/useMowHistory';
import {measuredStripeAngle, stripeAngleDiff} from '@/lib/mowDirection';
import {autoMowAngle} from '@/lib/mowStripes';
import {linkStripes, mowPlan, type MowPlan} from '@/lib/mowPlan';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {mergeOutlines} from '@/lib/mergeAreas';
import {generateId, splitByPath} from '@/lib/splitPolygon';
import {isDocked} from '@/lib/status';
import {useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useMemo, useState} from 'react';
import styles from './page.module.css';
import {tr, useLang} from '@/lib/i18n';
import MapBackups, {backupLabel} from '@/components/MapBackups';
import {angleChangedSince, deleteBackup, listBackups, loadBackup, saveBackup, type BackupInfo} from '@/lib/backups';
import AreaCard from './AreaCard';
import {DEG, type UpdateArea} from './editing';
import EditorToolbar from './EditorToolbar';
import MowSettings, {AngleOnMap, type AngleMismatch} from './MowSettings';
import OrderBox from './OrderBox';
import {DrawPanel, MergePanel, RestorePanel, SimplifyPanel, SplitPanel} from './Panels';
import {PARAM} from '@/lib/openmower';
import {rpcErrorText} from '@/lib/rpcText';
import {closedRings} from '@/lib/rings';
import {mowerPlan} from '@/lib/areaPlan';

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
  const simplified = useMemo(
    () =>
      baseOutline && simplifyCm !== null
        ? simplifyCm === 0
          ? baseOutline
          : simplifyPolygon(baseOutline, simplifyCm / 100)
        : null,
    [baseOutline, simplifyCm],
  );
  // kept the same object between renders, the plan below is only worked out again when it changes
  const shownMap = useMemo(
    () =>
      map && selectedArea && simplified
        ? {...map, areas: map.areas.map((a) => (a.id === selectedArea.id ? {...a, outline: simplified} : a))}
        : map,
    [map, selectedArea, simplified],
  );

  const toolWidth = numParam(params, PARAM.toolWidth);
  const angleOffset = numParam(params, PARAM.mowAngleOffset) ?? 0;
  const offsetIsAbsolute = params[PARAM.mowAngleOffsetIsAbsolute] === true;
  const angleIncrement = numParam(params, PARAM.mowAngleIncrement) ?? 0;
  const shownArea = shownMap?.areas.find((a) => a.id === selectedAreaId) ?? null;
  const isMowArea = shownArea?.properties.type === 'mow';
  const autoAngle = shownArea ? autoMowAngle(shownArea.outline) : 0;

  // the angle the planner actually gets, see MowingBehavior.cpp
  const plannedAngle = (area: {properties: {angle?: number}; outline: Point[]}) =>
    offsetIsAbsolute ? angleOffset * DEG : (area.properties.angle ?? autoMowAngle(area.outline)) + angleOffset * DEG;

  // check against the last real mow here, a leftover angle increment in checkpoint.bag isn't
  // published anywhere and rotates everything. saved area, not the edited one
  const savedArea = liveMap?.areas.find((a) => a.id === selectedAreaId);
  let mismatch: AngleMismatch | null = null;
  if (savedArea?.properties.type === 'mow' && pastJobs) {
    const passes = savedArea.properties.outline_count ?? numParam(params, PARAM.outlineCount) ?? 0;
    const margin = passes * (toolWidth ?? 0.2) + 0.2;
    // newest mowing stretch first, a job that got interrupted can resume with different settings
    const stretches = pastJobs.flatMap((job) => [...job.segments].reverse().map((seg) => ({job, seg})));
    for (const {job, seg} of stretches) {
      const m = measuredStripeAngle([seg], savedArea.outline, margin);
      if (!m) continue;
      const planned = (((plannedAngle(savedArea) / DEG) % 180) + 180) % 180;
      const diff = stripeAngleDiff(planned, m.angleDeg);
      if (Math.abs(diff) > 8) {
        mismatch = {
          measured: m.angleDeg,
          planned,
          diff,
          date: new Date(job.timestamp * 1000).toLocaleDateString(),
          since: job.timestamp,
        };
      }
      break;
    }
  }
  // not a leftover in checkpoint.bag if the angle got changed on purpose since that mow: a backup from after it
  // (made before a save) has a different one
  const mismatchKey = mismatch && savedArea ? `${savedArea.id} ${mismatch.since} ${savedArea.properties.angle}` : '';
  const [changedOnPurpose, setChangedOnPurpose] = useState<string | null>(null);
  useEffect(() => {
    if (!mismatchKey) return;
    const [id, since, angle] = mismatchKey.split(' ');
    let alive = true;
    void angleChangedSince(id, Number(since), angle === 'undefined' ? undefined : Number(angle)).then(
      (changed) => alive && changed && setChangedOnPurpose(mismatchKey),
    );
    return () => {
      alive = false;
    };
  }, [mismatchKey]);
  if (mismatchKey && changedOnPurpose === mismatchKey) mismatch = null;
  const effectiveAngle = shownArea ? plannedAngle(shownArea) + (mismatch ? previewCorrection : 0) * DEG : 0;

  // the real plan from the mower when it offers one, only for the saved map (no local edits)
  const [fromMower, setFromMower] = useState<{areaId: string; plan: MowPlan | null} | null>(null);
  const askMower = showStripes && isMowArea && !!selectedAreaId && history.length === 0;
  useEffect(() => {
    if (!askMower || !selectedAreaId) return;
    let alive = true;
    void mowerPlan(selectedAreaId).then(
      (plan) => alive && setFromMower({areaId: selectedAreaId, plan}),
      () => alive && setFromMower({areaId: selectedAreaId, plan: null}),
    );
    return () => {
      alive = false;
    };
  }, [askMower, selectedAreaId, liveMap]);
  const realPlan = askMower && fromMower?.areaId === selectedAreaId ? fromMower.plan : null;

  // otherwise where the mower will drive, worked out like its planner does (lib/mowPlan)
  const wantPlan = !!(shownMap && shownArea && isMowArea && showStripes && toolWidth);
  const plan = useMemo((): MowPlan | undefined => {
    if (realPlan) return realPlan;
    if (!wantPlan || !shownMap || !shownArea || !toolWidth) return undefined;
    const holes = shownMap.areas
      .filter((a) => a.properties.type === 'obstacle' && a.properties.active !== false && a.outline.length > 2)
      .map((a) => a.outline);
    const p = shownArea.properties;
    const global = (key: string) => numParam(params, PARAM.mowerLogic(key));
    return mowPlan({
      outline: shownArea.outline,
      holes,
      outlineOffset: p.outline_offset ?? global('outline_offset') ?? 0,
      outlineCount: p.outline_count ?? global('outline_count') ?? 0,
      overlapCount: p.outline_overlap_count ?? global('outline_overlap_count') ?? 0,
      toolWidth,
      angle: effectiveAngle,
    });
  }, [realPlan, wantPlan, shownMap, shownArea, toolWidth, params, effectiveAngle]);

  // the mower's own plan comes already joined up, the estimate gets its zigzags here
  const stripes = useMemo(
    () =>
      plan && (realPlan ? plan.stripes : toolWidth ? linkStripes(plan.stripes, effectiveAngle, toolWidth) : undefined),
    [plan, realPlan, toolWidth, effectiveAngle],
  );

  const globalValue = (key: string) => {
    const v = numParam(params, PARAM.mowerLogic(key));
    return v === undefined ? 'global' : `global ${v}`;
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

  const updateProperties: UpdateArea = (patch, undoable = true) => {
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

  // backups of the map kept in the container, and one shown instead of the editor
  const [backups, setBackups] = useState<BackupInfo[] | null | undefined>(undefined);
  const [preview, setPreview] = useState<{map: MowerMap; label: string} | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const refreshBackups = () => listBackups().then(setBackups);
  useEffect(() => {
    void listBackups().then(setBackups);
  }, []);
  const closePreview = () => {
    setPreview(null);
    setConfirmRestore(false);
    setRestoreError(null);
  };
  const restore = async () => {
    if (!preview) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      if (backups && liveMap) await saveBackup(liveMap, 'before restoring', true);
      await saveMap(preview.map);
      setEdited(null);
      setHistory([]);
      setSelectedAreaId(null);
      closePreview();
      void refreshBackups();
    } catch (e) {
      setRestoreError(rpcErrorText(e));
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };
  // a backup, or the map as it is on the mower right now, as a file
  const download = async (b: BackupInfo | null) => {
    const m = b ? await loadBackup(b.id) : liveMap;
    if (!m) return;
    const t = new Date((b ? b.t : Date.now() / 1000) * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(closedRings(m), null, 2)], {type: 'application/json'}));
    a.download = `mowbite-map-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
      // the version on the mower goes into the backups first, so every save can be undone
      if (backups && liveMap) await saveBackup(liveMap, 'before saving', true).catch(() => {});
      await saveMap(map);
      // back to the live map, it comes back from the mower with what was just saved
      setEdited(null);
      setHistory([]);
      void refreshBackups();
    } catch (e) {
      setSaveError(rpcErrorText(e));
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
            {preview && (
              <div className={styles.previewBar}>
                <span>{tr('Preview: {what}', {what: preview.label})}</span>
                <button onClick={closePreview} aria-label="close">
                  ×
                </button>
              </div>
            )}
            {preview && <MapView zoomable map={preview.map} mower={position} datum={datumFromParams(params)} />}
            {!preview && shownMap && (
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
                onDragCancel={undo}
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
                loops={plan?.loops}
                preview={splitPreview ?? (merged ? [merged.outline] : undefined)}
                markers={spot ? [spot] : undefined}
                focus={spot ?? undefined}
              />
            )}

            {!preview && selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow' && (
              <AngleOnMap area={selectedArea} autoAngle={autoAngle} remember={remember} update={updateProperties} />
            )}


            {!map && <p className={styles.dim}>{tr('waiting for map…')}</p>}
          </div>

          <div className={styles.panel}>
            {preview ? (
              <RestorePanel
                areas={preview.map.areas.length}
                docked={docked}
                restoring={restoring}
                confirm={confirmRestore}
                error={restoreError}
                onRestore={() => (confirmRestore ? void restore() : setConfirmRestore(true))}
                onDisarm={() => setConfirmRestore(false)}
                onClose={closePreview}
              />
            ) : (
              <>
              {map && (
                <EditorToolbar
                  idle={mode === 'idle'}
                  unsaved={history.length > 0}
                  saving={saving}
                  saveLabel={saving ? tr('saving…') : saveWarning && !docked ? tr('Save anyway') : tr('Save map')}
                  saveError={saveError}
                  onDraw={startDraw}
                  onUndo={undo}
                  onSave={() => void handleSave()}
                />
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
                      onClearLive={track.length > 1 ? () => void clearTrack() : undefined}
                    />
                  )}
                  {mowAreas.length > 1 && (
                    <OrderBox areas={mowAreas} docked={docked} onSelect={selectArea} onMove={moveInOrder} />
                  )}

                  <MapBackups
                    backups={backups ?? null}
                    onCreate={async (name) => {
                      if (!liveMap) return;
                      await saveBackup(liveMap, name, false);
                      await refreshBackups();
                    }}
                    onPreview={(b) =>
                      void loadBackup(b.id).then(
                        (m) => setPreview({map: m, label: backupLabel(b)}),
                        () => setRestoreError(tr('failed')),
                      )
                    }
                    onDelete={(b) => void deleteBackup(b.id).then(refreshBackups)}
                    onDownload={(b) => void download(b)}
                    onFile={(m, name) => setPreview({map: m, label: name})}
                  />
                </>
              )}

              {mode === 'split' && (
                <SplitPanel
                  preview={splitPreview}
                  points={pendingPoints.length}
                  onApply={applySplit}
                  onRemoveLast={() => setPendingPoints(pendingPoints.slice(0, -1))}
                  onCancel={cancelPicking}
                />
              )}

              {mode === 'merge' && selectedArea && (
                <MergePanel area={selectedArea} other={mergeWith} merged={merged} onApply={applyMerge} onCancel={cancelPicking} />
              )}

              {mode === 'draw' && <DrawPanel points={pendingPoints.length} onFinish={finishDraw} onCancel={cancelPicking} />}

              {selectedArea && mode === 'idle' && (
                <AreaCard
                  area={selectedArea}
                  showTools={simplifyCm === null}
                  confirmDelete={confirmDelete === selectedArea.id}
                  remember={remember}
                  update={updateProperties}
                  onSplit={startSplit}
                  onMerge={() => {
                    setSimplifyCm(null);
                    setMode('merge');
                  }}
                  onSimplify={() => setSimplifyCm(5)}
                  onDelete={deleteArea}
                  onDeleteBlur={() => setConfirmDelete(null)}
                />
              )}

              {selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow' && (
                <MowSettings
                  area={selectedArea}
                  autoAngle={autoAngle}
                  globalValue={globalValue}
                  remember={remember}
                  update={updateProperties}
                  showStripes={showStripes}
                  onToggleStripes={() => setShowStripes(!showStripes)}
                  toolWidth={toolWidth}
                  mismatch={mismatch}
                  previewCorrection={previewCorrection}
                  planFromMower={!!realPlan}
                  onPreviewCorrection={setPreviewCorrection}
                  angle={{offset: angleOffset, offsetIsAbsolute, increment: angleIncrement}}
                />
              )}

              {selectedArea && simplified && simplifyCm !== null && (
                <SimplifyPanel
                  cm={simplifyCm}
                  from={baseOutline?.length ?? 0}
                  to={simplified.length}
                  onChange={setSimplifyCm}
                  onApply={applySimplify}
                  onCancel={() => setSimplifyCm(null)}
                />
              )}

              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
