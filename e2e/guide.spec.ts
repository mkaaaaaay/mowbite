import {expect, test} from './app';

// the editor guide from the first step to the last, the simulation among them
test('the editor guide goes through all its steps', async ({page}) => {
  await page.goto('/guide/editor/');
  const titles: string[] = [];
  for (let i = 0; i < 30; i++) {
    const title = (await page.getByRole('heading', {level: 1}).textContent())?.trim() ?? '';
    titles.push(title);
    // the last one leads to the map
    if (await page.getByRole('button', {name: 'To the map'}).isVisible()) break;
    await page.getByRole('button', {name: 'Next'}).last().click();
  }
  expect(titles).toContain('Simulate the drive');
  expect(titles).toContain('Decorate');
  expect(new Set(titles).size).toBe(titles.length);
});
