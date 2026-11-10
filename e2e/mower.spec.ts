import {demoAction, demoCall, demoDocked, demoDrive, demoEmergency, demoHas, demoRefuseReset, expect, recordStation, tab, test} from './app';
import type {Page} from '@playwright/test';

const state = async (page: Page) => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state;

// pause turns into continue under the finger: a second tap right after mustn't take the pause back
test('pause and continue, a quick second tap on pause does nothing', async ({page}) => {
  await page.goto('/');
  // the demo mower is out mowing when it opens
  await expect.poll(() => state(page)).toBe('MOWING');
  const pause = page.getByRole('button', {name: 'Pause', exact: true});
  await pause.dblclick();
  const go = page.getByRole('button', {name: 'Continue', exact: true});
  await expect(go).toBeVisible();
  await expect(go).toBeDisabled();
  await expect.poll(() => state(page)).toBe('PAUSED');
  // a moment later it takes taps again
  await expect(go).toBeEnabled();
  expect(await state(page)).toBe('PAUSED');
  await go.click();
  await expect.poll(() => state(page)).toBe('MOWING');
  await expect(pause).toBeVisible();
});

// the blade in recording mode (mowing by hand): off when it's switched off, and when the phone is put away
test('the blade in recording mode goes off with its button and when the phone is put away', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const on = page.locator('button:visible', {hasText: 'Blade on'});
  const off = page.locator('button:visible', {hasText: 'Blade off'});
  const turning = page.getByText('The blade is turning, also while the mower stands still.').first();
  await on.click();
  await expect(turning).toBeVisible();
  await off.click();
  await expect(turning).toBeHidden();
  await on.click();
  await expect(turning).toBeVisible();
  const away = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await away(true);
  await away(false);
  await expect(turning).toBeHidden();
  await expect(on).toBeEnabled();
});

const pose = async (page: Page) => (await demoHas<{pose: {x: number; y: number}}>(page, 'robot_state/json')).pose;
// the stick's pad (a module's class names end in its own name, the rest is a hash)
const stick = (page: Page) => page.locator('[class*="_pad"]:has([class*="_knob"])');
// the stick of the upright layout held forward
async function holdStick(page: Page) {
  const box = (await stick(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8, {steps: 4});
}

// a second finger on Sideways while the stick is held: the stick is gone from under the first one, the mower stops anyway
test('the mower stops when the layout changes under a held stick', async ({page, isMobile}) => {
  test.skip(!isMobile, 'Sideways is on phones');
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await holdStick(page);
  const from = await pose(page);
  await expect.poll(async () => Math.hypot((await pose(page)).x - from.x, (await pose(page)).y - from.y)).toBeGreaterThan(0.05);
  await page.getByRole('button', {name: 'Sideways', exact: true}).dispatchEvent('click');
  await page.mouse.up();
  await expect(page.getByRole('button', {name: 'Upright'})).toBeVisible();
  // the wheels stop a second after the last command
  await page.waitForTimeout(1500);
  const stopped = await pose(page);
  await page.waitForTimeout(1500);
  const later = await pose(page);
  expect(Math.hypot(later.x - stopped.x, later.y - stopped.y)).toBeLessThan(0.01);
});

// the same with a second finger on the docking station's guide, there and back: the first one is on a new stick then
test('the mower stops when the docking station guide opens or closes under a held stick', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  for (const name of ['Record the docking station again', 'Cancel']) {
    await holdStick(page);
    const from = await pose(page);
    await expect.poll(async () => Math.hypot((await pose(page)).x - from.x, (await pose(page)).y - from.y)).toBeGreaterThan(0.05);
    await page.getByRole('button', {name, exact: true}).dispatchEvent('click');
    // still held and moved on the new stick, which doesn't take it: the wheels stop a second after the last command
    const box = (await stick(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 16, {steps: 2});
    await page.waitForTimeout(1500);
    const stopped = await pose(page);
    await page.waitForTimeout(1500);
    const later = await pose(page);
    expect(Math.hypot(later.x - stopped.x, later.y - stopped.y)).toBeLessThan(0.01);
    await page.mouse.up();
  }
});

// on OpenMower an emergency stop holds recording where it is: reset on the page, what's recorded stays
test('an emergency stop while recording is reset on the record page', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await demoEmergency(page);
  const reset = page.locator('button:visible', {hasText: 'Reset emergency'});
  await expect(page.getByText('Release the mower, then reset the emergency to drive again.')).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();
  await expect(stick(page)).toBeVisible();
  expect(await state(page)).toBe('AREA_RECORDING');
});

// the stick takes the reset button's place once the emergency stop is let go: a second tap meant for the reset mustn't
// drive
test('after an emergency reset on the record page the stick waits a moment', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  // when the reset was tapped and when the stick was pressed, by the page's clock
  await page.evaluate(() => {
    const at: Record<string, number> = ((window as unknown as {tapAt: Record<string, number>}).tapAt = {});
    for (const type of ['click', 'pointerdown']) document.addEventListener(type, () => (at[type] = performance.now()), true);
  });
  let from = await pose(page);
  // only a press within the second it waits tells: a busy pc can be late for it, then once more
  for (let late = 0; ; late++) {
    await demoEmergency(page);
    await page.locator('button:visible', {hasText: 'Reset emergency'}).click();
    const box = (await stick(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    const at = await page.evaluate(() => (window as unknown as {tapAt: Record<string, number>}).tapAt);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(600);
    if (at.pointerdown - at.click < 1000) break;
    expect(late, 'the press came too late every time').toBeLessThan(2);
    from = await pose(page);
  }
  const still = await pose(page);
  expect(Math.hypot(still.x - from.x, still.y - from.y)).toBeLessThan(0.01);
  // a moment later it drives again
  await holdStick(page);
  await expect.poll(async () => Math.hypot((await pose(page)).x - from.x, (await pose(page)).y - from.y)).toBeGreaterThan(0.05);
  await page.mouse.up();
});

// the same on the overview: start comes where the reset button was
test('after an emergency reset start waits a moment', async ({page}) => {
  await page.goto('/');
  await demoDocked(page);
  await demoEmergency(page);
  const start = page.getByRole('button', {name: 'Start', exact: true});
  await expect(start).toBeHidden();
  await page.getByRole('button', {name: 'Reset emergency'}).click();
  await expect(start).toBeVisible();
  await expect(start).toBeDisabled();
  expect(await state(page)).toBe('IDLE');
  // a moment later it takes taps again
  await expect(start).toBeEnabled();
});

// the overview says why the emergency stop came (the ros log), and why MowBite OS didn't let go of it when it was reset:
// still tilted, until it stands level and the next reset goes through
test('an emergency stop says why, a reset turned down says why not', async ({page}) => {
  await page.goto('/');
  await demoDocked(page);
  await demoRefuseReset(page, {reason: 'STILL_TILTED', angle: 34.4, limit: 26, severity: 'warning', resume: 'user', message: 'still tilted by 34 deg'});
  await demoEmergency(page, ['TILT']);
  await expect(page.getByText('Tilted too far', {exact: true})).toBeVisible();
  const reset = page.getByRole('button', {name: 'Reset emergency'});
  await reset.click();
  await expect(page.getByText('Not reset: still tilted (34°, less than 26° needed)')).toBeVisible();
  await expect(page.getByText('Stand it level, then reset it again.')).toBeVisible();
  await demoRefuseReset(page, null);
  await reset.click();
  await expect(reset).toBeHidden();
  await expect(page.getByText(/^Not reset/)).toBeHidden();
});

// a line without its second point drops the whole area on OpenMower: stop right after Record obstacle asks first
test('stop right after record obstacle asks before the area is lost', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const button = (name: string) => page.locator('button:visible', {hasText: name}).first();
  await button('Record outline').click();
  await holdStick(page);
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await button('Stop').click();
  await expect(button('Record obstacle')).toBeVisible();
  await button('Record obstacle').click();
  await button('Stop').click();
  const ask = page.getByRole('alertdialog', {name: 'Stop already?'});
  await expect(ask).toBeVisible();
  await ask.getByRole('button', {name: 'Keep recording'}).click();
  await expect(ask).toBeHidden();
  await expect(button('Stop')).toBeVisible();
  await button('Stop').click();
  await ask.getByRole('button', {name: 'Discard area'}).click();
  await expect(button('Record outline')).toBeVisible();
});

// discard area sits next to save: the first tap only asks
test('discard area takes a second tap', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const button = (name: string) => page.locator('button:visible', {hasText: name}).first();
  await button('Record outline').click();
  await holdStick(page);
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await button('Stop').click();
  await button('Discard area').click();
  await expect(button('Really discard?')).toBeVisible();
  await expect(button('Save as mowing area')).toBeVisible();
  await button('Really discard?').click();
  await expect(button('Record outline')).toBeVisible();
});

// saved is told once the map has the area
test('a saved area is told saved once it is in the map', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  const areas = async () => (await demoHas<{areas: unknown[]}>(page, 'map/json')).areas.length;
  const before = await areas();
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const button = (name: string) => page.locator('button:visible', {hasText: name}).first();
  await button('Record outline').click();
  await holdStick(page);
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await button('Stop').click();
  await button('Save as mowing area').click();
  await expect(page.getByText('Mowing area saved.').first()).toBeVisible();
  expect(await areas()).toBe(before + 1);
});

// a job the mower interrupted keeps the lanes of the old map, recording mode doesn't end it: an area recorded ends it
// once the mode is left, only switching the mode on and off leaves it
const offered = async (page: Page) =>
  (await demoHas<{action_id: string; enabled: number}[]>(page, 'actions/json')).find((a) => a.action_id === 'mower_logic:idle/reset_job')?.enabled;
const WAITING = 'An interrupted job is waiting. Recording an area ends it, the next start plans on the new map.';

// the page left by a tab ends recording mode
async function leaveByTab(page: Page) {
  await tab(page, '/').click();
  await page.getByRole('alertdialog', {name: 'End recording mode?'}).getByRole('button', {name: 'End recording mode'}).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => state(page)).toBe('IDLE');
}

test('an area recorded ends the interrupted job once recording mode is left', async ({page}) => {
  await page.goto('/record/');
  // sent home in the middle of its job
  await demoDocked(page);
  expect(await offered(page)).toBe(1);
  await expect(page.getByText(WAITING)).toBeVisible();
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const button = (name: string) => page.locator('button:visible', {hasText: name}).first();
  // backwards out of the station, then an outline along two sides of a square
  await demoDrive(page, [
    [-0.4, 0, 3],
    [0, 0, 1],
  ]);
  await button('Record outline').click();
  await demoDrive(page, [
    [-0.4, 0, 3],
    [0, Math.PI / 4, 2],
    [0.4, 0, 3],
    [0, 0, 1],
  ]);
  await button('Stop').click();
  await button('Save as mowing area').click();
  await expect(page.getByText('Mowing area saved.').first()).toBeVisible();
  // the same way back onto the station (from elsewhere the demo drives home by itself, OpenMower stays idle there)
  await demoDrive(page, [
    [-0.4, 0, 3],
    [0, -Math.PI / 4, 2],
    [0.4, 0, 6],
    [0, 0, 1],
  ]);
  await leaveByTab(page);
  await expect.poll(() => offered(page)).toBe(0);
  await expect(page.getByRole('button', {name: 'Drop the interrupted job'})).toBeHidden();
  // back on the record page (in the app, a reload would forget it): told until recording mode starts again
  await page.goBack();
  await expect(page).toHaveURL(/\/record\/?$/);
  await expect(page.getByText('The interrupted job was planned on the old map, it ended with the recording. The next start plans on the new one.')).toBeVisible();
  await expect(page.getByText(WAITING)).toBeHidden();
});

test('switching recording mode on and off leaves the interrupted job', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  expect(await offered(page)).toBe(1);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await expect.poll(() => state(page)).toBe('AREA_RECORDING');
  await leaveByTab(page);
  // longer than a drop after the mode is waited for
  await page.waitForTimeout(11_000);
  expect(await offered(page)).toBe(1);
  await expect(page.getByRole('button', {name: 'Drop the interrupted job'})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/record\/?$/);
  await expect(page.getByText(WAITING)).toBeVisible();
});

// recording mode left on without its page (another phone, the back button): the overview leads back to it, and out of
// it while nothing would be lost
test('the overview in recording mode leads back to recording and out of it', async ({page}) => {
  await page.goto('/');
  await demoDocked(page);
  await demoAction(page, 'mower_logic:idle/start_area_recording');
  const back = page.getByRole('link', {name: 'Back to recording'});
  const end = page.getByRole('button', {name: 'Leave recording mode'});
  await expect(back).toBeVisible();
  await end.click();
  await expect.poll(() => state(page)).not.toBe('AREA_RECORDING');
  await expect(back).toBeHidden();
  await demoAction(page, 'mower_logic:idle/start_area_recording');
  // an outline being recorded: ending would lose it, only the way back is offered
  await demoAction(page, 'mower_logic:area_recording/start_recording');
  await expect(back).toBeVisible();
  await expect(end).toBeHidden();
  await back.click();
  await expect(page).toHaveURL(/\/record\/?$/);
  await expect(page.locator('button:visible', {hasText: 'Discard area'}).first()).toBeVisible();
});

// with the blade turning a reload asks first: what the page sends while it unloads doesn't get out
test('a reload while the blade turns in recording mode asks first', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await page.locator('button:visible', {hasText: 'Blade on'}).click();
  await expect(page.getByText('The blade is turning, also while the mower stands still.').first()).toBeVisible();
  const asked = new Promise<string>((done) =>
    page.once('dialog', (d) => {
      done(d.type());
      void d.dismiss();
    }),
  );
  void page.reload().catch(() => {});
  expect(await asked).toBe('beforeunload');
  await expect(page.getByText('The blade is turning, also while the mower stands still.').first()).toBeVisible();
});

// paused OpenMower takes a skip and does it once it goes on: the countdown runs and it goes out
test('skip area while paused goes out and is done on continue', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => state(page)).toBe('MOWING');
  const area = async () => (await demoHas<{current_area: number}>(page, 'robot_state/json')).current_area;
  await expect.poll(area).toBeGreaterThanOrEqual(0);
  const before = await area();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect.poll(() => state(page)).toBe('PAUSED');
  await page.getByRole('button', {name: 'Skip area'}).click();
  const undo = page.getByRole('button', {name: /^Undo \(\d s\)$/});
  await expect(undo).toBeVisible();
  await expect(undo).toBeHidden({timeout: 8000});
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect.poll(area).not.toBe(before);
});

// a new garden has no docking station yet: the guide measures where it charges and the way out of it
test('the docking station recorded with the guide, also without one in the map', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  const map = await demoHas<{docking_stations: unknown[]}>(page, 'map/json');
  await demoCall(page, 'map.replace', [{...map, docking_stations: []}]);
  await page.getByRole('button', {name: 'Record docking station', exact: true}).click();
  await recordStation(page, 'New in the map.');
  const station = (await demoHas<{docking_stations: {position: {x: number; y: number}; heading: number}[]}>(page, 'map/json')).docking_stations[0];
  // where the demo's station stands, its way in to -x
  expect(station.position.x).toBeCloseTo(-1.1, 2);
  expect(station.position.y).toBeCloseTo(3.5, 2);
  expect(Math.cos(station.heading)).toBeCloseTo(-1, 3);
});

// recording: what to do now on the map, the steps in the card under it
test('recording says what to do on the map', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await expect(page.getByText('Drive to the edge of the new area', {exact: true})).toBeVisible();
  await page.locator('button:visible', {hasText: 'Record outline'}).first().click();
  await expect(page.getByText('Along the edge', {exact: true})).toBeVisible();
});

// a page stays with the mower it was opened with: another tab leaving the demo doesn't take this one out of it
test('a page in the demo stays in it while another tab leaves the demo', async ({page, context}) => {
  // (mqtt goes nowhere: nothing answers it)
  await context.routeWebSocket(/.*/, () => {});
  const list = JSON.stringify({mowers: [{id: 'b', name: 'B', host: 'mower2.test'}]});
  await page.addInitScript((l) => localStorage.setItem('appSettings', l), list);
  await page.goto('/schedule/');
  const schedule = page.getByRole('checkbox', {name: 'Mow by schedule'});
  await expect(schedule).toBeChecked();
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/cgi-bin/')) sent.push(`${r.method()} ${r.url()}`);
  });
  const other = await context.newPage();
  await other.goto('/settings/');
  await Promise.all([other.waitForEvent('load'), other.getByRole('button', {name: 'Leave', exact: true}).click()]);
  expect(await page.evaluate(() => localStorage.getItem('mower'))).toBeNull();
  const kept = await page.evaluate(() => localStorage.getItem('appSettings'));
  await schedule.uncheck();
  await expect(page.getByText('Switched off, the mower only mows when you start it.')).toBeVisible();
  await tab(page, '/settings').click();
  await page.locator('#look summary').click();
  await page.getByRole('checkbox', {name: 'Grass along the bottom of the screen'}).uncheck();
  // (a save goes out 0.4 s later)
  await page.waitForTimeout(1000);
  await expect(page.getByText('Demo: a made-up mower, nothing is saved')).toBeVisible();
  expect(sent).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('appSettings'))).toBe(kept);
  await other.close();
});

// a mower's address is checked before it's added, another port on the same host is another mower, remove asks once more
test('mowers: an address that is none is turned down, removing one needs a second tap', async ({context}) => {
  // (a page of its own, out of the demo: its requests to a container that isn't there fail in the console, mqtt goes
  // nowhere)
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  await page.goto('/settings/');
  await page.locator('#app > summary').click();
  const address = page.getByLabel('Address of the other mower (IP or name in your network)');
  const add = async (typed: string) => {
    await address.fill(typed);
    await page.getByRole('button', {name: 'Add mower'}).click();
  };
  await add('300.1.2.3');
  await expect(page.getByText("That's not an address. Enter an IP or the mower's name in your network.")).toBeVisible();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await add('mower2.test:8090');
  await add('mower2.test');
  await expect(page.getByText('mower2.test:8090')).toBeVisible();
  await expect(page.getByText('mower2.test:8082')).toBeVisible();
  await add('mower2.test:8090');
  await expect(page.getByText('This mower is already in the list.')).toBeVisible();
  await page.getByRole('button', {name: 'Remove', exact: true}).first().click();
  await expect(page.getByText('mower2.test:8090')).toBeVisible();
  await page.getByRole('button', {name: 'Really remove?'}).click();
  await expect(page.getByText('mower2.test:8090')).toHaveCount(0);
  await expect(page.getByText('mower2.test:8082')).toBeVisible();
  await page.close();
});
