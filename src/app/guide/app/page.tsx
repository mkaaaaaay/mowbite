'use client';

import {fmt, tr} from '@/lib/i18n';
import {anim, Scene} from '../art';
import Guide, {type GuideStep} from '../Guide';

// the dashboard's values and more than one mower, step by step with a drawing for each

const DUR = 6;
const card = {fill: 'var(--card)', stroke: 'var(--card-border)'};
const text = {fill: 'var(--foreground)'};
const dim = {fill: 'var(--text-secondary)'};
const accent = {fill: 'var(--accent)'};

// the top of the dashboard: the mower's name over its state, the round button with its first letter
function Head({name, letter}: {name: string; letter: string}) {
  return (
    <>
      <text x={24} y={34} fontSize={11} style={dim}>
        {name}
      </text>
      <text x={24} y={56} fontSize={20} fontWeight={600} style={text}>
        {tr('Mowing')}
      </text>
      <circle cx={290} cy={40} r={16} style={accent} />
      <text x={290} y={45} fontSize={14} fontWeight={700} textAnchor="middle" style={{fill: 'var(--accent-foreground)'}}>
        {letter}
      </text>
    </>
  );
}

// a value of the status card, faded in when it is ticked
function Row({y, label, value, from}: {y: number; label: string; value: string; from?: number}) {
  return (
    <g opacity={from === undefined ? 1 : 0}>
      {from !== undefined && anim('opacity', DUR, [0, from, from + 0.05, 1], [0, 0, 1, 1])}
      <text x={190} y={y} fontSize={11} style={dim}>
        {label}
      </text>
      <text x={290} y={y} fontSize={11} textAnchor="end" style={text}>
        {value}
      </text>
    </g>
  );
}

// a tick box of the list in the settings, ticked at that fraction of the loop
function Tick({y, label, at}: {y: number; label: string; at?: number}) {
  return (
    <>
      <rect x={26} y={y - 10} width={12} height={12} rx={3} style={{fill: 'none', stroke: 'var(--text-secondary)'}} />
      <path d={`M28 ${y - 4} l3 3 l5 -6`} fill="none" strokeWidth={2} strokeLinecap="round" style={{stroke: 'var(--accent)'}} opacity={at === undefined ? 1 : 0}>
        {at !== undefined && anim('opacity', DUR, [0, at, at + 0.05, 1], [0, 0, 1, 1])}
      </path>
      <text x={46} y={y} fontSize={11} style={text}>
        {label}
      </text>
    </>
  );
}

function ValuesArt() {
  return (
    <Scene still={DUR} label={tr('Your dashboard')}>
      <rect x={12} y={70} width={150} height={118} rx={12} style={card} />
      <text x={26} y={90} fontSize={11} fontWeight={600} style={dim}>
        {tr('Dashboard')}
      </text>
      <Tick y={112} label={tr('GPS')} />
      <Tick y={134} label={tr('Speed')} />
      <Tick y={156} label={tr('Mow motor')} at={0.4} />
      <Tick y={178} label={tr('Wi-Fi')} />
      <rect x={176} y={70} width={132} height={118} rx={12} style={card} />
      <Row y={96} label={tr('GPS')} value={`${fmt(1.8, 1)} cm`} />
      <Row y={120} label={tr('Speed')} value={`${fmt(0.4, 1)} m/s`} />
      <Row y={144} label={tr('Mow motor')} value="41 °C" from={0.45} />
      <Row y={168} label={tr('Wi-Fi')} value="-61 dBm" />
      <Head name={tr('Back lawn')} letter={tr('Back lawn').charAt(0)} />
    </Scene>
  );
}

function AddArt() {
  return (
    <Scene still={DUR} label={tr('More than one mower')}>
      <rect x={20} y={20} width={280} height={164} rx={12} style={card} />
      <text x={36} y={46} fontSize={14} fontWeight={600} style={text}>
        {tr('Mowers')}
      </text>
      <text x={36} y={74} fontSize={12} style={text}>
        {tr('Back lawn')}
      </text>
      <text x={284} y={74} fontSize={11} textAnchor="end" style={dim}>
        192.168.1.40
      </text>
      <g opacity={0}>
        {anim('opacity', DUR, [0, 0.45, 0.5, 1], [0, 0, 1, 1])}
        <text x={36} y={100} fontSize={12} style={text}>
          {tr('Front lawn')}
        </text>
        <text x={284} y={100} fontSize={11} textAnchor="end" style={dim}>
          192.168.1.41
        </text>
      </g>
      <rect x={36} y={136} width={124} height={30} rx={15} style={accent}>
        {anim('opacity', DUR, [0, 0.3, 0.35, 0.4, 1], [1, 1, 0.5, 1, 1])}
      </rect>
      <text x={98} y={155} fontSize={12} textAnchor="middle" style={{fill: 'var(--accent-foreground)'}}>
        {tr('Add mower')}
      </text>
    </Scene>
  );
}

function SwitchArt() {
  const swap = (show: 'first' | 'second') => anim('opacity', DUR, [0, 0.6, 0.62, 1], show === 'first' ? [1, 1, 0, 0] : [0, 0, 1, 1]);
  return (
    <Scene still={DUR} label={tr('Switching mowers')}>
      <rect x={12} y={12} width={296} height={176} rx={12} style={card} />
      <g>
        {swap('first')}
        <Head name={tr('Back lawn')} letter={tr('Back lawn').charAt(0)} />
      </g>
      <g opacity={0}>
        {swap('second')}
        <Head name={tr('Front lawn')} letter={tr('Front lawn').charAt(0)} />
      </g>
      {/* the list the round button opens */}
      <g opacity={0}>
        {anim('opacity', DUR, [0, 0.25, 0.3, 0.6, 0.62, 1], [0, 0, 1, 1, 0, 0])}
        <rect x={168} y={62} width={130} height={58} rx={8} style={{fill: 'var(--background)', stroke: 'var(--card-border)'}} />
        <text x={180} y={84} fontSize={12} style={text}>
          {tr('Back lawn')}
        </text>
        <rect x={172} y={92} width={122} height={22} rx={5} style={accent} opacity={0}>
          {anim('opacity', DUR, [0, 0.45, 0.5, 1], [0, 0, 0.35, 0.35])}
        </rect>
        <text x={180} y={108} fontSize={12} style={text}>
          {tr('Front lawn')}
        </text>
      </g>
      <rect x={24} y={140} width={272} height={8} rx={4} style={{fill: 'var(--well, rgba(0, 0, 0, 0.12))'}} />
      <rect x={24} y={140} width={190} height={8} rx={4} style={{fill: 'var(--success)'}} />
    </Scene>
  );
}

const STEPS: GuideStep[] = [
  {
    title: 'Your dashboard',
    text: "The dashboard shows what the mower is doing, its battery and a few values under it, such as GPS, speed and temperatures. Which values it shows you pick in Settings › Appearance › Dashboard: tick or untick each one. One that's off still shows while it warns.",
    Art: ValuesArt,
  },
  {
    title: 'More than one mower',
    text: 'Each of your mowers with MowBite can be added: in Settings › App › Mowers, under Add another mower, give it a name and its address in your home network (IP or name) and tap Add mower.',
    Art: AddArt,
  },
  {
    title: 'Switching mowers',
    text: "With more than one, the dashboard has a round button with the first letter of the mower's name at the top right (on a computer the choice is in the sidebar). Tap it and pick a mower. Its name stands above the state, so you always see which one you're looking at.",
    Art: SwitchArt,
  },
];

export default function AppGuidePage() {
  return <Guide steps={STEPS} done={{label: 'To the dashboard', href: '/'}} />;
}
