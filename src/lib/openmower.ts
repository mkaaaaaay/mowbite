// Everything MowBite expects from OpenMower in one place: MQTT topics, RPC methods, action ids,
// parameter names and a few paths that only show up as hints. OpenMower is being restructured
// (OSv3), when names change it should be this file (and docker/openmower.sh for the container).

export const TOPIC = {
  robotState: 'robot_state/json',
  position: 'position/json',
  map: 'map/json',
  mapOverlay: 'map_overlay/json',
  // each event as it happens, the same as in the event history
  events: 'events/json',
  sensorInfos: 'sensor_infos/json',
  sensorData: 'sensors/+/data',
  params: 'params/json',
  actions: 'actions/json',
  action: 'action',
  teleop: 'teleop',
  rpcRequest: 'rpc/request',
  rpcResponse: 'rpc/response',
  // how far the MowBite Planner got with the planning it's at (retained, see lib/plannerProgress)
  plannerProgress: 'mowbite/planner/progress',
  // how far the MowBite Planner's recording for a calibration got (retained, see lib/calibration)
  plannerCalib: 'mowbite/planner/calib',
} as const;

export const RPC = {
  // what this mower answers, newer OpenMower versions only
  methods: 'rpc.methods',
  // what runs on the mower, MowBite OS only (lib/mowerOs)
  systemInfo: 'system.info',
  // memory, storage, load and network of the mower itself, MowBite OS only (lib/system)
  systemStats: 'system.stats',
  // the lights on the mower by state, MowBite OS only (lib/light)
  lightGet: 'light.get_profile',
  lightSet: 'light.set_profile',
  lightPreview: 'light.preview',
  lightReset: 'light.reset',
  // the mower's sounds by situation, MowBite OS with a speaker only (lib/sound)
  soundList: 'sound.list',
  soundPlay: 'sound.play',
  soundStop: 'sound.stop',
  soundVolume: 'sound.volume',
  soundUpload: 'sound.upload',
  soundDelete: 'sound.delete',
  // the mower's cameras and a stream of one for a single viewer, MowBite OS with cameras only (lib/camera)
  cameraList: 'camera.list',
  cameraStream: 'camera.stream',
  replaceMap: 'map.replace',
  eventDays: 'events.history.list',
  events: 'events.history',
  jobs: 'position.history.list',
  jobTrack: 'position.history',
  // the mowing plan for an area straight from the mower's planner
  areaPlan: 'mowing.plan',
  // the area settings this mower keeps in map.json
  areaProperties: 'map.area_properties',
  // the last warnings and errors ROS logged, kept in memory by the mower
  logs: 'logs.recent',
  // the MowBite Planner's settings (with OM_PLANNER=mowbite only): every setting with value, default and range,
  // and changing them (null: back to the default)
  plannerSettings: 'planner.settings',
  plannerSettingsSet: 'planner.settings.set',
  // a plan straight from the MowBite Planner, with report: true where the mower's body would stick out
  plannerPlan: 'planner.plan',
  // a finished run's track checked against the body's safety distances: where it got into them and how far
  plannerDrive: 'planner.drive',
  // the angle turned further after finished mows (angle_increment) back to 0, answers like planner.settings
  plannerAngleReset: 'planner.angle.reset',
  // what a finished mow's real track left unmowed, as passes over it; armed, the mower drives those on the next start
  plannerLeftovers: 'planner.leftovers',
  // a calibration of the mower's sizes from a recording: driven by hand (joystick) or the next mow, stopped, and what
  // the planner worked out from it (lib/calibration)
  plannerCalibCheck: 'planner.calib.check',
  plannerCalibStart: 'planner.calib.start',
  plannerCalibStop: 'planner.calib.stop',
  plannerCalibResult: 'planner.calib.result',
  // sets parameters of nodes with a dynamic_reconfigure server while they run, {params: {name: value}}. the values
  // aren't stored, a restart brings the yaml's back
  setParams: 'params.set',
  // the MowBite Planner's last log lines, {since?, limit?} -> {lines: [{t, level, msg}]}, oldest first
  plannerLog: 'planner.log',
  // a plan driven the way the mower would (lib/simulate), how far the one running got, and stopping it
  plannerSimulate: 'planner.simulate',
  plannerSimulateStatus: 'planner.simulate.status',
  plannerSimulateCancel: 'planner.simulate.cancel',
} as const;

export const ACTION = {
  startMowing: 'mower_logic:idle/start_mowing',
  pause: 'mower_logic:mowing/pause',
  resume: 'mower_logic:mowing/continue',
  goHome: 'mower_logic:mowing/abort_mowing',
  // while leaving the dock (and waiting for gps after it): stops there, the mower stays idle where it is
  abortUndocking: 'mower_logic:undocking/abort_undocking',
  skipArea: 'mower_logic:mowing/skip_area',
  // the rest of the outline pass or block of lanes being mowed, the mower goes on with the next one
  skipPath: 'mower_logic:mowing/skip_path',
  resetEmergency: 'mower_logic/reset_emergency',
  startRecording: 'mower_logic:idle/start_area_recording',
  // drops an interrupted job, only offered while idle with one (needs an openmower that has it)
  resetJob: 'mower_logic:idle/reset_job',
  // the steps while recording an area, e.g. finish_mowing_area
  recording: (step: string) => `mower_logic:area_recording/${step}`,
} as const;

// MowBite OS takes each action also as a call that answers, accepted or why not (masterplan, App ↔ OS). the app calls
// it where rpc.methods names it, otherwise it sends the action. params besides client, the same for every one
export const COMMAND: Record<string, {method: string; params?: Record<string, unknown>}> = {
  [ACTION.resetEmergency]: {method: 'emergency.reset'},
  [ACTION.startMowing]: {method: 'mowing.start'},
  [ACTION.resetJob]: {method: 'mowing.reset_job'},
  [ACTION.pause]: {method: 'mowing.pause'},
  [ACTION.resume]: {method: 'mowing.continue'},
  [ACTION.goHome]: {method: 'mowing.abort'},
  [ACTION.skipArea]: {method: 'mowing.skip_area'},
  [ACTION.skipPath]: {method: 'mowing.skip_path'},
  [ACTION.abortUndocking]: {method: 'undocking.abort'},
  'mower_logic:docking/abort_docking': {method: 'docking.abort'},
  [ACTION.startRecording]: {method: 'recording.start'},
  [ACTION.recording('exit_recording_mode')]: {method: 'recording.exit'},
  [ACTION.recording('start_recording')]: {method: 'recording.ring_start'},
  [ACTION.recording('stop_recording')]: {method: 'recording.ring_stop'},
  [ACTION.recording('finish_mowing_area')]: {method: 'recording.save', params: {type: 'mow'}},
  [ACTION.recording('finish_navigation_area')]: {method: 'recording.save', params: {type: 'nav'}},
  [ACTION.recording('finish_discard')]: {method: 'recording.discard'},
  [ACTION.recording('record_dock')]: {method: 'recording.dock'},
  [ACTION.recording('auto_point_collecting_enable')]: {method: 'recording.auto_points', params: {enabled: true}},
  [ACTION.recording('auto_point_collecting_disable')]: {method: 'recording.auto_points', params: {enabled: false}},
  [ACTION.recording('collect_point')]: {method: 'recording.point'},
};

// ros parameters, as they come in params/json
export const PARAM = {
  mowerLogic: (key: string) => `/mower_logic/${key}`,
  toolWidth: '/mower_logic/tool_width',
  mowAngleOffset: '/mower_logic/mow_angle_offset',
  mowAngleOffsetIsAbsolute: '/mower_logic/mow_angle_offset_is_absolute',
  mowAngleIncrement: '/mower_logic/mow_angle_increment',
  outlineCount: '/mower_logic/outline_count',
  dockingApproachDistance: '/mower_logic/docking_approach_distance',
  maxPositionAccuracy: '/mower_logic/max_position_accuracy',
  // where the gps antenna sits from the point the mower turns around, xbot_positioning takes it out of the pose
  antennaX: '/xbot_positioning/antenna_offset_x',
  antennaY: '/xbot_positioning/antenna_offset_y',
} as const;

// mower_logic's own defaults (MowerLogic.cfg, the same in 1.4.0 and edge). params/json is sent when xbot_monitoring
// connects to the broker, that can be before mower_logic put its defaults in, then only what the mower's yaml sets
// is there. what's missing then is the default, that's what the mower runs with
export const PARAM_DEFAULTS: Record<string, number> = {
  [PARAM.toolWidth]: 0.14,
  [PARAM.outlineCount]: 3,
  '/mower_logic/outline_overlap_count': 0,
  '/mower_logic/outline_offset': 0,
  [PARAM.mowAngleOffset]: 0,
  [PARAM.mowAngleIncrement]: 0,
  [PARAM.dockingApproachDistance]: 1.5,
  [PARAM.maxPositionAccuracy]: 0.2,
  '/mower_logic/gps_timeout': 10,
};

// where things are on a mower set up with openmower-cli today, only shown to explain things
export const PATHS = {
  eventHistory: '/home/openmower/ros/event_history/',
  checkpoint: '~/ros/checkpoint.bag',
  restart: 'openmower restart',
} as const;

// the source of the mower logic, linked next to events so you can see where they come from
export const LOGIC_SOURCE = 'https://github.com/ClemensElflein/open_mower_ros/blob/main/src/mower_logic/src/mower_logic/';
