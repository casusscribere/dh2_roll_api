/**
 * CB-4 acceptance (Phase 4, E-4): the creation wizard, headless.
 *
 * Drives createWizard (ui/builder-core.mjs) against dispatch directly — the
 * SAME engine calls the Builder page makes. The oracle is
 * fixtures/wizard-expected.json, hand-computed from the pack's cost matrix;
 * the engine is asserted to agree with the sheet, not the other way round.
 *
 * RAW facts encoded here (core p.31–35, verified against _pdf_text):
 * - characteristics roll 2d10 + 25 (the campaign's "experienced" variant —
 *   range 27–45); a home-world "+" characteristic rolls 3d10 KEEP HIGHEST
 *   two, a "−" characteristic keeps the lowest two (the pack encodes these as
 *   ±3 in characteristicModifiers); Influence is the tenth rolled value;
 * - exactly ONE characteristic may be rerolled, second result kept;
 * - Emperor's Blessing: 1d10 ≥ the home world's value → Fate threshold +1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { dispatch } from '../lib/api-router.mjs';
import { createWizard, WIZARD_STEPS } from '../../ui/builder-core.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { migrateCharacter, validateCharacter } from '../lib/character-schema.mjs';
import { characterToFoundryActor, foundryActorToCharacter, normalizeForRoundTrip } from '../lib/foundry-actor.mjs';

const EXPECTED = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wizard-expected.json'), 'utf8'));

/** api adapter with the page's contract: parsed body on 2xx, throw otherwise. */
async function api(method, path, body) {
    const r = dispatch(method, path, body);
    if (r.status >= 400) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
    return r.body;
}

/** rng producing a fixed d10/d5 sequence: value v → Math.floor(v*N)+1 = die. */
const seqRng = (dice) => {
    let i = 0;
    return () => (dice[Math.min(i++, dice.length - 1)] - 1 + 0.5) / 10;
};

const wizard = (rng) => createWizard({ pack: CHARGEN_PACK, api, rng });

async function chooseOrigin(w, roleChoices = { roleTalent: 'Quick Draw' }) {
    await w.choose('homeWorld', { ref: 'dh2:home_world:feral_world' });
    await w.choose('background', { ref: 'dh2:background:outcast' });
    await w.choose('role', { ref: 'dh2:role:desperado', choices: roleChoices });
}

/* ── (a) step order ─────────────────────────────────────────────────────── */

test('the wizard declares the D-K / CB-4.1 step order', () => {
    assert.deepEqual(WIZARD_STEPS, [
        'homeWorld', 'background', 'role', 'characteristics', 'woundsFate',
        'divination', 'startingXp', 'details', 'validate', 'done',
    ]);
    assert.deepEqual(wizard().steps, WIZARD_STEPS);
});

/* ── (b) origin application ─────────────────────────────────────────────── */

test('choosing a home world applies fate threshold, wound formula and modifiers via applyOrigin', async () => {
    const w = wizard();
    await w.choose('homeWorld', { ref: 'dh2:home_world:feral_world' });
    assert.equal(w.state.originInfo.fateThreshold, EXPECTED.homeworld.fateThreshold);
    assert.equal(w.state.originInfo.woundsFormula, EXPECTED.homeworld.woundsFormula);
    assert.deepEqual(w.state.originInfo.characteristicModifiers, { S: 3, T: 3, Inf: -3 });
    assert.deepEqual(w.state.doc.fate, { max: 2, current: 2 });
    assert.ok(w.state.doc.aptitudes.some((a) => a.name === 'Toughness' && a.source === 'homeworld'));
});

test('background and role grants land; the role talent choice resolves', async () => {
    const w = wizard();
    await chooseOrigin(w);
    const d = w.state.doc;
    assert.equal(d.origin.homeworld.ref, 'dh2:home_world:feral_world');
    assert.equal(d.origin.background.name, 'Outcast');
    assert.equal(d.origin.role.name, 'Desperado');
    assert.deepEqual(d.aptitudes.map((a) => a.name).sort(), [...EXPECTED.aptitudes].sort());
    assert.ok(d.talents.some((t) => t.name === 'Quick Draw'), 'role talent choice');
    assert.equal(d.skills.Awareness.advances, 1, 'background skill grant');
    assert.equal(d.xp.total, EXPECTED.startingXp);
    assert.deepEqual(w.state.pendingChoices, []);
});

test('an unresolved role talent choice surfaces as a pending choice', async () => {
    const w = wizard();
    await w.choose('homeWorld', { ref: 'dh2:home_world:feral_world' });
    await w.choose('background', { ref: 'dh2:background:outcast' });
    await w.choose('role', { ref: 'dh2:role:desperado' });
    assert.ok(w.state.pendingChoices.some((c) => c.key === 'roleTalent'));
});

/* ── (c) characteristics — D-K both methods ─────────────────────────────── */

test('raw roll: 2d10+25 per characteristic; +chars keep the highest 2 of 3, −chars the lowest 2', async () => {
    // Die order is documented: doc keys ws,bs,s,t,ag,int,per,wp,fel then
    // influence; 2 dice each, except ±modified characteristics roll 3.
    // Feral World: +S, +T, −Inf.
    const dice = [
        1, 2,          // ws  → 28
        1, 2,          // bs  → 28
        1, 2, 10,      // s   (+) → keep 2,10 → 37
        3, 4, 5,       // t   (+) → keep 4,5  → 34
        1, 2,          // ag  → 28
        1, 2,          // int → 28
        1, 2,          // per → 28
        1, 2,          // wp  → 28
        1, 2,          // fel → 28
        6, 7, 8,       // influence (−) → keep 6,7 → 38
    ];
    const w = wizard(seqRng(dice));
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'raw' });
    const c = w.state.doc.characteristics;
    assert.equal(c.s.base, 37, 'keep-highest failed');
    assert.equal(c.t.base, 34);
    assert.equal(c.ws.base, 28);
    assert.equal(w.state.doc.influence, 38, 'keep-lowest failed');
    for (const k of ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel']) {
        assert.ok(c[k].base >= 27 && c[k].base <= 45, `${k} out of RAW range`);
    }
    assert.equal(w.state.characteristics.method, 'raw');
});

test('exactly one reroll is allowed, and the second result is kept', async () => {
    const w = wizard(seqRng([
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,  // initial rolls
        9, 10,                                                                  // the reroll (ws)
    ]));
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'raw' });
    assert.equal(w.state.doc.characteristics.ws.base, 27);
    w.rollCharacteristics({ method: 'raw', rerollIndex: 'ws' });
    assert.equal(w.state.doc.characteristics.ws.base, 44, 'reroll not applied');
    assert.equal(w.state.characteristics.rerolled, 'ws');
    assert.throws(() => w.rollCharacteristics({ method: 'raw', rerollIndex: 'bs' }), /one reroll/i);
});

test('manual entry stores the values and records method:"manual"', async () => {
    const w = wizard();
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    assert.equal(w.state.doc.characteristics.wp.base, 40);
    assert.equal(w.state.doc.influence, 22);
    assert.equal(w.state.characteristics.method, 'manual');
});

test('origin locks once characteristics are set (restart to change it)', async () => {
    const w = wizard();
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    await assert.rejects(() => w.choose('homeWorld', { ref: 'dh2:home_world:hive_world' }), /locked/i);
});

/* ── (d) the full flow against the hand-computed sheet ──────────────────── */

test('full flow: one legal character; XP spend equals the fixture; validators clean; Foundry round trip', async () => {
    // woundsFate dice (seqRng encodes d10 faces; 9 → rng 0.85 → d5 = 5):
    // wounds 9+5 = 14; blessing d10 = 10 ≥ 3 → fate 3.
    const w = wizard(seqRng([9, 10]));
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    await w.choose('woundsFate');
    assert.deepEqual(w.state.doc.wounds, { max: 14, current: 14, critical: 0 });
    assert.deepEqual(w.state.doc.fate, { max: 3, current: 3 }, "Emperor's Blessing (+1) not applied");
    assert.equal(w.state.woundsFate.blessed, true);

    w.setDivination('Trust in your fear.');

    // spend starting XP — the CB-3 advancement API, same route the panel uses
    for (const p of EXPECTED.purchases) {
        const advances = await w.advances();
        const found = advances.find((a) => p.ref
            ? (a.ref === p.ref && (p.rank === undefined || a.rank === p.rank))
            : (a.name === p.name && a.rank === p.rank));
        assert.ok(found, `advance not offered: ${JSON.stringify(p)}`);
        assert.equal(found.matches, p.matches, `${found.name}: match count`);
        assert.equal(found.cost, p.cost, `${found.name}: cost disagrees with the hand-computed sheet`);
        assert.ok(found.prereqsMet, `${found.name}: prerequisites`);
        await w.buy(found);
    }
    assert.equal(w.state.xp.spent, EXPECTED.spent);
    assert.equal(w.state.xp.remaining, EXPECTED.remaining);

    w.setDetails({ name: 'Fixture Acolyte' });
    const { doc, validation } = await w.finish();

    assert.equal(doc.name, 'Fixture Acolyte');
    assert.equal(doc.tarot.text, 'Trust in your fear.');
    assert.equal(w.state.step, 'done');

    // wizard state persisted for auditability (D-K)
    const audit = doc.extensions.builder.wizard;
    assert.equal(audit.characteristics.method, 'manual');
    assert.equal(audit.selections.homeworldRef, 'dh2:home_world:feral_world');

    // validators: character 0 errors; build reconciliation 0 errors
    const vc = validateCharacter(migrateCharacter(structuredClone(doc)));
    assert.deepEqual(vc.errors, [], JSON.stringify(vc.errors));
    assert.deepEqual(validation.build.errors, [], JSON.stringify(validation.build.errors));
    assert.deepEqual(validation.character.errors ?? [], []);

    // §7.3 mechanized: the built character survives the Foundry round trip
    const m = migrateCharacter(structuredClone(doc));
    assert.deepEqual(
        normalizeForRoundTrip(foundryActorToCharacter(characterToFoundryActor(m))),
        normalizeForRoundTrip(m),
        'wizard output does not survive the Foundry round trip');
});
