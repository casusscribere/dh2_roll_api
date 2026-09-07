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
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';
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
        'divination', 'startingXp', 'equipment', 'details', 'validate', 'done',
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

test('changing an earlier step PROPAGATES: origin swap recomputes wounds/fate from the recorded rolls and replays purchases at new prices', async () => {
    // woundsFate dice (seqRng encodes d10 faces): 9 → d5 = 5; blessing d10 = 10.
    const w = wizard(seqRng([9, 10]));
    await chooseOrigin(w);                                   // Feral World: 9+1d5, fate 2, blessing 3+
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    await w.choose('woundsFate');
    assert.deepEqual(w.state.doc.wounds, { max: 14, current: 14, critical: 0 });
    assert.deepEqual(w.state.doc.fate, { max: 3, current: 3 });

    const ag = (await w.advances()).find((a) => a.kind === 'characteristic' && a.ref === 'ag');
    assert.equal(ag.cost, 100);                              // Desperado holds Agility + Finesse
    await w.buy(ag);

    // swap the home world: Voidborn is 7+1d5, fate 3, blessing 5+ — same recorded dice
    await w.choose('homeWorld', { ref: 'dh2:home_world:voidborn' });
    const d = w.state.doc;
    assert.deepEqual(d.wounds, { max: 12, current: 12, critical: 0 }, 'wounds recomputed: 7 + the recorded 5');
    assert.deepEqual(d.fate, { max: 4, current: 4 }, 'fate recomputed: threshold 3 + recorded blessing 10 ≥ 5');
    assert.ok(d.aptitudes.some((a) => a.name === 'Intelligence' && a.source === 'homeworld'), 'new home-world aptitude');
    assert.ok(!d.aptitudes.some((a) => a.name === 'Toughness' && a.source === 'homeworld'), 'old aptitude gone');
    assert.equal(d.characteristics.ag.base, EXPECTED.characteristics.ag, 'values preserved');
    assert.equal(d.characteristics.ag.advances, 1, 'the purchase survived the rebuild');
    assert.equal(d.xp.ledger[0].cost, 100, 'Desperado still holds both Ag aptitudes — price unchanged');
    assert.deepEqual(w.state.conflicts, []);

    // …and swapping the ROLE moves aptitudes, so the same purchase REPRICES
    await w.choose('role', { ref: 'dh2:role:chirurgeon' });
    assert.equal(w.state.doc.xp.ledger[0].cost, 500, 'repriced at 0 matches after the role swap');
    assert.equal(w.state.doc.characteristics.ag.advances, 1);
});

test('edit mode: a wizard-born doc reloads its recipe and keeps propagating', async () => {
    const w = wizard(seqRng([9, 10]));
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    await w.choose('woundsFate');
    w.setDivination('First pass.');
    const savedDoc = structuredClone(w.state.doc);

    const w2 = wizard();
    const edit = (await import('../../ui/builder-core.mjs')).createWizard({ pack: CHARGEN_PACK, api, doc: savedDoc });
    assert.equal(edit.state.selections.homeworldRef, 'dh2:home_world:feral_world');
    assert.equal(edit.state.characteristics.method, 'manual');
    assert.equal(edit.state.hasRecipe, true);
    await edit.choose('homeWorld', { ref: 'dh2:home_world:voidborn' });
    assert.deepEqual(edit.state.doc.wounds, { max: 12, current: 12, critical: 0 });
});

test('edit mode: an extant doc WITHOUT a recipe shows its creation state; origin sets apply as deltas', async () => {
    const roster = migrateCharacter(structuredClone(CHARACTER_ROSTER.find((c) => c.id.includes('gnaeus')).doc));
    const edit = (await import('../../ui/builder-core.mjs')).createWizard({ pack: CHARGEN_PACK, api, doc: roster });
    assert.equal(edit.state.hasRecipe, false);
    assert.equal(edit.state.selections.homeworldRef, null, 'roster docs carry no origin');
    assert.ok(edit.state.characteristics.values.ws > 0, 'characteristics read from the doc');

    const before = structuredClone(edit.state.doc.xp.ledger);
    await edit.choose('homeWorld', { ref: 'dh2:home_world:hive_world' });
    const d = edit.state.doc;
    assert.equal(d.origin.homeworld.name, 'Hive World');
    assert.ok(d.aptitudes.some((a) => a.name === 'Perception' && a.source === 'homeworld'));
    assert.deepEqual(d.xp.ledger, before, 'delta mode never rewrites the ledger');
    assert.ok(d.characteristics.ws.advances !== undefined, 'existing stats untouched');
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

    // Equip Acolyte (core stage 4): kit-class guidance + RAW acquisition count
    const info = w.equipmentInfo();
    assert.equal(info.startingEquipmentClass, 'Outcast');
    assert.equal(info.acquisitions, 2);            // influence 22 → bonus 2
    await w.choose('equipment', { gear: [{ name: 'Rope', notes: '10m coil' }, { name: 'Glow-globe' }] });
    assert.deepEqual(w.state.doc.gear.map((g) => g.name), ['Rope', 'Glow-globe']);

    w.setDetails({ name: 'Fixture Acolyte' });
    const { doc, validation } = await w.finish();

    assert.equal(doc.name, 'Fixture Acolyte');
    assert.equal(doc.tarot.text, 'Trust in your fear.');
    assert.equal(w.state.step, 'done');

    // the creation RECIPE persisted for auditability + propagation (D-K)
    const audit = doc.extensions.builder.creation;
    assert.equal(audit.characteristics.method, 'manual');
    assert.equal(audit.selections.homeworldRef, 'dh2:home_world:feral_world');
    assert.equal(audit.woundsFate.woundsRoll, 5);
    assert.equal(audit.divination, 'Trust in your fear.');

    // every creation purchase carries its source note
    assert.ok(doc.xp.ledger.length >= 3);
    assert.ok(doc.xp.ledger.every((e) => e.source === 'Creation'), JSON.stringify(doc.xp.ledger));

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

test('wizard: buying the Psyker elite advance at creation applies its instant changes at 0 XP', async () => {
    const w = wizard(seqRng([9, 10]));
    await chooseOrigin(w);
    w.rollCharacteristics({ method: 'manual', values: { ...EXPECTED.characteristics, influence: EXPECTED.influence } });
    await w.choose('woundsFate');
    w.setDivination('The Warp whispers.');

    const advances = await w.advances();
    const psyker = advances.find((a) => a.kind === 'elite_advance' && a.name === 'Psyker');
    assert.ok(psyker, 'Psyker EA not offered');
    assert.equal(psyker.prereqsMet, true, 'WP 40 fixture meets the prerequisite');
    await w.buy(psyker);

    const d = w.state.doc;
    assert.equal(d.psy.rating, 1);
    assert.ok(d.traits.some((t) => (t.name ?? t) === 'Psyker'));
    assert.ok(d.aptitudes.some((a) => (a.name ?? a) === 'Psyker'));
    const grants = d.xp.ledger.filter((e) => e.source === 'Elite Advance: Psyker');
    assert.ok(grants.length >= 4, JSON.stringify(d.xp.ledger));
    assert.ok(grants.every((e) => e.cost === 0));
    assert.equal(d.xp.ledger.find((e) => e.name === 'Psyker' && e.kind === 'elite_advance').source, 'Creation');

    // …and the psyker-gated growth path is now open
    const after = await w.advances();
    assert.ok(after.some((a) => a.kind === 'psy_rating' && a.rank === 2 && a.cost === 400));
});

test('choice points PERSIST with their values, and changing the member rescinds its choices', async () => {
    const w = wizard();
    await chooseOrigin(w);                                   // roleTalent: Quick Draw

    // the resolved choice point is still listed, carrying its value
    const points = w.choicePoints();
    const rt = points.find((p) => p.key === 'roleTalent');
    assert.ok(rt, 'resolved choice point disappeared');
    assert.deepEqual(rt.options, ['Catfall', 'Quick Draw']);
    assert.equal(rt.value, 'Quick Draw');
    assert.equal(rt.member, 'roleRef');
    assert.ok(w.state.doc.talents.some((t) => t.name === 'Quick Draw'));

    // re-picking the SAME role's choice swaps the grant
    await w.choose('role', { choices: { roleTalent: 'Catfall' } });
    assert.ok(w.state.doc.talents.some((t) => t.name === 'Catfall'));
    assert.ok(!w.state.doc.talents.some((t) => t.name === 'Quick Draw'), 'old pick rescinded on re-choice');

    // changing the ROLE nullifies every choice attached to the previous role
    await w.choose('role', { ref: 'dh2:role:chirurgeon' });
    assert.equal(w.state.selections.choices.roleTalent, undefined, 'stale role choice not cleared');
    assert.ok(!w.state.doc.talents.some((t) => t.name === 'Catfall'), 'previous role talent rescinded');
    assert.ok(!w.choicePoints().some((p) => p.key === 'roleTalent' && p.value), 'no stale value shown');
});
