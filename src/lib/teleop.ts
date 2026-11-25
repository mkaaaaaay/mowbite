import {Buffer} from 'buffer';
import {getMqttClient, withPrefix} from './mqttClient';
import {TOPIC} from './openmower';

// OpenMower takes remote driving on "teleop" as bson {vx, vz} (m/s forward, rad/s counterclockwise).
// The xCore stops the wheels when nothing arrived for a second (diff_drive_service.cpp), so this has to be sent
// over and over.
function twist(vx: number, vz: number): Buffer {
  const buf = Buffer.alloc(29);
  let o = 0;
  buf.writeInt32LE(29, o);
  o += 4;
  for (const [key, v] of [
    ['vx', vx],
    ['vz', vz],
  ] as const) {
    buf.writeUInt8(0x01, o++); // double
    o += buf.write(key + '\0', o, 'latin1');
    buf.writeDoubleLE(v, o);
    o += 8;
  }
  buf.writeUInt8(0, o);
  return buf;
}

// m/s at full stick, the turn rate follows along
export const SPEEDS = [0.15, 0.25, 0.35, 0.5];
export const TURN_PER_SPEED = 3;

const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

// a value that isn't a number stops, the rest stays within full stick at the top speed
export function sendDrive(vx: number, vz: number) {
  const top = Math.max(...SPEEDS);
  const [x, z] = Number.isFinite(vx) && Number.isFinite(vz) ? [clamp(vx, top), clamp(vz, top * TURN_PER_SPEED)] : [0, 0];
  getMqttClient().publish(withPrefix(TOPIC.teleop), twist(x, z), {qos: 0});
}
