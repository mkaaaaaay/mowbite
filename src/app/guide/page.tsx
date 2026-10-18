'use client';

import {ART, LegendIcon} from './art';
import Guide, {type GuideItem, type GuideStep} from './Guide';

// recording the map, step by step with a drawing for each
const STEPS: GuideStep[] = [
  {
    title: 'Map your garden',
    text: 'The mower mows by a map: the areas it mows, the obstacles it drives around and its docking station. You record them once by driving it around them with the joystick, the app draws along. To start, tap Record under the map on the Map tab.',
  },
  {
    title: 'Docking station',
    text: 'Tap Start recording mode. If the mower is in the dock, back it out about a meter, it then faces the station. Tap Record docking station, drive straight in until it sits on the contacts and tap Save docking position. That way in becomes its docking direction.',
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
    text: "The mower only drives on mowing and navigation areas. If two lawns don't touch, record the path between them the same way and tap Save as navigation area. The spot about 1.5 m in front of the dock has to lie in one of them too: from there it drives straight in.",
  },
  {
    title: 'Tips',
    text: 'Only record with an RTK fix, otherwise the edge ends up off. Drive slowly along edges. For straight edges switch Auto points off and tap Set point here only at the corners, otherwise the mower sets a point every 10 cm. When you are done, tap Leave recording mode.',
  },
  {
    title: 'What a map is made of',
    text: 'A map has these parts. Afterwards you can fine tune everything in the map editor: move points, merge areas, reduce points. The guide Edit the map shows how.',
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
  return <Guide steps={STEPS} items={ITEMS} done={{label: 'Record now', href: '/record'}} />;
}
