import type {MowerMap} from '@/hooks/useMowerMap';
import type {KeptPlan} from './diagnosis';
import {modelOf, MOWER_MODELS, plannerSizes, type MowerSizes, type PlannerSettings} from './mowerBody';
import {closedRings} from './rings';

// The garden in one object, to plan and drive it again elsewhere (the planner's bench, a simulator): the map as
// map.json has it, the planner's whole answer to planner.settings, what OpenMower runs with. At the end of the
// diagnosis file and on its own from the settings. No logins and not where the garden is (the datum).
export const GARDEN_FORMAT = 'mowbite-garden-export';

// what planning and driving depend on: mower_logic, the antenna, the path controllers, the wheels and the battery
const KEEP = /^\/(mower_logic|xbot_positioning|move_base_flex)\/|^\/ll\/services\/(diff_drive|power)\//;
// never, whatever OpenMower calls it
const PRIVATE = /ntrip|pass|user|login|token|secret|key|mqtt|host|uri|url|bind_ip|datum/i;

export function exportParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([k]) => KEEP.test(k) && !PRIVATE.test(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export interface GardenInput {
  created: number; // unix s
  appVersion: string;
  methods: string[] | null;
  map: MowerMap | null;
  planner: PlannerSettings | null;
  params: Record<string, unknown>;
  // the app's own sizes, without the planner
  sizes?: MowerSizes;
  // with a run: the map and the settings as it left the dock, and the plans it got
  startMap?: MowerMap | null;
  startPlanner?: PlannerSettings | null;
  startParams?: Record<string, unknown> | null;
  plans?: KeptPlan[];
}

export function gardenExport(g: GardenInput) {
  const sizes = g.planner ? plannerSizes(g.planner) : g.sizes;
  const model = modelOf(sizes);
  return {
    format: GARDEN_FORMAT,
    version: 1,
    created: new Date(g.created * 1000).toISOString(),
    app_version: g.appVersion,
    // neither OpenMower nor the planner says its version, what they answer tells which features they have
    rpc_methods: g.methods,
    mower_model: model ? (MOWER_MODELS.find((m) => m.key === model)?.label ?? model) : null,
    mower_sizes: g.planner ? null : (sizes ?? null),
    map: g.map && closedRings(g.map),
    planner_settings: g.planner,
    params: exportParams(g.params),
    ...(g.startMap !== undefined && {
      run: {
        map: g.startMap && closedRings(g.startMap),
        planner_settings: g.startPlanner ?? null,
        params: g.startParams ? exportParams(g.startParams) : null,
        plans: g.plans ?? [],
      },
    }),
  };
}

// last over the whole file, for what a log line may carry: a login in a url, a password or token, a position in degrees
export function scrub(text: string): string {
  return text
    .replace(/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1***@')
    .replace(/\b(password|passwd|token|secret|user(?:name)?)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2***')
    .replace(/\b(lat(?:itude)?|lon(?:g(?:itude)?)?|datum_\w+)(["']?\s*[:=]?\s*["']?)-?\d+\.\d+/gi, '$1$2***');
}
