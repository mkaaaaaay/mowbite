'use client';

import {useCameras} from '@/hooks/useCameras';
import {useObstacles} from '@/hooks/useObstacles';
import {obstacleGlyph} from '@/components/ObstacleGlyph';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {SHORT} from '@/lib/camera';
import {useDockTestSeries} from '@/lib/mowerOs';
import {DOCK_TEST_REACH, DOCK_TEST_RUNS, RPC} from '@/lib/openmower';
import {fmt, tr} from '@/lib/i18n';
import {anim, appear, DockTestArt, PAINT, Scene, SCREEN_LOOP} from '../art';
import Guide, {type GuideStep} from '../Guide';

// the dashboard's values, the cameras and what the obstacle sensors saw on a mower that has them and more than one mower, step by step with a drawing for each

const DUR = SCREEN_LOOP;
const {card, field, well, text, dim, accent, onAccent} = PAINT;

// the top of the dashboard: the mower's name over its state, the round button with its first letter
function Head({name}: {name: string}) {
  return (
    <>
      <text x={24} y={34} fontSize={11} style={dim}>
        {name}
      </text>
      <text x={24} y={56} fontSize={20} fontWeight={600} style={text}>
        {tr('Mowing')}
      </text>
      <circle cx={290} cy={40} r={16} style={accent} />
      <text x={290} y={45} fontSize={14} fontWeight={700} textAnchor="middle" style={onAccent}>
        {name.charAt(0)}
      </text>
    </>
  );
}

// a value of the status card, faded in when it is ticked
function Row({y, label, value, from}: {y: number; label: string; value: string; from?: number}) {
  return (
    <g opacity={from === undefined ? 1 : 0}>
      {from !== undefined && appear(from)}
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
        {at !== undefined && appear(at)}
      </path>
      <text x={46} y={y} fontSize={11} style={text}>
        {label}
      </text>
    </>
  );
}

function ValuesArt() {
  return (
    <Scene label={tr('Your dashboard')}>
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
      <Head name={tr('Back lawn')} />
    </Scene>
  );
}

function AddArt() {
  return (
    <Scene label={tr('More than one mower')}>
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
        {appear(0.45)}
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
      <text x={98} y={155} fontSize={12} textAnchor="middle" style={onAccent}>
        {tr('Add mower')}
      </text>
    </Scene>
  );
}

function SwitchArt() {
  const swap = (show: 'first' | 'second') => anim('opacity', DUR, [0, 0.6, 0.62, 1], show === 'first' ? [1, 1, 0, 0] : [0, 0, 1, 1]);
  return (
    <Scene label={tr('Switching mowers')}>
      <rect x={12} y={12} width={296} height={176} rx={12} style={card} />
      <g>
        {swap('first')}
        <Head name={tr('Back lawn')} />
      </g>
      <g opacity={0}>
        {swap('second')}
        <Head name={tr('Front lawn')} />
      </g>
      {/* the list the round button opens */}
      <g opacity={0}>
        {anim('opacity', DUR, [0, 0.25, 0.3, 0.6, 0.62, 1], [0, 0, 1, 1, 0, 0])}
        <rect x={168} y={62} width={130} height={58} rx={8} style={field} />
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
      <rect x={24} y={140} width={272} height={8} rx={4} style={well} />
      <rect x={24} y={140} width={190} height={8} rx={4} style={{fill: 'var(--success)'}} />
    </Scene>
  );
}

// a camera's picture with the cameras to switch to on it, the highlight going from front to the side to the back
function CameraArt() {
  const chips = (['front', 'left', 'rear'] as const).map((p) => tr(SHORT[p]));
  const at = (i: number) =>
    anim('opacity', DUR, [0, 0.33 * i, 0.33 * i + 0.02, 0.33 * (i + 1), Math.min(1, 0.33 * (i + 1) + 0.02), 1], i === 2 ? [0, 0, 1, 1, 1, 1] : [0, 0, 1, 1, 0, 0]);
  return (
    <Scene label={tr('Camera')}>
      <rect x={50} y={12} width={220} height={165} rx={12} style={{fill: '#9cc9e8'}} />
      <rect x={50} y={66} width={220} height={24} style={{fill: '#3d6b35'}} />
      <path d="M50 90 H270 V165 a12 12 0 0 1 -12 12 H62 a12 12 0 0 1 -12 -12 Z" style={{fill: '#4f8a43'}} />
      <path d="M150 90 L104 177 H138 Z M170 90 L192 177 H226 Z" style={{fill: '#5d9c50'}} />
      <rect x={75} y={143} width={170} height={26} rx={13} style={{fill: 'rgba(14, 18, 24, 0.6)'}} />
      {chips.map((label, i) => (
        <g key={label}>
          <rect x={79 + i * 55} y={146} width={52} height={20} rx={10} style={accent} opacity={i === 0 ? 1 : 0}>
            {at(i)}
          </rect>
          <text x={105 + i * 55} y={160} fontSize={11} textAnchor="middle" style={{fill: '#fff'}}>
            {label}
          </text>
        </g>
      ))}
    </Scene>
  );
}

const CAMERA_STEP: GuideStep = {
  title: 'Camera',
  text: "A mower with MowBite OS and cameras can show their picture on the dashboard: tap the camera at the top right of the status card, or tick Camera picture in Settings › App › Appearance › Dashboard. On the picture you switch between the mower's cameras, such as front, side and rear, open it over the whole screen or take it off the dashboard again. Where a camera recognises things, AI view switches the boxes around them in the picture on and off. A tap on the picture puts these buttons away and brings them back. While recording an area, View picks the map or a camera, held sideways at the top. The mower only sends a picture while you look, to at most two at a time. While the blade runs there is no picture for now, the app says why.",
  Art: CameraArt,
};

// the map with a hedgehog seen on the lawn, its card with the photo coming up as it's tapped
function ObstaclesArt() {
  return (
    <Scene label={tr('Obstacles')}>
      <rect x={24} y={12} width={272} height={165} rx={12} style={{fill: '#4f8a43'}} />
      <path d="M60 40 H260 M60 70 H260 M60 100 H260" style={{stroke: '#5d9c50', strokeWidth: 14}} />
      <circle cx={200} cy={60} r={22} style={{fill: 'color-mix(in srgb, var(--c-seen) 25%, transparent)', stroke: 'var(--c-seen)', strokeWidth: 1.5, strokeDasharray: '4 3'}} />
      <circle cx={200} cy={60} r={12} style={{fill: 'var(--c-seen)', stroke: '#fff', strokeWidth: 1.5}} />
      <g transform="translate(200 60) scale(0.8)" style={{fill: '#fff'}}>
        {obstacleGlyph('ANIMAL')}
      </g>
      <g opacity={0}>
        {appear(0.35)}
        <rect x={40} y={100} width={240} height={68} rx={10} style={card} />
        <rect x={50} y={108} width={68} height={52} rx={6} style={{fill: '#9cc9e8'}} />
        <rect x={50} y={130} width={68} height={30} style={{fill: '#4f8a43'}} />
        <ellipse cx={84} cy={144} rx={13} ry={7} style={{fill: '#5c4630'}} />
        <rect x={68} y={134} width={32} height={18} style={{fill: 'none', stroke: '#ffd400', strokeWidth: 2}} />
        <text x={130} y={126} fontSize={13} fontWeight={600} style={text}>
          {tr('Hedgehog')}
        </text>
        <text x={130} y={146} fontSize={11} style={dim}>
          {tr('Only seen')}
        </text>
      </g>
    </Scene>
  );
}

const OBSTACLES_STEP: GuideStep = {
  title: 'Obstacles',
  text: "A mower with MowBite OS and an obstacle sensor can show on the map what it saw. Switch it on in Settings › Mower › Obstacles. Each one is a round with a sign for a person, an animal or a thing, it pulses while it's just been seen. Tap the sign: when and how often it was seen and, with photos on, its photo with a box round it. Delete one there, or all of them in the settings. For now the mower doesn't stop or drive around them. The camera only looks ahead, it's a help and no replacement for keeping an eye on the mower. The photos stay on the mower and can show people.",
  Art: ObstaclesArt,
};

const DOCK_TEST_STEP: GuideStep = {
  title: 'Docking test',
  text: "A mower with MowBite OS and a dock camera can test docking by the camera alone. Put it in front of the station: at most {cm} cm beside the line straight out of it and less than {deg}° skewed. Then tap Test docking by camera on the dashboard and confirm.{series} It drives off by itself, slowly and with the blade off, without map or GPS: stay at the STOP button. Stop docking on the dashboard or STOP at the mower ends it. If it doesn't get onto the contacts, the activity says why.",
  Art: DockTestArt,
};
// where the mower takes several dockings in a row
const DOCK_TEST_SERIES = 'Before you confirm you can pick up to {n} dockings in a row: after each it drives out of the station by itself and docks again, the first that fails ends the test.';

const STEPS: GuideStep[] = [
  {
    title: 'Your dashboard',
    text: "The dashboard shows what the mower is doing, its battery and a few values under it, such as GPS, speed and temperatures. Which values it shows you pick in Settings › App › Appearance › Dashboard: tick or untick each one. One that's off still shows while it warns.",
    Art: ValuesArt,
  },
  {
    title: 'More than one mower',
    text: 'Each of your mowers with MowBite can be added: in Settings › App › Your mowers, under Add another mower, give it a name and its address in your home network (IP or name) and tap Add mower.',
    Art: AddArt,
  },
  {
    title: 'Switching mowers',
    text: "With more than one, the dashboard has a round button with the first letter of the mower's name at the top right (on a computer the choice is in the sidebar). Tap it and pick a mower. Its name stands above the state, so you always see which one you're looking at.",
    Art: SwitchArt,
  },
];

export default function AppGuidePage() {
  const cameras = useCameras().on;
  const obstacles = useObstacles().on;
  const dockTest = !!useRpcMethods()?.has(RPC.dockingTest);
  const series = useDockTestSeries() ? ` ${tr(DOCK_TEST_SERIES, {n: DOCK_TEST_RUNS})}` : '';
  const testStep = {...DOCK_TEST_STEP, vars: {...DOCK_TEST_REACH, series}};
  const steps = [...STEPS.slice(0, 1), ...(cameras ? [CAMERA_STEP] : []), ...(obstacles ? [OBSTACLES_STEP] : []), ...(dockTest ? [testStep] : []), ...STEPS.slice(1)];
  return <Guide steps={steps} done={{label: 'To the dashboard', href: '/'}} />;
}
