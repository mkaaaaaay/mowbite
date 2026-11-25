import {describe, expect, it} from 'vitest';
import {infosFrom, sensorId, sensorValue} from './useMowerSensors';

describe('the sensors as they come from the mower', () => {
  it('are a list of sensors, anything else none', () => {
    const temp = {sensor_id: 'om_temp', sensor_name: 'Temperature'};
    expect(infosFrom(JSON.stringify([temp, null, {sensor_name: 'no id'}]))).toEqual([temp]);
    for (const bad of ['null', '{}', '"x"']) expect(infosFrom(bad)).toEqual([]);
  });

  it("go by OpenMower's ids, also where MowBite OS names them its own way", () => {
    const own = {sensor_id: 'battery_voltage', key: 'battery_voltage', sensor_name: 'Battery Voltage'};
    const named = {sensor_id: 'om_mow_motor_rpm', key: 'blade_rpm', sensor_name: 'Mow Motor Revolutions'};
    const plain = {sensor_id: 'battery_temp', key: 'battery_temp', sensor_name: 'Battery Temp'};
    const ids = infosFrom(JSON.stringify([own, named, plain])).map((i) => i.sensor_id);
    expect(ids).toEqual(['om_v_battery', 'om_mow_motor_rpm', 'battery_temp']);
    const more = ['position_accuracy', 'om_gps_accuracy', 'os_ntrip_state'];
    expect(more.map(sensorId)).toEqual(['om_gps_accuracy', 'om_gps_accuracy', 'os_ntrip_state']);
  });

  it("read the charge state under its own id in OpenMower's words", () => {
    const words = ['idle', 'charging', 'done', 'other'].map((v) => sensorValue('charge_state', v));
    expect(words).toEqual(['Not Charging', 'Fast Charge', 'Done', 'other']);
    expect(sensorValue('om_charge_state', 'Fast Charge')).toBe('Fast Charge');
  });
});
