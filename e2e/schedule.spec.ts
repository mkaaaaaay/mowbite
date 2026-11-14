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

test('a time for starts by hand: off at first, switched on with 19:00 and changed', async ({page}) => {
  test.skip(SIM, 'the demo mower only');
  await page.goto('/schedule/');
  const card = page.locator('section').filter({has: page.getByRole('heading', {name: 'Starts by hand'})});
  const on = card.getByRole('checkbox');
  const time = card.getByLabel('Home at', {exact: true}).and(page.locator('input[type=time]'));
  await expect(on).not.toBeChecked();
  await expect(time).toBeDisabled();
  await expect(card.getByText(/it mows until done. Started during/)).toBeVisible();
  await on.check();
  await expect(time).toBeEnabled();
  await expect(time).toHaveValue('19:00');
  await time.fill('18:30');
  await expect(time).toHaveValue('18:30');
  await expect(card.getByText(/it goes home at that time/)).toBeVisible();
  // switched off, the schedule leaves it in place
  await page.getByRole('checkbox', {name: 'Mow by schedule'}).uncheck();
  await expect(time).toHaveValue('18:30');
});

test('a run says who started it, as far as the log knows', async ({page}) => {
  test.skip(SIM, 'the demo mower only');
  await page.goto('/activity/');
  await expect(page.getByText('Started by hand')).toBeVisible();
});
