import {readdirSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {SIM} from './app';

// every page of the build (the not-found ones aside, none without a build: against a simulator)
export const PAGES = (SIM ? [] : readdirSync('out', {recursive: true, encoding: 'utf8'}))
  .filter((f) => f.endsWith('index.html') && !/^(_not-found|404)\//.test(f))
  .map((f) => '/' + f.slice(0, -'index.html'.length))
  .sort();

// all a page says with everything folded opened, in every tab. each: something more to read in each of these states
export async function pageText(page: Page, path: string, each: () => Promise<string> = async () => ''): Promise<string> {
  await page.goto(path);
  // what comes from the mower first (state, settings, the day's events)
  await page.waitForTimeout(1500);
  // folded groups open, a few rounds for the ones inside others
  const unfolded = async () => {
    for (let round = 0; round < 3; round++) await page.$$eval('details', (all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await page.waitForTimeout(300);
    return (await page.locator('body').innerText()) + (await each());
  };
  let text = await unfolded();
  for (const t of await page.getByRole('tab').all()) {
    await t.click();
    text += await unfolded();
  }
  return text;
}

// what the info buttons on the page say, each opened and closed again
export const infoTips = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const painted = () => new Promise((done) => requestAnimationFrame(() => done(null)));
    let said = '';
    for (const b of document.querySelectorAll<HTMLButtonElement>('button[aria-label="More info"]')) {
      b.click();
      await painted();
      said += `\n${document.querySelector('[role="tooltip"]')?.textContent ?? ''}`;
      b.click();
      await painted();
    }
    return said;
  });
