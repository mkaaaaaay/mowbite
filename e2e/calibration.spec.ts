import {demoDocked, demoHas, expect, SIM, test} from './app';
import type {Page} from '@playwright/test';

// the demo mower driven with the stick at once, as if the seconds had passed: [m/s forward, rad/s left, seconds] each,
// 0 and 0 the stick let go (else the last move goes on for a second once the clock gets there)
const demoDrive = (page: Page, moves: [number, number, number][]) =>
  page.evaluate((moves) => {
    type Demo = {published(topic: string, message: Uint8Array): void; tick(now: number): void};
    const demo = (window as unknown as {mowbiteDemo: Demo}).mowbiteDemo;
    // the stick's command as bson {vx, vz}, like lib/teleop
    const twist = (vx: number, vz: number) => {
      const d = new DataView(new ArrayBuffer(29));
      let o = 0;
      d.setInt32(o, 29, true);
      o += 4;
      for (const [k, v] of [['vx', vx], ['vz', vz]] as const) {
        d.setUint8(o++, 1);
        for (const c of k + '\0') d.setUint8(o++, c.charCodeAt(0));
        d.setFloat64(o, v, true);
        o += 8;
      }
      return new Uint8Array(d.buffer);
    };
    // the demo's clock to now first: the first step as long as the others, not as long as since its last tick
    let t = Date.now();
    demo.tick(t);
    for (const [vx, vz, s] of moves)
      for (let i = 0; i < s * 5; i++) {
        demo.published('teleop', twist(vx, vz));
        demo.tick((t += 200));
      }
  }, moves);

// from the start through the drive by hand until the result is worked out
async function calibrateByHand(page: Page) {
  await page.goto('/calibration/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start calibration'}).click();
  // what it checks itself, what's to tick
  const sheet = page.getByRole('dialog', {name: 'Ready to calibrate?'});
  await expect(sheet.getByText('Position accurate to a few centimeters')).toBeVisible();
  await expect(sheet.getByText('Tick both points above, then it starts.')).toBeVisible();
  // the receiver's fix as the planner sees it (planner.calib.check)
  await expect(sheet.getByText('2.1 cm')).toBeVisible();
  await sheet.getByRole('checkbox', {name: /Room to drive/}).check();
  await expect(sheet.getByText('Tick “You stay with it” too, then it starts.')).toBeVisible();
  await sheet.getByRole('checkbox', {name: /You stay with it/}).check();
  await sheet.getByRole('button', {name: "Let's go"}).click();
  // recording mode first: into position with the stick, then the recording started
  await expect(page.getByText('Drive the mower into position with the joystick')).toBeVisible();
  await page.getByRole('button', {name: 'Start calibration'}).click();

  // recording mode on, the planner recording: what's missing on the tiles
  await expect(page.getByText('Stand 10 s')).toBeVisible();
  await expect(page.getByText('Turn left', {exact: true})).toBeVisible();
  expect((await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('AREA_RECORDING');
  await expect(page.getByText('Let go of the stick')).toBeVisible();

  // stood, then runs of 6 m with a whole round on the spot between them, three each way
  const run: [number, number, number] = [0.5, 0, 12];
  const left: [number, number, number] = [0, 1, 6.6];
  const right: [number, number, number] = [0, -1, 6.6];
  await demoDrive(page, [[0, 0, 12], run, left, run, left, run, left]);
  // a turn counts once a straight piece follows it
  await expect(page.getByText('2 of 3')).toBeVisible({timeout: 30_000});
  await demoDrive(page, [run]);
  await expect(page.getByText('Turn right round')).toBeVisible({timeout: 30_000});
  await demoDrive(page, [right, run, right, run, right, run, [0, 0, 5]]);

  // worked out by itself once it's enough
  await expect(page.getByRole('heading', {name: 'Result', exact: true})).toBeVisible({timeout: 30_000});
}

test('calibrating by hand: driven, worked out, three values applied and set back', async ({page}) => {
  test.skip(SIM, 'the demo mower only');
  await calibrateByHand(page);
  // the values against the ones set now, three of them changed
  await expect(page.getByText('Distance per wheel turn')).toBeVisible();
  await expect(page.getByText(/Unchanged: the difference is smaller than the measuring accuracy/).first()).toBeVisible();
  await expect(page.getByText('The IMU sits tilted: 0.3° to the side, 4.5° forward. Just a note, OpenMower has no setting for it.')).toBeVisible();
  // left and right on their own (the planner's info), the warning from 2 % apart
  await expect(page.getByText(/^Each wheel on its own: left 2007, right 2056 ticks\/m \(2\.4 % apart\)\.$/)).toBeVisible();
  await expect(page.getByText(/^Left and right: the right wheel is in effect 2\.4 % smaller/)).toBeVisible();
  // recording mode ended away from the station: asked once more
  await page.getByRole('button', {name: 'End recording mode'}).click();
  await expect(page.getByText("It isn't on the station yet, after this the stick doesn't drive it any more.")).toBeVisible();
  await page.getByRole('button', {name: 'End it anyway'}).click();
  // (the demo mower drives home from there by itself, OpenMower stays idle where it is)
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).not.toBe('AREA_RECORDING');

  await page.getByRole('button', {name: 'Apply 3 values'}).click();
  await expect(page.getByText('Applying 3 values')).toBeVisible();
  await expect(page.getByText('ll/services/diff_drive/ticks_per_m')).toBeVisible();
  // written by the updater in the dock: then they're in effect
  await expect(page.getByText(/Restarted, in effect since/)).toBeVisible({timeout: 20_000});
  await expect(page.getByText('3 values applied')).toBeVisible();

  // the last calibration on the page, set back to the copy before
  await page.getByRole('button', {name: 'Close'}).click();
  await expect(page.getByRole('heading', {name: 'Last calibration'})).toBeVisible();
  await page.getByRole('button', {name: 'Set back'}).click();
  await page.getByRole('button', {name: 'Yes, set back'}).click();
  await expect(page.getByText(/Set back, OpenMower restarted at/)).toBeVisible({timeout: 20_000});
});

// the antenna 3 cm further back than entered: the docking station lies off by that, recorded again with the guide
test('the docking station recorded again after the antenna moved: out to the mark, the first point, in until it charges', async ({page}) => {
  test.skip(SIM, 'the demo mower only');
  await calibrateByHand(page);
  await page.getByRole('button', {name: 'End recording mode'}).click();
  await page.getByRole('button', {name: 'End it anyway'}).click();
  await page.getByRole('button', {name: 'Apply 3 values'}).click();
  // with the values before the station would lie off again: only once they're in effect
  const again = page.getByRole('button', {name: 'Record it now'});
  await expect(page.getByText(/The antenna sits 3 cm differently than assumed/)).toBeVisible();
  await expect(again).toBeDisabled();
  await expect(page.getByText('Possible once the new values are in effect.')).toBeVisible();
  await expect(page.getByText('3 values applied')).toBeVisible({timeout: 20_000});
  // (the demo mower drives home by itself from where the calibration ended)
  await page.evaluate(() => (window as unknown as {mowbiteDemo: {ahead(s: number): void}}).mowbiteDemo.ahead(600));
  await expect(again).toBeEnabled({timeout: 20_000});
  await again.click();

  // backed out of the station to the mark: the first point only there
  await expect(page.getByText('Back it out straight')).toBeVisible();
  const first = page.getByRole('button', {name: 'Set first point'});
  await expect(first).toBeDisabled();
  expect((await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('AREA_RECORDING');
  await demoDrive(page, [[-0.25, 0, 4], [0, 0, 1]]);
  await expect(page.getByText('Stands right.')).toBeVisible();
  await first.click();

  // straight in: saved once it charges
  await expect(page.getByText('Straight in until it charges')).toBeVisible();
  const save = page.getByRole('button', {name: 'Save docking station'});
  await expect(save).toBeDisabled();
  await demoDrive(page, [[0.25, 0, 4], [0, 0, 1]]);
  await expect(page.getByText('It charges.')).toBeVisible();
  await save.click();
  // recording mode ended by itself, where the card was it's told
  await expect(page.getByText('Docking station recorded again')).toBeVisible();
  await expect(page.getByText('In the same place as before.')).toBeVisible();
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('IDLE');
  const station = (await demoHas<{docking_stations: {position: {x: number; y: number}; heading: number}[]}>(page, 'map/json')).docking_stations[0];
  // (the way in to -x like before: ±180°)
  expect(Math.cos(station.heading)).toBeCloseTo(-1, 3);
});

// on a phone held upright the two pads held sideways are recommended, a tap turns it there
test('driving for the calibration recommends sideways on a phone held upright', async ({page, isMobile}) => {
  test.skip(SIM || !isMobile, 'the demo mower on a phone');
  await page.goto('/calibration/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start calibration'}).click();
  const sheet = page.getByRole('dialog', {name: 'Ready to calibrate?'});
  await sheet.getByRole('checkbox', {name: /Room to drive/}).check();
  await sheet.getByRole('checkbox', {name: /You stay with it/}).check();
  await sheet.getByRole('button', {name: "Let's go"}).click();
  const hint = page.getByRole('button', {name: 'Sideways recommended'});
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(page.getByRole('button', {name: 'Upright'})).toBeVisible();
  await expect(hint).toBeHidden();
});

test('the guide for calibrating opens from the settings', async ({page}) => {
  await page.goto('/settings/#guides');
  await page.getByRole('link', {name: 'Calibrating'}).click();
  await expect(page.getByRole('heading', {name: 'Turning on the spot'})).toBeVisible();
  await page.getByRole('link', {name: 'To the calibration'}).click();
  await expect(page.getByRole('heading', {name: 'Calibration', exact: true})).toBeVisible();
});
