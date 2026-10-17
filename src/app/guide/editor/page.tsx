'use client';

import {CheckIcon, PencilIcon, RouteIcon, UndoIcon} from '@/components/icons';
import {EDITOR_ART} from '../editorArt';
import Guide, {type GuideItem, type GuideStep} from '../Guide';
import styles from '../page.module.css';

// changing the map in the editor, step by step with a drawing for each
const STEPS: GuideStep[] = [
  {
    title: 'Edit the map',
    text: 'On the Map page, tap an area: its points show up and you can change it. Nothing reaches the mower before you tap Save map, until then Undo takes every step back.',
  },
  {
    title: 'Move points',
    text: 'Drag a point to where the edge really is. Drag the small dot between two points to add one there. Tap a point and then the button next to it to delete it.',
  },
  {
    title: 'Split area',
    text: 'Tap Split area, then points for a line across the area, starting and ending outside it, and apply. Both parts keep type and settings. The same way you can cut a shape out of it.',
  },
  {
    title: 'Merge',
    text: 'Tap Merge, then the other area. They have to overlap or touch. The result keeps the name, type and settings of the first one.',
  },
  {
    title: 'Reduce points',
    text: 'Recorded edges have a point every few centimeters. Reduce points takes out the ones that barely change the shape, the slider sets how far the edge may move.',
  },
].map((s, i) => ({...s, Art: EDITOR_ART[i]}));

const tool = (icon: React.ReactNode, save = false) => <span className={[styles.tool, save ? styles.save : ''].join(' ')}>{icon}</span>;

const ITEMS: GuideItem[] = [
  {key: 'draw', title: 'Draw', text: 'A new area by tapping its corners on the map.', icon: () => tool(<PencilIcon size={20} />)},
  {key: 'record', title: 'Record', text: 'A new area by driving around it with the mower.', icon: () => tool(<RouteIcon size={20} />)},
  {key: 'undo', title: 'Undo', text: 'Takes the last change back, as often as you like.', icon: () => tool(<UndoIcon size={20} />)},
  {key: 'save', title: 'Save map', text: "Sends the map to the mower. With MowBite's container the old one is backed up first.", icon: () => tool(<CheckIcon size={20} />, true)},
];

export default function EditorGuidePage() {
  return <Guide steps={STEPS} items={ITEMS} itemsTitle="In the editor bar" done={{label: 'To the map', href: '/map'}} />;
}
