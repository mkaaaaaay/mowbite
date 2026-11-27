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
  // MowBite OS's updater (its host): what it does and has, and whether it and MowBite OS are there (both retained, see lib/osUpdate, lib/hostOs)
  updateStatus: 'mowbite/update/status',
  hostStatus: 'mowbite/host/status',
  // whether the next start of the schedule would go as things are now (retained, empty without one to come)
  scheduleReady: 'mowbite/schedule/ready',
  // MowBite OS's setup program (retained where the platform has a step list, see lib/setup)
  setup: 'setup/json',
} as const;

// the caster's port when the access names none (ntrip.set)
export const NTRIP_PORT = 2101;

// the name MowBite OS answers system.info with
export const MOWBITE_OS = 'mowbite-os';

export const RPC = {
  // what this mower answers, newer OpenMower versions only
  methods: 'rpc.methods',
  // what runs on the mower, MowBite OS only (lib/mowerOs)
  systemInfo: 'system.info',
  // the map checked after MowBite OS went back to an older backup of its data, mowing by itself is free again (api 58)
  dataRollbackConfirm: 'data.rollback.confirm',
  // docks by the dock camera alone from in front of the station, without map or position (MowBite OS, where it lists it)
  dockingTest: 'docking.test',
  // home from idle away from the station, MowBite OS where it docks by itself
  dockingStart: 'docking.start',
  // MowBite OS's calibration drive: what stands in its way here, its start and its stop (listed while its program
  // runs), and the last result (lib/osCalibration)
  calibrationCheck: 'calibration.check',
  calibrationStart: 'calibration.start',
  calibrationAbort: 'calibration.abort',
  calibrationResult: 'calibration.result',
  // takes values of the last drive into robot.geometry (api 67)
  calibrationApply: 'calibration.apply',
  // memory, storage, load and network of the mower itself, MowBite OS only (lib/system)
  systemStats: 'system.stats',
  // min, mean and max of the number sensors per step over 48 h, MowBite OS where it lists it (hooks/useSensorHistory)
  sensorsHistory: 'sensors.history',
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
  // the access to the caster for corrections, MowBite OS only; set and delete where it takes them over rpc (lib/ntrip)
  ntripGet: 'ntrip.get',
  ntripSet: 'ntrip.set',
  ntripDelete: 'ntrip.delete',
  // the mower's cameras and a stream of one for a single viewer, MowBite OS with cameras only (lib/camera)
  cameraList: 'camera.list',
  cameraStream: 'camera.stream',
  // a camera locked after a crash while it ran, back on (api 64)
  cameraUnlock: 'camera.unlock',
  // what the obstacle sensors saw, kept on the mower with a photo each, where the platform has such a sensor (lib/obstacles)
  obstaclesList: 'vision.obstacles.list',
  obstaclesImage: 'vision.obstacles.image',
  obstaclesClear: 'vision.obstacles.clear',
  // the mower's sizes, MowBite OS only: kept by it, its planner only shows them (lib/mowerBody)
  geometry: 'robot.geometry.get',
  geometrySet: 'robot.geometry.set',
  // the setup program: its state, a step begun, answered, kept going, skipped or stopped, all taken back, and a step's image
  setupGet: 'setup.get',
  setupStart: 'setup.start',
  setupAnswer: 'setup.answer',
  setupKeep: 'setup.keep',
  setupSkip: 'setup.skip',
  setupAbort: 'setup.abort',
  setupReset: 'setup.reset',
  setupImage: 'setup.image',
  // the mowers the image runs as and the choice of one, MowBite OS starts again as it (api 57)
  setupPlatforms: 'setup.platforms',
  setupPlatformSet: 'setup.platform.set',
  // the serial ports and who holds each, and what comes at a free one, listened to only on the owner's tap (api 71)
  setupPorts: 'setup.ports',
  setupPortsListen: 'setup.ports.listen',
  setupFirmwareExport: 'setup.firmware.export',
  // points off the end of the line being recorded, MowBite OS only (masterplan 3.2)
  recordingUndo: 'recording.undo',
  // MowBite OS's own updates, answered by its host (lib/osUpdate)
  updateStatus: 'update.status',
  updateStart: 'update.start',
  updateAbort: 'update.abort',
  updateRollback: 'update.rollback',
  // starts MowBite OS again, answered by its host too (lib/hostOs)
  hostRestartOs: 'host.restart_os',
  hostConfirmStart: 'host.confirm_start',
  // a Tron restarted into the USB mode of its loader, for the installer on a PC (lib/hostOs)
  hostUsbMode: 'host.usb_mode',
  hostWifiScan: 'host.wifi_scan',
  hostWifiSet: 'host.wifi_set',
  // root's login over ssh, on a mower whose host manages it (lib/hostOs)
  hostSsh: 'host.ssh',
  // MowBite OS's own schedule (lib/schedule), the container's elsewhere
  scheduleGet: 'schedule.get',
  scheduleSet: 'schedule.set',
  scheduleLog: 'schedule.log',
  // MowBite OS's push messages and statistics (lib/notify, lib/stats), the container's cgis elsewhere
  notifyGet: 'notify.get',
  notifySet: 'notify.set',
  notifyTest: 'notify.test',
  notifyPushAdd: 'notify.push_add',
  notifyPushRemove: 'notify.push_remove',
  notifySnooze: 'notify.snooze',
  notifyLog: 'notify.log',
  statsGet: 'stats.get',
  statsPartDone: 'stats.part_done',
  statsPartDue: 'stats.part_due',
  statsStops: 'stats.stops',
  updateCheck: 'update.check',
  updateSetAuto: 'update.set_auto',
  updateSetChannel: 'update.set_channel',
  replaceMap: 'map.replace',
  eventDays: 'events.history.list',
  events: 'events.history',
  jobs: 'position.history.list',
  jobTrack: 'position.history',
  // deleting them on the mower, MowBite OS only: all days, and all tracks but the one of the running job
  eventsDelete: 'events.history.delete',
  jobTrackDelete: 'position.history.delete',
  // the mowing plan for an area straight from the mower's planner
  areaPlan: 'mowing.plan',
  // the area settings this mower keeps in map.json
  areaProperties: 'map.area_properties',
  // the last warnings and errors ROS logged, kept in memory by the mower
  logs: 'logs.recent',
  // MowBite OS's journal and the incidents kept from it (lib/incidents)
  journalStatus: 'journal.status',
  incidentsList: 'incidents.list',
  incidentsGet: 'incidents.get',
  incidentsDownload: 'incidents.download',
  incidentsMark: 'incidents.mark',
  incidentsDelete: 'incidents.delete',
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
  // while heading home or docking: stops there, the mower stays idle where it is
  abortDocking: 'mower_logic:docking/abort_docking',
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

// MowBite OS's parts whose update waits for the mower idle in the dock and restarts MowBite OS (masterplan 3.5), the
// others switch at any time
export const UPDATE_GATED = ['os', 'planner'];

// how far off the line straight out of the station the docking test may start (MowBite OS's dock camera)
export const DOCK_TEST_REACH = {cm: 5, deg: 20};
// how many dockings in a row a docking test takes (runs), from this api of MowBite OS on; before it only one
export const DOCK_TEST_RUNS = 10;
export const DOCK_TEST_RUNS_API = 37;
// camera.stream switches the boxes of what the mower recognises on and off per stream
export const CAMERA_DETECTIONS_API = 49;
// map.replace takes the SHA-256 of the map/json text the app last read and turns the map down (-32001) when another one
// was stored meanwhile
export const MAP_CHECK_API = 53;
// from this api on the cutting height, global and of an area, counts at once, also while the blade runs
export const HEIGHT_AT_ONCE_API = 60;
// host.wifi_set takes hidden for a WLAN that doesn't send its name
export const WIFI_HIDDEN_API = 63;
// camera.list's reason for a camera locked after a crash while it ran, camera.unlock lets it stream again (api 64)
export const CAMERA_LOCKED = 'LOCKED_AFTER_CRASH';
// a Tron opens its setup WLAN after the trial by a gesture at its buttons (setup_wifi in the host's status)
export const SETUP_WIFI_API = 64;
// the gesture: On/OK pressed this often within this many seconds, the setup WLAN then open this long
export const SETUP_WIFI_PRESSES = 5;
export const SETUP_WIFI_WITHIN_S = 5;
export const SETUP_WIFI_MINUTES = 30;
// root's password that host.ssh takes, in characters, without control characters
export const SSH_PASSWORD = {min: 8, max: 128};

// how long setup.ports.listen listens to a port (s), and how much longer the app waits for its answer
export const PORT_LISTEN_S = 10;
export const PORT_LISTEN_MARGIN_S = 5;

// a Tron as system.info names its platform (its driver's name): the one whose loader has a USB mode and whose buttons
// open its setup WLAN. how long the host may take to answer the restart into the USB mode
export const TRON_PLATFORM = 'airseekers_tron';
export const USB_MODE_MS = 30000;

// MowBite OS calibrates as IDLE with this sub state, the phases its CALIBRATION events name in their order
export const CALIBRATING = 'CALIBRATING';
export const CALIBRATION_PHASES = ['start', 'align', 'stand', 'line', 'spin_left', 'spin_right', 'evaluate', 'end'] as const;

// obstacle_mode by its names in vision.obstacles.list
export const OBSTACLE_MODES = ['off', 'show', 'stop', 'avoid'];

// above this voltage on the charge contacts OpenMower's idle takes the mower for docked (IdleBehavior)
export const DOCKED_VOLTAGE = 5;

// how much of the line the record page's back button takes back
export const UNDO_METERS = 1;

// MowBite OS takes each action also as a call that answers, accepted or why not (masterplan, App ↔ OS). the app calls
// it where rpc.methods names it, otherwise it sends the action. params besides client, the same for every one. Its
// own id of the action (api 70 on) is the method, with the variant where one method has two actions
export const COMMAND: Record<string, {method: string; params?: Record<string, unknown>; variant?: string}> = {
  [ACTION.resetEmergency]: {method: 'emergency.reset'},
  [ACTION.startMowing]: {method: 'mowing.start'},
  [ACTION.resetJob]: {method: 'mowing.reset_job'},
  [ACTION.pause]: {method: 'mowing.pause'},
  [ACTION.resume]: {method: 'mowing.continue'},
  [ACTION.goHome]: {method: 'mowing.abort'},
  [ACTION.skipArea]: {method: 'mowing.skip_area'},
  [ACTION.skipPath]: {method: 'mowing.skip_path'},
  [ACTION.abortUndocking]: {method: 'undocking.abort'},
  [ACTION.abortDocking]: {method: 'docking.abort'},
  [ACTION.startRecording]: {method: 'recording.start'},
  [ACTION.recording('exit_recording_mode')]: {method: 'recording.exit'},
  [ACTION.recording('start_recording')]: {method: 'recording.ring_start'},
  [ACTION.recording('stop_recording')]: {method: 'recording.ring_stop'},
  [ACTION.recording('finish_mowing_area')]: {method: 'recording.save', params: {type: 'mow'}, variant: 'mow'},
  [ACTION.recording('finish_navigation_area')]: {method: 'recording.save', params: {type: 'nav'}, variant: 'nav'},
  [ACTION.recording('finish_discard')]: {method: 'recording.discard'},
  [ACTION.recording('record_dock')]: {method: 'recording.dock'},
  [ACTION.recording('auto_point_collecting_enable')]: {method: 'recording.auto_points', params: {enabled: true}, variant: 'on'},
  [ACTION.recording('auto_point_collecting_disable')]: {method: 'recording.auto_points', params: {enabled: false}, variant: 'off'},
  [ACTION.recording('collect_point')]: {method: 'recording.point'},
  [ACTION.recording('undo_points')]: {method: RPC.recordingUndo, params: {meters: UNDO_METERS}},
};

// MowBite OS names its actions and mower_logic's settings its own way from this api on (/logic/<name>); its bridge
// still speaks OpenMower's names unless turned off (openmower_names). The app keeps OpenMower's inside
export const OWN_NAMES_API = 70;
export const OWN_LOGIC = '/logic/';
const ownIds = Object.entries(COMMAND).map(([id, c]): [string, string] => [id, c.variant ? `${c.method}:${c.variant}` : c.method]);
const OWN_ID = new Map(ownIds);
const OM_ID = new Map(ownIds.map(([id, own]) => [own, id]));
// an action by MowBite OS's own id, one it has none for as it is
export const ownActionId = (id: string) => OWN_ID.get(id) ?? id;
// an action of actions/json by OpenMower's id, whichever names the bridge speaks
export const omActionId = (id: string) => OM_ID.get(id) ?? id;

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
  // OpenMower's sounds (1.5.0 on, not in its legacy mode): the file is the language's sounds_<code>.yaml
  soundEnabled: '/ll/services/sound/enabled',
  soundVolume: '/ll/services/sound/volume',
  soundConfigFile: '/ll/services/sound/config_file',
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

// values for mower_params.yaml by their path ("ll/services/sound/volume"), as yaml to enter by hand
export function paramsYaml(pairs: [string, string | number | boolean][]): string {
  const tree: Record<string, unknown> = {};
  for (const [path, value] of pairs) {
    const keys = path.replace(/^\//, '').split('/');
    let at = tree;
    keys.slice(0, -1).forEach((k) => (at = (at[k] ??= {}) as Record<string, unknown>));
    at[keys[keys.length - 1]] = value;
  }
  const yaml = (o: Record<string, unknown>, ind = ''): string =>
    Object.entries(o)
      .map(([k, v]) => (typeof v === 'object' ? `${ind}${k}:\n${yaml(v as Record<string, unknown>, ind + '  ')}` : `${ind}${k}: ${v}\n`))
      .join('');
  return yaml(tree);
}
