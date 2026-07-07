/**
 * dh2-roll-vm in-Foundry smoke test (ROADMAP Lane C validation — automates the
 * walking-skeleton checklist in foundry/dh2-roll-vm/README.md).
 *
 * Pattern borrowed from the proven join harness at
 * `<FoundryData>/systems/dark-heresy-2nd/tools/foundry-join/` (which validated
 * the dark-heresy-3rd-edition v14 migration): Playwright joins a RUNNING
 * Foundry as a user, then asserts inside the page.
 *
 * Prereqs (one-time, manual):
 *   1. `npm run deploy:foundry`
 *   2. Foundry running at FOUNDRY_URL (default http://localhost:30000), with a
 *      test world open on `dark-heresy-3rd-edition` (or `dark-heresy-2nd`) and
 *      the `dh2-roll-vm` module ENABLED.
 *   3. A GM user to join as (FOUNDRY_USER, default "Gamemaster"; FOUNDRY_PASSWORD).
 *
 * Run:  node tools/foundry-test/test-dh2vm-smoke.mjs [--headed]
 * Playwright is resolved from this repo if installed (npm i -D playwright), else
 * from the existing harness's node_modules — no new install needed.
 */
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';

const base = process.env.FOUNDRY_URL ?? 'http://localhost:30000';
const userName = process.env.FOUNDRY_USER ?? 'Gamemaster';
const password = process.env.FOUNDRY_PASSWORD ?? '';
const headless = !process.argv.includes('--headed');

/** Resolve playwright: local devDependency first, then the join harness's copy. */
async function loadPlaywright() {
    try { return await import('playwright'); } catch { /* fall through */ }
    const dataDir = process.env.FOUNDRY_DATA ?? 'C:\\Users\\kirkl\\AppData\\Local\\FoundryVTT\\Data';
    const harness = join(dataDir, 'systems', 'dark-heresy-2nd', 'tools', 'foundry-join');
    if (existsSync(join(harness, 'node_modules', 'playwright'))) {
        return createRequire(join(harness, 'package.json'))('playwright');
    }
    console.error('✗ playwright not found. Either `npm i -D playwright` in this repo, or set FOUNDRY_DATA so the join harness copy can be used.');
    process.exit(2);
}

const { chromium } = await loadPlaywright();

async function pickUser(page) {
    const select = page.locator('select').first();
    if ((await select.count()) > 0) {
        await select.selectOption({ label: userName }).catch(async () => {
            await select.selectOption({ value: userName });
        });
        return;
    }
    const byText = page.getByText(userName, { exact: true }).first();
    if ((await byText.count()) > 0) { await byText.click(); return; }
    throw new Error(`Could not select user "${userName}" on the join page`);
}

const browser = await chromium.launch({ headless });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);

try {
    await page.goto(`${base.replace(/\/$/, '')}/join`, { waitUntil: 'load' });
    // If Foundry is at the Setup / admin-auth screen, there is no world to join.
    const landed = page.url();
    if (/\/(setup|auth|license)/.test(landed)) {
        console.error(`✗ Foundry is at ${landed} — no world is LAUNCHED.`);
        console.error('  In the Foundry app: Game Worlds → your test world → Launch World, then re-run.');
        process.exit(1);
    }
    await page.waitForFunction(() => !!document.querySelector('select') || !!document.querySelector('form'));
    await pickUser(page);
    const pwd = page.locator('input[type="password"], input[name="password"]').first();
    if ((await pwd.count()) > 0) await pwd.fill(password);
    const joinBtn = page.getByRole('button', { name: /join\s*game/i }).first();
    if ((await joinBtn.count()) > 0) await joinBtn.click();
    else await page.locator('button[type="submit"], input[type="submit"]').first().click();
    // Fail FAST with the actual reason if login is rejected (bad password, user
    // already active, …) instead of waiting out the long navigation timeout.
    try {
        await page.waitForURL(/\/game/, { timeout: 30_000 });
    } catch {
        const note = await page.evaluate(() =>
            document.querySelector('#notifications')?.innerText?.trim()
            || document.querySelector('.notification')?.innerText?.trim() || '').catch(() => '');
        console.error(`✗ Login as "${userName}" did not reach /game (stuck at ${page.url()}).`);
        if (note) console.error(`  Foundry says: ${note}`);
        console.error('  Checks: is the world launched? does this user have a password (set FOUNDRY_PASSWORD)?');
        console.error('  is the user already logged in elsewhere (log them out)? Try --headed to watch.');
        process.exit(1);
    }
    await page.waitForFunction(() => !!globalThis.game?.ready, { timeout: 120_000 });

    const result = await page.evaluate(async () => {
        const out = { system: game.system.id, foundry: game.version, checks: [] };
        const check = (name, pass, detail = '') => out.checks.push({ name, pass: !!pass, detail: String(detail) });

        // 1. module active + API surface
        const mod = game.modules.get('dh2-roll-vm');
        check('module active', mod?.active, `v${mod?.version ?? '?'}`);
        check('game.dh2vm registered', !!game.dh2vm);
        if (!game.dh2vm) return out;
        const vm = game.dh2vm;

        // 2. rule set compiled inside Foundry
        check('builtinRules > 50', (vm.builtinRules?.length ?? 0) > 50, `${vm.builtinRules?.length} rules`);

        // 3. deterministic d100 test through the VM
        const rt = vm.rollTest({ target: 40, unnatural: 3 }, vm.rollScript([20]));
        check('rollTest deterministic (forced 20 vs 40)', rt.success === true && rt.roll === 20, `dos ${rt.dos} (incl. +${rt.bonusDos} unnatural)`);

        // 4. full engagement, deterministic, entirely in-page
        const eng = vm.resolveEngagement({
            attacker: {
                characteristics: { ws: 50, s: 35, t: 30 }, unnatural: { s: 2 },
                weapon: { name: 'Smoke Axe', isMelee: true, damage: '1d10', pen: 0, damageType: 'Rending', sbMultiplier: 1, rof: { single: true, burst: 0, full: 0 }, qualities: ['Tearing'] },
                action: 'Standard Attack',
            },
            defender: { characteristics: { ag: 30, t: 30 }, armour: 2, toughnessBonus: 3 },
            options: {},
        }, vm.rollScript([20, 5, 7]), vm.buildRegistry());
        check('resolveEngagement deterministic', eng.attack.test.success && eng.attack.totalWounds === 7,
            `wounds ${eng.attack.totalWounds} (die 7 kept + SB 5 − soak 5)`);

        // 5. importCharacter: canonical JSON → Actor with embedded items
        const doc = {
            schemaVersion: 1, kind: 'dh2.character', name: 'Smoke Test Vex', system: 'dh2',
            characteristics: { ws: 35, bs: 40, s: 35, t: 30, ag: 35, int: 30, per: 30, wp: 30, fel: 30 },
            unnatural: { s: 2 }, armour: { body: 4 },
            wounds: { max: 12, current: 12 }, fate: { max: 3, current: 3 },
            talents: ['Ambidextrous'], traits: [{ name: 'Brutal Charge', level: 3 }],
            conditions: [], circumstances: [],
            weapons: [{ name: 'Boltgun', class: 'basic', damage: '1d10+9', pen: 4, damageType: 'Explosive', rof: { single: true, burst: 3, full: 0 }, qualities: ['Tearing'] }],
        };
        let actor = null;
        try {
            actor = await vm.importCharacter(doc);
            const items = actor?.items?.map((i) => `${i.type}:${i.name}`) ?? [];
            check('importCharacter creates Actor', !!actor, actor?.name ?? 'null');
            check('imported Actor has weapon+talent+trait items', items.length >= 3, items.join(', '));
            // 6. mapActor round-trip on the imported actor
            const mapped = vm.mapActor(actor);
            check('mapActor reads imported characteristics', mapped.characteristics.bs === 40 && mapped.characteristics.ws === 35,
                JSON.stringify(mapped.characteristics));
        } finally {
            if (actor) await actor.delete();
        }

        // 7. generated compendium packs (Phase 3 pack export v1)
        const tablesPack = game.packs.get('dh2-roll-vm.rules-tables');
        const specialsPack = game.packs.get('dh2-roll-vm.attack-specials');
        check('rules-tables pack present', !!tablesPack, tablesPack ? `${tablesPack.index.size} tables` : 'missing');
        check('attack-specials pack present', !!specialsPack, specialsPack ? `${specialsPack.index.size} qualities` : 'missing');
        if (tablesPack) {
            const idx = [...tablesPack.index.values()].map((e) => e.name);
            check('Scatter Diagram table in pack', idx.includes('Scatter Diagram'), idx.join(', ').slice(0, 80));
        }
        if (specialsPack) {
            const entry = [...specialsPack.index.values()].find((e) => e.name === 'Corrosive');
            let detail = 'index entry missing';
            if (entry) {
                const item = await specialsPack.getDocument(entry._id);
                detail = item?.system?.description?.slice(0, 60) ?? 'no description';
            }
            check('Corrosive attackSpecial loads with provenance', !!entry && /p\.145/.test(detail), detail);
        }

        // 8. EncounterState ⇄ ActiveEffect mirror (Phase 4) — round-trip parity
        {
            let actor = null;
            try {
                actor = await Actor.create({ name: 'AE Mirror Test', type: 'acolyte' });
                const enc = vm.emptyEncounter();
                const entry = vm.encounterActor(enc, 'AE Mirror Test');
                entry.conditions.push({ name: 'On Fire', severity: null, duration: null, location: null });
                entry.conditions.push({ name: 'Toxified', severity: 3, duration: 2, location: 'Body' });
                entry.conditions.push({ name: 'Haywire Field', severity: 3, duration: null, location: null, decay: 1 });
                const written = await vm.syncEncounterToActor(actor, enc.actors['AE Mirror Test']);
                const back = vm.readEncounterFromActor(actor, 'AE Mirror Test');
                const a = enc.actors['AE Mirror Test'].conditions, b = back.actors['AE Mirror Test'].conditions;
                const same = a.length === b.length && a.every((c, i) =>
                    c.name === b[i].name && (c.severity ?? null) === (b[i].severity ?? null)
                    && (c.duration ?? null) === (b[i].duration ?? null) && (c.decay ?? undefined) === (b[i].decay ?? undefined));
                check('AE mirror round-trip (conditions ⇄ ActiveEffects)', written === 3 && same,
                    b.map((c) => `${c.name}${c.severity != null ? `(${c.severity})` : ''}${c.duration != null ? `[${c.duration}r]` : ''}`).join(', '));
                // and the headless tick runs in-page against the mirrored state
                const tick = vm.tickEncounter(back, 'TURN_START', vm.buildRegistry(), vm.rollScript([7]), 'AE Mirror Test');
                check('upkeep tick in-page (On Fire burns 7)', tick.events.some((e) => e.type === 'damage' && e.amount === 7),
                    JSON.stringify(tick.events[0] ?? {}));
            } finally {
                if (actor) await actor.delete();
            }
        }

        // 9. dh2Attack — needs a controlled token + target; run only if present
        const controlled = canvas?.tokens?.controlled?.[0];
        const targeted = game.user?.targets?.first?.();
        if (controlled && targeted) {
            const msg = await vm.dh2Attack();
            check('dh2Attack posts a chat card', !!msg);
        } else {
            check('dh2Attack (skipped — select a token and target another to include)', true, 'skipped');
        }
        return out;
    });

    console.log(`\nWorld: system ${result.system}, Foundry ${result.foundry}`);
    let failed = 0;
    for (const c of result.checks) {
        console.log(` ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
        if (!c.pass) failed++;
    }
    console.log(failed === 0 ? '\nPASS — walking-skeleton checklist green.' : `\nFAIL — ${failed} check(s) failed.`);
    process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
    console.error('✗ smoke test aborted:', err.message);
    process.exitCode = 1;
} finally {
    await browser.close();
}
