import type {Page} from '@playwright/test';
import {demoCameras, demoDocked, demoWith, expect, SIM, tab, test} from './app';

// the picture the camera view shows right now, as text: the demo draws the camera's name into each one of its stream
const picture = (page: Page) =>
  page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('[data-camera] img');
    return img?.src
      ? fetch(img.src).then(
          (r) => r.text(),
          () => '',
        )
      : '';
  });

// the camera picture switched on for the dashboard, and back there
async function onDashboard(page: Page) {
  await tab(page, '/settings').click();
  await page.locator('#look summary').click();
  await page.getByRole('checkbox', {name: 'Camera picture'}).check();
  await tab(page, '/').click();
  return page.locator('[data-camera]');
}

// the cameras of a mower with MowBite OS: the demo is an OpenMower and has none until a test switches them on. it's out
// mowing when it opens, the blade running: no picture until it's home
test.describe('cameras', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/');
    await page.locator('#look summary').click();
    await expect(page.getByRole('checkbox', {name: 'Mow motor', exact: true})).toBeVisible();
    await expect(page.getByRole('checkbox', {name: 'Camera picture'})).toHaveCount(0);
  });

  test('on the dashboard once switched on: why there is none while the blade runs, then the picture, the cameras to switch', async ({page}) => {
    await demoWith(page, 'Cameras');
    await page.goto('/');
    await expect(page.locator('[data-camera]')).toHaveCount(0);

    const camera = await onDashboard(page);
    await expect(camera).toContainText('No picture');
    await expect(camera).toContainText('Not while the blade is running');

    await demoDocked(page);
    await expect(camera.locator('img')).toBeVisible();
    await expect(camera).not.toContainText('No picture');
    const front = camera.getByRole('button', {name: 'Front camera'});
    await expect(front).toHaveAttribute('aria-pressed', 'true');
    await camera.getByRole('button', {name: 'Rear camera'}).click();
    await expect(camera.getByRole('button', {name: 'Rear camera'})).toHaveAttribute('aria-pressed', 'true');
    await expect(camera.locator('img')).toHaveCount(1);
    await expect.poll(() => picture(page)).toContain('Rear camera');

    // a tap on the picture puts the buttons on it away and brings them back
    await camera.getByRole('button', {name: 'Hide the buttons'}).click();
    await expect(front).toBeHidden();
    await camera.getByRole('button', {name: 'Show the buttons'}).click();
    await expect(front).toBeVisible();

    // over the whole screen and back, the picture stays the same one
    await camera.getByRole('button', {name: 'Full screen', exact: true}).click();
    await expect(camera.getByRole('button', {name: 'Leave full screen'})).toBeVisible();
    await expect(camera.getByRole('button', {name: 'Hide the camera picture'})).toHaveCount(0);
    await camera.getByRole('button', {name: 'Leave full screen'}).click();
    await expect(camera.getByRole('button', {name: 'Full screen', exact: true})).toBeVisible();
    await expect.poll(() => picture(page)).toContain('Rear camera');

    // turned down: the reason, and once more
    await page.evaluate(() => ((window as {mowbiteDemoCameraRefuse?: string}).mowbiteDemoCameraRefuse = 'CAMERA_BUSY'));
    await camera.getByRole('button', {name: 'Left side camera'}).click();
    await expect(camera).toContainText('Two are watching already, at most two at a time');
    await camera.getByRole('button', {name: 'Try again'}).click();
    await expect.poll(() => picture(page)).toContain('Obstacle camera left');

    // off on the picture itself, on again at the top of the dashboard
    await camera.getByRole('button', {name: 'Hide the camera picture'}).click();
    await expect(camera).toHaveCount(0);
    const onOff = page.getByRole('button', {name: 'Camera picture', exact: true});
    await expect(onOff).toHaveAttribute('aria-pressed', 'false');
    await onOff.click();
    await expect(camera.locator('img')).toBeVisible();
  });

  test("a stream its address doesn't let in: why, and the next try with a new one from the mower", async ({page}) => {
    await demoWith(page, 'Cameras');
    await page.goto('/');
    const camera = await onDashboard(page);
    await demoDocked(page);
    await expect.poll(() => picture(page)).toContain('Stereo camera');

    await page.evaluate(() => ((window as {mowbiteDemoCameraStatus?: number}).mowbiteDemoCameraStatus = 401));
    await camera.getByRole('button', {name: 'Rear camera'}).click();
    await expect(camera).toContainText("The mower didn't accept the connection.");
    await expect(camera).toContainText('HTTP 401');
    await expect(camera.locator('img')).toHaveCount(0);
    await camera.getByRole('button', {name: 'Try again'}).click();
    await expect.poll(() => picture(page)).toContain('Rear camera');
    await expect(camera).not.toContainText('No picture');
  });

  test('cameras that come up while the app is open show without a reload, and leave when their process ends', async ({page}) => {
    await page.goto('/settings/');
    await page.locator('#look summary').click();
    await expect(page.getByRole('checkbox', {name: 'Mow motor', exact: true})).toBeVisible();
    await expect(page.getByRole('checkbox', {name: 'Camera picture'})).toHaveCount(0);

    await demoCameras(page, true);
    await page.getByRole('checkbox', {name: 'Camera picture'}).check();
    await tab(page, '/').click();
    const camera = page.locator('[data-camera]');
    await demoDocked(page);
    await expect.poll(() => picture(page)).toContain('Stereo camera');

    await demoCameras(page, false);
    await expect(camera).toHaveCount(0);
    await demoCameras(page, true);
    await expect.poll(() => picture(page)).toContain('Stereo camera');
  });

  test('in recording mode the map or a camera', async ({page}) => {
    await demoWith(page, 'Cameras');
    await page.goto('/record/');
    await demoDocked(page);
    await page.getByRole('button', {name: 'Start recording mode'}).click();
    const view = page.getByRole('group', {name: 'View'}).first();
    await expect(view.getByRole('button', {name: 'Map'})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-camera]')).toHaveCount(0);

    await view.getByRole('button', {name: 'Rear camera'}).click();
    await expect.poll(() => picture(page)).toContain('Rear camera');
    // the stick stays on the picture
    await expect(page.locator('[data-camera]')).toBeVisible();

    // the blade by hand: no picture, and why
    await page.locator('button:visible', {hasText: 'Blade on'}).click();
    await expect(page.locator('[data-camera]')).toContainText('Not while the blade is running');
    await page.locator('button:visible', {hasText: 'Blade off'}).click();
    await expect(page.locator('[data-camera] img')).toBeVisible();

    await view.getByRole('button', {name: 'Map'}).click();
    await expect(page.locator('[data-camera]')).toHaveCount(0);
  });

  test('sideways the choice at the top', async ({page, isMobile}) => {
    test.skip(!isMobile, 'Sideways is on phones');
    await demoWith(page, 'Cameras');
    await page.goto('/record/');
    await demoDocked(page);
    await page.getByRole('button', {name: 'Start recording mode'}).click();
    await page.getByRole('button', {name: 'Sideways', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Upright'})).toBeVisible();
    const view = page.getByRole('group', {name: 'View'});
    await view.getByRole('button', {name: 'Front'}).click();
    await expect.poll(() => picture(page)).toContain('Stereo camera');
    await expect(page.getByRole('button', {name: 'Zoom in'})).toHaveCount(0);
    await view.getByRole('button', {name: 'Map'}).click();
    await expect(page.getByRole('button', {name: 'Zoom in'})).toBeVisible();
  });
});
