import {tr} from './i18n';

// The planner's recorded outline pass (recorded_loop): what the app warns of before it's switched on, and its words
// for why the planner planned an area without it.

export const RECORDED_LOOP = 'recorded_loop';

// how far past what its body covered while recording the mower can get on that pass, and so the distance to keep from
// a drop when recording for it (cm, by calculation)
export const RECORDED_LOOP_CM = 20;

// asked before it's switched on and shown under the switch while it's on, {cm}: RECORDED_LOOP_CM
export const RECORDED_LOOP_WARNING = {
  title: 'The mower drives right up to the recorded line',
  lines: [
    'On this pass the mower keeps no distance: it follows the line it was recorded on.',
    'It can get beyond what its body covered while recording, most at corners: by our calculation up to {cm} cm if you recorded the area forwards without a break and with Auto points on.',
    "If there's a drop, water, stairs, a bed or gravel next to the line: record the area forwards without a break and at least {cm} cm away from it, or leave this option off.",
    'At walls and fences a bumper can trigger. The mower then stops.',
  ],
};

// a plan's warning for an area planned without it
export const IGNORED = 'recorded_loop ignored: ';

// the planner's reasons by how they begin, the same in planner.settings (ignored) and in a plan's warnings
const REASONS: [string, string][] = [
  ['no mower size set', 'The mower sizes are missing. Enter them under "Mower sizes".'],
  ['edges hard', '"Lines of the map" is set to "The wall itself". It only works with "Driven along the edge".'],
  ['blade_offset set', "The blade doesn't sit in the middle of the mower."],
  ['fill_pattern concentric', 'Not with the pattern "Rings".'],
  ['no loops along the outline', 'No outline passes are set.'],
  ['the mower is larger than the one the area was recorded with', 'The mower is larger than the one the area was recorded with. Record the area again with this mower.'],
  ['the area is too small for it', 'The area is too small for it.'],
  ['MowBite OS: only on an area recorded by driving along it', 'This area has no exact edge. Record it again for that: the whole round forwards without a break, with Auto points on.'],
  ['no way gets to all of the plan with it', "With it the mower couldn't get to every part of the plan. This area is planned without it."],
];

// the app's text for one of the planner's reasons, undefined for one it has no words for
export const recordedLoopReason = (reason: string): string | undefined => REASONS.find(([starts]) => reason.startsWith(starts))?.[1];

// the reason out of a plan's warning, undefined for another warning
export const recordedLoopIgnored = (warning: string): string | undefined => (warning.startsWith(IGNORED) ? warning.slice(IGNORED.length) : undefined);

// the warning's title and lines in the app's language
export const recordedLoopWarning = () => ({
  title: tr(RECORDED_LOOP_WARNING.title),
  lines: RECORDED_LOOP_WARNING.lines.map((l) => tr(l, {cm: RECORDED_LOOP_CM})),
});

// what the app says for an area or a setting the planner goes without it for
export const recordedLoopNote = (reason: string) =>
  tr('Recorded outline pass not possible: {reason}', {reason: tr(recordedLoopReason(reason) ?? reason)});
