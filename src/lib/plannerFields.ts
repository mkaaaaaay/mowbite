// How the app shows the MowBite Planner's settings (planner.settings gives value, default, type, range and choices,
// this adds a name, what it does, a group and how a value is typed in). Settings the planner has but this doesn't
// know show up with their own name under "More", so a newer planner's settings can be set too. The groups are the
// sections of the planner menu, the same for all areas and for one area.

export type Group = 'pattern' | 'angle' | 'edge' | 'obstacles' | 'turns' | 'route' | 'fine';

export interface Field {
  label: string;
  help: string;
  group: Group;
  // how it's typed in: degrees for an angle the planner takes in rad
  unit?: 'm' | 'deg';
  step?: number;
  // names for the choices of a setting that has them
  choices?: Record<string, string>;
  // names for off and on of a switch that is a choice of two ways
  ways?: [string, string];
  // offered per area too (the area's planner property)
  area?: boolean;
  // only under "More"
  advanced?: boolean;
}

export const GROUPS: {key: Group; label: string}[] = [
  {key: 'pattern', label: 'Pattern'},
  {key: 'angle', label: 'Direction'},
  {key: 'edge', label: 'Edge'},
  {key: 'obstacles', label: 'Obstacles'},
  {key: 'turns', label: 'Turns'},
  {key: 'route', label: 'Drives between the parts'},
  {key: 'fine', label: 'Fine tuning'},
];

export const FIELDS: Record<string, Field> = {
  lane_spacing_mode: {
    label: 'Lane spacing',
    help: "Fixed: OpenMower's lane spacing (tool_width), or the overlap set here. Picked by the planner: the widest spacing between the two below that leaves nothing unmowed, fewer lanes and turns.",
    group: 'pattern',
    choices: {fixed: 'Fixed', auto: 'Picked by the planner'},
    area: true,
  },
  lane_spacing_min: {
    label: 'Spacing from',
    help: 'With the lane spacing picked by the planner: the narrowest spacing it tries. Empty: half the blade.',
    group: 'pattern',
    unit: 'm',
    step: 0.01,
    advanced: true,
  },
  lane_spacing_max: {
    label: 'Spacing up to',
    help: 'With the lane spacing picked by the planner: the widest spacing it tries, it starts there. Empty: 85 % of the blade.',
    group: 'pattern',
    unit: 'm',
    step: 0.01,
    advanced: true,
  },
  overlap: {
    label: 'Overlap',
    help: "How much of the blade's width the lanes overlap (0.2 = 20 %), with a fixed spacing. Empty: from OpenMower's lane spacing (tool_width).",
    group: 'pattern',
    step: 0.05,
    advanced: true,
  },
  fill_pattern: {
    label: 'Pattern',
    help: 'Inside the outline passes: parallel lanes, lanes and then lanes across them, or rings further and further in.',
    group: 'pattern',
    choices: {lanes: 'Lanes', crosshatch: 'Crosshatch', concentric: 'Rings'},
    area: true,
  },
  narrow_parts: {
    label: 'Narrow parts',
    help: "Where the area is narrower than a U-turn (a path, a strip between beds): lanes anyway, or the outline passes go on further in until it's mowed.",
    group: 'pattern',
    choices: {lanes: 'Lanes anyway', loops: 'Passes further in'},
    area: true,
  },
  crosshatch_angle: {
    label: 'Crosshatch angle',
    help: 'Direction of the second lanes to the first.',
    group: 'pattern',
    unit: 'deg',
    step: 5,
  },
  angle_strategy: {
    label: 'Automatic direction',
    help: "For areas without a mow angle of their own: how the direction of the lanes is worked out. OpenMower: from the outline's first point, for a recorded area the way you set off.",
    group: 'angle',
    choices: {longest_edge: 'Along the longest edge', min_width: 'Across the narrowest width', optimal: 'Fewest lanes and turns'},
    area: true,
  },
  angle_offset: {
    label: 'Turned by',
    help: 'Added to the direction of the lanes, also to a fixed one.',
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle_step: {
    label: 'Tries a direction every',
    help: 'With the automatic direction "Fewest lanes and turns": the directions tried are this far apart. Smaller takes longer.',
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle: {
    label: 'Fixed direction',
    help: "Lanes always this way, wins over the areas' mow angle (but for areas with an angle of their own). Empty: worked out.",
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle_increment: {
    label: 'Turn further by',
    help: "After finished mowing runs the lanes turn this much further, so the wheels don't wear tracks into the lawn. Within an area's direction range they swing back and forth, without one they go round all 180°. 0: off.",
    group: 'angle',
    unit: 'deg',
    step: 1,
  },
  angle_increment_every: {
    label: 'After every nth mowing run',
    help: 'How many finished mowing runs it takes for the next turn.',
    group: 'angle',
    step: 1,
  },
  angle_min: {label: 'Direction from', help: 'The direction of the lanes stays between these two, set both or neither.', group: 'angle', unit: 'deg', step: 1, advanced: true},
  angle_max: {label: 'Direction to', help: 'The direction of the lanes stays between these two, set both or neither.', group: 'angle', unit: 'deg', step: 1, advanced: true},
  perimeter_passes: {
    label: 'Outline passes',
    help: "For all areas, an area's own outline passes still count. Automatic: as many as the lanes' turns leave unmowed along the edge. Empty: OpenMower's (outline_count).",
    group: 'edge',
    step: 1,
  },
  lane_overlap_passes: {
    label: 'Overlapping passes',
    help: "How many outline passes the lanes reach into. Empty: OpenMower's (outline_overlap_count).",
    group: 'edge',
    step: 1,
    area: true,
  },
  lane_overlap_limit: {
    label: 'Turns stay within the overlap',
    help: 'On: lanes and the turns between them go no further out than the overlapping passes say. Where no curve fits there the mower turns on the spot, and a lane starts later where the outline passes already mowed. Off: the turns take the room they need in the outline passes, which looks like more overlap than set. Costs more turns on the spot, least with 2 overlapping passes.',
    group: 'edge',
    area: true,
  },
  obstacle_passes: {
    label: 'Passes around obstacles',
    help: "How many passes go round each obstacle, on their own from the outline passes. Automatic: as many as along the outline. 0: none, the lanes go round them.",
    group: 'edge',
    step: 1,
    area: true,
  },
  perimeter_offset: {
    label: 'Outline offset',
    help: "How far inside the lines of the map the first outline pass runs. Empty: OpenMower's (outline_offset). With the mower sizes the safety distance to the edge counts instead.",
    group: 'edge',
    unit: 'm',
    step: 0.05,
    advanced: true,
  },
  // in the planner menu, here for their names
  edges: {
    label: 'Lines of the map',
    help: 'What the lines of the map stand for: driven along the edge with the mower, or the wall itself.',
    group: 'edge',
    choices: {recorded: 'Driven along the edge', hard: 'The wall itself'},
  },
  perimeter_order: {
    label: 'Outline passes first or last',
    help: 'Before the lanes, or after them: last, they mow over the marks the turns leave at the edge.',
    group: 'edge',
    choices: {first: 'First', last: 'Last'},
    area: true,
  },
  perimeter_direction: {
    label: 'Way round',
    help: "Which way the outline passes go round. Automatic: the way the mower already faces. Random: one or the other, anew after every finished mow (only with a planner that knows it). With the mower's outline such a planner drives the outermost pass of both the way the edge was recorded.",
    group: 'edge',
    choices: {auto: 'Automatic', ccw: 'Counter-clockwise', cw: 'Clockwise', random: 'Random'},
  },
  turn_radius: {
    label: 'Turn radius',
    help: "Radius of the turns at the ends of the lanes, and no curve anywhere is tighter. Larger is gentler on the lawn, but needs more room at the edge (more outline passes).",
    group: 'turns',
    unit: 'm',
    step: 0.05,
    area: true,
  },
  turn_radius_auto: {
    label: 'Turn radius automatic',
    help: 'The planner picks the radius of each turn itself, up to twice the turn radius where there is room. The turn radius is the least it takes. Only where no turn fits otherwise it drives a tighter half circle as wide as the lanes are apart, in place of turning on the spot.',
    group: 'turns',
    area: true,
  },
  lane_order: {
    label: 'Lane order',
    help: 'Neighbour after neighbour needs tight turns. Skipping lanes leaves room for a wide turn every time, the lanes in between follow on the way back.',
    group: 'turns',
    choices: {snake: 'Neighbour after neighbour', skip: 'Skip lanes'},
  },
  turn_types: {
    label: 'Turns allowed',
    help: 'The kinds of turns the planner may use, the first ones it likes best. Turning on the spot leaves out the bulb turn.',
    group: 'turns',
    choices: {u_turn: 'U-turn', bulb: 'Bulb turn', detour: 'Detour along the edge', pivot: 'Turn on the spot'},
    advanced: true,
  },
  turn_on_spot: {
    label: 'Turning',
    help: 'Where a plain curve doesn’t fit, the mower drives a loop, gentle on the lawn, or turns on the spot, about 14 % quicker but harder on the lawn.',
    group: 'turns',
    ways: ['In a loop', 'On the spot'],
    area: true,
  },
  headland_turns: {
    label: 'Clean stripes',
    help: 'In the field of lanes only straight lanes, turns and drives along the outline passes. About a quarter longer.',
    group: 'pattern',
    area: true,
  },
  split_zones: {
    label: 'Parts with their own direction',
    help: 'A part of the lawn better mowed another way gets lanes of its own direction, only where the whole plan then needs fewer lanes. Not with crosshatch, rings or clean stripes.',
    group: 'pattern',
    area: true,
  },
  mop_up: {
    label: 'Fill the gaps of the plan',
    help: 'At the end one more round over the biggest pieces the plan leaves unmowed, a short pass over each. Only with the mower sizes.',
    group: 'pattern',
    area: true,
  },
  headland_corners: {
    label: 'Corners of the drives along the edge',
    help: 'With clean stripes: the drives along the outline passes take their corners in a curve, or sharp with a turn on the spot.',
    group: 'pattern',
    choices: {rounded: 'Rounded', sharp: 'Sharp'},
    area: true,
  },
  edge_margin: {
    label: 'Safety distance to the edge',
    help: "How far the mower's body keeps off the real edge, everywhere.",
    group: 'edge',
    unit: 'm',
    step: 0.01,
    area: true,
  },
  obstacle_margin: {
    label: 'Safety distance to obstacles',
    help: "How far the mower's body keeps off obstacles, areas not mowed and inactive ones. An obstacle's own distance wins.",
    group: 'obstacles',
    unit: 'm',
    step: 0.01,
    area: true,
  },
  body_fit: {
    label: 'Collision check',
    help: 'Where the body would stick out past a real edge or into an obstacle, the path goes another way, leaving a little out where nothing fits. Off: the path as planned.',
    group: 'turns',
    area: true,
  },
  spin_margin: {
    label: 'Extra distance when turning',
    help: 'When turning on the spot and all along the turns between the lanes, the body keeps this much more distance: it often wanders a little there.',
    group: 'turns',
    unit: 'm',
    step: 0.01,
    area: true,
  },
  route_order: {
    label: 'Order of the parts',
    help: 'The closest part not mowed yet next, or the order with the shortest drives between them (takes a little longer to plan).',
    group: 'route',
    choices: {nearest: 'Closest next', optimized: 'Shortest drives'},
    area: true,
  },
  bend_max_gap: {
    label: 'Lanes around obstacles',
    help: 'A lane split by an obstacle no longer than this (a tree, a small bed) goes on around it instead of the area being split there. 0 = off.',
    group: 'obstacles',
    unit: 'm',
    step: 0.5,
    area: true,
  },
  bend_max_offset: {
    label: 'How far around',
    help: 'How far a lane going around an obstacle may leave its line.',
    group: 'obstacles',
    unit: 'm',
    step: 0.1,
  },
  nested_areas: {
    label: 'Areas inside areas',
    help: 'A mowing area lying in another (90 % of it at least) is left out of the bigger one and mowed round, it gets a plan of its own with its own settings (another angle, not mowed). Off: the bigger one mows across it.',
    group: 'obstacles',
  },
  transit_edge_distance: {
    label: 'Distance of the drives to edges',
    help: "Drives between the parts keep this far from walls and beds where that doesn't cost much more. 0 = the shortest way.",
    group: 'route',
    unit: 'm',
    step: 0.1,
  },
  transit_edge_cost: {
    label: 'How much more it may cost',
    help: 'Every meter closer to an edge counts this many meters more.',
    group: 'route',
    step: 0.5,
    advanced: true,
  },
  planner: {
    label: 'Planner',
    help: "Which planner works out the plans of all areas: the MowBite Planner with the settings here, or OpenMower's own slic3r planner like without MowBite, with OpenMower's outline passes, lane spacing and mow angles and no collision check. It counts from the next plan.",
    group: 'fine',
    choices: {mowbite: 'MowBite', slic3r: 'slic3r (OpenMower)'},
  },
};

// settings a planner may still report that the app leaves out: the planner of the next version drops them again (and
// everything stored with them)
export const DROPPED = ['mode'];
// settings of before the planner leaves out now (fixed, gone, or turn_radius for min_turn_radius), also where an area
// still has one
export const RETIRED = [
  'min_turn_radius',
  'smooth_spins',
  'allow_reverse',
  'waypoint_spacing',
  'simplify_tolerance',
  'min_lane_length',
  'transit_clearance',
  'body_tolerance',
  'perimeter_corner_radius',
];
// choices not offered any more, though a planner from before still has them
export const DROPPED_CHOICES: Record<string, string[]> = {fill_pattern: ['auto'], turn_types: ['k_turn']};
// counted by the planner itself, not in the lists: the angle turned further (shown with it in the simple menu), the
// finished mows the random way round goes by
export const COUNTED = ['angle_steps', 'finished_mows'];
// in the planner menu at the map (PlannerSimple), the lists for experts leave them out
export const SIMPLE = [
  'planner',
  'fill_pattern',
  'crosshatch_angle',
  'lane_spacing_mode',
  'overlap',
  'headland_turns',
  'headland_corners',
  'narrow_parts',
  'split_zones',
  'mop_up',
  'angle_strategy',
  'angle_increment',
  'angle_increment_every',
  'edges',
  'perimeter_passes',
  'obstacle_passes',
  'lane_overlap_passes',
  'lane_overlap_limit',
  'perimeter_order',
  'edge_margin',
  'obstacle_margin',
  'perimeter_direction',
  'leftovers_auto',
  'bend_max_gap',
  'nested_areas',
  'turn_on_spot',
  'turn_radius',
  'turn_radius_auto',
  'spin_margin',
  'body_fit',
  'route_order',
  'transit_edge_distance',
];

// a direction for all areas: each area has its own angle, range and further turning for that. Not offered any more,
// one still stored shows with a button to take it away (PlannerSimple)
export const ANGLE_FOR_ALL = ['angle', 'angle_offset', 'angle_min', 'angle_max'];

// shown in their own card (Mower sizes)
export const BODY_KEYS = [
  'robot_width',
  'robot_front',
  'robot_rear',
  'mower_width',
  'blade_ahead',
  'blade_offset',
  'edges',
  // a list of points (type "points"), set from a model in the same card
  'robot_outline',
];

const DEG = 180 / Math.PI;

// the value as typed in: degrees for angles, rounded so a stored rad value doesn't show 15 decimals
export function toInput(field: Field | undefined, value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const v = field?.unit === 'deg' ? value * DEG : value;
  return String(Math.round(v * 1000) / 1000);
}

// what the planner takes: null for an empty field (back to the default), rad for degrees
export function fromInput(field: Field | undefined, text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return 'invalid';
  return field?.unit === 'deg' ? v / DEG : v;
}

// a few settings together, how the mower turns and covers an area (the planner menu's style). set: what choosing it
// sets, by: the settings that tell which one is on (a planner without changes is gentle)
export const STYLES: Record<string, {set: Record<string, unknown>; by: Record<string, unknown>}> = {
  gentle: {
    set: {turn_on_spot: false, lane_order: 'skip', headland_turns: false, turn_radius_auto: true},
    by: {turn_on_spot: false, lane_order: 'skip', headland_turns: false},
  },
  quick: {
    set: {turn_on_spot: true, lane_order: 'snake', headland_turns: false, turn_radius_auto: false},
    by: {turn_on_spot: true, lane_order: 'snake', headland_turns: false},
  },
  clean: {set: {headland_turns: true, turn_on_spot: false}, by: {headland_turns: true}},
};
export const STYLE_LABELS: Record<string, string> = {gentle: 'Gentle on the lawn', quick: 'Quick', clean: 'Clean stripes'};
export const STYLE_NOTES: Record<string, string> = {
  gentle: 'Loops instead of turning on the spot, wide turns, lanes skipped for room: kind to the lawn, a little more driving.',
  quick: 'Turns on the spot, lane after lane: the shortest, the wheels may scuff the lawn where it turns.',
  clean: 'Only straight lanes, it turns along the outline passes: clean stripes, about a quarter longer.',
};

// the style the settings for all areas make up, null for a mix of their own. A setting the planner doesn't have counts as
// fitting
export function styleOf(all: Record<string, {value: unknown}>): string | null {
  const fits = (by: Record<string, unknown>) => Object.entries(by).every(([k, v]) => !all[k] || all[k].value === v);
  return Object.keys(STYLES).find((k) => fits(STYLES[k].by)) ?? null;
}
