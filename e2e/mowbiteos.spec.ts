import {OM_WORDS} from '@/lib/platformWords';
import {demoFlag, demoHas, demoWith, expect, SIM, test} from './app';
import {infoTips, pageText, PAGES} from './texts';

// the demo mower as MowBite OS (system.info, window.mowbiteDemoOs) with the parts of it the demo has: nothing of
// OpenMower shows anywhere, not on the pages with everything folded opened and not in what the info buttons say
const OS_PARTS = ['Os', 'Geometry', 'Updates', 'Lights', 'Sounds', 'Cameras', 'Undo', 'Incidents', 'Planner', 'Ntrip', 'Host', 'Erase', 'DockTest'] as const;
// the design named after it is offered on any mower
const DESIGN = /(?<=Sunny\n)OpenMower/g;
const found = (text: string) => [...new Set(text.replace(DESIGN, '').match(new RegExp(OM_WORDS, 'g')))];

test.describe('on MowBite OS', () => {
  test.skip(SIM, 'the demo mower only');
  test.beforeEach(({page}) => demoWith(page, ...OS_PARTS));

  test('no page says anything of OpenMower', async ({page}) => {
    test.setTimeout(300_000);
    const said: Record<string, string[]> = {};
    for (const path of PAGES) {
      const words = found(await pageText(page, path, () => infoTips(page)));
      if (words.length) said[path] = words;
    }
    expect(said).toEqual({});
  });

  test("a setting of how it works set by MowBite OS's own name (api 70)", async ({page}) => {
    await demoFlag(page, 'mowbiteDemoOsApi', 70);
    await page.goto('/settings/#auto');
    const field = page.getByRole('textbox', {name: 'Wait after the rain'});
    await field.fill('45');
    await field.blur();
    await expect.poll(async () => (await demoHas<Record<string, unknown>>(page, 'params/json'))['/mower_logic/rain_delay_minutes']).toBe(45);
    await expect(field).toHaveValue('45');
  });
});
