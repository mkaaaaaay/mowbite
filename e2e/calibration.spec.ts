import {demoDocked, demoHas, expect, SIM, test} from './app';
import type {Page} from '@playwright/test';

// the demo mower driven with the stick at once, as if the seconds had passed: [m/s forward, rad/s left, seconds] each
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
    let t = Date.now();
    for (const [vx, vz, s] of moves)
      for (let i = 0; i < s * 5; i++) {
        if (vx || vz) demo.published('teleop', twist(vx, vz));
        demo.tick((t += 200));
      }
  }, moves);

test('calibrating by hand: driven, worked out, two values applied and set back', async ({page}) => {
  test.skip(SIM, 'the demo mower only');
  await page.goto('/calibration/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start calibration'}).click();
  // what it checks itself, what's to tick
  const sheet = page.getByRole('dialog', {name: 'Ready to calibrate?'});
  await expect(sheet.getByText('Position accurate to a few centimeters')).toBeVisible();
  await expect(sheet.getByText('Tick both points above, then it starts.')).toBeVisible();
  await sheet.getByRole('checkbox', {name: /Room to drive/}).check();
  await expect(sheet.getByText('Tick “You stay with it” too, then it starts.')).toBeVisible();
  await sheet.getByRole('checkbox', {name: /You stay with it/}).check();
  await sheet.getByRole('button', {name: "Let's go"}).click();

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

  // worked out by itself once it's enough: the values against the ones set now, two of them changed
  await expect(page.getByRole('heading', {name: 'Result', exact: true})).toBeVisible({timeout: 30_000});
  await expect(page.getByText('Distance per wheel turn')).toBeVisible();
  await expect(page.getByText(/Unchanged: the difference is smaller than the measuring accuracy/).first()).toBeVisible();
  await expect(page.getByText('The IMU sits tilted: 0.3° to the side, 4.5° forward. Just a note, OpenMower has no setting for it.')).toBeVisible();
  // driven back onto the station meanwhile, recording mode ended there
  // not on the station: asked once more
  await page.getByRole('button', {name: 'End recording mode'}).click();
  await page.getByRole('button', {name: "End it, it's not on the station"}).click();
  // (the demo mower drives home from there by itself, OpenMower stays idle where it is)
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).not.toBe('AREA_RECORDING');

  await page.getByRole('button', {name: 'Apply 2 values'}).click();
  await expect(page.getByText('Applying 2 values')).toBeVisible();
  await expect(page.getByText('ll/services/diff_drive/ticks_per_m')).toBeVisible();
  // written by the updater in the dock: then they're in effect
  await expect(page.getByText(/Restarted, in effect since/)).toBeVisible({timeout: 20_000});
  await expect(page.getByText('2 values applied')).toBeVisible();

  // the last calibration on the page, set back to the copy before
  await page.getByRole('button', {name: 'Close'}).click();
  await expect(page.getByRole('heading', {name: 'Last calibration'})).toBeVisible();
  await page.getByRole('button', {name: 'Set back'}).click();
  await page.getByRole('button', {name: 'Yes, set back'}).click();
  await expect(page.getByText(/Set back, OpenMower restarted at/)).toBeVisible({timeout: 20_000});
});

test('the guide for calibrating opens from the settings', async ({page}) => {
  await page.goto('/settings/#guides');
  await page.getByRole('link', {name: 'Calibrating'}).click();
  await expect(page.getByRole('heading', {name: 'Turning on the spot'})).toBeVisible();
  await page.getByRole('link', {name: 'To the calibration'}).click();
  await expect(page.getByRole('heading', {name: 'Calibration', exact: true})).toBeVisible();
});
