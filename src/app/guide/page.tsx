'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useMowbiteOs} from '@/lib/mowerOs';
import {RPC} from '@/lib/openmower';
import {ART, LegendIcon} from './art';
import Guide, {type GuideItem, type GuideStep} from './Guide';

// recording the map, step by step with a drawing for each. osText: the step on MowBite OS where it differs, undoText
// there with the back button
const STEPS: (GuideStep & {osText?: string; undoText?: string})[] = [
  {
    title: 'Map your garden',
    text: 'The mower mows by a map: the areas it mows, the obstacles it drives around and its docking station. You record them once by driving it around them with the joystick, the app draws along. To start, tap Record under the map on the Map tab.',
  },
  {
    title: 'Driving',
    text: "Tap Start recording mode, if it's out mowing tap Send it home first: the job it was on ends once you record an area, the next start plans on the new map. Upright you drive with the joystick. Held sideways the phone becomes a remote control: the left pad drives forward and back, the right one steers, the steps are buttons at the bottom. If your phone doesn't rotate, tap Sideways. After an emergency stop or when the connection was gone, let go and press again to drive on.",
  },
  {
    title: 'Docking station',
    text: 'Tap Record docking station, it guides you. The mower stands in the station until it charges, then you back it out straight 1 to 1½ m, steering only where the ground pushes it aside, and it stands there a moment. Tap Save docking station: the way between becomes its docking direction. Then drive it back in.',
    osText:
      'Stop about a meter in front of the docking station, facing it, and tap Record docking station. Then drive it straight in until it sits on the contacts and tap Save docking position: the way between becomes its docking direction.',
  },
  {
    title: 'Mowing area',
    text: 'Drive to the edge of the lawn, tap Record outline and drive once around it, close to the edge: the line is the middle of the mower. Back at the start, the outline closes by itself. Without obstacles, tap Save as mowing area then.',
  },
  {
    title: 'Obstacles',
    text: 'Beds, trees, the pond: before saving the area, tap Record obstacle and drive closely around each one. Then tap Save as mowing area, the mower leaves the obstacles out.',
  },
  {
    title: 'Paths and the way to the dock',
    text: "The mower only drives on mowing and navigation areas. If two lawns don't touch, record the path between them the same way and tap Save as navigation area. The spot in front of the dock where it lines up (Settings, Docking: Approach in a straight line from) has to lie in one of them too: from there it drives straight in.",
  },
  {
    title: 'Tips',
    text: 'Only record with an RTK fix, otherwise the edge ends up off. Drive slowly along edges. For straight edges switch Auto points off and tap Set point here only at the corners, otherwise the mower sets a point every 10 cm. When you are done, tap Leave recording mode, held sideways the ✕. Leaving the page asks first and ends it as well.',
    undoText:
      'Only record with an RTK fix, otherwise the edge ends up off. Drive slowly along edges. For straight edges switch Auto points off and tap Set point here only at the corners, otherwise the mower sets a point every 10 cm. Gone wrong? The back button takes the end of the line away piece by piece. The mower stays where it is and Auto points go off: drive back to the end of the line and switch them on again. When you are done, tap Leave recording mode, held sideways the ✕. Leaving the page asks first and ends it as well.',
  },
  {
    title: 'What a map is made of',
    text: 'A map has these parts. Afterwards you can fine-tune everything in the map editor: move points, merge areas, reduce points. The guide Edit the map shows how.',
  },
].map((s, i) => ({...s, Art: ART[i]}));

const ITEMS: GuideItem[] = (
  [
    {kind: 'mow', title: 'Mowing area', text: 'Where it mows. Each one has its own mowing angle and settings.'},
    {kind: 'nav', title: 'Navigation area', text: "A way between areas that don't touch, the mower only drives through it with the blade off."},
    {kind: 'obstacle', title: 'Obstacle', text: 'A bed, a tree or the pond inside a mowing area. It drives around it.'},
    {kind: 'dock', title: 'Docking station', text: 'Where it sets off from and comes back to charge.'},
  ] as const
).map((l) => ({key: l.kind, title: l.title, text: l.text, icon: (dock) => <LegendIcon kind={l.kind} dock={dock} />}));

export default function GuidePage() {
  const os = useMowbiteOs();
  // MowBite OS's own steps, the back button where it has recording.undo
  const undo = !!useRpcMethods()?.has(RPC.recordingUndo);
  const steps = os ? STEPS.map((s) => ({...s, text: (undo && s.undoText) || s.osText || s.text})) : STEPS;
  return <Guide steps={steps} items={ITEMS} done={{label: 'Record now', href: '/record'}} />;
}
