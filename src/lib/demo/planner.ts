import {RPC} from '../openmower';
import {demoFlags} from './flags';

// A MowBite Planner on the mower for the click tests of its recorded outline pass (planner.settings and
// planner.settings.set, no plans of its own). The demo has none, a test switches it on before the page loads
// (window.mowbiteDemoPlanner), with what window.mowbiteDemoPlannerSet has stored on it. window.mowbiteDemoLoopIgnored
// set to one of the planner's reasons: it goes without the pass for that, said with the setting and in the plans'
// warnings

type Key = {value: unknown; type: string; unit?: string; choices?: string[]};
const num = (value: number): Key => ({value, type: 'number', unit: 'm'});
const DEFAULTS: Record<string, Key> = {
  robot_width: num(0.4),
  robot_front: num(0.3),
  robot_rear: num(0.25),
  mower_width: num(0.18),
  blade_ahead: num(0),
  blade_offset: num(0),
  edges: {value: 'recorded', type: 'string', choices: ['recorded', 'hard']},
  body_fit: {value: true, type: 'boolean'},
  recorded_loop: {value: false, type: 'boolean'},
  recorded_loop_margin: num(0),
};

export function demoPlanner() {
  const stored: Record<string, unknown> = {...(demoFlags().mowbiteDemoPlannerSet as Record<string, unknown> | undefined)};
  const ignored = () => demoFlags().mowbiteDemoLoopIgnored as string | undefined;
  const get = () => ({
    settings: Object.fromEntries(
      Object.entries(DEFAULTS).map(([k, d]) => [
        k,
        {...d, value: k in stored ? stored[k] : d.value, default: d.value, stored: k in stored, settable: true, ...(k === 'recorded_loop' && ignored() && {ignored: ignored()})},
      ]),
    ),
  });
  return {
    methods: {
      [RPC.plannerSettings]: get,
      [RPC.plannerSettingsSet]: (params: unknown) => {
        for (const [k, v] of Object.entries((params ?? {}) as Record<string, unknown>)) {
          if (!(k in DEFAULTS)) throw new Error(`${k} is no setting`);
          if (v === null) delete stored[k];
          else stored[k] = v;
        }
        return get();
      },
    },
    // what a plan says of the pass it was planned without
    warnings: (): string[] => (stored.recorded_loop === true && ignored() ? [`recorded_loop ignored: ${ignored()}`] : []),
  };
}
