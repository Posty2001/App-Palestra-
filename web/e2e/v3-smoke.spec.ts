import { expect, test, type Page } from '@playwright/test';

/** Fase 0–1: l'app parte senza server, crea il profilo locale e registra una seduta che sopravvive alla ricarica. */

async function onboard(page: Page, name: string, role: 'Mi alleno' | 'Sono un coach' = 'Mi alleno'): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/benvenuto$/);
  await page.getByTestId('welcome-name').fill(name);
  await page.getByRole('button', { name: role }).click();
  await page.getByTestId('welcome-start').click();
}

test('primo avvio, seduta, serie salvata e ricarica senza server', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api')) apiCalls.push(r.url());
  });
  await onboard(page, 'Franco');
  await expect(page.locator('h1')).toHaveText('Oggi');
  await expect(page.getByTestId('sync-status')).toHaveText('Sul dispositivo');
  await page.getByRole('button', { name: /Inizia allenamento/ }).click();
  await expect(page).toHaveURL(/\/seduta$/);
  const active = page.locator('.ex-active');
  await active.getByLabel(/ kg$/).first().fill('60');
  await active.getByLabel(/ ripetizioni$/).first().fill('8');
  await page.getByTestId('complete-set').click();
  await expect(page.getByTestId('rest-bar')).toBeVisible();
  await page.reload();
  await expect(page.locator('.ex-active')).toContainText('60');
  await expect(page.getByTestId('rest-bar')).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test('la scheda base contiene il Pendulum Squat al Giorno 3', async ({ page }) => {
  await onboard(page, 'Franco');
  await page.getByRole('link', { name: 'Scheda' }).click();
  await expect(page.getByText('Scheda 5 giorni').first()).toBeVisible();
  await page.getByRole('button', { name: /Giorno 3/ }).first().click();
  await expect(page.getByText('Pendulum Squat')).toBeVisible();
  await expect(page.getByText(/RDL manubri/i)).toHaveCount(0);
});

test('coach: profilo coach e cambio modalità', async ({ page }) => {
  await onboard(page, 'Coach', 'Sono un coach');
  await expect(page.getByTestId('mode-switch')).toBeVisible();
  await page.getByTestId('mode-switch').getByRole('link', { name: 'Coach' }).click();
  await expect(page.locator('h1')).toHaveText('Dashboard');
});
