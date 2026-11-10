'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {tr} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {anim, appear, PAINT, Scene, SCREEN_LOOP} from '../art';
import Guide, {type GuideStep} from '../Guide';

// the lights and sounds of a mower with MowBite OS, step by step with a drawing for each

const DUR = SCREEN_LOOP;
const {card, field, well, text, dim, accent, onAccent} = PAINT;

// a button tapped at that fraction of the loop
const tap = (at: number) => anim('opacity', DUR, [0, at, at + 0.04, at + 0.08, 1], [1, 1, 0.5, 1, 1]);

// a state of the list: its name and its colors as dots
function State({y, name, colors}: {y: number; name: string; colors: string[]}) {
  return (
    <>
      <text x={34} y={y} fontSize={12} style={text}>
        {name}
      </text>
      {colors.map((c, i) => (
        <circle key={i} cx={210 + i * 14} cy={y - 4} r={5} fill={c} />
      ))}
    </>
  );
}

function LightsArt() {
  return (
    <Scene still={DUR} label={tr('Lights by state')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <State y={40} name={tr('Heading home')} colors={['#3b82f6']} />
      <State y={66} name={tr('Charging in the dock')} colors={['#22c55e']} />
      <State y={92} name={tr('Mowing')} colors={['#22c55e', '#facc15']} />
      {/* the state opened: its effect and a second color added */}
      <g opacity={0}>
        {appear(0.3)}
        <rect x={30} y={102} width={260} height={74} rx={8} style={field} />
        <text x={42} y={124} fontSize={11} style={dim}>
          {tr('Effect')}
        </text>
        <text x={278} y={124} fontSize={12} textAnchor="end" style={text}>
          {tr('Blinking')}
        </text>
        <text x={42} y={150} fontSize={11} style={dim}>
          {tr('Colors')}
        </text>
        <circle cx={250} cy={146} r={7} fill="#22c55e" />
        <circle cx={270} cy={146} r={7} fill="#facc15" opacity={0}>
          {appear(0.55)}
        </circle>
      </g>
    </Scene>
  );
}

function TryArt() {
  // the mower from above, its lights blinking once the button is tapped
  const blink = anim('fill', DUR, [0, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1], ['#3a3a3a', '#3a3a3a', '#22c55e', '#facc15', '#22c55e', '#facc15', '#22c55e', '#22c55e']);
  return (
    <Scene still={DUR} label={tr('Try it, then save')}>
      <rect x={100} y={26} width={120} height={100} rx={30} fill="#5b5f66" />
      <rect x={124} y={40} width={72} height={10} rx={5} fill="#3a3a3a">
        {blink}
      </rect>
      <rect x={44} y={146} width={140} height={30} rx={15} style={card}>
        {tap(0.3)}
      </rect>
      <text x={114} y={165} fontSize={12} textAnchor="middle" style={text}>
        {tr('Show on the mower')}
      </text>
      <g opacity={0}>
        {appear(0.8)}
        <rect x={196} y={146} width={84} height={30} rx={15} style={accent} />
        <text x={238} y={165} fontSize={12} textAnchor="middle" style={onAccent}>
          {tr('Save')}
        </text>
      </g>
    </Scene>
  );
}

function SoundsArt() {
  // the waves of the speaker while it plays
  const wave = (r: number, at: number) => (
    <path d={`M${232 + r} ${66 - r} A${r * 1.4} ${r * 1.4} 0 0 1 ${232 + r} ${66 + r}`} fill="none" strokeWidth={2} strokeLinecap="round" style={{stroke: 'var(--accent)'}} opacity={0}>
      {anim('opacity', DUR, [0, at, at + 0.05, 0.75, 0.8, 1], [0, 0, 1, 1, 0, 0])}
    </path>
  );
  return (
    <Scene still={DUR} label={tr('Sounds')}>
      <rect x={20} y={14} width={280} height={100} rx={12} style={card} />
      <text x={36} y={42} fontSize={13} fontWeight={600} style={text}>
        {tr('Mowing starts')}
      </text>
      <rect x={36} y={66} width={86} height={28} rx={14} style={accent}>
        {tap(0.25)}
      </rect>
      <text x={79} y={84} fontSize={12} textAnchor="middle" style={onAccent}>
        {tr('Listen')}
      </text>
      <path d="M212 58 h8 l10 -9 v34 l-10 -9 h-8 z" style={dim} />
      {wave(8, 0.3)}
      {wave(16, 0.36)}
      <rect x={20} y={126} width={280} height={60} rx={12} style={card} />
      <text x={36} y={150} fontSize={12} style={text}>
        {tr('Volume {n} %', {n: 60})}
      </text>
      <rect x={36} y={164} width={248} height={6} rx={3} style={well} />
      <rect x={36} y={164} width={149} height={6} rx={3} style={accent} />
      <circle cx={185} cy={167} r={8} style={accent} />
    </Scene>
  );
}

function OwnSoundArt() {
  // the own sound chosen, sent in parts, then it is the situation's
  const bar = anim('width', DUR, [0, 0.3, 0.6, 1], [0, 0, 248, 248]);
  return (
    <Scene still={DUR} label={tr('Your own sounds')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <text x={36} y={42} fontSize={13} fontWeight={600} style={text}>
        {tr('Mowing starts')}
      </text>
      <rect x={36} y={58} width={150} height={28} rx={14} style={field}>
        {tap(0.2)}
      </rect>
      <text x={111} y={76} fontSize={12} textAnchor="middle" style={text}>
        {tr('Choose your own sound')}
      </text>
      <rect x={36} y={104} width={248} height={6} rx={3} style={well} />
      <rect x={36} y={104} width={0} height={6} rx={3} style={accent}>
        {bar}
      </rect>
      <g opacity={0}>
        {appear(0.7)}
        <text x={36} y={140} fontSize={12} style={dim}>
          {tr('{n} s, {from}', {n: 4, from: tr('your own')})}
        </text>
        <text x={36} y={166} fontSize={12} textDecoration="underline" style={dim}>
          {tr('Sound of the manufacturer')}
        </text>
      </g>
    </Scene>
  );
}

const LIGHTS: GuideStep[] = [
  {
    title: 'Lights by state',
    text: 'The lights on the mower show what it is doing. In Settings › Lights every state has its own look: open one and pick the effect (steady, blinking, pulsing, a running light or a color gradient), its colors, how fast it moves and how bright it is.',
    Art: LightsArt,
  },
  {
    title: 'Try it, then save',
    text: "Tap Show on the mower: it shows there for a few seconds, nothing is saved yet. If you like it, tap Save, Discard puts it back. During an emergency stop the lights show that instead, it looks the same on every mower and can't be changed. All back to the defaults resets every state.",
    Art: TryArt,
  },
];
const SOUNDS: GuideStep = {
  title: 'Sounds',
  text: 'A mower with a speaker plays a sound in some situations, such as when mowing starts or the battery is low. Settings › Sounds lists them: tap Listen to hear one on the mower. One volume counts for all of them. At 0 it plays nothing at all, not even for an emergency stop.',
  Art: SoundsArt,
};
const OWN_SOUND: GuideStep = {
  title: 'Your own sounds',
  text: "Choose your own sound picks an MP3 on this device for a situation, at most 30 s long and 2 MB large. It goes to the mower in parts, the mower checks it, then plays it instead of the manufacturer's. Sound of the manufacturer deletes yours again, tap it twice.",
  Art: OwnSoundArt,
};

export default function LightsGuidePage() {
  const methods = useRpcMethods();
  const lights = !!methods?.has(RPC.lightGet);
  const sounds = !!methods?.has(RPC.soundList);
  const own = !!methods?.has(RPC.soundUpload);
  // all while it isn't known (yet) what the mower has
  const steps = lights || sounds ? [...(lights ? LIGHTS : []), ...(sounds ? [SOUNDS] : []), ...(own ? [OWN_SOUND] : [])] : [...LIGHTS, SOUNDS, OWN_SOUND];
  return <Guide steps={steps} done={{label: 'To the settings', href: lights || !sounds ? '/settings#lights' : '/settings#sounds'}} />;
}
