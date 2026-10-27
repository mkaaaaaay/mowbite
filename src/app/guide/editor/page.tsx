'use client';

import {CheckIcon, PencilIcon, RedoIcon, RouteIcon, UndoIcon} from '@/components/icons';
import {EDITOR_ART} from '../editorArt';
import Guide, {type GuideItem, type GuideStep} from '../Guide';
import styles from '../page.module.css';

// changing the map in the editor, step by step with a drawing for each
const STEPS: GuideStep[] = [
  {
    title: 'Edit the map',
    text: 'On the Map tab, tap an area: its points show up, and under the map you find its settings and tools. Nothing changes on the mower until you tap Save map, until then Undo takes every step back and Redo brings it back.',
  },
  {
    title: 'Area types',
    text: "Mowing areas are driven on and mowed, navigation areas only driven on (e.g. a path between two lawns), the mower doesn't go anywhere else. Obstacles such as beds lie inside a mowing area and are driven around. Decoration such as the beds round the lawn is only a picture on the map, the mower ignores it. A draft is just a sketch, the mower ignores it too.",
  },
  {
    title: 'Leaving areas out',
    text: "Two ways to leave an area out: with don't mow the mower still drives across it, but doesn't mow it. Without the tick at active it ignores the area completely and doesn't even drive on it (standing on it, it gets stuck). An inactive obstacle simply gets mowed over.",
  },
  {
    title: 'Edit points',
    text: 'Hold a point for a moment and drag it to where the edge really is. Drag the small dot between two points the same way, a new point appears there. To delete a point, tap it and then the trash button next to it.',
  },
  {
    title: 'Snapping',
    text: "Dragged or set close to another area's corner or edge, a point snaps onto it, so the two meet without a gap. The magnet on the map switches snapping off, on a computer Alt places a single point freely.",
  },
  {
    title: 'Split area',
    text: 'Tap Split area, set points for a line across the area (start and end outside) and tap Apply split. Both parts keep type and settings. With Cut out a shape you tap the corners of a shape inside the area instead, it becomes an area of its own.',
  },
  {
    title: 'Merge',
    text: 'Tap Merge and then the second area, then Apply merge under the map. The two have to touch or overlap. The new area keeps the name, type and settings of the one picked first.',
  },
  {
    title: 'Take out',
    text: 'If an area lies over another one, e.g. a path over the lawn, pick the lawn, tap Take out, then the path and Take out under the map. The part under the path drops out of the lawn, the path stays as it is. If it lies fully inside, the rest is split in two through it.',
  },
  {
    title: 'Lay against',
    text: 'For a whole edge at once: pick e.g. a bed, tap Lay against, then the lawn next to it and Lay against under the map. Its corners close to the lawn move onto the lawn\'s edge, the slider sets how far they may be off. A mowing area stays as it is, unless both are.',
  },
  {
    title: 'Reduce points',
    text: 'Recorded edges mostly have a point every 10 cm, which makes editing fiddly. Reduce points takes out the ones that barely change the shape. The slider sets how far the edge may move at most.',
  },
  {
    title: 'Mow angle',
    text: 'The mow angle is the direction of the lanes. With a mowing area picked you set it with the slider (on a phone at the bottom of the map), − and + change it by 1°, the map shows the lanes meanwhile. You can type it in under Mowing settings (with the planner: This area).',
  },
  {
    title: 'Mowing order',
    text: 'With no area picked (tap next to the areas), the mowing order is under the map. With ↑ and ↓ an area comes earlier or later, the numbers on the map change along. This too only counts after Save map.',
  },
  {
    title: 'Real edges',
    text: "When recording, the mower keeps the path of its middle: that's the line. Its body reaches further though, up to the dashed line, the real edge. So the green strip between them is lawn too. The dashed line needs your mower's sizes (Settings, Your mower).",
  },
  {
    title: 'Simulate the drive',
    text: "With the MowBite Planner on the mower, Simulate the drive under This area drives the area's plan the way your mower would: with OpenMower's controller and the errors of GPS, wheels and drive. On the map you see what's left unmowed (orange), where the body gets into the safety distance (red) and how long it takes. The bar at the bottom of the map plays the drive back, faster or slower. Change something on the area and the result is gone, simulate again then.",
  },
  {
    title: 'Map style',
    text: 'With the gear on the map you pick the map style: Plain shows colored areas, Garden draws the garden from above (off until you pick it). There ways, obstacles and decoration get a picture by their name. With one picked you change it under the map at Picture on the map, and its color, size, direction and the ground under it. Light and shadows, the season, the lawn growing back and a mowing edge can be switched on one by one.',
  },
  {
    title: 'Decorate',
    text: "In the garden style the gear on the map has Decorate. It sets pictures that stand by themselves, such as a gnome, a lamp or a bench: tap one in the row under the map, then the spot on the map. Tap a picture with a ring to change its color, size and rotation, hold it to move it. Finish saves them on the mower, Cancel takes it all back. To the mower they are only pictures, it doesn't drive round them.",
  },
  {
    title: 'Save and backups',
    text: 'Save map sends the map to the mower. With MowBite running as a container on the mower, the old map is backed up first: under the map at Backups (no area picked) Preview shows it and Restore brings it back.',
  },
].map((s, i) => ({...s, Art: EDITOR_ART[i]}));

const tool = (icon: React.ReactNode, save = false) => <span className={[styles.tool, save ? styles.save : ''].join(' ')}>{icon}</span>;

const ITEMS: GuideItem[] = [
  {key: 'draw', title: 'Draw', text: 'A new area by tapping its corners on the map.', icon: () => tool(<PencilIcon size={20} />)},
  {key: 'record', title: 'Record', text: 'A new area by driving around it with the mower.', icon: () => tool(<RouteIcon size={20} />)},
  {key: 'undo', title: 'Undo', text: 'Takes the last change back, step by step up to the last save.', icon: () => tool(<UndoIcon size={20} />)},
  {key: 'redo', title: 'Redo', text: 'Brings back what Undo took back, until something else gets changed.', icon: () => tool(<RedoIcon size={20} />)},
  {key: 'save', title: 'Save map', text: 'Sends the map to the mower, nothing changes there before.', icon: () => tool(<CheckIcon size={20} />, true)},
];

export default function EditorGuidePage() {
  return <Guide steps={STEPS} items={ITEMS} itemsTitle="In the editor bar" done={{label: 'To the map', href: '/map'}} tallArt />;
}
