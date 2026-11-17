import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';

/**
 * Prove end-to-end su viewport iPhone (Chromium con emulazione iPhone 13).
 * Utenti sintetici creati dal server e2e: coach, atleta A, atleta B (dominio .test, nome [DEMO]).
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
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function device(browser: Browser, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...test.info().project.use });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.locator('h1')).toHaveText(email === COACH ? 'Atleti' : 'Oggi');
  return { ctx, page };
}

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

const idOf = async (email: string) => (await q<{ id: string }>('select id from users where email = $1', [email]))[0]!.id;

test('1 · coach: assegna la propria scheda (con Pendulum) all\'atleta A', async ({ browser }) => {
  const { ctx, page } = await device(browser, COACH);
  await shot(page, '01-coach-atleti');
  await page.getByTestId('athlete-row').filter({ hasText: 'Atleta A' }).click();
  await expect(page.getByTestId('athlete-banner')).toContainText('[DEMO] Atleta A');
  await page.getByTestId('assign-open').click();
  await page.getByTestId('assign-program').selectOption({ label: 'Scheda 5 giorni' });
  await page.getByLabel('Nome per l\'atleta (facoltativo)').fill('Massa · 5 giorni');
  await page.getByTestId('assign-confirm').click();
  await expect(page.getByText('Massa · 5 giorni').first()).toBeVisible();
  await expect(page.getByTestId('edit-athlete-program')).toBeVisible(); // la scheda compare subito nel tab
  await shot(page, '02-coach-profilo-atleta');
  // La scheda personale del coach resta distinta: chip "Il mio spazio" nella vista Scheda
  await page.goto('/scheda');
  await expect(page.getByText('Il mio spazio')).toBeVisible();
  await expect(page.getByTestId('program-card')).toHaveCount(1);
  await ctx.close();
});

test('2 · atleta A: Oggi → Pendulum → Completa serie → Recupero → Lascia in sospeso → Riprendi → Termina → Salva', async ({ browser }) => {
  const { ctx, page } = await device(browser, A);
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await page.getByTestId('day-select').selectOption({ label: 'Giorno 3' });
  await shot(page, '03-oggi');
  await page.getByRole('button', { name: 'Inizia allenamento' }).click();
  await expect(page).toHaveURL(/\/seduta$/);

  const pend = page.getByTestId('exercise-pendulum squat');
  await pend.getByRole('button', { name: /Pendulum Squat/ }).click();
  await expect(pend).toContainText('Nessuno storico');
  await pend.getByLabel('Serie 1 kg').fill('60');
  await pend.getByLabel('Serie 1 ripetizioni').fill('7');
  await pend.getByLabel('Serie 1 RIR').selectOption('2');
  const complete = pend.getByRole('button', { name: 'Completa serie' }).first();
  await complete.dblclick(); // doppio tocco: deve registrare una sola serie
  await expect(pend.getByText('✓ Registrata')).toHaveCount(1);

  // Recupero: barra fissa, durata predefinita 5:00 (4’-5’), modificabile
  const bar = page.getByTestId('rest-bar');
  await expect(bar).toContainText('Recupero · Pendulum Squat');
  await expect(page.getByTestId('rest-clock')).toHaveText(/^[45]:\d\d$/);
  await bar.getByRole('button', { name: '4:00' }).click();
  await expect(page.getByTestId('rest-clock')).toHaveText(/^3:5\d$|^4:00$/);
  await page.mouse.wheel(0, 2000);
  await expect(bar).toBeInViewport();
  await shot(page, '04-seduta-recupero');

  // Riapertura dell'app: seduta e timer ripristinati sul tempo reale
  await page.reload();
  await expect(page.getByTestId('rest-clock')).toHaveText(/^3:[45]\d$/);

  await page.getByTestId('suspend').click();
  await expect(page.getByRole('button', { name: 'Riprendi allenamento' })).toBeVisible();
  await expect(page.getByText('1 serie registrate')).toBeVisible();
  await page.getByRole('button', { name: 'Riprendi allenamento' }).click();

  await page.getByTestId('skip-rest').click();
  await expect(page.getByTestId('rest-bar')).toContainText('Nessun recupero in corso');
  const pend2 = page.getByTestId('exercise-pendulum squat');
  if (!(await pend2.getByLabel('Serie 2 kg').isVisible())) await pend2.getByRole('button', { name: /Pendulum Squat/ }).click();
  await pend2.getByLabel('Serie 2 kg').fill('65');
  await pend2.getByLabel('Serie 2 ripetizioni').fill('5');
  await pend2.getByRole('button', { name: 'Completa serie' }).click();
  await expect(pend2.getByText('✓ Registrata')).toHaveCount(2);
  // + Riscaldamento resta nello storico ma fuori dal conteggio
  await pend2.getByTestId('add-warmup').click();
  await pend2.getByLabel('Riscald. 1 kg').fill('40');
  await pend2.getByLabel('Riscald. 1 ripetizioni').fill('10');
  await pend2.getByRole('button', { name: 'Registra riscaldamento' }).click();
  await expect(pend2.getByText('2/2')).toBeVisible();

  await page.getByRole('button', { name: 'Termina allenamento' }).click();
  const summary = page.getByTestId('finish-summary');
  await expect(page.getByTestId('finish-sets')).toHaveText('2');
  await expect(summary).toContainText('+ 1 di riscaldamento');
  await expect(summary).toContainText('Serie mancanti');
  await shot(page, '05-termina');
  await page.getByLabel('Nota per il coach (facoltativa)').fill('Pendulum ok, ginocchio sinistro un po\' rigido');
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
  const tbar = page.getByTestId('exercise-t bar prono + kelso shrugs alla fine');
  await expect(tbar).toBeVisible();
  // Prefill dall'ultima seduta assente → campi vuoti; T-bar ha top set + back-off
  await expect(tbar).toContainText('Top set 1');
  await expect(tbar).toContainText('Back-off −20%');

  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato'); // avvio seduta già sul server
  await ctx.setOffline(true);
  await ctx.route('**/api/**', (r) => r.abort('internetdisconnected')); // taglio deterministico anche per richieste già avviate
  await tbar.getByLabel('Top set 1 kg').fill('70');
  await tbar.getByLabel('Top set 1 ripetizioni').fill('7');
  await tbar.getByTestId('set-work-0').getByRole('button', { name: 'Completa serie' }).click();
  await expect(tbar.getByText('✓ Registrata')).toHaveCount(1);
  await tbar.getByLabel('Top set 2 kg').fill('70');
  await tbar.getByLabel('Top set 2 ripetizioni').fill('6');
  await tbar.getByTestId('set-work-1').getByRole('button', { name: 'Completa serie' }).click();
  await expect(tbar.getByText('✓ Registrata')).toHaveCount(2);
  await expect(page.getByTestId('sync-status')).toContainText('da inviare');
  await shot(page, '06-offline');
  // Chiusura e riapertura dell'app senza rete: la shell arriva dal service worker, la seduta da IndexedDB
  await page.reload();
  await expect(page.getByTestId('exercise-t bar prono + kelso shrugs alla fine').getByText('✓ Registrata')).toHaveCount(2);

  const aId = await idOf(A);
  // Seduta avviata online, serie registrate offline: sul server non sono ancora arrivate
  const before = await q<{ n: number }>(`select count(s.*)::int n from workouts w left join workout_sets s on s.workout_id = w.id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId]);
  expect(before[0]!.n).toBe(0);

  await ctx.unroute('**/api/**');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-status')).toHaveText('Sincronizzato', { timeout: 20_000 });
  const rows = await q<{ n: number }>(
    `select count(*)::int n from workout_sets s join workouts w on w.id = s.workout_id where w.athlete_id = $1 and w.status = 'in_progress'`, [aId]);
  expect(rows[0]!.n).toBe(2);

  // Nuovo accesso con la stessa utenza da un secondo dispositivo
  const second = await device(browser, A);
  await expect(second.page.getByRole('button', { name: 'Riprendi allenamento' })).toBeVisible();
  await second.page.getByRole('button', { name: 'Riprendi allenamento' }).click();
  const tbar2 = second.page.getByTestId('exercise-t bar prono + kelso shrugs alla fine');
  await expect(tbar2.getByText('✓ Registrata')).toHaveCount(2);
  await second.page.getByRole('button', { name: 'Termina allenamento' }).click();
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
  await athlete.page.getByTestId('day-select').selectOption({ label: 'Giorno 3' });
  await athlete.page.getByRole('button', { name: 'Inizia allenamento' }).click();
  const pend = athlete.page.getByTestId('exercise-pendulum squat');
  await expect(pend).toContainText('2 × 7/5');

  const coach = await device(browser, COACH);
  await coach.page.getByTestId('athlete-row').filter({ hasText: 'Atleta A' }).click();
  await coach.page.getByTestId('edit-athlete-program').first().click();
  const reps = coach.page.getByTestId('editor-ex-2-2').getByLabel('Ripetizioni');
  await expect(coach.page.getByTestId('editor-ex-2-2').getByLabel('Esercizio 3')).toHaveValue('Pendulum Squat');
  await reps.fill('8/6');
  await coach.page.getByTestId('open-publish').click();
  await expect(coach.page.getByRole('dialog')).toContainText('Giorno 3, Pendulum Squat: ripetizioni 7/5 → 8/6');
  await shot(coach.page, '07-pubblica-modifica');
  await coach.page.getByTestId('confirm-publish').click();
  await expect(coach.page).toHaveURL(/\/atleti\/.+\/scheda$/);

  // La seduta in corso resta sulla versione 1
  await athlete.page.reload();
  await expect(athlete.page.getByTestId('exercise-pendulum squat')).toContainText('2 × 7/5');
  // Ultima volta: precompilazione dalla serie corrispondente della seduta precedente
  await athlete.page.getByTestId('exercise-pendulum squat').getByRole('button', { name: /Pendulum Squat/ }).click();
  await expect(athlete.page.getByTestId('exercise-pendulum squat')).toContainText('60 kg × 7 · 65 kg × 5');
  await expect(athlete.page.getByTestId('exercise-pendulum squat').getByLabel('Serie 1 kg')).toHaveValue('60');
  await expect(athlete.page.getByTestId('exercise-pendulum squat').getByLabel('Serie 2 ripetizioni')).toHaveValue('5');
  await athlete.page.getByRole('button', { name: 'Termina allenamento' }).click();
  await athlete.page.getByRole('button', { name: 'Scarta seduta' }).click();
  await athlete.page.getByRole('button', { name: 'Sì, scarta' }).click();
  // Scarto: rotazione invariata; riepilogo della nuova versione visibile all'atleta
  await expect(athlete.page.getByTestId('next-day')).toHaveText('Giorno 5');
  await expect(athlete.page.getByTestId('program-update')).toContainText('Pendulum Squat: ripetizioni 7/5 → 8/6');
  await shot(athlete.page, '08-oggi-aggiornamento');
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
  // Check retrodatato senza foto + check di oggi con foto (private)
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
  await p.getByTestId('save-check').click();
  await expect(p.getByTestId('share-toggle')).not.toBeChecked();
  await expect(p.locator('img.photo')).toHaveCount(3);

  // Confronto: primo e ultimo check, stessa posa affiancata, differenze
  await p.goto('/check');
  const cmp = p.getByTestId('compare');
  await expect(cmp.locator('img.photo')).toHaveCount(2);
  await expect(cmp).toContainText('-2,2 kg');
  await expect(cmp).toContainText('-3 cm');
  await shot(p, '09-confronto-check');

  // Chiedi al coach da un esercizio
  await p.goto('/');
  await p.getByRole('button', { name: 'Inizia allenamento' }).click();
  const ex = p.getByTestId('session-list').locator('section').first();
  await expect(ex.locator('.ex-head')).toHaveAttribute('aria-expanded', 'true'); // primo esercizio aperto di default
  await ex.getByRole('button', { name: 'Chiedi al coach' }).click();
  await ex.getByLabel(/Domanda breve/).fill('Posso usare le cinghie?');
  await ex.getByRole('button', { name: 'Invia domanda' }).click();
  await expect(ex).toContainText('in attesa di risposta');
  await expect(p.getByTestId('sync-status')).toHaveText('Sincronizzato');

  // Coach: Da rivedere
  const coach = await device(browser, COACH);
  const c = coach.page;
  const items = c.getByTestId('review-item');
  await expect(items.filter({ hasText: 'Domanda · Adductor machine' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Check del' })).toHaveCount(2);
  await expect(items.filter({ hasText: 'Peso 75,2 kg' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Nota allenamento' })).toHaveCount(1);
  await shot(c, '10-da-rivedere');
  await items.filter({ hasText: 'Domanda · Adductor machine' }).getByRole('button').first().click();
  await expect(c.getByRole('dialog')).toContainText('Posso usare le cinghie?');
  await c.getByTestId('answer-text').fill('Sì, solo sull\'ultima serie.');
  await c.getByRole('button', { name: 'Invia risposta' }).click();
  await expect(items.filter({ hasText: 'Domanda' })).toHaveCount(0);

  // Check: foto private → il coach non le vede
  const today = new Date();
  const ddmm = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`;
  await items.filter({ hasText: `Check del ${ddmm}` }).getByRole('button').first().click();
  const card = c.getByTestId('coach-check');
  await expect(card).toContainText('non ha condiviso le foto');
  expect(await card.locator('img.photo').count()).toBe(0);
  await c.getByTestId('check-feedback-text').fill('Ottimo lavoro sul girovita.');
  await c.getByRole('button', { name: 'Invia feedback' }).click();
  await expect(card).toContainText('Ottimo lavoro sul girovita.');
  // Exercise feedback
  await c.getByTestId('feedback-open').click();
  await c.getByTestId('feedback-exercise').selectOption('Adductor machine');
  await c.getByTestId('feedback-text').fill('Controlla la fase eccentrica: 3 secondi.');
  await c.getByRole('button', { name: 'Invia indicazione' }).click();
  await expect(c.getByRole('status').filter({ hasText: 'Inviato' })).toBeVisible();

  // Atleta: feedback nel check e nell'esercizio
  await p.goto('/check');
  await p.getByTestId('check-item').first().click();
  await expect(p.getByTestId('check-feedback')).toContainText('Ottimo lavoro sul girovita.');
  // Condivide le foto → il coach le vede
  await Promise.all([p.waitForResponse((r) => r.url().includes('/sharing') && r.ok()), p.getByTestId('share-toggle').check()]);
  await expect(p.getByTestId('share-toggle')).toBeChecked();
  const checkUrl = p.url();
  await c.reload();
  await c.getByRole('button', { name: 'Check', exact: true }).click();
  await c.getByTestId('coach-check-item').first().click();
  await expect(c.getByTestId('coach-check').locator('img.photo')).toHaveCount(3);
  const photoSrc = await c.getByTestId('coach-check').locator('img.photo').first().getAttribute('src');
  expect((await c.request.get(photoSrc!)).status()).toBe(200);
  await shot(c, '11-coach-check-foto');

  // Revoca della visibilità: accesso negato immediatamente anche a URL già noto
  await Promise.all([p.waitForResponse((r) => r.url().includes('/sharing') && r.ok()), p.getByTestId('share-toggle').uncheck()]);
  await expect(p.getByTestId('share-toggle')).not.toBeChecked();
  expect((await c.request.get(photoSrc!)).status()).toBe(404);
  // Atleta B non accede alla foto di A
  const b = await device(browser, B);
  expect((await b.page.request.get(photoSrc!)).status()).toBe(404);

  // Secondo dispositivo dell'atleta: stesso check, feedback e risposta nell'esercizio
  const tablet = await device(browser, A);
  await tablet.page.goto(checkUrl);
  await expect(tablet.page.getByTestId('check-feedback')).toContainText('Ottimo lavoro');
  await expect(tablet.page.locator('img.photo')).toHaveCount(3);
  await tablet.page.goto('/');
  await tablet.page.getByRole('button', { name: 'Riprendi allenamento' }).click();
  const ex2 = tablet.page.getByTestId('exercise-adductor machine');
  await expect(ex2.locator('.ex-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(ex2.getByTestId('exercise-feedback')).toContainText('fase eccentrica');
  await expect(ex2).toContainText('Sì, solo sull\'ultima serie.');
  await shot(tablet.page, '12-feedback-esercizio');

  // Eliminazione foto dal primo dispositivo
  await p.getByTestId('delete-photo-front').click();
  await expect(p.locator('img.photo')).toHaveCount(2);
  const left = await q<{ n: number }>('select count(*)::int n from check_photos p join users u on u.id = p.athlete_id where u.email = $1', [A]);
  expect(left[0]!.n).toBe(3); // 1 (check retrodatato) + 2 rimaste

  // Pulizia della seduta aperta per questo test
  await tablet.page.getByRole('button', { name: 'Termina allenamento' }).click();
  await tablet.page.getByRole('button', { name: 'Scarta seduta' }).click();
  await tablet.page.getByRole('button', { name: 'Sì, scarta' }).click();

  // Dati di esempio riconoscibili e confinati
  const users = await q<{ email: string; display_name: string; is_demo: boolean }>('select email, display_name, is_demo from users');
  for (const u of users) {
    expect(u.is_demo).toBe(true);
    expect(u.email.endsWith('@demo.app-palestra.test')).toBe(true);
    expect(u.display_name.startsWith('[DEMO]')).toBe(true);
  }
  for (const d of [athlete, coach, b, tablet]) await d.ctx.close();
});

test('6 · importazione del PDF incluso da interfaccia, revisione e sostituzione RDL → Pendulum', async ({ browser }) => {
  const { ctx, page } = await device(browser, B);
  await page.goto('/scheda/importa');
  await page.getByTestId('pdf-input').setInputFiles(path.resolve(import.meta.dirname, '../../fixtures/scheda_allenamento_5_giorni.pdf'));
  await expect(page.getByTestId('import-message')).toContainText('Trovati 5 giorni e 34 esercizi');
  await expect(page.locator('.doubt')).toHaveCount(2);
  const rdl = page.getByTestId('editor-ex-2-2');
  await expect(rdl.getByLabel('Esercizio 3')).toHaveValue('RDL manubri');
  await rdl.getByLabel('Esercizio 3').fill('Pendulum Squat');
  await page.getByTestId('editor-day-4').getByRole('button', { name: 'Rimuovi giorno' }).click();
  await page.getByTestId('add-day').click();
  await shot(page, '13-import-revisione');
  // Il giorno aggiunto ha un esercizio senza nome: va completato prima di salvare
  await page.getByTestId('save-program').click();
  await expect(page.getByRole('alert')).toContainText('un esercizio non ha nome');
  await page.getByTestId('editor-day-4').getByLabel('Esercizio 1').fill('Crunch');
  // Gli elementi dubbi richiedono conferma esplicita
  await page.getByTestId('save-program').click();
  await expect(page.getByRole('alert')).toContainText('Conferma di aver controllato');
  await page.getByTestId('confirm-review').check();
  await page.getByTestId('save-program').click();
  await expect(page).toHaveURL(/\/scheda$/);
  await expect(page.getByTestId('program-card')).toHaveCount(1);
  const rows = await q<{ content: { days: { name: string; exercises: { name: string }[] }[] } }>(
    `select v.content from programs p join program_versions v on v.id = p.current_version_id join users u on u.id = p.owner_id where u.email = $1`, [B]);
  const days = rows[0]!.content.days;
  expect(days.map((d) => d.name)).toEqual(['Giorno 1', 'Giorno 2', 'Giorno 3', 'Giorno 4', 'Giorno 5']);
  expect(days[4]!.exercises.map((e) => e.name)).toEqual(['Crunch']); // il Giorno 5 originale è stato rimosso
  expect(days[2]!.exercises[2]!.name).toBe('Pendulum Squat');

  // Secondo programma creato a mano → selezione nella vista Oggi, rotazioni indipendenti
  await page.goto('/scheda/nuova');
  await page.getByTestId('program-name').fill('Full body 2 giorni');
  await page.getByTestId('editor-ex-0-0').getByLabel('Esercizio 1').fill('Squat');
  await page.getByTestId('add-day').click();
  await page.getByTestId('editor-ex-1-0').getByLabel('Esercizio 1').fill('Stacco');
  await page.getByTestId('save-program').click();
  await expect(page.getByTestId('program-card')).toHaveCount(2);
  await page.goto('/');
  await page.getByTestId('program-select').selectOption({ label: 'Full body 2 giorni' });
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await page.getByRole('button', { name: 'Inizia allenamento' }).click();
  await page.getByRole('button', { name: 'Termina allenamento' }).click();
  await page.getByTestId('save-workout').click();
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 2');
  await page.getByTestId('program-select').selectOption({ index: 0 });
  await expect(page.getByTestId('next-day')).toHaveText('Giorno 1');
  await ctx.close();
});
