'use client';

import {type MarkState, SIGNS, stateWord} from '@/components/setup/StateMark';
import {StepSymbol} from '@/components/setup/StepSymbol';
import {line, LockIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import {useId} from 'react';
import {anim, PAINT, Scene, SCREEN_LOOP, tap} from '../art';
import Guide, {type GuideStep} from '../Guide';

// the setup program of a mower with MowBite OS, step by step with a drawing of its screens for each

const DUR = SCREEN_LOOP;
const {card, text, dim, accent, onAccent, tile} = PAINT;
const OK = 'var(--success)';
const BAD = 'var(--error)';

// shown from one fraction of the loop to another
function Shown({from = 0, to = 1, children}: {from?: number; to?: number; children: React.ReactNode}) {
  if (from <= 0 && to >= 1) return <>{children}</>;
  const times = from <= 0 ? [0, to, to + 0.02, 1] : to >= 1 ? [0, from, from + 0.03, 1] : [0, from, from + 0.03, to, to + 0.02, 1];
  const values = from <= 0 ? [1, 1, 0, 0] : to >= 1 ? [0, 0, 1, 1] : [0, 0, 1, 1, 0, 0];
  return (
    <g opacity={from <= 0 ? 1 : 0}>
      {anim('opacity', DUR, times, values)}
      {children}
    </g>
  );
}

const MARK_FILL: Partial<Record<MarkState, string>> = {ok: OK, failed: BAD, skipped: 'var(--track)'};

// the round state mark of the setup (StateMark) at that point
function Mark({x, y, state, r = 10}: {x: number; y: number; state: MarkState; r?: number}) {
  const fill = MARK_FILL[state];
  const sign = SIGNS[state];
  const ring = state === 'open' ? 'var(--text-secondary)' : state === 'running' || state === 'waiting' ? 'var(--accent)' : null;
  return (
    <g transform={`translate(${x} ${y})`}>
      {fill && <circle r={r} fill={fill} />}
      {ring && (
        <circle r={r - 1} fill="none" stroke={ring} strokeOpacity={state === 'open' ? 0.6 : 1} strokeWidth={1.8} strokeDasharray={state === 'waiting' ? '3.4 2.4' : undefined}>
          {state === 'waiting' && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite" />}
        </circle>
      )}
      {state === 'running' && <circle r={r * 0.4} style={accent} />}
      {sign && (
        <g transform={`scale(${(r / 12) * 0.62}) translate(-12 -12)`} {...line} strokeWidth={2.5} style={{color: fill && state !== 'skipped' ? 'var(--accent-foreground)' : 'var(--text-secondary)'}}>
          {sign}
        </g>
      )}
    </g>
  );
}

// a button of the app, filled for the main one; tapped at that fraction of the loop
function Button({x, y, w, h = 28, size = 12, label, main, at}: {x: number; y: number; w: number; h?: number; size?: number; label: string; main?: boolean; at?: number}) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={10} style={main ? accent : tile}>
        {at !== undefined && tap(at)}
      </rect>
      <text x={x + w / 2} y={y + h / 2 + size / 3} fontSize={size} fontWeight={600} textAnchor="middle" style={main ? onAccent : text}>
        {label}
      </text>
    </>
  );
}

// a tick box, ticked from that fraction of the loop on
function Tick({x, y, at}: {x: number; y: number; at: number}) {
  return (
    <>
      <rect x={x} y={y} width={14} height={14} rx={4} fill="var(--background)" stroke="var(--card-border)" />
      <Shown from={at}>
        <rect x={x} y={y} width={14} height={14} rx={4} style={accent} />
        <path d={`M${x + 3} ${y + 7} l3 3 l5 -6`} fill="none" stroke="var(--accent-foreground)" strokeWidth={1.8} strokeLinecap="round" />
      </Shown>
    </>
  );
}

// the drawing on top of a step: its symbol in a circle on a tile
function Figure({x, y, w, h, symbol}: {x: number; y: number; w: number; h: number; symbol: string}) {
  const r = Math.min(20, h / 2 - 4);
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={10} style={tile} />
      <circle cx={x + w / 2} cy={y + h / 2} r={r} fill="var(--tint-accent)" />
      <g transform={`translate(${x + w / 2 - r * 0.6} ${y + h / 2 - r * 0.6})`} style={{color: 'var(--accent)'}}>
        <StepSymbol name={symbol} size={r * 1.2} />
      </g>
    </>
  );
}

// a part or step on its tile: the mark, the name and the word for its state, each state from one fraction on
function Row({x, y, w, name, states}: {x: number; y: number; w: number; name: string; states: {from: number; state: MarkState; word?: string; bad?: boolean}[]}) {
  return (
    <>
      <rect x={x} y={y} width={w} height={32} rx={10} style={tile} />
      <text x={x + 32} y={y + 14} fontSize={12} fontWeight={600} style={text}>
        {name}
      </text>
      {states.map((s, i) => (
        <Shown key={i} from={s.from} to={states[i + 1]?.from ?? 1}>
          <Mark x={x + 16} y={y + 16} state={s.state} />
          <text x={x + 32} y={y + 26} fontSize={10} style={s.bad ? {fill: BAD} : dim}>
            {s.word ?? stateWord(s.state)}
          </text>
        </Shown>
      ))}
    </>
  );
}

function OverviewArt() {
  // the next step passes: its stage gets a tick, the bar a segment, the next stage opens; Go on leads on
  const stage = (y: number, name: string, states: {from: number; state: MarkState; word?: string; faint?: boolean}[]) => (
    <>
      {states.map((s, i) => (
        <Shown key={i} from={s.from} to={states[i + 1]?.from ?? 1}>
          <Mark x={46} y={y} state={s.state} r={11} />
          <text x={66} y={y - 1} fontSize={12} fontWeight={600} style={s.faint ? dim : text}>
            {name}
          </text>
          <text x={66} y={y + 12} fontSize={10} style={dim}>
            {s.word ?? stateWord(s.state)}
          </text>
        </Shown>
      ))}
      <path d={`M279 ${y - 4} l4 4 l-4 4`} fill="none" strokeWidth={1.6} strokeLinecap="round" style={{stroke: 'var(--text-secondary)'}} />
    </>
  );
  const of = 6;
  const w = (252 - (of - 1) * 4) / of;
  return (
    <Scene label={tr('The setup')}>
      <rect x={20} y={10} width={280} height={182} rx={14} style={card} />
      {[2, 3].map((done) => (
        <Shown key={done} from={done === 3 ? 0.3 : 0} to={done === 2 ? 0.3 : 1}>
          <text x={34} y={34} fontSize={12.5} fontWeight={600} style={text}>
            {tr('{done} of {of} steps done', {done, of})}
          </text>
        </Shown>
      ))}
      {Array.from({length: of}, (_, i) => (
        <g key={i}>
          <rect x={34 + i * (w + 4)} y={42} width={w} height={5} rx={2.5} fill={i < 2 ? OK : 'var(--track)'} />
          {i === 2 && (
            <Shown from={0.3}>
              <rect x={34 + i * (w + 4)} y={42} width={w} height={5} rx={2.5} fill={OK} />
            </Shown>
          )}
        </g>
      ))}
      <Button x={34} y={56} w={252} h={28} label={tr('Go on: {step}', {step: tr('Wheel motor left')})} main at={0.8} />
      {stage(108, tr('Device'), [{from: 0, state: 'ok'}])}
      {stage(140, tr('Inputs'), [
        {from: 0, state: 'open', word: tr('{done} of {of} done', {done: 2, of: 3})},
        {from: 0.3, state: 'ok'},
      ])}
      {stage(172, tr('Driving'), [
        {from: 0, state: 'locked', faint: true},
        {from: 0.45, state: 'open', word: tr('{n} steps', {n: 3})},
      ])}
    </Scene>
  );
}

function StepArt() {
  // Start checks the parts one by one: the first passes, the second fails, Repeat passes it
  return (
    <Scene label={tr('A step')}>
      <rect x={20} y={8} width={280} height={186} rx={14} style={card} />
      <Figure x={30} y={18} w={260} h={48} symbol="wheels" />
      <text x={30} y={84} fontSize={13} fontWeight={600} style={text}>
        {tr('Check the parts')}
      </text>
      <Row
        x={30}
        y={92}
        w={260}
        name={tr('Wheel motor left')}
        states={[
          {from: 0, state: 'open'},
          {from: 0.12, state: 'running'},
          {from: 0.3, state: 'ok'},
        ]}
      />
      <Row
        x={30}
        y={128}
        w={260}
        name={tr('Wheel motor right')}
        states={[
          {from: 0, state: 'open'},
          {from: 0.3, state: 'running'},
          {from: 0.45, state: 'failed', bad: true},
          {from: 0.64, state: 'running'},
          {from: 0.78, state: 'ok'},
        ]}
      />
      <Shown to={0.12}>
        <Button x={30} y={166} w={260} h={24} label={tr('Start')} main at={0.06} />
      </Shown>
      <Shown from={0.5}>
        <Button x={30} y={166} w={260} h={24} label={tr('Repeat')} main at={0.6} />
      </Shown>
    </Scene>
  );
}

function LinesArt() {
  // the STOP button is pressed: its line lights up, the step asks to take it, Save gives the line its role, the next waits
  const lines = ['IN1', 'IN2', 'IN3'];
  return (
    <Scene label={tr('Sensors on their lines')}>
      <rect x={20} y={8} width={280} height={186} rx={14} style={card} />
      <Row
        x={30}
        y={16}
        w={260}
        name={tr('STOP button')}
        states={[
          {from: 0, state: 'waiting'},
          {from: 0.72, state: 'ok'},
        ]}
      />
      {lines.map((l, i) => {
        const x = 30 + i * 88;
        return (
          <g key={l}>
            <rect x={x} y={54} width={84} height={32} rx={10} style={tile} />
            <circle cx={x + 12} cy={65} r={4.5} fill="var(--track)" />
            {i === 0 && (
              <Shown from={0.2} to={0.55}>
                <rect x={x} y={54} width={84} height={32} rx={10} fill="var(--tint-accent)" />
                <circle cx={x + 12} cy={65} r={7.5} fill="var(--tint-accent)" />
                <circle cx={x + 12} cy={65} r={4.5} style={accent} />
              </Shown>
            )}
            <text x={x + 22} y={69} fontSize={12} fontWeight={600} style={text}>
              {l}
            </text>
            <Shown to={i === 0 ? 0.72 : 1}>
              <text x={x + 8} y={80} fontSize={9.5} style={dim}>
                {tr('Watched only')}
              </text>
            </Shown>
            {i === 0 && (
              <Shown from={0.72}>
                <text x={x + 8} y={80} fontSize={9.5} style={dim}>
                  {tr('STOP button')}
                </text>
              </Shown>
            )}
          </g>
        );
      })}
      <Shown from={0.3} to={0.72}>
        <rect x={30} y={92} width={260} height={62} rx={10} fill="var(--tint-accent)" />
        <text x={42} y={110} fontSize={12} fontWeight={600} style={text}>
          {tr('Take this line?')}
        </text>
        <text x={42} y={124} fontSize={10} style={accent}>
          {tr('{part}: seen on line {line}', {part: tr('STOP button'), line: 'IN1'})}
        </text>
        <Tick x={42} y={133} at={0.48} />
        <text x={62} y={144} fontSize={12} style={text}>
          {tr('Take it')}
        </text>
        <g opacity={0.45}>
          {anim('opacity', DUR, [0, 0.5, 0.52, 1], [0.45, 0.45, 1, 1])}
          <Button x={30} y={162} w={260} h={24} label={tr('Save')} main at={0.62} />
        </g>
      </Shown>
      <Shown from={0.74}>
        <Row x={30} y={92} w={260} name={tr('Lifting')} states={[{from: 0, state: 'waiting'}]} />
      </Shown>
    </Scene>
  );
}

function MoveArt() {
  // Start on a step that moves the mower brings up the sheet: tick both points, then start
  const clip = useId();
  return (
    <Scene label={tr('Before it moves')}>
      <defs>
        <clipPath id={clip}>
          <rect x={20} y={8} width={280} height={186} rx={14} />
        </clipPath>
      </defs>
      <rect x={20} y={8} width={280} height={186} rx={14} style={card} />
      <g clipPath={`url(#${clip})`}>
        <Figure x={30} y={18} w={260} h={50} symbol="wheels" />
        <text x={30} y={88} fontSize={13} fontWeight={600} style={text}>
          {tr('Wheel motor left')}
        </text>
        <text x={30} y={102} fontSize={11} style={dim}>
          {tr('The wheels turn')}
        </text>
        <Button x={30} y={112} w={260} h={26} label={tr('Start')} main at={0.05} />
        <rect x={20} y={8} width={280} height={186} fill="rgb(16 18 24)" opacity={0}>
          {anim('opacity', DUR, [0, 0.1, 0.16, 1], [0, 0, 0.45, 0.45])}
        </rect>
        <g transform="translate(0 130)">
          <animateTransform attributeName="transform" type="translate" dur={`${DUR}s`} repeatCount="indefinite" keyTimes="0;0.1;0.18;1" values="0 130;0 130;0 0;0 0" />
          <rect x={20} y={76} width={280} height={140} rx={16} fill="var(--background)" />
          <rect x={144} y={83} width={32} height={4} rx={2} fill="var(--track)" />
          <text x={34} y={106} fontSize={13} fontWeight={600} style={text}>
            {tr('The mower moves in a moment')}
          </text>
          {[tr('Mower stands under the open sky'), tr('Nobody close by')].map((label, i) => (
            <g key={i}>
              <Tick x={34} y={114 + i * 22} at={0.3 + i * 0.12} />
              <text x={56} y={125 + i * 22} fontSize={12} style={text}>
                {label}
              </text>
            </g>
          ))}
          <Button x={34} y={160} w={122} h={26} label={tr('Cancel')} />
          <g opacity={0.4}>
            {anim('opacity', DUR, [0, 0.44, 0.46, 1], [0.4, 0.4, 1, 1])}
            <Button x={164} y={160} w={122} h={26} label={tr('Start')} main at={0.68} />
          </g>
        </g>
      </g>
    </Scene>
  );
}

function WheelsArt() {
  // the mower jacked up turns its wheels part by part, then asks which single wheel turns: the right one, and it passes
  return (
    <Scene label={tr('Wheels in the air')}>
      <rect x={20} y={8} width={280} height={186} rx={14} style={card} />
      <Row
        x={30}
        y={18}
        w={260}
        name={tr('Forwards')}
        states={[
          {from: 0, state: 'waiting'},
          {from: 0.15, state: 'ok'},
        ]}
      />
      <Row
        x={30}
        y={56}
        w={260}
        name={tr('One wheel only')}
        states={[
          {from: 0, state: 'open'},
          {from: 0.15, state: 'waiting'},
          {from: 0.75, state: 'ok'},
        ]}
      />
      <Shown from={0.25} to={0.75}>
        <rect x={30} y={96} width={260} height={88} rx={10} fill="var(--tint-accent)" />
        <text x={42} y={114} fontSize={12} fontWeight={600} style={text}>
          {tr('Which wheel turns?')}
        </text>
        {[tr('Left wheel'), tr('Right wheel')].map((label, i) => (
          <g key={i}>
            <circle cx={49} cy={130 + i * 20} r={6} fill="var(--background)" stroke="var(--card-border)" />
            {i === 1 && (
              <Shown from={0.45}>
                <circle cx={49} cy={130 + i * 20} r={3.5} style={accent} />
              </Shown>
            )}
            <text x={62} y={134 + i * 20} fontSize={11} style={text}>
              {label}
            </text>
          </g>
        ))}
        <Button x={206} y={150} w={74} h={24} size={11} label={tr('Save')} main at={0.6} />
      </Shown>
    </Scene>
  );
}

function SafetyArt() {
  // a step skipped for now, then the safety measurement passes and the lock on top opens
  const lock = (open: boolean) => {
    const color = open ? 'var(--soft-good)' : 'var(--soft-warn)';
    return (
      <>
        <rect x={20} y={22} width={280} height={44} rx={12} fill={open ? 'var(--tint-good)' : 'var(--tint-warn)'} />
        <g transform="translate(32 35)" style={{color}}>
          <LockIcon open={open} size={18} />
        </g>
        <text x={58} y={open ? 48 : 41} fontSize={12} fontWeight={600} style={{fill: color}}>
          {open ? tr('Safety measured') : tr('Safety measurement missing')}
        </text>
        {!open && (
          <text x={58} y={56} fontSize={10} style={{fill: color}}>
            {tr('Drives only while you watch')}
          </text>
        )}
      </>
    );
  };
  return (
    <Scene label={tr('Skipping and the safety measurement')}>
      <Shown to={0.62}>{lock(false)}</Shown>
      <Shown from={0.62}>{lock(true)}</Shown>
      <rect x={20} y={76} width={280} height={100} rx={14} style={card} />
      <Row
        x={30}
        y={86}
        w={260}
        name={tr('Lifting')}
        states={[
          {from: 0, state: 'open'},
          {from: 0.18, state: 'skipped'},
        ]}
      />
      <Shown to={0.18}>
        <Button x={200} y={92} w={82} h={20} size={11} label={tr('Skip')} at={0.1} />
      </Shown>
      <Row
        x={30}
        y={130}
        w={260}
        name={tr('Safety measurement')}
        states={[
          {from: 0, state: 'open'},
          {from: 0.3, state: 'running'},
          {from: 0.56, state: 'ok'},
        ]}
      />
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
    text: 'A step that turns the wheels or the blade asks first: tick what it lists, then start. Stay by the mower, Cancel stops the step, and so does the STOP button on the mower. While the emergency stop is on, the step waits. Keep the page open: if it closes or the phone locks, the mower stops the step.',
    Art: MoveArt,
  },
  {
    title: 'Wheels in the air',
    text: 'Put the mower on a stand under its body, the front not higher than the back, and keep a hand at the STOP button. The wheels turn forwards, backwards, both ways round and then only one: tell which one turns. It takes about 15 seconds. Further steps check that the wheels stop at the STOP button and the bumpers and stay still without a command. The STOP button, lifting and bumper have to pass before any wheel turns.',
    Art: WheelsArt,
  },
  {
    title: 'Skipping and the safety measurement',
    text: "A step you can't do now can be skipped with a reason and done later. Until the safety measurement passed, the mower drives only while you watch: the lock on top of the setup says so, and why. If a safety step fails, for instance a wheel turns the wrong way, the lock closes again until that step passes; repeating a passed safety step says so first.",
    Art: SafetyArt,
  },
];

export default function SetupGuidePage() {
  return <Guide steps={STEPS} done={{label: 'To the setup', href: '/setup'}} />;
}
