'use client';

import Link from 'next/link';
import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import MapView from '@/components/MapView';
import TrackPicker from '@/components/TrackPicker';
import {saveMap, useMowerMap, type MowerMap, type Point} from '@/hooks/useMowerMap';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useIdle, useMowerStateValue} from '@/hooks/useMowerState';
import {useEggForced, useUmbrella} from '@/lib/eggs';
import {lastRun as newestRun} from '@/hooks/useRecentRuns';
import {clearTrack, trackPoints, useLastRun, useLastRunJob, useMowerTrack} from '@/hooks/useMowerTrack';
import {useMarginPlaces} from '@/lib/marginCheck';
import {useLeftoversBefore} from '@/hooks/useLeftoversBefore';
import {usePlanProgress} from '@/hooks/usePlanProgress';
import {datumFromParams, numParam, useMowerParams} from '@/hooks/useMowerParams';
import {loadJobTrack, useJobList, useMowHistory, type TrackSegment} from '@/hooks/useMowHistory';
import {simplifyPolygon} from '@/lib/simplifyPolygon';
import {mergeOutlines} from '@/lib/mergeAreas';
import {cutOut, generateId, splitByPath} from '@/lib/splitPolygon';
import {layAgainst, movingOf} from '@/lib/snapAreas';
import {subtractOutline} from '@/lib/subtractAreas';
import {useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps} from 'react';
import styles from './page.module.css';
import {fmt, tr, useLang} from '@/lib/i18n';
import MapBackups, {backupLabel} from '@/components/MapBackups';
import {deleteBackup, loadBackup, saveBackup} from '@/lib/backups';
import AreaCard from './AreaCard';
import DecorPanel, {showUnderMap} from './DecorPanel';
import {decorRedo, decorUndo, goneLooks, onlyPinsChanged, pinSquare, pinsFrom, type UpdateArea, NEW_AREA_SETTINGS} from './editing';
import EditorToolbar from './EditorToolbar';
import MowSettings, {AngleOnMap, AreaDirection, AreaPlanInfo, OpenMowerArea} from './MowSettings';
import OrderBox from './OrderBox';
import {DrawPanel, MergePanel, RestorePanel, SimplifyPanel, SnapPanel, SplitPanel, SubtractPanel} from './Panels';
import {PARAM} from '@/lib/openmower';
import {RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {sameContent} from '@/lib/sameMap';
import {savePlanCase} from '@/lib/planCase';
import {useAreaProperties} from '@/lib/areaProps';
import {useMowPlan} from './useMowPlan';
import {useMapEdits} from './useMapEdits';
import {useMapBackups} from './useMapBackups';
import {checkMap} from '@/lib/mapCheck';
import {narrowPassages} from '@/lib/narrowPassages';
import Problems, {problemText} from './Problems';
import {BodyCheck, PlanChecks} from './BodyCheck';
import {PlanSimulation, SimPlayer, type ShownSim} from './PlanSimulation';
import {createSimClock} from '@/lib/simulate';
import {Fold} from './Fold';
import {bodyFrom, isPin, slic3rPlans, standing, useMowerBody, usePlannerSettings, type BodySpot} from '@/lib/mowerBody';
import {OpenMowerMowing, useCanSetParams} from '@/components/MowerParamSettings';
import {PlannerSettings} from '@/components/PlannerSettings';
import {PlannerSimple} from '@/components/PlannerSimple';
import settingsStyles from '../settings/page.module.css';
import {areaLook, pinSize, type Look} from '@/components/gardenLook';
import {PICTURES} from '@/components/gardenPictures';
import {useKeptState} from '@/hooks/useKeptState';
import {tick} from '@/lib/haptics';
import {dropLooks, looksOf, restoreLooks, saveSettings, settingsStore, withLooks, type KeptLooks} from '@/lib/settings';

// '0' when the map was unpinned on this device
const PINNED_KEY = 'mapPinned';
const SNAP_KEY = 'mapSnap';

// decorating (mode 'decor'), kept while the app runs like the edits: on while it's open (off again after "after mowing",
// what it kept stays for the next round), the picture the next tap sets (copy: the picked pin's color, size and direction
// go along), what was kept for the pins' pictures before (cancel puts it back, {} for a pin set since) and the map it
// started from (undo goes back no further)
interface Decor {
  on: boolean;
  look: Look | null;
  copy: KeptLooks[string] | null;
  kept: KeptLooks;
  start: MowerMap | null;
}

// the map editor, kept by the layout while other pages are open (components/MapKeeper), the /map route is empty.
// useSearchParams needs a suspense boundary in a static export
export default function MapEditorPage() {
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
  // no job a map change could break off
  const idle = useIdle();
  const track = useMowerTrack();
  const lastRun = useLastRun();
  const lastRunJob = useLastRunJob();
  const liveMap = useMowerMap();
  const params = useMowerParams();
  // while it mows: how far it got with the area's plan, like on the overview (the state only then, it changes every
  // second)
  const mowingState = useMowerStateValue((l) => (l.state?.current_state === 'MOWING' ? l.state : null));
  // (driving the leftover passes of the last mow: along those, nothing to draw when the planner can't work them out again)
  const planProgress = usePlanProgress(mowingState, liveMap, undefined);
  const progress = planProgress?.leftovers && !planProgress.todoLength && !planProgress.doneLength ? null : planProgress;
  // and that mow's track, faded under the trail
  const before = useLeftoversBefore(!!planProgress?.leftovers);
  // the mower's icon dressed like the eater on the dashboard
  const umbrella = useUmbrella(newestRun());
  const towel = useEggForced('towel');
  const towelNow = towel || (!!progress && !progress.leftovers && Math.round(progress.fraction * 100) === 42);
  // the same object while nothing changes, the map is drawn again only when it does
  const costume = useMemo(() => ({towel: towelNow, umbrella}), [towelNow, umbrella]);
  const {map, edited, base, setMap, history, future, remember, undoStep, redoStep, originalOf, keepOriginal, dirty, external, dropEdits, rebase, mergeNote, mergeExternal} =
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
  // points snap onto other areas' corners and edges, unless switched off on this device
  const [snapOn, setSnapOn] = useState(() => {
    try {
      return localStorage.getItem(SNAP_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggleSnap = () => {
    setSnapOn(!snapOn);
    try {
      localStorage.setItem(SNAP_KEY, snapOn ? '0' : '1');
    } catch {}
  };
  const jobList = useJobList();
  // null = live trail, otherwise a recorded job shown instead
  // ?job=<id> (from the activity page) opens that job's track until another one is picked
  const search = useSearchParams();
  const urlJob = search.get('job');
  // ?at=x,y&msg=... from a problem on the activity page: marked on the map with its message
  const at = search.get('at')?.split(',').map(Number);
  // (closed for the link it came with, the page is kept while others are open: another link shows its spot)
  const [spotClosed, setSpotClosed] = useState<string | null>(null);
  const spot =
    spotClosed !== search.get('at') && at?.length === 2 && at.every(Number.isFinite) ? {x: at[0], y: at[1], msg: search.get('msg') ?? ''} : null;
  // a job picked here, while the page has the link it was picked with
  const [picked, setPicked] = useState<{job: string | null; with: string | null} | undefined>(undefined);
  const jobId = picked && picked.with === urlJob ? picked.job : urlJob;
  const [loaded, setLoaded] = useState<{id: string; segments: TrackSegment[]} | null>(null);
  const viewJob = jobId ? {id: jobId, segments: loaded?.id === jobId ? loaded.segments : null} : null;
  const showJob = (id: string) => setPicked({job: id || null, with: urlJob});
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
  // a newer map on the mower (another device, a recording): the first tap on save shows what saving does then, the
  // second one saves over it
  // (for the mower's map then: a newer one again asks again)
  const [armedFor, setArmedFor] = useState<MowerMap | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  // the backup before saving failed: said once, the next tap saves without one
  const [withoutBackup, setWithoutBackup] = useState(false);
  const conflictArmed = !!armedFor && armedFor === liveMap;
  const [saveWarning, setSaveWarning] = useState(false);
  const [editMode, setMode] = useState<'idle' | 'split' | 'draw' | 'merge' | 'subtract' | 'snap'>('idle');
  const [decor, setDecor] = useKeptState<Decor | null>('map:decor', null);
  const mode = decor?.on ? 'decor' : editMode;
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // how far off an area's corners may be to be laid against another one
  const [snapCm, setSnapCm] = useState(50);
  // the other area clicked to merge with or to take out
  const [otherId, setOtherId] = useState<string | null>(null);
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
  const baseOutline = selectedArea ? originalOf(selectedArea) : null;
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

  // not while a point is dragged, a new plan redrawn mid-drag makes it stutter
  const [draggingPoint, setDraggingPoint] = useState(false);
  // the map the checks and the plan go by: while a point is dragged the one from before it was picked up, worked out
  // again once it's let go
  const [heldMap, setHeldMap] = useState<MowerMap | null>(null);
  const planMap = draggingPoint && heldMap ? heldMap : shownMap;
  const dragging = (on: boolean) => {
    setDraggingPoint(on);
    setHeldMap(on ? shownMap : null);
  };

  // self crossing outlines, a dock off the drivable areas and the like, also in the preview of reducing points. With a
  // planner that keeps the mower's body off the edges and obstacles: where it doesn't get through between them
  const approachDistance = numParam(params, PARAM.dockingApproachDistance);
  const plannerSettings = usePlannerSettings();
  // OpenMower's slic3r planner switched on in the MowBite Planner: no distances kept, no collision check
  const slic3r = slic3rPlans(plannerSettings);
  // OpenMower's own mowing values can be changed here (params.set)
  const canSetParams = useCanSetParams();
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
    () => (planMap ? [...checkMap(planMap, approachDistance), ...(margins ? narrowPassages(planMap, margins) : [])] : []),
    [planMap, approachDistance, margins],
  );
  const warnings = problems.filter((p) => p.level === 'warn').length;
  const spotted = problems.flatMap((p) => ('at' in p ? [p] : []));
  const problemSpots = spotted.map((p) => p.at);
  // a red spot tapped on the map: what it is, in words
  const [problemPick, setProblemPick] = useState<number | null>(null);
  const pickedProblem = problemPick !== null && shownMap ? spotted[problemPick] : undefined;

  // the mower's body as the planner knows it, and where it would stick out in the selected area's plan
  const body = useMowerBody();
  // a planner that checks the mower's body in every plan (it has body_fit): what it found shows with the plan
  const collisionMode = !!plannerSettings?.settings.body_fit && !slic3r;
  // a planner that takes the body's sizes and has none: it checks nothing, whatever sizes the app itself draws with
  const unsized = !!plannerSettings?.settings.robot_front && !bodyFrom(plannerSettings);
  const [bodySpots, setBodySpots] = useState<BodySpot[] | null>(null);
  const {toolWidth, angleOffset, offsetIsAbsolute, angleIncrement, shownArea, autoAngle, touchAngle, mismatch, realPlan, plan, stripes, planLength, planRequest} =
    useMowPlan({params, liveMap, shownMap: planMap, selectedAreaId, pastJobs, areaProps, showStripes, previewCorrection, draggingPoint});
  // a place of the collision check picked on the map: the body where it would have stuck out, for the plan it's from
  const [fitPick, setFitPick] = useState<{plan: unknown; index: number} | null>(null);
  const fitPlace = fitPick && fitPick.plan === realPlan ? realPlan?.checks?.places[fitPick.index] : undefined;
  // the plan driven by the planner (PlanSimulation): for the plan it was asked for, on the map and played back there until
  // hidden. the live trail and the last run's margins make way for it meanwhile
  const [sim, setSim] = useState<ShownSim | null>(null);
  const simKey = planRequest ? JSON.stringify(planRequest) : '';
  const simNow = sim && sim.key === simKey ? sim : null;
  const simOnMap = simNow?.shown && mode === 'idle' ? simNow : null;
  const simResult = simOnMap?.result;
  const simClock = useMemo(() => (simResult ? createSimClock(simResult.frames) : null), [simResult]);
  const simShown = useMemo(() => (simResult && simClock ? {frames: simResult.frames, clock: simClock} : undefined), [simResult, simClock]);
  const simLeft = useMemo(() => simResult?.left.map((l) => l.outline), [simResult]);
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
    return v === undefined ? tr('like all areas') : `${tr('like all areas')}: ${fmt(v, Number.isInteger(v) ? 0 : 2)}`;
  };

  const selectArea = (id: string) => {
    // decorating only a pin is picked
    if (mode === 'decor') {
      if (map?.areas.some((a) => a.id === id && isPin(a))) setSelectedAreaId(id);
      return;
    }
    if (mode === 'merge' || mode === 'subtract' || mode === 'snap') {
      if (id !== selectedAreaId) setOtherId(id);
      return;
    }
    setSelectedAreaId(id);
    setSimplifyCm(null);
  };

  const deselect = () => {
    if (mode !== 'idle' && mode !== 'decor') return;
    setSelectedAreaId(null);
    setSimplifyCm(null);
  };

  // decorating stays on: undo goes back no further than where it started, redo only brings pins back
  const canUndo = mode === 'decor' ? !!map && decorUndo(map, decor?.start ?? null, history) : history.length > 0;
  const canRedo = mode === 'decor' ? !!map && decorRedo(map, future) : future.length > 0;

  const undo = () => {
    if (!canUndo || !undoStep()) return;
    setSimplifyCm(null);
    setMode('idle');
    setPendingPoints([]);
  };

  const redo = () => {
    if (!canRedo || !redoStep()) return;
    setSimplifyCm(null);
    setMode('idle');
    setPendingPoints([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // in a text field undo and redo are the typing's own
      const t = e.target;
      const typing =
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable) ||
        (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(t.type));
      if ((e.ctrlKey || e.metaKey) && typing) return;
      // ctrl+y, or ctrl+shift+z as on a mac
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
        // decorating: the picture to set let go, else the pin picked
        if (mode === 'decor' && decor?.look) setDecor({...decor, look: null, copy: null});
        else if (mode !== 'idle' && mode !== 'decor') cancelPicking();
        else deselect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const applySimplify = () => {
    if (shownMap && selectedArea && baseOutline && simplified) {
      remember();
      keepOriginal(selectedArea.id, baseOutline, simplified);
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
    if (!map || !idle) return;
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


  // a pin moves as a whole, by its middle
  const moveVertex = (areaId: string, vertexIndex: number, x: number, y: number) => {
    setMap((prev) =>
      prev
        ? {
            ...prev,
            areas: prev.areas.map((a) =>
              a.id !== areaId
                ? a
                : isPin(a)
                  ? {...a, outline: pinSquare(x, y)}
                  : {...a, outline: a.outline.map((p, i) => (i === vertexIndex ? {x, y} : p))},
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
    setOtherId(null);
  }

  const other = map?.areas.find((a) => a.id === otherId) ?? null;
  const merged = mode === 'merge' && selectedArea && other ? mergeOutlines(selectedArea.outline, other.outline) : null;

  const applyMerge = () => {
    if (!map || !selectedArea || !other || !merged) return;
    // keeps the id of the selected one like its name and settings, schedules and pauses pick areas by it
    const area = {...selectedArea, outline: merged.outline};
    // in the place of the first of the two, the order in map.json is the mowing order
    const first = map.areas.find((a) => a.id === selectedArea.id || a.id === other.id)!;
    remember();
    setMap({
      ...map,
      areas: map.areas.flatMap((a) => (a === first ? [area] : a.id === selectedArea.id || a.id === other.id ? [] : [a])),
    });
    setSelectedAreaId(area.id);
    cancelPicking();
  };

  // what's left of the selected area with the other one taken out
  const subtracted =
    mode === 'subtract' && selectedArea && other ? subtractOutline(selectedArea.outline, other.outline, !standing(selectedArea)) : null;
  // an obstacle inside the area isn't mowed anyway, cutting the area open around it changes nothing
  const subtractable = !!subtracted?.pieces.length && !(other?.properties.type === 'obstacle' && subtracted.cut > 0);

  const applySubtract = () => {
    if (!map || !selectedArea || !subtracted || !subtractable) return;
    const name = selectedArea.properties.name;
    // the biggest piece keeps the name and the id (schedules and pauses pick areas by it), the others get a number
    const pieces = subtracted.pieces.map((outline, i) => ({
      ...selectedArea,
      id: i ? generateId() : selectedArea.id,
      outline,
      properties: {...selectedArea.properties, name: name && i ? `${name} ${i + 1}` : name},
    }));
    remember();
    setMap({...map, areas: map.areas.flatMap((a) => (a.id === selectedArea.id ? pieces : [a]))});
    setSelectedAreaId(pieces[0].id);
    cancelPicking();
  };

  // laying one against the other: a mowing area stays as it is, unless both are (then the selected one moves)
  const [moving, fixed] = mode === 'snap' && selectedArea && other ? movingOf(selectedArea, other) : [null, null];
  const laid = moving && fixed ? layAgainst(moving.outline, fixed.outline, snapCm / 100) : null;

  const applySnap = () => {
    if (!map || !moving || !laid?.valid) return;
    remember();
    setMap({...map, areas: map.areas.map((a) => (a.id === moving.id ? {...a, outline: laid.outline} : a))});
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
    if (mode === 'decor') {
      placePin(x, y);
      return;
    }

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
  const datum = datumFromParams(params);
  const {backups, preview, setPreview, confirmRestore, setConfirmRestore, restoring, restoreError, setRestoreError, refreshBackups, closePreview, restore, download, downloadGeo} =
    useMapBackups(liveMap, datum, () => {
      dropEdits();
      setSelectedAreaId(null);
    });

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

  // anyway: asked already (decorating asks on its own), saved while the mower is busy too. next: the map to save, the one
  // edited unless it was just put together with the mower's. true once it's on the mower
  const handleSave = async (anyway = false, next = map) => {
    if (!next) return false;
    // saving while the mower is on a job can make it lose track of the area it's on, ask first
    if (!idle && !saveWarning && !anyway) {
      setSaveWarning(true);
      return false;
    }
    if (external && dirty && !anyway && !conflictArmed) {
      setArmedFor(liveMap);
      requestAnimationFrame(() => showUnderMap(conflictRef.current));
      return false;
    }
    setSaveWarning(false);
    setSaving(true);
    setSaveError(null);
    // the pins the edits took away (and the ones set while decorating and gone again): what's kept for their pictures
    // goes once it's saved. not a pin set somewhere else meanwhile, a backup can still bring that one back
    const pins = [...((base ?? liveMap)?.areas.filter(isPin).map((a) => a.id) ?? []), ...Object.keys(decor?.kept ?? {})];
    const gone = [...new Set(pins)].filter((id) => !next.areas.some((a) => a.id === id));
    try {
      // the version on the mower goes into the backups first, so every save can be undone. without that only when asked
      if (backups && liveMap && !withoutBackup) {
        try {
          await saveBackup(liveMap, 'before saving', true);
        } catch (e) {
          setWithoutBackup(true);
          setSaveError(
            tr("The map on the mower couldn't be backed up first ({why}). Tap save again to save without that backup.", {
              why: e instanceof Error ? e.message : tr('failed'),
            }),
          );
          return false;
        }
      }
      lateSave.current = {map: next, gone, before: liveMap};
      await saveMap(next);
      lateSave.current = null;
      setArmedFor(null);
      setWithoutBackup(false);
      saved(next, gone, liveMap);
      return true;
    } catch (e) {
      // no answer: it may still get there, then it's saved after all (below)
      if (!(e instanceof RpcError && e.code === 'timeout')) lateSave.current = null;
      setSaveError(rpcErrorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  // a map on the mower: back to the mower's map (it comes back from there with it), the pictures of the pins the edits
  // took away go
  const saved = (next: MowerMap, gone: string[], before: MowerMap | null) => {
    setNewSaved({areas: next.areas.filter((a) => NEW_AREA_SETTINGS.some((k) => a.properties[k] !== undefined)), before});
    dropEdits('originals');
    dropLooks(gone);
    // a round of decorating left for after mowing is saved with it
    if (decor && !decor.on) setDecor(null);
    void refreshBackups();
  };
  // a save the mower didn't answer in time: once its map comes back from there it's saved after all, not a change from
  // somewhere else. edits made meanwhile stay and go on from it
  const lateSave = useRef<{map: MowerMap; gone: string[]; before: MowerMap | null} | null>(null);
  useEffect(() => {
    const late = lateSave.current;
    if (!late || !liveMap || !sameContent(liveMap, late.map)) return;
    lateSave.current = null;
    setSaveError(null);
    if (map === late.map) saved(late.map, late.gone, late.before);
    else rebase(liveMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the mower's map comes
  }, [liveMap]);

  // decorating: what has to come first, the garden style (pictures are drawn only there) or the changes to areas saved
  // (finish saves pins only). saved from there it starts once the map is the mower's again (next)
  const [decorAsk, setDecorAsk] = useState<'style' | 'save' | null>(null);
  // another page opened (the page is kept hidden meanwhile, MapKeeper): a delete armed and a question asked here don't
  // wait for it to come back
  useLayoutEffect(
    () => () => {
      setConfirmDelete(null);
      setDecorAsk(null);
    },
    [],
  );
  const [decorNext, setDecorNext] = useState(false);
  // finish tapped while the mower is out, asked first
  const [decorBusy, setDecorBusy] = useState(false);
  // saved or left for after mowing, said for a moment on the map
  const [decorNote, setDecorNote] = useState<string | null>(null);
  // a question before decorating, brought into view under the map
  const askRef = useRef<HTMLDivElement>(null);
  useEffect(() => showUnderMap(askRef.current), [decorAsk]);
  // a pin just taken away, for 5 s with the way back (map: the map then, after any other change the way back is gone)
  const [removed, setRemoved] = useState<{what: string; map: MowerMap} | null>(null);
  const garden = settings.mapStyle === 'garden';
  // (against the map the edits started from: a change on the mower meanwhile isn't one of ours)
  const areasChanged = !!map && !!liveMap && !onlyPinsChanged(base ?? liveMap, map);
  const pickedPin = mode === 'decor' && selectedArea && isPin(selectedArea) ? selectedArea : null;

  const startDecor = () => {
    if (!map) return;
    // the pictures as they are now, a round left for after mowing and not saved since keeps what it kept then
    const now = looksOf(settingsStore.snapshot(), map.areas.filter(isPin).map((a) => a.id));
    setDecor({on: true, look: null, copy: null, kept: decor ? {...now, ...decor.kept} : now, start: map});
    setDecorAsk(null);
    setDecorBusy(false);
    setSelectedAreaId(null);
    setSimplifyCm(null);
    setConfirmDelete(null);
    cancelPicking();
  };
  const enterDecor = () => {
    if (!garden) setDecorAsk('style');
    else if (areasChanged) setDecorAsk('save');
    else startDecor();
  };
  const decorInGarden = () => {
    saveSettings({...settingsStore.snapshot(), mapStyle: 'garden'});
    if (areasChanged) setDecorAsk('save');
    else startDecor();
  };
  if (decorNext && !dirty) {
    setDecorNext(false);
    startDecor();
  }

  // the picture picked set where the map was tapped, a pin of its own, picked right away. once: the next one is picked
  // again
  const placePin = (x: number, y: number) => {
    if (!map || !decor?.look) return;
    const look = decor.look;
    const id = generateId();
    remember();
    setMap({...map, areas: [...map.areas, {id, properties: {type: 'decor', pin: true, name: tr(PICTURES[look].label)}, outline: pinSquare(x, y)}]});
    // its size written down too: a MowBite that doesn't know pins yet still draws it that big
    const copy = decor.copy ?? {};
    saveSettings(withLooks(settingsStore.snapshot(), {[id]: {...copy, looks: look, lookSizes: copy.lookSizes ?? pinSize(look)}}));
    setDecor({...decor, look: null, copy: null, kept: {...decor.kept, [id]: {}}});
    setSelectedAreaId(id);
    tick();
  };
  const armPin = (look: Look | null) => {
    if (decor) setDecor({...decor, look, copy: null});
  };
  // another one like the pin picked with the next tap, its color, size and direction along. again: none after all
  const copyPin = () => {
    if (!decor || !pickedPin) return;
    if (decor.copy) setDecor({...decor, look: null, copy: null});
    else setDecor({...decor, look: areaLook(pickedPin, settings.looks), copy: looksOf(settings, [pickedPin.id])[pickedPin.id]});
  };
  const removePin = () => {
    if (!map || !pickedPin) return;
    const next = {...map, areas: map.areas.filter((a) => a.id !== pickedPin.id)};
    remember();
    setMap(next);
    setSelectedAreaId(null);
    setRemoved({what: tr(PICTURES[areaLook(pickedPin, settings.looks)].label), map: next});
  };
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 5000);
    return () => clearTimeout(t);
  }, [removed]);
  useEffect(() => {
    if (!decorNote) return;
    const t = setTimeout(() => setDecorNote(null), 4000);
    return () => clearTimeout(t);
  }, [decorNote]);
  // another picture in the picked pin's place: its name goes along, it's drawn by that where its settings aren't known
  const swapPin = (look: Look) => updateProperties({name: tr(PICTURES[look].label)}, false);

  const closeDecor = () => {
    setDecor(null);
    setDecorBusy(false);
    setSelectedAreaId(null);
    setRemoved(null);
  };
  // finish: the map saved once, with the pins (asked first while the mower is out), put together first with a change on
  // the mower meanwhile (only pins were changed here). nothing changed on the map: only closed, the pictures' settings
  // count at once anyway, those of pins set and gone again go
  const finishDecor = async (anyway = false) => {
    if (!dirty) {
      if (decor) restoreLooks(goneLooks(decor.kept, map));
      return closeDecor();
    }
    if (!idle && !anyway) return setDecorBusy(true);
    setDecorBusy(false);
    if (!(await handleSave(true, external ? mergeExternal() : map))) return;
    closeDecor();
    setDecorNote(tr('Decoration saved on the mower'));
  };
  // after mowing: closed, what it changed stays here unsaved, decorating again goes on with it
  const decorLater = () => {
    if (decor) setDecor({...decor, on: false, look: null, copy: null});
    setDecorBusy(false);
    setSelectedAreaId(null);
    setRemoved(null);
    setDecorNote(tr("Kept in the app. Later: the map's gear, Decorate, then Finish."));
  };
  // a round left for after mowing whose changes are gone meanwhile (dropped, a backup restored): over, the pictures of its
  // pins no longer on the map as they were
  useEffect(() => {
    if (!decor || decor.on || edited) return;
    restoreLooks(goneLooks(decor.kept, liveMap));
    setDecor(null);
  }, [decor, edited, liveMap, setDecor]);
  // called off: the pins as they are on the mower, their pictures as they were. the outlines from before reducing points
  // stay (pins don't change them), with nothing changed on the map the steps to undo and redo too
  const cancelDecor = () => {
    if (!decor) return;
    if (map && liveMap && base && !onlyPinsChanged(base, map)) {
      remember();
      setMap(pinsFrom(map, liveMap));
    } else if (dirty) dropEdits('originals');
    restoreLooks(decor.kept);
    closeDecor();
  };
  // something cancel throws away: a change to the map or to the pins' pictures
  const decorChanged = dirty || (!!decor && withLooks(settings, decor.kept) !== settings);

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
    <div className={styles.page} data-map-editor>
      <main className={styles.main}>
        <TitleRow className={styles.titleRow}>
          <h1>
            <TitleMark />
            {tr('Map')}
          </h1>
        </TitleRow>

        {/* decorating the map stays at the top */}
        <div className={[styles.editor, pinned || mode === 'decor' ? styles.pinned : ''].filter(Boolean).join(' ')}>
          <div className={styles.mapCol}>
            {/* phones: undo, redo and finish on the map while decorating, the panel under it has the pictures */}
            {mode === 'decor' && !preview && (
              <div className={styles.mapSave}>
                <button className={styles.pillButton} onClick={undo} disabled={!canUndo} aria-label={tr('Undo')}>
                  ↶
                </button>
                <button className={styles.pillButton} onClick={redo} disabled={!canRedo} aria-label={tr('Redo')}>
                  ↷
                </button>
                <button
                  className={[styles.pillButton, styles.saveButton, dirty ? styles.unsaved : ''].join(' ')}
                  onClick={() => void finishDecor()}
                  disabled={saving}
                >
                  {saving ? tr('saving…') : tr('Finish')}
                </button>
              </div>
            )}
            {removed && removed.map === map && mode === 'decor' && (
              <p className={styles.mapToast}>
                {tr('{what} removed', {what: removed.what})}
                <button
                  onClick={() => {
                    undo();
                    setRemoved(null);
                  }}
                >
                  {tr('Undo')}
                </button>
              </p>
            )}
            {decorNote && <p className={[styles.mapToast, styles.mapToastLong].join(' ')}>{decorNote}</p>}
            {/* phones: undo and save on the map while an area is edited, the toolbar is further down then */}
            {selectedArea && mode === 'idle' && dirty && !preview && (
              <div className={styles.mapSave}>
                <button className={styles.pillButton} onClick={undo} disabled={history.length === 0} aria-label={tr('Undo')}>
                  ↶
                </button>
                {future.length > 0 && (
                  <button className={styles.pillButton} onClick={redo} aria-label={tr('Redo')}>
                    ↷
                  </button>
                )}
                <button className={[styles.pillButton, styles.saveButton, styles.unsaved].join(' ')} onClick={() => void handleSave()} disabled={saving}>
                  {saving ? tr('saving…') : (external && dirty) || (saveWarning && !idle) ? tr('Save anyway') : tr('Save map')}
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
                <button onClick={() => setSpotClosed(search.get('at'))} aria-label="close">
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
                pin={mode === 'decor' ? undefined : {on: pinned, onToggle: togglePinned}}
                snap={mode === 'decor' ? undefined : {on: snapOn, onToggle: toggleSnap}}
                map={shownMap}
                emergency={emergency}
                track={simShown ? undefined : trackShown}
                beforeTrack={trackShown && !simShown ? before : undefined}
                pastTrack={
                  simShown
                    ? undefined
                    : viewJob?.segments?.map((s) => ({
                        points: s.points.map(([x, y]) => ({x, y})),
                        blades: !!s.attributes.blades,
                      }))
                }
                sim={simShown}
                leftPieces={simLeft}
                navErrors={simResult?.navErrors}
                selectedAreaId={selectedAreaId}
                onSelectArea={selectArea}
                onMoveVertex={simplifyCm === null && (mode === 'idle' || mode === 'decor') ? moveVertex : undefined}
                onDragStart={remember}
                onDragging={dragging}
                onDecorate={mode === 'idle' ? enterDecor : undefined}
                // the start of a pinch, nothing to redo
                onDragCancel={() => undoStep(false)}
                onUndo={undo}
                onInsertVertex={simplifyCm === null && mode !== 'decor' ? insertVertex : undefined}
                onDeleteVertex={simplifyCm === null && mode !== 'decor' ? deleteVertex : undefined}
                pickingPoints={mode === 'split' || mode === 'draw'}
                onClickEmpty={deselect}
                decor={mode === 'decor' ? {armed: !!decor?.look} : undefined}
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
                preview={splitPreview ?? (merged ? [merged.outline] : subtractable ? subtracted?.pieces : laid?.valid ? [laid.outline] : undefined)}
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
                marginPlaces={simResult ? simResult.touches : marginPlaces.length ? marginPlaces : undefined}
                jumpPlaces={realPlan?.checks ? [...realPlan.checks.jumps, ...realPlan.checks.unchecked] : undefined}
                focus={spot ?? undefined}
              />
            )}

            {!preview && selectedArea && mode === 'idle' && simplifyCm === null && selectedArea.properties.type === 'mow' && !simClock && (
              <AngleOnMap area={selectedArea} autoAngle={autoAngle} remember={remember} update={updateProperties} onEdit={touchAngle} />
            )}
            {!preview && simClock && <SimPlayer clock={simClock} onClose={() => setSim((s) => (s ? {...s, shown: false} : s))} />}


            {!map && <p className={styles.dim}>{tr('waiting for map…')}</p>}
          </div>

          <div className={styles.panel}>
            {preview ? (
              <RestorePanel
                areas={preview.map.areas.filter((a) => !isPin(a)).length}
                backedUp={!!backups}
                idle={idle}
                restoring={restoring}
                confirm={confirmRestore}
                error={restoreError}
                onRestore={() => (confirmRestore ? void restore() : setConfirmRestore(true))}
                onDisarm={() => setConfirmRestore(false)}
                onClose={closePreview}
              />
            ) : (
              <>
              {map && mode !== 'decor' && (
                <EditorToolbar
                  idle={mode === 'idle'}
                  canUndo={history.length > 0}
                  canRedo={future.length > 0}
                  unsaved={dirty}
                  saving={saving}
                  saveLabel={
                    saving ? tr('saving…') : (external && dirty) || warnings || (saveWarning && !idle) ? tr('Save anyway') : tr('Save map')
                  }
                  saveError={saveError ?? droppedNote}
                  onDraw={startDraw}
                  onUndo={undo}
                  onRedo={redo}
                  onSave={() => void handleSave()}
                />
              )}

              {decorAsk === 'style' && !garden && mode === 'idle' && (
                <div ref={askRef} className={styles.warning}>
                  <p>{tr('Pictures are only drawn in the garden style.')}</p>
                  <div className={styles.inlineRow}>
                    <button className={styles.pillButton} onClick={decorInGarden}>
                      {tr('Switch on the garden style')}
                    </button>
                    <button className={styles.pillButton} onClick={() => setDecorAsk(null)}>
                      {tr('Cancel')}
                    </button>
                  </div>
                </div>
              )}
              {decorAsk === 'save' && areasChanged && mode === 'idle' && (
                <div ref={askRef} className={styles.warning}>
                  {/* the mower out: asked here, not in the warning further down */}
                  <p>
                    {tr('Save your map changes first.')}
                    {!idle && ` ${tr('The mower is busy. Saving now can interrupt it.')}`}
                  </p>
                  <div className={styles.inlineRow}>
                    <button className={styles.pillButton} onClick={() => void handleSave(true).then((ok) => setDecorNext(ok))} disabled={saving}>
                      {saving ? tr('saving…') : idle ? tr('Save map') : tr('Save anyway')}
                    </button>
                    <button className={styles.pillButton} onClick={() => setDecorAsk(null)}>
                      {tr('Cancel')}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'decor' && map && decor && (
                <DecorPanel
                  areas={map.areas}
                  pin={pickedPin}
                  armed={decor.look ? {look: decor.look, copy: !!decor.copy} : null}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  unsaved={dirty}
                  saving={saving}
                  busy={decorBusy && !idle}
                  error={saveError}
                  changed={decorChanged}
                  onArm={armPin}
                  onCopy={copyPin}
                  onRemove={removePin}
                  onUndo={undo}
                  onRedo={redo}
                  onFinish={() => void finishDecor()}
                  onSaveAnyway={() => void finishDecor(true)}
                  onLater={decorLater}
                  onCancel={cancelDecor}
                  onSwap={swapPin}
                />
              )}


              {mode === 'idle' && map && <Problems problems={problems} map={map} onSelect={selectArea} />}

              {/* (finishing decorating puts both together by itself) */}
              {external && dirty && mode !== 'decor' && (
                <div ref={conflictRef} className={[styles.warning, conflictArmed ? styles.warningArmed : ''].join(' ')}>
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

              {saveWarning && !idle && (
                <div className={styles.warning}>
                  <p>{tr('The mower is busy (mowing, docking or recording). Changing the map now can break that off. Better save once it is done.')}</p>
                  <a onClick={() => setSaveWarning(false)}>{tr("don't save for now")}</a>
                </div>
              )}

              {map && !selectedArea && mode === 'idle' && (
                <>
                  {map.areas.length ? (
                    <p className={styles.dim}>
                      {tr('Click an area to edit it.')}{' '}
                      {/* the pictures standing by themselves take no taps here */}
                      {garden && map.areas.some(isPin) && `${tr("Set and change pictures: the map's gear, Decorate.")} `}
                      <Link href="/guide/editor" className={styles.guideLink}>
                        {tr('How it works, step by step')}
                      </Link>
                    </p>
                  ) : (
                    <p className={styles.dim}>
                      {tr('No area yet.')}{' '}
                      <Link href="/guide" className={styles.guideLink}>
                        {tr('How to record the map, step by step')}
                      </Link>
                    </p>
                  )}
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
                    <OrderBox areas={mowAreas} idle={idle} onSelect={selectArea} onMove={moveInOrder} />
                  )}

                  {/* without the planner (or with OpenMower's slic3r planning) OpenMower's own values for all areas */}
                  {(!plannerSettings || slic3r) && canSetParams && (
                    <Fold id="mowingAll" title={tr('Mowing for all areas')}>
                      <div className={styles.foldCards}>
                        <section className={settingsStyles.card}>
                          <OpenMowerMowing styles={settingsStyles} />
                        </section>
                      </div>
                    </Fold>
                  )}

                  {/* everything for the planner is here at the map: for all areas, an area's own with the area */}
                  {plannerSettings && (
                    <Fold id="plannerAll" title={tr('Planner for all areas')}>
                      <PlannerSimple
                        toolWidth={toolWidth}
                        omIncrement={angleIncrement}
                        map={map}
                        onSelectArea={selectArea}
                        expert={
                          <div className={styles.foldCards}>
                            <PlannerSettings styles={settingsStyles} />
                          </div>
                        }
                      />
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
                    onDownloadGeo={() => void downloadGeo()}
                    onFile={(m, name) => setPreview({map: m, label: name})}
                    // a geojson file goes into the map being edited, checked like any edit, undone or saved from here
                    geo={
                      datum
                        ? {
                            datum,
                            base: map,
                            onLoad: (m) => {
                              remember();
                              setMap(m);
                            },
                          }
                        : null
                    }
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
                <MergePanel area={selectedArea} other={other} merged={merged} onApply={applyMerge} onCancel={cancelPicking} />
              )}

              {mode === 'subtract' && selectedArea && (
                <SubtractPanel area={selectedArea} other={other} result={subtracted} onApply={applySubtract} onCancel={cancelPicking} />
              )}

              {mode === 'snap' && selectedArea && (
                <SnapPanel area={selectedArea} other={other} moving={moving} laid={laid} cm={snapCm} onCm={setSnapCm} onApply={applySnap} onCancel={cancelPicking} />
              )}

              {mode === 'draw' && <DrawPanel points={pendingPoints.length} onFinish={finishDraw} onCancel={cancelPicking} />}

              {map && selectedArea && mode === 'idle' && (
                <AreaCard
                  area={selectedArea}
                  areas={map.areas}
                  showTools={simplifyCm === null}
                  confirmDelete={confirmDelete === selectedArea.id}
                  remember={remember}
                  update={updateProperties}
                  onSplit={startSplit}
                  onMerge={() => {
                    setSimplifyCm(null);
                    setMode('merge');
                  }}
                  onSubtract={() => {
                    setSimplifyCm(null);
                    setMode('subtract');
                  }}
                  onSnap={() => {
                    setSimplifyCm(null);
                    setMode('snap');
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
                      setMany: (values) => {
                        const own = {...(selectedArea.properties.planner ?? {})};
                        for (const [key, value] of Object.entries(values)) {
                          if (value === undefined || value === null) delete own[key];
                          else own[key] = value;
                        }
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
                  {selectedArea.properties.type === 'mow' && (
                    <PlanSimulation request={planRequest} sim={simNow} onResult={setSim} onShow={(shown) => setSim((s) => (s ? {...s, shown} : s))} />
                  )}
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
