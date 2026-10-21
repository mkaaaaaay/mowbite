# what the scripts in the container expect from OpenMower, like src/lib/openmower.ts for the app.
# OpenMower is being restructured (OSv3), when names change it should be here
TOPIC_ROBOT_STATE=robot_state/json
TOPIC_EVENTS=events/json
TOPIC_SENSOR_DATA='sensors/+/data'
# the charge contacts' voltage, there also when the battery is full and is_charging is off
TOPIC_CHARGE_VOLTAGE=sensors/om_v_charge/data
TOPIC_ACTION=action
# the actions the mower knows, with enabled 1/0 for what it takes right now (retained)
TOPIC_ACTIONS=actions/json
TOPIC_MAP=map/json
ACTION_START_MOWING=mower_logic:idle/start_mowing
ACTION_SKIP_AREA=mower_logic:mowing/skip_area
ACTION_HOME=mower_logic:mowing/abort_mowing
ACTION_RESET_JOB=mower_logic:idle/reset_job
TOPIC_RPC_REQUEST=rpc/request
TOPIC_RPC_RESPONSE=rpc/response
TOPIC_RPC_ERROR=rpc/error
# the last ros warnings and errors, kept in memory by the monitoring node
RPC_LOGS=logs.recent
# the ros parameters as the mower has them, and setting some while it runs (newer OpenMower only, not stored there)
TOPIC_PARAMS=params/json
RPC_SET_PARAMS=params.set
PARAM_MOW_ANGLE_OFFSET=/mower_logic/mow_angle_offset
# the MowBite Planner's settings (with the planner only)
RPC_PLANNER_SETTINGS=planner.settings
# the MowBite Planner's own log lines, kept in memory since its start (with the planner only)
RPC_PLANNER_LOG=planner.log
# the plan of an area: the MowBite Planner's (with the planner only) and OpenMower's own
RPC_PLANNER_PLAN=planner.plan
RPC_AREA_PLAN=mowing.plan
