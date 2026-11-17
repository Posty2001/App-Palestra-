import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';

/**
 * Prove end-to-end su viewport iPhone (Chromium con emulazione iPhone 13).
 * Utenti sintetici creati dal server e2e: coach, atleta A, atleta B (dominio .test, nome [DEMO]).
 * Flussi 1–6: regressione delle funzioni esistenti sulla nuova interfaccia. Flussi 7–10: test mirati del restyling.
 */

const PW = process.env.DEMO_PASSWORD ?? '';
const COACH = 'coach@demo.app-palestra.test';
const A = 'atleta.a@demo.app-palestra.test';
const B = 'atleta.b@demo.app-palestra.test';
const SHOTS = process.env.E2E_SHOTS_DIR ?? null;
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => db.end());

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(350); // fine delle animazioni
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function device(browser: Browser, email: string, opts: { clock?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...test.info().project.use });
  const page = await ctx.newPage();
  if (opts.clock) await page.clock.install();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.locator('h1')).toHaveText(email === COACH ? 'Dashboard' : 'Oggi');
  return { ctx, page };
}

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
const idOf = async (email: string) => (await q<{ id: string }>('select id from users where email = $1', [email]))[0]!.id;

async function chooseDay(page: Page, label: string): Promise<void> {
  if (await page.getByTestId('change-day').isVisible()) await page.getByTestId('change-day').click();
  await page.getByTestId('day-select').selectOption({ label });
}

/** Apre l'esercizio nella lista della seduta (se non è già quello attivo). */
async function openExercise(page: Page, key: string): Promise<Locator> {
  const el = page.getByTestId(`exercise-${key}`);
  await expect(page.locator('.ex-active')).toHaveCount(1);
  if (!(await el.evaluate((e) => e.classList.contains('ex-active')))) await el.getByRole('button').first().click();
  await expect(el).toHaveClass(/ex-active/);
  return el;
}

const field = (scope: Page | Locator, label: string) => scope.getByLabel(label, { exact: true });

/** Nessuno scorrimento orizzontale: il contenuto deve stare nella larghezza dell'iPhone. */
async function expectNoHScroll(page: Page, where: string): Promise<void> {
  const r = await page.evaluate(() => {
    const w = window.screen.width; // larghezza reale dell'iPhone: se il contenuto è più largo, il browser allarga il viewport
    const out = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1)
      .slice(0, 5).map((e) => `${e.tagName}.${(e as HTMLElement).className}:${Math.round(e.getBoundingClientRect().right)}`);
    return { sw: Math.max(document.documentElement.scrollWidth, window.innerWidth), w, out };
  });
  expect(r.sw, `scroll orizzontale in ${where}: ${r.out.join(' | ')}`).toBeLessThanOrEqual(r.w);
}

test('1 · coach: assegna la propria scheda (con Pendulum) all\'atleta A e cambia modalità', async ({ browser }) => {
  const { ctx, page } = await device(browser, COACH);
  await shot(page, '01-coach-dashboard');
  await page.getByTestId('tabbar').getByRole('link', { name: 'Atleti' }).click();
  await shot(page, '02-coach-atleti');
  await page.getByTestId('athlete-row').filter({ hasText: 'Atleta A' }).click();
  await expect(page.getByTestId('athlete-banner')).toContainText('[DEMO] Atleta A');
  await page.getByTestId('assign-open').click();
  await page.getByTestId('assign-sheet').getByText('Scheda 5 giorni').click();
  await page.getByTestId('assign-name').fill('Massa · 5 giorni');
  await shot(page, '03-coach-assegna');
  await page.getByTestId('assign-confirm').click();
  await expect(page.getByTestId('edit-athlete-program')).toBeVisible(); // la scheda compare subito nel tab Scheda
  await expect(page.getByText('Massa · 5 giorni').first()).toBeVisible();
  await shot(page, '04-coach-profilo-atleta');
  // Cambio modalità: stesso account, schede personali del coach
  await page.getByTestId('tabbar').getByRole('link', { name: 'Dashboard' }).click();
  await page.getByTestId('mode-switch').getByRole('link', { name: 'Il mio allenamento' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('h1')).toHaveText('Oggi');
  await expect(page.getByTestId('tabbar').getByRole('link')).toHaveText(['Oggi', 'Scheda', 'Progressi', 'Check']);
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await shot(page, '05-coach-mio-allenamento');
  await page.getByTestId('tabbar').getByRole('link', { name: 'Scheda' }).click();
  await expect(page.getByTestId('program-card')).toHaveCount(1);
  await page.getByTestId('mode-switch').getByRole('link', { name: 'Coach' }).click();
  await expect(page.locator('h1')).toHaveText('Dashboard');
  await ctx.close();
});

test('2 · atleta A: Oggi → Pendulum → Completa serie → Recupero → Lascia in sospeso → Riprendi → Termina → Salva', async ({ browser }) => {
  const { ctx, page } = await device(browser, A);
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await chooseDay(page, 'Giorno 3');
  await shot(page, '06-oggi');
  await page.getByRole('button', { name: 'Inizia allenamento' }).click();
  await expect(page).toHaveURL(/\/seduta$/);

  const pend = await openExercise(page, 'pendulum squat');
  await expect(pend.getByTestId('last-time')).toContainText('nessuno storico');
  await field(pend, 'Serie 1 kg').fill('60');
  await field(pend, 'Serie 1 ripetizioni').fill('7');
  await pend.getByRole('button', { name: 'RIR 2' }).click();
  await page.getByTestId('complete-set').dblclick(); // doppio tocco: una sola serie
  await expect(pend.getByTestId('set-done-work-0')).toContainText('60 × 7 · RIR 2');

  // Recupero: barra fissa sopra "Completa serie", durata predefinita 5:00 (4’-5’), modificabile
  const bar = page.getByTestId('rest-bar');
  await expect(bar).toContainText('Recupero · Pendulum Squat');
  await expect(page.getByTestId('rest-clock')).toHaveText(/^[45]:\d\d$/);
  await page.getByTestId('rest-open').click();
  await page.getByTestId('rest-sheet').getByRole('button', { name: '4:00' }).click();
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText(/^3:5\d$|^4:00$/);
  await shot(page, '08-timer-recupero');
  await page.getByTestId('rest-sheet').getByRole('button', { name: 'Chiudi' }).click();
  await page.mouse.wheel(0, 2000);
  await expect(bar).toBeInViewport();
  await expect(page.getByTestId('complete-set')).toBeInViewport();
  await expectNoHScroll(page, 'seduta');
  await shot(page, '07-seduta-esercizio-attivo');

  // Riapertura dell'app: seduta e timer ripristinati sul tempo reale
  await page.reload();
  await expect(page.getByTestId('rest-clock')).toHaveText(/^3:[45]\d$/);

  await page.getByTestId('suspend').click();
  await expect(page.getByRole('button', { name: 'Riprendi allenamento' })).toBeVisible();
  await expect(page.getByText('1 serie registrate')).toBeVisible();
  await page.getByRole('button', { name: 'Riprendi allenamento' }).click();

  await page.getByTestId('skip-rest').click();
  await expect(page.getByTestId('rest-bar')).toHaveCount(0);
  const pend2 = await openExercise(page, 'pendulum squat');
  await field(pend2, 'Serie 2 kg').fill('65');
  await field(pend2, 'Serie 2 ripetizioni').fill('5');
  await page.getByTestId('complete-set').click();
  await expect(pend2.getByTestId('set-done-work-1')).toContainText('65 × 5');
  await expect(page.getByTestId('complete-set')).toHaveText('Prossimo esercizio');
  // + Riscaldamento: resta nello storico ma fuori dal conteggio
  await pend2.getByTestId('add-warmup').click();
  await field(pend2, 'Riscald. 1 kg').fill('40');
  await field(pend2, 'Riscald. 1 ripetizioni').fill('10');
  await page.getByTestId('complete-set').click();
  await expect(pend2.getByTestId('set-done-warmup-0')).toContainText('40 × 10');

  await page.getByTestId('finish-open').click();
  const summary = page.getByTestId('finish-summary');
  await expect(page.getByTestId('finish-sets')).toHaveText('2');
  await expect(summary).toContainText('+ 1 di riscaldamento');
  await expect(summary).toContainText(/serie mancant/);
  await shot(page, '09-termina');
  await summary.getByLabel('Nota per il coach (facoltativa)').fill('Pendulum ok, ginocchio sinistro un po\' rigido');
  await page.getByTestId('save-workout').click();
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 4');
  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato');

  const aId = await idOf(A);
  const ws = await q<{ status: string; n: number; w: number }>(
    `select w.status, count(s.*)::int n, count(s.*) filter (where s.kind = 'work')::int w from workouts w left join workout_sets s on s.workout_id = w.id where w.athlete_id = $1 group by w.id`, [aId]);
  expect(ws).toEqual([{ status: 'completed', n: 3, w: 2 }]);
  await ctx.close();
});

test('3 · offline: serie registrate senza rete, riconnessione, nuovo accesso → dati una sola volta', async ({ browser }) => {
  const { ctx, page } = await device(browser, A);
  await page.getByRole('button', { name: 'Inizia allenamento' }).click(); // Giorno 4
  const tbar = await openExercise(page, 't bar prono + kelso shrugs alla fine');
  await expect(tbar).toContainText('Top set 1');
  await expect(tbar).toContainText('obiettivo 7-5');

  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato'); // avvio seduta già sul server
  await ctx.setOffline(true);
  await ctx.route('**/api/**', (r) => r.abort('internetdisconnected')); // taglio deterministico anche per richieste già avviate
  await field(tbar, 'Top set 1 kg').fill('70');
  await field(tbar, 'Top set 1 ripetizioni').fill('7');
  await page.getByTestId('complete-set').click();
  await expect(tbar.getByTestId('set-done-work-0')).toBeVisible();
  await field(tbar, 'Top set 2 kg').fill('70');
  await field(tbar, 'Top set 2 ripetizioni').fill('6');
  await page.getByTestId('complete-set').click();
  await expect(tbar.getByTestId('set-done-work-1')).toBeVisible();
  await expect(tbar).toContainText('Back-off −20%'); // la terza serie è il back-off
  await expect(page.getByTestId('sync-status')).toContainText('da inviare');
  await shot(page, '10-offline');
  // Chiusura e riapertura dell'app senza rete: la shell arriva dal service worker, la seduta da IndexedDB
  await page.reload();
  const tbarAfter = page.getByTestId('exercise-t bar prono + kelso shrugs alla fine');
  await expect(tbarAfter.getByTestId('set-done-work-0')).toContainText('70 × 7');
  await expect(tbarAfter.getByTestId('set-done-work-1')).toContainText('70 × 6');

  const aId = await idOf(A);
  const before = await q<{ n: number }>(`select count(s.*)::int n from workouts w left join workout_sets s on s.workout_id = w.id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId]);
  expect(before[0]!.n).toBe(0); // le serie offline non sono ancora sul server

  await ctx.unroute('**/api/**');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato', { timeout: 20_000 });
  const rows = await q<{ n: number }>(`select count(*)::int n from workout_sets s join workouts w on w.id = s.workout_id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId]);
  expect(rows[0]!.n).toBe(2);

  // Nuovo accesso con la stessa utenza da un secondo dispositivo
  const second = await device(browser, A);
  await second.page.getByRole('button', { name: 'Riprendi allenamento' }).click();
  const tbar2 = await openExercise(second.page, 't bar prono + kelso shrugs alla fine');
  await expect(tbar2.getByTestId('set-done-work-0')).toBeVisible();
  await expect(tbar2.getByTestId('set-done-work-1')).toBeVisible();
  await second.page.getByTestId('finish-open').click();
  await expect(second.page.getByTestId('finish-sets')).toHaveText('2');
  await second.page.getByTestId('save-workout').click();
  await expect(second.page.getByTestId('next-day')).toHaveText('Giorno 5');

  // Il primo dispositivo si riallinea: niente seduta fantasma
  await page.goto('/');
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 5');
  const totals = await q<{ workouts: number; sets: number }>(
    `select count(distinct w.id)::int workouts, count(s.*)::int sets from workouts w left join workout_sets s on s.workout_id = w.id where w.athlete_id = $1 and w.status = 'completed'`, [aId]);
  expect(totals[0]).toEqual({ workouts: 2, sets: 5 });
  await second.ctx.close();
  await ctx.close();
});

test('4 · pubblicare una modifica durante una seduta non altera quella seduta', async ({ browser }) => {
  const athlete = await device(browser, A);
  await chooseDay(athlete.page, 'Giorno 3');
  await athlete.page.getByRole('button', { name: 'Inizia allenamento' }).click();
  await expect(athlete.page.getByTestId('exercise-pendulum squat')).toContainText('2 × 7/5');

  const coach = await device(browser, COACH);
  const c = coach.page;
  await expectNoHScroll(c, 'dashboard con elementi da gestire');
  await c.getByTestId('tabbar').getByRole('link', { name: 'Atleti' }).click();
  await c.getByTestId('athlete-row').filter({ hasText: 'Atleta A' }).click();
  await c.getByTestId('tab-scheda').click();
  await c.getByTestId('edit-athlete-program').first().click();
  await c.getByTestId('editor-daytab-2').click();
  const card = c.getByTestId('editor-ex-2-2');
  await card.locator('.ed-head').click();
  await expect(field(card, 'Esercizio 3')).toHaveValue('Pendulum Squat');
  await field(card, 'Ripetizioni').fill('8/6');
  await expect(card.getByTestId('change-label')).toHaveText('Modificato'); // modifica non ancora pubblicata
  await shot(c, '11-editor-modificato');
  await c.getByTestId('open-publish').click();
  await expect(c.getByRole('dialog')).toContainText('Giorno 3, Pendulum Squat: ripetizioni 7/5 → 8/6');
  await shot(c, '12-pubblica-modifica');
  await c.getByTestId('confirm-publish').click();
  await expect(c).toHaveURL(/\/atleti\/.+\/scheda$/);

  // La seduta in corso resta sulla versione 1
  const p = athlete.page;
  await p.reload();
  await expect(p.getByTestId('exercise-pendulum squat')).toContainText('2 × 7/5');
  const pend = await openExercise(p, 'pendulum squat');
  await expect(pend).toContainText('7/5');
  // Ultima volta + precompilazione dalla serie corrispondente della seduta precedente
  await expect(pend.getByTestId('last-time')).toContainText('60×7 · 65×5');
  await expect(field(pend, 'Serie 1 kg')).toHaveValue('60');
  await expect(field(pend, 'Serie 1 ripetizioni')).toHaveValue('7');
  await p.getByTestId('finish-open').click();
  await p.getByRole('button', { name: 'Scarta seduta' }).click();
  await p.getByRole('button', { name: 'Sì, scarta' }).click();
  await expect(p.getByTestId('next-day')).toHaveText('Giorno 5'); // scarto: rotazione invariata
  await expect(p.getByTestId('program-update')).toContainText('Pendulum Squat: ripetizioni 7/5 → 8/6');
  const v = await q<{ version_no: number; n: number }>(`select version_no, (select count(*)::int from workout_sets where workout_id = w.id) n from workouts w where status = 'discarded'`);
  expect(v).toEqual([{ version_no: 1, n: 0 }]);
  await coach.ctx.close();
  await athlete.ctx.close();
});

test('5 · Atleta → check e Chiedi al coach → Coach → Da rivedere → Feedback → Atleta; foto, revoca, eliminazione', async ({ browser }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'palestra-photos-'));
  const files: Record<string, string> = {};
  for (const [pose, color] of [['front', '#7a3a48'], ['side', '#3a5a7a'], ['back', '#4a7a3a']] as const) {
    const f = path.join(dir, `${pose}.jpg`);
    writeFileSync(f, await sharp({ create: { width: 600, height: 900, channels: 3, background: color } }).jpeg().toBuffer());
    files[pose] = f;
  }
  const athlete = await device(browser, A);
  const p = athlete.page;
  await p.goto('/check/nuovo');
  await p.getByLabel('Data (puoi retrodatare)').fill('2026-10-01');
  await p.getByLabel('Peso kg').fill('77,4');
  await p.getByLabel('Addome cm').fill('88');
  await p.getByTestId('photo-front').setInputFiles(files.front!);
  await p.getByTestId('save-check').click();
  await expect(p.locator('h1')).toContainText('Check');
  await p.goto('/check/nuovo');
  await p.getByLabel('Peso kg').fill('75,2');
  await p.getByLabel('Addome cm').fill('85');
  await p.getByLabel('Nota').fill('Settimana 6');
  for (const pose of ['front', 'side', 'back']) await p.getByTestId(`photo-${pose}`).setInputFiles(files[pose]!);
  await expect(p.getByTestId('share-preview')).toContainText('non incluse (restano private)');
  await p.getByTestId('share-photos').check();
  await expect(p.getByTestId('share-preview')).toContainText('incluse (3)');
  await p.getByTestId('share-photos').uncheck();
  await shot(p, '13-nuovo-check');
  await p.getByTestId('save-check').click();
  await expect(p.getByTestId('share-toggle')).not.toBeChecked();
  await expect(p.locator('img.photo')).toHaveCount(3);

  await p.goto('/check');
  const cmp = p.getByTestId('compare');
  await expect(cmp.locator('img.photo')).toHaveCount(2);
  await expect(cmp).toContainText('-2,2 kg');
  await expect(cmp).toContainText('-3 cm');
  await shot(p, '14-check-confronto');

  // Chiedi al coach dal menu ⋯ dell'esercizio
  await p.goto('/');
  await p.getByRole('button', { name: 'Inizia allenamento' }).click();
  await p.getByTestId('exercise-menu').click();
  await shot(p, '15-menu-esercizio');
  await p.getByTestId('actions-sheet').getByRole('button', { name: /Chiedi al coach/ }).click();
  const chat = p.getByTestId('chat-sheet');
  await chat.getByLabel(/Domanda breve/).fill('Posso usare le cinghie?');
  await chat.getByRole('button', { name: 'Invia' }).click();
  await expect(chat).toContainText('In attesa di risposta');
  await expect(p.getByTestId('sync-status').first()).toHaveText('Sincronizzato');
  await chat.getByRole('button', { name: 'Chiudi' }).click();

  // Coach: Dashboard → Da gestire
  const coach = await device(browser, COACH);
  const c = coach.page;
  const items = c.getByTestId('review-item');
  await expect(items.filter({ hasText: 'Domanda · Adductor machine' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Check del' })).toHaveCount(2);
  await expect(items.filter({ hasText: 'Peso 75,2 kg' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Nota allenamento' })).toHaveCount(1);
  await expect(c.getByTestId('kpi-checks')).toContainText('2');
  await expect(c.getByTestId('kpi-questions')).toContainText('1');
  await shot(c, '16-coach-da-gestire');
  await items.filter({ hasText: 'Domanda · Adductor machine' }).click();
  await expect(c.getByTestId('coach-thread')).toContainText('Posso usare le cinghie?');
  await expect(c.getByTestId('athlete-banner')).toContainText('[DEMO] Atleta A');
  await c.getByTestId('answer-text').fill('Sì, solo sull\'ultima serie.');
  await shot(c, '17-coach-risposta');
  await c.getByRole('button', { name: 'Invia risposta' }).click();
  await expect(c.getByTestId('coach-thread')).toContainText('Sì, solo sull\'ultima serie.');
  await c.goto('/coach');
  await expect(items.filter({ hasText: 'Domanda' })).toHaveCount(0);

  // Check di oggi: foto private → il coach non le vede
  const ddmm = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' }).format(new Date()); // stesso fuso del browser
  await items.filter({ hasText: `Check del ${ddmm}` }).click();
  const review = c.getByTestId('coach-check');
  await expect(review).toContainText('non ha condiviso le foto');
  expect(await review.locator('img.photo').count()).toBe(0);
  await c.getByTestId('check-feedback-text').fill('Ottimo lavoro sul girovita.');
  await c.getByRole('button', { name: 'Invia feedback' }).click();
  await expect(review).toContainText('Ottimo lavoro sul girovita.');
  const reviewUrl = c.url();
  // Indicazione su un esercizio dal profilo
  await c.getByTestId('athlete-banner').getByRole('link').first().click();
  await c.getByTestId('feedback-open').click();
  await c.getByTestId('feedback-exercise').selectOption('Adductor machine');
  await c.getByTestId('feedback-text').fill('Controlla la fase eccentrica: 3 secondi.');
  await c.getByRole('button', { name: 'Invia indicazione' }).click();
  await expect(c.getByRole('status').filter({ hasText: 'Inviato' })).toBeVisible();

  // Atleta: feedback nel check; condivide le foto
  await p.goto('/check');
  await p.getByTestId('check-item').first().click();
  await expect(p.getByTestId('check-feedback')).toContainText('Ottimo lavoro sul girovita.');
  await Promise.all([p.waitForResponse((r) => r.url().includes('/sharing') && r.ok()), p.getByTestId('share-toggle').check()]);
  await expect(p.getByTestId('share-toggle')).toBeChecked();
  const checkUrl = p.url();
  await c.goto(reviewUrl);
  await expect(c.getByTestId('coach-check-photos').locator('img.photo')).toHaveCount(3);
  const photoSrc = await c.getByTestId('coach-check-photos').locator('img.photo').first().getAttribute('src');
  expect((await c.request.get(photoSrc!)).status()).toBe(200);
  await shot(c, '18-coach-revisione-check');

  // Revoca: accesso negato immediatamente anche a URL già noto; atleta B mai
  await Promise.all([p.waitForResponse((r) => r.url().includes('/sharing') && r.ok()), p.getByTestId('share-toggle').uncheck()]);
  await expect(p.getByTestId('share-toggle')).not.toBeChecked();
  expect((await c.request.get(photoSrc!)).status()).toBe(404);
  const b = await device(browser, B);
  expect((await b.page.request.get(photoSrc!)).status()).toBe(404);

  // Secondo dispositivo dell'atleta: check, feedback e risposta nell'esercizio
  const tablet = await device(browser, A);
  await tablet.page.goto(checkUrl);
  await expect(tablet.page.getByTestId('check-feedback')).toContainText('Ottimo lavoro');
  await expect(tablet.page.locator('img.photo')).toHaveCount(3);
  await tablet.page.goto('/');
  await tablet.page.getByRole('button', { name: 'Riprendi allenamento' }).click();
  const ex2 = await openExercise(tablet.page, 'adductor machine');
  await expect(ex2.getByTestId('exercise-feedback')).toContainText('fase eccentrica');
  await expect(ex2.getByTestId('last-time')).toContainText('Sì, solo sull\'ultima serie.');
  await ex2.getByTestId('last-time').click();
  await expect(tablet.page.getByTestId('chat-sheet')).toContainText('Posso usare le cinghie?');
  await shot(tablet.page, '19-domande-feedback');
  await tablet.page.getByTestId('chat-sheet').getByRole('button', { name: 'Chiudi' }).click();

  // Eliminazione foto dal primo dispositivo
  await p.getByTestId('delete-photo-front').click();
  await expect(p.locator('img.photo')).toHaveCount(2);
  const left = await q<{ n: number }>('select count(*)::int n from check_photos p join users u on u.id = p.athlete_id where u.email = $1', [A]);
  expect(left[0]!.n).toBe(3);

  await tablet.page.getByTestId('finish-open').click();
  await tablet.page.getByRole('button', { name: 'Scarta seduta' }).click();
  await tablet.page.getByRole('button', { name: 'Sì, scarta' }).click();

  const users = await q<{ email: string; display_name: string; is_demo: boolean }>('select email, display_name, is_demo from users');
  for (const u of users) {
    expect(u.is_demo).toBe(true);
    expect(u.email.endsWith('@demo.app-palestra.test')).toBe(true);
    expect(u.display_name.startsWith('[DEMO]')).toBe(true);
  }
  for (const d of [athlete, coach, b, tablet]) await d.ctx.close();
});

test('6 · importazione del PDF incluso, revisione, RDL → Pendulum, giorni, due programmi', async ({ browser }) => {
  const { ctx, page } = await device(browser, B);
  await page.goto('/scheda/importa');
  await page.getByTestId('pdf-input').setInputFiles(path.resolve(import.meta.dirname, '../../fixtures/scheda_allenamento_5_giorni.pdf'));
  await expect(page.getByTestId('import-message')).toContainText('Trovati 5 giorni e 34 esercizi');
  await expect(page.getByTestId('editor-daytab-0')).toContainText('!'); // recupero «—» da verificare
  await expect(page.getByTestId('editor-daytab-1')).toContainText('!'); // back-off senza %
  await page.getByTestId('editor-ex-0-6').locator('.ed-head').click();
  await expect(page.getByTestId('editor-ex-0-6').locator('.doubt')).toContainText('Recupero non indicato');
  await page.getByTestId('editor-daytab-2').click();
  const rdl = page.getByTestId('editor-ex-2-2');
  await rdl.locator('.ed-head').click();
  await expect(field(rdl, 'Esercizio 3')).toHaveValue('RDL manubri');
  await field(rdl, 'Esercizio 3').fill('Pendulum Squat');
  await page.getByTestId('editor-daytab-4').click();
  await page.getByTestId('day-menu').click();
  await page.getByTestId('remove-day').click();
  await page.getByTestId('day-menu').click();
  await page.getByTestId('add-day').click();
  await shot(page, '20-import-revisione');
  await page.getByTestId('save-program').click();
  await expect(page.getByRole('alert')).toContainText('un esercizio non ha nome');
  await field(page.getByTestId('editor-ex-4-0'), 'Esercizio 1').fill('Crunch');
  await page.getByTestId('save-program').click();
  await expect(page.getByRole('alert')).toContainText('Conferma di aver controllato');
  await page.getByTestId('confirm-review').check();
  await page.getByTestId('save-program').click();
  await expect(page).toHaveURL(/\/scheda$/);
  await expect(page.getByTestId('program-card')).toHaveCount(1);
  await shot(page, '21-scheda');
  const rows = await q<{ content: { days: { name: string; exercises: { name: string }[] }[] } }>(
    `select v.content from programs p join program_versions v on v.id = p.current_version_id join users u on u.id = p.owner_id where u.email = $1`, [B]);
  const days = rows[0]!.content.days;
  expect(days.map((d) => d.name)).toEqual(['Giorno 1', 'Giorno 2', 'Giorno 3', 'Giorno 4', 'Giorno 5']);
  expect(days[4]!.exercises.map((e) => e.name)).toEqual(['Crunch']);
  expect(days[2]!.exercises[2]!.name).toBe('Pendulum Squat');

  await page.goto('/scheda/nuova');
  await page.getByTestId('program-name').fill('Full body 2 giorni');
  await field(page.getByTestId('editor-ex-0-0'), 'Esercizio 1').fill('Squat');
  await page.getByTestId('day-menu').click();
  await page.getByTestId('add-day').click();
  await field(page.getByTestId('editor-ex-1-0'), 'Esercizio 1').fill('Stacco');
  await page.getByTestId('save-program').click();
  await expect(page.getByTestId('program-card')).toHaveCount(2);
  await page.goto('/');
  await page.getByTestId('program-select').selectOption({ label: 'Full body 2 giorni' });
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await page.getByRole('button', { name: 'Inizia allenamento' }).click();
  await page.getByTestId('finish-open').click();
  await page.getByTestId('save-workout').click();
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 2');
  await page.getByTestId('program-select').selectOption({ index: 0 });
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await ctx.close();
});

// ------------------------------------------------------------------ test mirati del restyling

test('7 · navigazione: barre per ruolo e modalità, contesto atleta, modalità ricordata', async ({ browser }) => {
  const coach = await device(browser, COACH);
  const c = coach.page;
  const tabs = c.getByTestId('tabbar').getByRole('link');
  await expect(tabs).toHaveText(['Dashboard', 'Atleti', 'Schede', 'Progressi', 'Check']);
  for (const [name, title] of [['Atleti', 'Atleti'], ['Schede', 'Schede'], ['Progressi', 'Progressi'], ['Check', 'Check'], ['Dashboard', 'Dashboard']] as const) {
    await tabs.filter({ hasText: name }).click();
    await expect(c.locator('h1').first()).toHaveText(title);
    await expect(tabs.filter({ hasText: name })).toHaveClass(/active/);
    await expectNoHScroll(c, `coach/${name}`);
  }
  await tabs.filter({ hasText: 'Atleti' }).click();
  await c.getByTestId('athlete-row').first().click();
  await expectNoHScroll(c, 'profilo atleta');
  for (const t of ['scheda', 'sedute', 'progressi', 'check']) {
    await c.getByTestId(`tab-${t}`).click();
    await expectNoHScroll(c, `profilo/${t}`);
  }
  await c.getByTestId('tabbar').getByRole('link', { name: 'Dashboard' }).click();
  // Progressi coach: un atleta alla volta, contesto evidente
  await tabs.filter({ hasText: 'Progressi' }).click();
  await expect(c.getByTestId('athlete-banner')).toContainText('Profilo atleta · [DEMO] Atleta A');
  await c.getByTestId('progress-athlete').selectOption({ label: '[DEMO] Atleta B' });
  await expect(c.getByTestId('athlete-banner')).toContainText('[DEMO] Atleta B');
  await shot(c, '22-coach-progressi');
  await c.getByTestId('tabbar').getByRole('link', { name: 'Schede' }).click();
  await shot(c, '23-coach-schede');
  // Modalità ricordata: dopo "Il mio allenamento" il nuovo accesso riparte da lì
  await c.getByTestId('mode-switch').getByRole('link', { name: 'Il mio allenamento' }).click();
  await expect(c.locator('h1')).toHaveText('Oggi');
  await c.getByTestId('account-link').click();
  await c.getByTestId('logout').click();
  await c.getByLabel('Email').fill(COACH);
  await c.getByLabel('Password').fill(PW);
  await c.getByRole('button', { name: 'Accedi' }).click();
  await expect(c.locator('h1')).toHaveText('Oggi');
  await c.getByTestId('mode-switch').getByRole('link', { name: 'Coach' }).click();
  await expect(c.locator('h1')).toHaveText('Dashboard');
  await coach.ctx.close();

  // Atleta: 4 voci, nessun selettore, area coach inaccessibile
  const ath = await device(browser, B);
  await expect(ath.page.getByTestId('tabbar').getByRole('link')).toHaveText(['Oggi', 'Scheda', 'Progressi', 'Check']);
  await expect(ath.page.getByTestId('mode-switch')).toHaveCount(0);
  for (const name of ['Oggi', 'Scheda', 'Progressi', 'Check']) {
    await ath.page.getByTestId('tabbar').getByRole('link', { name }).click();
    await expectNoHScroll(ath.page, `atleta/${name}`);
  }
  await ath.page.goto('/coach');
  await expect(ath.page.locator('h1')).toHaveText('Oggi');
  await ath.page.getByTestId('tabbar').getByRole('link', { name: 'Progressi' }).click();
  await ath.page.getByRole('button', { name: 'Sedute' }).click();
  await expect(ath.page.getByTestId('history')).toBeVisible();
  await ath.ctx.close();
});

test('8 · timer: tempo reale, pausa e ripresa, ±15 s, preset, fine recupero, riapertura', async ({ browser }) => {
  const { ctx, page } = await device(browser, A, { clock: true });
  await page.getByRole('button', { name: 'Inizia allenamento' }).click(); // Giorno 5
  const ex = await openExercise(page, 'adductor machine');
  await field(ex, 'Serie 1 kg').fill('50');
  await field(ex, 'Serie 1 ripetizioni').fill('10');
  await page.getByTestId('complete-set').click();
  await expect(page.getByTestId('rest-clock')).toHaveText('3:00'); // recupero 3’
  await page.clock.fastForward('00:30');
  await expect(page.getByTestId('rest-clock')).toHaveText('2:30');
  await page.getByTestId('rest-open').click();
  const sheet = page.getByTestId('rest-sheet');
  await sheet.getByRole('button', { name: '+15 s' }).click();
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText('2:45');
  await sheet.getByRole('button', { name: '−15 s' }).click();
  await sheet.getByRole('button', { name: '−15 s' }).click();
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText('2:15');
  // Pausa: il tempo non scorre; ripresa: riparte da dove era
  await page.getByTestId('rest-pause').click();
  await expect(sheet).toContainText('In pausa');
  await page.clock.fastForward('01:00');
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText('2:15');
  await page.getByTestId('rest-pause').click();
  await page.clock.fastForward('00:15');
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText('2:00');
  // Preset
  await sheet.getByRole('button', { name: '2:00' }).click();
  await expect(page.getByTestId('rest-sheet-clock')).toHaveText('1:15');
  await sheet.getByRole('button', { name: 'Chiudi' }).click();
  // Riapertura dopo "background": il tempo trascorso viene conteggiato
  await page.reload();
  await page.clock.fastForward('01:00');
  await expect(page.getByTestId('rest-clock')).toHaveText('0:15');
  // Fine recupero: segnale visivo evidente (verde + "Recupero finito")
  await page.clock.fastForward('00:20');
  await expect(page.getByTestId('rest-bar')).toHaveClass(/over/);
  await expect(page.getByTestId('rest-bar')).toContainText('Recupero finito');
  await expect(page.getByTestId('rest-clock')).toHaveText(/^\+0:0\d$/);
  await page.getByTestId('skip-rest').click();
  await expect(page.getByTestId('rest-bar')).toHaveCount(0);
  await page.getByTestId('finish-open').click();
  await page.getByRole('button', { name: 'Scarta seduta' }).click();
  await page.getByRole('button', { name: 'Sì, scarta' }).click();
  await ctx.close();
});

test('9 · registrazione serie: passi ±, inserimento manuale, modifica e annulla', async ({ browser }) => {
  const { ctx, page } = await device(browser, A);
  await page.getByRole('button', { name: 'Inizia allenamento' }).click();
  const ex = await openExercise(page, 'adductor machine');
  const kg = field(ex, 'Serie 1 kg');
  await kg.fill('60');
  await ex.getByRole('button', { name: 'Aumenta Serie 1 kg' }).click();
  await expect(kg).toHaveValue('62,5'); // passo predefinito 2,5
  // Passo 1,25 per questo esercizio: nessun errore di arrotondamento
  await page.getByTestId('exercise-menu').click();
  await page.getByTestId('actions-sheet').getByRole('button', { name: /Passo dei pulsanti/ }).click();
  await page.getByTestId('actions-sheet').getByRole('button', { name: '1,25 kg' }).click();
  await ex.getByRole('button', { name: 'Aumenta Serie 1 kg' }).click();
  await ex.getByRole('button', { name: 'Aumenta Serie 1 kg' }).click();
  await expect(kg).toHaveValue('65');
  await ex.getByRole('button', { name: 'Diminuisci Serie 1 kg' }).click();
  await expect(kg).toHaveValue('63,75');
  // Inserimento manuale sempre possibile
  await kg.fill('61,3');
  await field(ex, 'Serie 1 ripetizioni').fill('8');
  await page.getByTestId('complete-set').click();
  await expect(ex.getByTestId('set-done-work-0')).toContainText('61,3 × 8');
  // Modifica della serie registrata (stesso id, nessun duplicato)
  await ex.getByTestId('set-done-work-0').click();
  await field(ex, 'Serie 1 ripetizioni').fill('9');
  await ex.getByRole('button', { name: 'Aggiorna' }).click();
  await expect(ex.getByTestId('set-done-work-0')).toContainText('61,3 × 9');
  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato');
  const aId = await idOf(A);
  const rows = await q<{ weight_kg: number; reps: number }>(`select s.weight_kg::float8 as weight_kg, s.reps from workout_sets s join workouts w on w.id = s.workout_id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId]);
  expect(rows).toEqual([{ weight_kg: 61.3, reps: 9 }]);
  // Il passo resta per esercizio: Calf machine usa ancora 2,5
  const calf = await openExercise(page, 'calf machine');
  await field(calf, 'Serie 1 kg').fill('40');
  await calf.getByRole('button', { name: 'Aumenta Serie 1 kg' }).click();
  await expect(field(calf, 'Serie 1 kg')).toHaveValue('42,5');
  // Annulla serie
  const add = await openExercise(page, 'adductor machine');
  await add.getByTestId('set-done-work-0').click();
  await add.getByRole('button', { name: 'Annulla serie' }).click();
  await expect(add.getByRole('button', { name: 'Annulla serie' })).toHaveCount(0);
  await expect(add.getByTestId('set-done-work-0')).toHaveCount(0);
  await expect.poll(async () => (await q(`select 1 from workout_sets s join workouts w on w.id = s.workout_id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId])).length).toBe(0);
  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato');
  await page.getByTestId('finish-open').click();
  await page.getByRole('button', { name: 'Scarta seduta' }).click();
  await page.getByRole('button', { name: 'Sì, scarta' }).click();
  await ctx.close();
});

test('10 · inattività: attivo, inattivo oltre soglia, mai allenato; soglia modificabile', async ({ browser }) => {
  const coachId = await idOf(COACH);
  const aId = await idOf(A);
  // Dati di prova: A senza allenamenti da 10 giorni, nuovo atleta C mai allenato (B attivo oggi)
  await q(`update workouts set started_at = now() - interval '10 days 3 hours', ended_at = now() - interval '10 days 2 hours' where athlete_id = $1`, [aId]);
  const c = await q<{ id: string }>(`insert into users(email, password_hash, display_name, role, is_demo) values ('atleta.c@demo.app-palestra.test', 'x', '[DEMO] Atleta C', 'athlete', true) returning id`);
  await q('insert into coach_links(coach_id, athlete_id) values ($1, $2)', [coachId, c[0]!.id]);

  const { ctx, page } = await device(browser, COACH);
  await page.getByTestId('tabbar').getByRole('link', { name: 'Atleti' }).click();
  const rowA = page.getByTestId('athlete-row').filter({ hasText: 'Atleta A' });
  const rowB = page.getByTestId('athlete-row').filter({ hasText: 'Atleta B' });
  const rowC = page.getByTestId('athlete-row').filter({ hasText: 'Atleta C' });
  await expect(rowA.getByTestId('activity-inactive')).toHaveText('Inattivo da 10 giorni');
  await expect(rowC.getByTestId('activity-never')).toHaveText('Nessun allenamento registrato');
  await expect(rowB).toContainText('attivo oggi');
  await expect(page.getByTestId('filter-inactive')).toContainText('1');
  await expect(page.getByTestId('filter-never')).toContainText('1');
  await page.getByTestId('athlete-search').fill('atleta c');
  await expect(page.getByTestId('athlete-row')).toHaveCount(1);
  await page.getByTestId('athlete-search').fill('');
  await page.getByTestId('filter-inactive').click();
  await expect(page.getByTestId('athlete-row')).toHaveCount(1);
  await shot(page, '24-coach-atleti-inattivi');
  // Soglia 14 giorni dalle impostazioni coach (salvata sul dispositivo)
  await page.getByTestId('account-link').click();
  await page.getByTestId('inactivity-days').fill('14');
  await page.getByRole('button', { name: 'Salva soglia' }).click();
  await page.goto('/atleti');
  await expect(rowA.getByTestId('activity-inactive')).toHaveCount(0);
  await expect(rowA).toContainText('attivo 10 giorni fa');
  await expect(page.getByTestId('filter-inactive')).toContainText('0');
  await ctx.close();
});
