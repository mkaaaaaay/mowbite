'use client';

import {tr} from '@/lib/i18n';
import {anim, appear, PAINT, Scene, SCREEN_LOOP, tap} from '../art';
import Guide, {type GuideStep} from '../Guide';

// the setup program of a mower with MowBite OS, step by step with a drawing for each

const DUR = SCREEN_LOOP;
const {card, field, well, text, dim, accent, onAccent} = PAINT;
const OK = 'var(--success)';
const BAD = 'var(--error)';

// a round mark: open (a ring), passed (a tick) or failed (a cross), shown from that fraction of the loop on. passAt: a
// ring that turns into a tick then
function Mark({x, y, kind = 'open', at, passAt}: {x: number; y: number; kind?: 'open' | 'ok' | 'bad'; at?: number; passAt?: number}) {
  if (passAt !== undefined)
    return (
      <>
        <Mark x={x} y={y} />
        <Mark x={x} y={y} kind="ok" at={passAt} />
      </>
    );
  const color = kind === 'ok' ? OK : kind === 'bad' ? BAD : 'var(--text-secondary)';
  return (
    <g opacity={at === undefined ? 1 : 0}>
      {at !== undefined && appear(at)}
      <circle cx={x} cy={y} r={7} fill={kind === 'open' ? 'none' : color} stroke={color} strokeWidth={1.6} />
      {kind === 'ok' && <path d={`M${x - 3.5} ${y} l2.5 2.5 l4.5 -5`} fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />}
      {kind === 'bad' && <path d={`M${x - 3} ${y - 3} l6 6 m0 -6 l-6 6`} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />}
    </g>
  );
}

// a button of the app, filled for the main one
function Button({x, y, w, label, main, at}: {x: number; y: number; w: number; label: string; main?: boolean; at?: number}) {
  return (
    <>
      <rect x={x} y={y} width={w} height={28} rx={14} style={main ? accent : field}>
        {at !== undefined && tap(at)}
      </rect>
      <text x={x + w / 2} y={y + 18} fontSize={12} textAnchor="middle" style={main ? onAccent : text}>
        {label}
      </text>
    </>
  );
}

function OverviewArt() {
  // the segments fill one by one, the next stage opens
  const done = 3;
  const of = 6;
  return (
    <Scene still={DUR} label={tr('The setup')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <text x={36} y={40} fontSize={13} fontWeight={600} style={text}>
        {tr('{done} of {of} steps done', {done, of})}
      </text>
      {Array.from({length: of}, (_, i) => (
        <g key={i}>
          <rect x={36 + i * 42} y={50} width={38} height={6} rx={3} fill="var(--track)" />
          {i < done && (
            <rect x={36 + i * 42} y={50} width={38} height={6} rx={3} fill={OK} opacity={0}>
              {appear(0.15 + i * 0.12)}
            </rect>
          )}
        </g>
      ))}
      <Mark x={44} y={86} kind="ok" />
      <text x={60} y={90} fontSize={12} style={text}>
        {tr('Device')}
      </text>
      <Mark x={44} y={116} passAt={0.5} />
      <text x={60} y={120} fontSize={12} style={text}>
        {tr('Inputs')}
      </text>
      <Mark x={44} y={146} />
      <text x={60} y={150} fontSize={12} style={dim}>
        {tr('Driving')}
      </text>
      <g opacity={0}>
        {appear(0.6)}
        <Button x={150} y={134} w={136} label={tr('Go on')} main at={0.75} />
      </g>
    </Scene>
  );
}

function StepArt() {
  // two parts checked: the first passes, the second fails, a repeat passes it
  return (
    <Scene still={DUR} label={tr('A step')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <text x={36} y={40} fontSize={13} fontWeight={600} style={text}>
        {tr('Check the parts')}
      </text>
      <rect x={30} y={52} width={260} height={30} rx={8} style={field} />
      <text x={42} y={71} fontSize={12} style={text}>
        {tr('Wheel motor left')}
      </text>
      <Mark x={272} y={67} passAt={0.25} />
      <rect x={30} y={88} width={260} height={30} rx={8} style={field} />
      <text x={42} y={107} fontSize={12} style={text}>
        {tr('Wheel motor right')}
      </text>
      <Mark x={272} y={103} />
      <g opacity={0}>
        {anim('opacity', DUR, [0, 0.35, 0.37, 0.7, 0.72, 1], [0, 0, 1, 1, 0, 0])}
        <Mark x={272} y={103} kind="bad" />
        <text x={36} y={138} fontSize={11} style={{fill: BAD}}>
          {tr('Not passed')}
        </text>
      </g>
      <Mark x={272} y={103} kind="ok" at={0.8} />
      <Button x={36} y={150} w={90} label={tr('Start')} main at={0.1} />
      <g opacity={0}>
        {anim('opacity', DUR, [0, 0.4, 0.42, 0.8, 0.82, 1], [0, 0, 1, 1, 0, 0])}
        <Button x={136} y={150} w={90} label={tr('Repeat')} main at={0.65} />
      </g>
    </Scene>
  );
}

function LinesArt() {
  // the board's lines as tiles, one lights up when the STOP button is pressed, the step asks to take it
  return (
    <Scene still={DUR} label={tr('Sensors on their lines')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      {['IN1', 'IN2', 'IN3'].map((l, i) => (
        <g key={l}>
          <rect x={36 + i * 86} y={28} width={76} height={34} rx={8} style={field} />
          {i === 0 && (
            <rect x={36} y={28} width={76} height={34} rx={8} opacity={0} fillOpacity={0.35} style={accent}>
              {appear(0.25)}
            </rect>
          )}
          <text x={74 + i * 86} y={50} fontSize={12} textAnchor="middle" style={text}>
            {l}
          </text>
        </g>
      ))}
      <g opacity={0}>
        {appear(0.35)}
        <text x={36} y={88} fontSize={12} style={accent}>
          {tr('{part}: seen on line {line}, it switches low', {part: tr('STOP button'), line: 'IN1'})}
        </text>
        <rect x={36} y={100} width={248} height={30} rx={8} style={well} />
        <circle cx={52} cy={115} r={6} fill="none" style={{stroke: 'var(--accent)'}} strokeWidth={1.6} />
        <circle cx={52} cy={115} r={3} opacity={0} style={accent}>
          {appear(0.55)}
        </circle>
        <text x={66} y={119} fontSize={12} style={text}>
          {tr('Take it')}
        </text>
        <Button x={36} y={146} w={90} label={tr('Save')} main at={0.65} />
      </g>
    </Scene>
  );
}

function MoveArt() {
  // the sheet before a step that moves the mower: what to make sure of, then start
  return (
    <Scene still={DUR} label={tr('Before it moves')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <text x={36} y={40} fontSize={13} fontWeight={600} style={text}>
        {tr('The mower moves in a moment')}
      </text>
      <text x={36} y={62} fontSize={12} style={dim}>
        {tr('The wheels turn')}
      </text>
      {[tr('Mower stands under the open sky'), tr('Nobody close by')].map((label, i) => (
        <g key={i} transform={`translate(0 ${84 + i * 26})`}>
          <rect x={38} y={-8} width={16} height={16} rx={4} style={field} />
          <g opacity={0}>
            {appear(0.2 + i * 0.15)}
            <rect x={38} y={-8} width={16} height={16} rx={4} style={accent} />
            <path d="M40 0 l3 3 l5 -6" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
          </g>
          <text x={64} y={4} fontSize={12} style={text}>
            {label}
          </text>
        </g>
      ))}
      <Button x={36} y={146} w={70} label={tr('Cancel')} />
      <g opacity={0.45}>
        {anim('opacity', DUR, [0, 0.5, 0.52, 1], [0.45, 0.45, 1, 1])}
        <Button x={116} y={146} w={150} label={tr('Let the wheels turn')} main at={0.75} />
      </g>
    </Scene>
  );
}

function SafetyArt() {
  // the lock of driving alone opens once the safety measurement passed
  const shut = 'M146 74 V58 a14 14 0 0 1 28 0 V74';
  const open = 'M146 74 V58 a14 14 0 0 1 26 -6';
  return (
    <Scene still={DUR} label={tr('Skipping and the safety measurement')}>
      <rect x={20} y={14} width={280} height={172} rx={12} style={card} />
      <path d={shut} fill="none" strokeWidth={4} strokeLinecap="round" style={{stroke: 'var(--text-secondary)'}}>
        {anim('d', DUR, [0, 0.55, 0.6, 1], [shut, shut, open, open])}
      </path>
      <rect x={136} y={72} width={48} height={38} rx={6} style={dim} />
      <rect x={136} y={72} width={48} height={38} rx={6} fill={OK} opacity={0}>
        {appear(0.6)}
      </rect>
      <text x={160} y={136} fontSize={12} textAnchor="middle" style={text}>
        {tr('Safety measurement missing')}
        {anim('opacity', DUR, [0, 0.55, 0.6, 1], [1, 1, 0, 0])}
      </text>
      <text x={160} y={136} fontSize={12} textAnchor="middle" opacity={0} style={{fill: OK}}>
        {appear(0.6)}
        {tr('Safety measured')}
      </text>
      <Button x={36} y={150} w={80} label={tr('Skip')} />
    </Scene>
  );
}

const STEPS: GuideStep[] = [
  {
    title: 'The setup',
    text: 'Settings › Mower › Setup checks the mower step by step: its parts, its sensors and how it drives. The steps come in stages, a stage opens once the steps it needs are done. Go on takes you to the next step to do, the bar on top shows how far it got.',
    Art: OverviewArt,
  },
  {
    title: 'A step',
    text: 'A step says what to do and shows it in a drawing. Tap Start: the mower checks the parts and values listed, each gets a tick or a cross. Not passed says why and how to fix it, then tap Repeat. A passed step can be repeated at any time.',
    Art: StepArt,
  },
  {
    title: 'Sensors on their lines',
    text: 'For the sensors, such as the STOP button or lifting, the step shows the lines of the board live. Trigger the sensor it waits for and let go: the step names the line it saw and asks whether to take it. After the last one MowBite OS starts again, the step waits for it. How long a sensor has to stay triggered is under Advanced once the step passed.',
    Art: LinesArt,
  },
  {
    title: 'Before it moves',
    text: 'A step that turns the wheels or the blade asks first: tick what it lists, then start. Stay by the mower, Cancel stops the step, and so does the STOP button on the mower. While the emergency stop is on, the step waits.',
    Art: MoveArt,
  },
  {
    title: 'Skipping and the safety measurement',
    text: "A step you can't do now can be skipped with a reason and done later. Until the safety measurement passed, the mower drives only while you watch: the lock on top of the setup says so, and why.",
    Art: SafetyArt,
  },
];

export default function SetupGuidePage() {
  return <Guide steps={STEPS} done={{label: 'To the setup', href: '/setup'}} />;
}
