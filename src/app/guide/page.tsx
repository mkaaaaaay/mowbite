'use client';

import {ART, LegendIcon} from './art';
import Guide, {type GuideItem, type GuideStep} from './Guide';

// recording the map, step by step with a drawing for each
const STEPS: GuideStep[] = [
  {
    title: 'Map your garden',
    text: 'MowBite mows by a map: the areas it mows, the obstacles it drives around and its docking station. You record them once by driving the mower around them with the joystick on the Record page, the app draws along.',
  },
  {
    title: 'Docking station',
    text: 'Start recording mode, stop the mower about a meter in front of the station, facing it, and tap Record docking station. Then drive straight in until it sits on the contacts and tap Save docking position.',
  },
  {
    title: 'Mowing area',
    text: 'Drive to the edge of the lawn, tap Record outline and drive once around it, close to the edge: the line is the middle of the mower. Stop back at the start, the outline closes by itself.',
  },
  {
    title: 'Obstacles',
    text: 'Beds, trees, the pond: before saving the area, tap Record obstacle and drive closely around each one. Then tap Save as mowing area, the mower leaves the obstacles out.',
  },
  {
    title: 'What a map is made of',
    text: 'A map has these parts. Afterwards you can fine tune everything in the map editor: move points, merge or simplify areas.',
  },
].map((s, i) => ({...s, Art: ART[i]}));

const ITEMS: GuideItem[] = (
  [
    {kind: 'mow', title: 'Mowing area', text: 'Where it mows. Each one has its own mowing angle and settings.'},
    {kind: 'nav', title: 'Navigation area', text: 'A way between areas, the mower only drives through it with the blade off.'},
    {kind: 'obstacle', title: 'Obstacle', text: 'A bed, a tree or the pond inside a mowing area. It drives around it.'},
    {kind: 'dock', title: 'Docking station', text: 'Where it sets off from and comes back to charge.'},
  ] as const
).map((l) => ({key: l.kind, title: l.title, text: l.text, icon: (dock) => <LegendIcon kind={l.kind} dock={dock} />}));

export default function GuidePage() {
  return <Guide steps={STEPS} items={ITEMS} done={{label: 'Record now', href: '/record'}} />;
}
