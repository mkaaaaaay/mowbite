'use client';

import {TitleMark} from '@/components/Logo';
import MapView from '@/components/MapView';
import TrackPicker from '@/components/TrackPicker';
import {saveMap, useMowerMap, type MowerMap, type Point} from '@/hooks/useMowerMap';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useDocked, useMowerStateValue} from '@/hooks/useMowerState';
import {useEggForced, useUmbrella} from '@/lib/eggs';
import {lastRun as newestRun} from '@/hooks/useRecentRuns';
import {clearTrack, trackPoints, useLastRun, useLastRunJob, useMowerTrack} from '@/hooks/useMowerTrack';
import {useMarginPlaces} from '@/lib/marginCheck';
import {usePlanProgress} from '@/hooks/usePlanProgress';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {loadJobTrack, useJobList, useMowHistory, type TrackSegment} from '@/hooks/useMowHistory';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {mergeOutlines} from '@/lib/mergeAreas';
import {cutOut, generateId, splitByPath} from '@/lib/splitPolygon';
import {useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useMemo, useState, type ComponentProps} from 'react';
import styles from './page.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import MapBackups, {backupLabel} from '@/components/MapBackups';
import {deleteBackup, listBackups, loadBackup, saveBackup, type BackupInfo} from '@/lib/backups';
import AreaCard from './AreaCard';
import {type UpdateArea, NEW_AREA_SETTINGS} from './editing';
import EditorToolbar from './EditorToolbar';
import MowSettings, {AngleOnMap, AreaDirection, AreaPlanInfo, OpenMowerArea} from './MowSettings';
import OrderBox from './OrderBox';
import {DrawPanel, MergePanel, RestorePanel, SimplifyPanel, SplitPanel} from './Panels';
import {PARAM} from '@/lib/openmower';
import {rpcErrorText} from '@/lib/rpcText';
import {closedRings} from '@/lib/rings';
import {saveFile} from '@/lib/saveFile';
import {savePlanCase} from '@/lib/planCase';
import {useAreaProperties} from '@/lib/areaProps';
import {useMowPlan} from './useMowPlan';
import {useMapEdits} from './useMapEdits';
import {checkMap} from '@/lib/mapCheck';
import {narrowPassages} from '@/lib/narrowPassages';
import Problems, {problemText} from './Problems';
import {BodyCheck, PlanChecks} from './BodyCheck';
import {Fold} from './Fold';
import {bodyFrom, slic3rPlans, useMowerBody, usePlannerSettings, type BodySpot} from '@/lib/mowerBody';
import {MowerBodySettings} from '@/components/MowerBodySettings';
import {PlannerSettings} from '@/components/PlannerSettings';
import {PlannerSimple} from '@/components/PlannerSimple';
import simpleStyles from '@/components/PlannerSimple.module.css';
import settingsStyles from '../settings/page.module.css';

// useSearchParams needs a suspense boundary in a static export
// '0' when the map was unpinned on this device
const PINNED_KEY = 'mapPinned';

export default function MapPage() {
  return (
    <Suspense>
      <MapEditor />
    </Suspense>
  );
}

// the map with the mower where it is: its position read here, the editor with all its menus isn't drawn again for every
// move. A mower without position/json: robot_state's pose
function LiveMapView(props: Omit<ComponentProps<typeof MapView>, 'mower'>) {
  const live = useMowerPosition();
  const pose = useMowerStateValue((l) => (live ? null : (l.state?.pose ?? null)));
  return <MapView {...props} mower={live ?? pose ?? undefined} />;
}

function MapEditor() {
  useLang();
  // only what the page needs of the mower's state and sensors: it isn't drawn again for every message that comes in
  const emergency = useMowerStateValue((l) => !!l.state?.emergency);
  const docked = useDocked();
  const track = useMowerTrack();
  const lastRun = useLastRun();
  const lastRunJob = useLastRunJob();
  const liveMap = useMowerMap();
  const params = useMowerParams();
  // while it mows: how far it got with the area's plan, like on the overview (the state only then, it changes every
  // second)
  const mowingState = useMowerStateValue((l) => (l.state?.current_state === 'MOWING' ? l.state : null));
  const progress = usePlanProgress(mowingState, liveMap, undefined);
  // the mower's icon dressed like the eater on the dashboard
  const umbrella = useUmbrella(newestRun());
  const towel = useEggForced('towel');
  const towelNow = towel || (!!progress && Math.round(progress.fraction * 100) === 42);
  // the same object while nothing changes, the map is drawn again only when it does
  const costume = useMemo(() => ({towel: towelNow, umbrella}), [towelNow, umbrella]);
  const {map, edited, setMap, history, remember, undoStep, originals, setOriginals, dirty, external, dropEdits, mergeNote, mergeExternal} =
    useMapEdits(liveMap);
  const [showStripes, setShowStripes] = useState(true);
  // on a phone the map stays at the top while the settings under it scroll, unless it was unpinned on this device
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(PINNED_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const togglePinned = () => {
    setPinned(!pinned);
    try {
      localStorage.setItem(PINNED_KEY, pinned ? '0' : '1');
    } catch {}
  };
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

  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  // only the angle check of a picked area needs them
  const pastJobs = useMowHistory(!!selectedAreaId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState(false);
  const [mode, setMode] = useState<'idle' | 'split' | 'draw' | 'merge'>('idle');
  const [mergeWithId, setMergeWithId] = useState<string | null>(null);
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  // split: the points are a closed shape inside the area to cut out, not a line across it
  const [cutShape, setCutShape] = useState(false);
  // tolerance in cm while the simplify preview is open
  const [simplifyCm, setSimplifyCm] = useState<number | null>(null);
  // delete needs a second click, id of the area that's armed
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);


  // the area settings this mower keeps, mow_around changes the plan
  const areaProps = useAreaProperties();
  const selectedArea = map?.areas.find((a) => a.id === selectedAreaId) ?? null;
  // while an area is edited only its plan shows, the last run's track and its cut strip went at the old settings; the
  // area being mowed keeps its live trail
  const trackShown = viewJob || (selectedArea && progress?.areaId !== selectedAreaId) ? undefined : track;
  // the finished run on the map, a picked one or the last: where the body got into the safety distances
  const marginPlaces = useMarginPlaces(viewJob?.id ?? (trackShown ? lastRunJob : null));
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

  // self crossing outlines, a dock off the drivable areas and the like, also in the preview of reducing points. With a
  // planner that keeps the mower's body off the edges and obstacles: where it doesn't get through between them
  const approachDistance = numParam(params, PARAM.dockingApproachDistance);
  const plannerSettings = usePlannerSettings();
  // OpenMower's slic3r planner switched on in the MowBite Planner: no distances kept, no collision check
  const slic3r = slic3rPlans(plannerSettings);
  const margins = useMemo(() => {
    if (slic3rPlans(plannerSettings)) return null;
    const value = (k: string) => plannerSettings?.settings[k]?.value;
    const sized = ['robot_width', 'robot_front', 'robot_rear'].every((k) => {
      const v = value(k);
      return typeof v === 'number' && v > 0;
    });
    const [edge, obstacle, width] = [value('edge_margin'), value('obstacle_margin'), value('robot_width')];
    return sized && typeof edge === 'number' && typeof obstacle === 'number' ? {edge, obstacle, width: width as number} : null;
  }, [plannerSettings]);
  const problems = useMemo(
    () => (shownMap ? [...checkMap(shownMap, approachDistance), ...(margins ? narrowPassages(shownMap, margins) : [])] : []),
    [shownMap, approachDistance, margins],
  );
  const warnings = problems.filter((p) => p.level === 'warn').length;
  const spotted = problems.flatMap((p) => ('at' in p ? [p] : []));
  const problemSpots = spotted.map((p) => p.at);
  // a red spot tapped on the map: what it is, in words
  const [problemPick, setProblemPick] = useState<number | null>(null);
  const pickedProblem = problemPick !== null && shownMap ? spotted[problemPick] : undefined;

  // not while a point is dragged, a new plan redrawn mid-drag makes it stutter
  const [draggingPoint, setDraggingPoint] = useState(false);
  // the mower's body as the planner knows it, and where it would stick out in the selected area's plan
  const body = useMowerBody();
  // a planner that checks the mower's body in every plan (it has body_fit): what it found shows with the plan
  const collisionMode = !!plannerSettings?.settings.body_fit && !slic3r;
  // a planner that takes the body's sizes and has none: it checks nothing, whatever sizes the app itself draws with
  const unsized = !!plannerSettings?.settings.robot_front && !bodyFrom(plannerSettings);
  const [bodySpots, setBodySpots] = useState<BodySpot[] | null>(null);
  const {toolWidth, angleOffset, offsetIsAbsolute, angleIncrement, shownArea, autoAngle, touchAngle, mismatch, realPlan, plan, stripes, planLength, planRequest} =
    useMowPlan({params, liveMap, shownMap, selectedAreaId, pastJobs, areaProps, showStripes, previewCorrection, draggingPoint});
  // a place of the collision check picked on the map: the body where it would have stuck out, for the plan it's from
  const [fitPick, setFitPick] = useState<{plan: unknown; index: number} | null>(null);
  const fitPlace = fitPick && fitPick.plan === realPlan ? realPlan?.checks?.places[fitPick.index] : undefined;
  const pickedText = (() => {
    const pose = fitPlace?.pose;
    if (!pose) return null;
    const own = selectedArea?.properties.planner ?? {};
    const value = (k: string) => {
      const v = own[k] ?? plannerSettings?.settings[k]?.value;
      return typeof v === 'number' ? v : 0;
    };
    // past the real edge only where it's more than the larger of the distances, the place doesn't tell which one
    const kept = Math.max(value('edge_margin'), value('obstacle_margin')) + (pose.spin ? value('spin_margin') : 0);
    const past = pose.d > kept + 0.005;
    const cm = Math.max(1, Math.round((past ? pose.d - kept : pose.d) * 100));
    const what = past
      ? pose.spin
        ? tr('Turning on the spot here, the mower would have stuck out past the real edge, by {cm} cm at least.', {cm})
        : tr('Here the mower would have stuck out past the real edge, by {cm} cm at least.', {cm})
      : pose.spin
        ? tr('Turning on the spot here, the mower would have come {cm} cm into the safety distance.', {cm})
        : tr('Here the mower would have come {cm} cm into the safety distance.', {cm});
    const then =
      fitPlace!.m > 0
        ? tr('The planner drives another way there and leaves {m} m of loops and lanes out.', {m: fmt(fitPlace!.m, 1)})
        : tr('The planner drives another way there.');
    // (the map draws the body at one heading, turning its corners sweep round)
    const sweep = pose.spin ? ` ${tr('The dashed circle is how far its corners reach while it turns.')}` : '';
    return `${what} ${then}${sweep}`;
  })();

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

  const undo = () => {
    if (!undoStep()) return;
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
    // typing on in a field that kept focus through a save: the first change still gets its undo step
    if (undoable || !edited) remember();
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
    // keeps the id of the selected one like its name and settings, schedules and pauses pick areas by it
    const area = {...selectedArea, outline: merged.outline};
    // in the place of the first of the two, the order in map.json is the mowing order
    const first = map.areas.find((a) => a.id === selectedArea.id || a.id === mergeWith.id)!;
    remember();
    setMap({
      ...map,
      areas: map.areas.flatMap((a) => (a === first ? [area] : a.id === selectedArea.id || a.id === mergeWith.id ? [] : [a])),
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

  const splitPreview: Point[][] | null =
    mode === 'split' && selectedArea
      ? cutShape
        ? cutOut(selectedArea.outline, pendingPoints)
        : splitByPath(selectedArea.outline, pendingPoints)
      : null;

  const applySplit = () => {
    if (!map || !selectedArea || !splitPreview) return;
    const name = selectedArea.properties.name;
    // the first piece keeps the name and the id (schedules and pauses pick areas by it), the others get a number
    const pieces = splitPreview.map((outline, i) => ({
      ...selectedArea,
      id: i ? generateId() : selectedArea.id,
      outline,
      properties: {...selectedArea.properties, name: name && i ? `${name} ${i + 1}` : name},
    }));
    remember();
    setMap({
      ...map,
      areas: map.areas.flatMap((a) => (a.id === selectedArea.id ? pieces : [a])),
    });
    // a cut out shape is the new one, likely to be renamed next
    setSelectedAreaId(pieces[pieces.length - 1 - (cutShape ? 0 : 1)].id);
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
      dropEdits();
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
    const name = `mowbite-map-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.json`;
    await saveFile(name, JSON.stringify(closedRings(m), null, 2));
  };

  // an openmower that doesn't know the newer area settings drops them when saving, noticed once its map comes back
  const [newSaved, setNewSaved] = useState<{areas: MowerMap['areas']; before: MowerMap | null} | null>(null);
  const dropped = useMemo(() => {
    if (!newSaved || !liveMap || liveMap === newSaved.before) return [];
    const lost = new Set<string>();
    for (const a of newSaved.areas) {
      const now = liveMap.areas.find((x) => x.id === a.id);
      if (!now) continue;
      for (const k of NEW_AREA_SETTINGS) if (a.properties[k] !== undefined && now.properties[k] === undefined) lost.add(k);
    }
    return [...lost];
  }, [newSaved, liveMap]);
  const droppedNote = dropped.length
    ? tr("Your OpenMower version doesn't know {what} yet, it got dropped when saving.", {
        what: [...new Set(dropped.map((k) => `"${tr(k === 'mowable' ? "don't mow" : 'angle range')}"`))].join(', '),
      })
    : null;

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
      setNewSaved({areas: map.areas.filter((a) => NEW_AREA_SETTINGS.some((k) => a.properties[k] !== undefined)), before: liveMap});
      // back to the live map, it comes back from the mower with what was just saved
      dropEdits('originals');
      void refreshBackups();
    } catch (e) {
      setSaveError(rpcErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  // the selected mowing area's angle and plan (MowSettings), with the planner in its menu
  const mowProps =
    selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow'
      ? {
          area: selectedArea,
          autoAngle,
          globalValue,
          remember,
          update: updateProperties,
          showStripes,
          onToggleStripes: () => setShowStripes(!showStripes),
          onAngleEdit: touchAngle,
          toolWidth,
          mismatch,
          previewCorrection,
          planFromMower: !!realPlan,
          planChosen: plan?.chosen,
          planDuration: realPlan?.duration,
          planZones: realPlan?.zones?.length,
          byPlanner: !!plannerSettings,
          planAngle: realPlan?.angle,
          planLength: shownArea?.properties.mowable === false || shownArea?.properties.active === false ? 0 : planLength,
          onPreviewCorrection: setPreviewCorrection,
          angle: {offset: angleOffset, offsetIsAbsolute, increment: angleIncrement},
          onSaveCase: planRequest
            ? () =>
                savePlanCase({
                  areaId: selectedArea.id,
                  areaName: selectedArea.properties.name ?? '',
                  request: planRequest,
                  map: liveMap,
                  params,
                })
            : undefined,
        }
      : null;
  // a mow angle set wins: the area's own way of working the direction out goes, the planner would take that first
  const updateDirection: UpdateArea = (patch, undoable) => {
    const own = selectedArea?.properties.planner;
    if (patch.angle !== undefined && own?.angle_strategy !== undefined) {
      const rest = {...own};
      delete rest.angle_strategy;
      return updateProperties({...patch, planner: Object.keys(rest).length ? rest : undefined}, undoable);
    }
    updateProperties(patch, undoable);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>
          <TitleMark />
          {tr('Map')}
        </h1>

        <div className={[styles.editor, pinned ? styles.pinned : ''].filter(Boolean).join(' ')}>
          <div className={styles.mapCol}>
            {/* phones: undo and save on the map while an area is edited, the toolbar is further down then */}
            {selectedArea && mode === 'idle' && dirty && !preview && (
              <div className={styles.mapSave}>
                <button className={styles.pillButton} onClick={undo} disabled={history.length === 0} aria-label={tr('Undo')}>
                  ↶
                </button>
                <button className={[styles.pillButton, styles.saveButton, styles.unsaved].join(' ')} onClick={() => void handleSave()} disabled={saving}>
                  {saving ? tr('saving…') : tr('Save map')}
                </button>
              </div>
            )}
            {pickedProblem && shownMap && (
              <div className={styles.previewBar}>
                <span>{problemText(pickedProblem, shownMap)}</span>
                <button onClick={() => setProblemPick(null)} aria-label="close">
                  ×
                </button>
              </div>
            )}
            {pickedText && (
              <div className={styles.previewBar}>
                <span>{pickedText}</span>
                <button onClick={() => setFitPick(null)} aria-label="close">
                  ×
                </button>
              </div>
            )}
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
            {preview && <LiveMapView zoomable map={preview.map} datum={datumFromParams(params)} />}
            {!preview && shownMap && (
              <LiveMapView
                zoomable
                viewKey="editor"
                pin={{on: pinned, onToggle: togglePinned}}
                map={shownMap}
                emergency={emergency}
                track={trackShown}
                pastTrack={viewJob?.segments?.map((s) => ({
                  points: s.points.map(([x, y]) => ({x, y})),
                  blades: !!s.attributes.blades,
                }))}
                selectedAreaId={selectedAreaId}
                onSelectArea={selectArea}
                onMoveVertex={simplifyCm === null && mode === 'idle' ? moveVertex : undefined}
                onDragStart={remember}
                onDragging={setDraggingPoint}
                onDragCancel={undo}
                onUndo={undo}
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
                // the area being mowed shows how far the mower got instead of its plan
                stripes={progress && progress.areaId === selectedAreaId ? undefined : stripes}
                loops={progress && progress.areaId === selectedAreaId ? undefined : plan?.loops}
                pieces={progress && progress.areaId === selectedAreaId ? undefined : plan?.pieces}
                openLoops={!!plan?.open}
                progress={progress ?? undefined}
                costume={costume}
                preview={splitPreview ?? (merged ? [merged.outline] : undefined)}
                markers={spot || problemSpots.length ? [...(spot ? [spot] : []), ...problemSpots] : undefined}
                // (the spot from the activity page has its message above the map already)
                onMarkerPick={(i) => {
                  const n = i - (spot ? 1 : 0);
                  if (n >= 0) setProblemPick(n === problemPick ? null : n);
                }}
                bodySpots={bodySpots ?? undefined}
                bodySpace={realPlan?.checks?.space}
                fitPlaces={realPlan?.checks?.places}
                fitPicked={fitPlace ? fitPick!.index : null}
                onFitPick={(index) => setFitPick(index === null ? null : {plan: realPlan, index})}
                turnPlaces={realPlan?.checks?.turns}
                marginPlaces={marginPlaces.length ? marginPlaces : undefined}
                jumpPlaces={realPlan?.checks ? [...realPlan.checks.jumps, ...realPlan.checks.unchecked] : undefined}
                focus={spot ?? undefined}
              />
            )}

            {!preview && selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow' && (
              <AngleOnMap area={selectedArea} autoAngle={autoAngle} remember={remember} update={updateProperties} onEdit={touchAngle} />
            )}


            {!map && <p className={styles.dim}>{tr('waiting for map…')}</p>}
          </div>

          <div className={styles.panel}>
            {preview ? (
              <RestorePanel
                areas={preview.map.areas.length}
                backedUp={!!backups}
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
                  canUndo={history.length > 0}
                  unsaved={dirty}
                  saving={saving}
                  saveLabel={
                    saving ? tr('saving…') : (external && dirty) || warnings || (saveWarning && !docked) ? tr('Save anyway') : tr('Save map')
                  }
                  saveError={saveError ?? droppedNote}
                  onDraw={startDraw}
                  onUndo={undo}
                  onSave={() => void handleSave()}
                />
              )}


              {mode === 'idle' && map && <Problems problems={problems} map={map} onSelect={selectArea} />}

              {external && dirty && (
                <div className={styles.warning}>
                  <p>
                    {tr(
                      'The map on the mower was changed since you started editing here (another app or device, or a recording). Saving puts your version in its place.',
                    )}{' '}
                    {/* the save backs up the mower's map first when backups work */}
                    {backups ? tr('That change is then only in the backups.') : tr('That change would be lost.')}
                  </p>
                  <a onClick={mergeExternal}>{tr('put both together (what only one side changed is kept)')}</a>
                  <a
                    onClick={() => {
                      dropEdits();
                      setSelectedAreaId(null);
                    }}
                  >
                    {tr('drop my changes and load it')}
                  </a>
                </div>
              )}

              {mergeNote && dirty && <p className={styles.warning}>{mergeNote}</p>}

              {saveWarning && !docked && (
                <div className={styles.warning}>
                  <p>
                    {tr("The mower isn't idle in the dock. Changing the map during a job can stop the job. Better save once it's back in the dock.")}
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
                      onClearLive={trackPoints(track) > 1 ? () => void clearTrack() : undefined}
                      lastRun={trackPoints(track) > 1 ? lastRun : null}
                    />
                  )}
                  {mowAreas.length > 1 && (
                    <OrderBox areas={mowAreas} docked={docked} onSelect={selectArea} onMove={moveInOrder} />
                  )}

                  {/* everything for the planner is here at the map: for all areas and the mower's sizes, an area's own
                      with the area */}
                  {plannerSettings && (
                    <Fold id="plannerAll" title={tr('Planner for all areas')}>
                      <PlannerSimple toolWidth={toolWidth} omIncrement={angleIncrement} map={map} onSelectArea={selectArea} />
                      <details className={simpleStyles.expert}>
                        <summary>{tr('More settings (expert)')}</summary>
                        {slic3r && <p className={simpleStyles.note}>{tr('Only with the MowBite Planner:')}</p>}
                        <div className={slic3r ? simpleStyles.off : undefined} inert={slic3r}>
                          <div className={styles.foldCards}>
                            <PlannerSettings styles={settingsStyles} />
                          </div>
                        </div>
                      </details>
                    </Fold>
                  )}
                  {plannerSettings && (
                    <Fold id="mowerSizes" title={tr('Mower sizes')}>
                      <div className={styles.foldCards}>
                        <MowerBodySettings styles={settingsStyles} />
                      </div>
                    </Fold>
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
                  cutShape={cutShape}
                  onCutShape={setCutShape}
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

              {/* without the planner: OpenMower's own settings of the area, its angle and its plan */}
              {mowProps && !plannerSettings && (
                <Fold id="mow" title={tr('Mowing settings')}>
                  <MowSettings {...mowProps} />
                </Fold>
              )}
              {/* with the planner everything of the area in one place, in the sections of the planner menu */}
              {mowProps && selectedArea && plannerSettings && (
                <Fold id="area" title={tr('This area')}>
                  <PlannerSimple
                    toolWidth={toolWidth}
                    omIncrement={angleIncrement}
                    map={map}
                    onSelectArea={selectArea}
                    plan={<AreaPlanInfo {...mowProps} />}
                    direction={<AreaDirection {...mowProps} update={updateDirection} />}
                    openmower={<OpenMowerArea {...mowProps} inMenu />}
                    area={{
                      own: selectedArea.properties.planner ?? {},
                      openmower: {
                        outline_count: selectedArea.properties.outline_count,
                        outline_overlap_count: selectedArea.properties.outline_overlap_count,
                        outline_offset: selectedArea.properties.outline_offset,
                      },
                      dropOpenMower: (key) => updateProperties({[key]: undefined}),
                      // OpenMower's values go too, they'd count over the ones for all areas
                      clear: () =>
                        updateProperties({planner: undefined, outline_count: undefined, outline_overlap_count: undefined, outline_offset: undefined}),
                      planned: plan?.chosen?.perimeter_passes,
                      outline: selectedArea.outline,
                      set: (key, value) => {
                        const own = {...(selectedArea.properties.planner ?? {})};
                        if (value === undefined || value === null) delete own[key];
                        else own[key] = value;
                        updateProperties({planner: Object.keys(own).length ? own : undefined});
                      },
                    }}
                  />
                  {body &&
                    realPlan &&
                    !slic3r &&
                    !unsized &&
                    (collisionMode ? (
                      <PlanChecks checks={realPlan.checks} on={(selectedArea.properties.planner?.body_fit ?? plannerSettings?.settings.body_fit?.value) !== false} />
                    ) : (
                      <BodyCheck request={planRequest} onSpots={setBodySpots} />
                    ))}
                </Fold>
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
