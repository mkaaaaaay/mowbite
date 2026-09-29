# what the scripts in the container expect from OpenMower, like src/lib/openmower.ts for the app.
# OpenMower is being restructured (OSv3), when names change it should be here
TOPIC_ROBOT_STATE=robot_state/json
TOPIC_EVENTS=events/json
TOPIC_SENSOR_DATA='sensors/+/data'
TOPIC_ACTION=action
TOPIC_MAP=map/json
ACTION_START_MOWING=mower_logic:idle/start_mowing
ACTION_SKIP_AREA=mower_logic:mowing/skip_area
ACTION_HOME=mower_logic:mowing/abort_mowing
