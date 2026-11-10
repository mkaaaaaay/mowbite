import type {Page} from '@playwright/test';
import {expect, SIM, test} from './app';

// the card with the start times (the pause has an until of its own)
const plans = (page: Page) => page.locator('section').filter({has: page.getByRole('heading', {name: 'Start times'})});

// the demo's start time (monday, wednesday and friday at 10:00) moved to 01:00, dark at the garden all year: the
// question about the dark comes and stays while a weekday and the end time are changed
async function ask(page: Page) {
  test.skip(SIM, 'the demo mower only');
  await page.goto('/schedule/');
  const start = plans(page).getByLabel('Start', {exact: true});
  const cancel = page.getByRole('button', {name: 'Cancel'});
  await expect(start).toHaveValue('10:00');
  await start.fill('01:00');
  await expect(cancel).toBeVisible();
  await plans(page).getByRole('button', {name: 'Tue'}).click();
  await expect(cancel).toBeVisible();
  await expect(start).toHaveValue('01:00');
  await plans(page).getByLabel('until', {exact: true}).fill('05:00');
  await expect(cancel).toBeVisible();
  await expect(start).toHaveValue('01:00');
  return start;
}

test('the question about the dark stays through other changes, mow anyway saves both times', async ({page}) => {
  const start = await ask(page);
  await page.getByRole('button', {name: 'Mow anyway'}).click();
  await expect(page.getByText('Also mows in the dusk and dark.')).toBeVisible();
  await expect(start).toHaveValue('01:00');
  await expect(plans(page).getByLabel('until', {exact: true})).toHaveValue('05:00');
});

test('the question about the dark cancelled takes both times back, the weekday stays', async ({page}) => {
  const start = await ask(page);
  await page.getByRole('button', {name: 'Cancel'}).click();
  await expect(start).toHaveValue('10:00');
  await expect(plans(page).getByLabel('until', {exact: true})).toHaveValue('');
  await expect(page.getByRole('button', {name: 'Mow anyway'})).toBeHidden();
  await expect(plans(page).getByRole('button', {name: 'Tue'})).toHaveClass(/on/);
});
