import {expect, SIM, tab, test} from './app';

// what the dashboard's status card shows is set in the settings, one switched off is gone from it. the demo keeps its
// settings until it's left, so the pages change through the tabs
test.describe('dashboard', () => {
  test.skip(SIM, 'the demo mower only');

  test('a value switched off in the settings is gone from the status card', async ({page}) => {
    await page.goto('/');
    const status = page.locator('main section').first();
    await expect(status).toContainText('Mow motor');

    await tab(page, '/settings').click();
    await page.getByRole('tab', {name: 'App'}).click();
    await page.locator('#look summary').click();
    const item = page.getByRole('checkbox', {name: 'Mow motor', exact: true});
    await expect(item).toBeChecked();
    await item.uncheck();

    await tab(page, '/').click();
    await expect(status).toContainText('Left ESC');
    await expect(status).not.toContainText('Mow motor');
  });
});
