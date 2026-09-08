/**
 * Table 2-9: Divinations (user request 2026-09-08 — "fill the gaps": the
 * wizard's Divination step goes data-driven).
 *
 * PACK: `pack.divinations` carries the 25 d100 rows as RANGES + CITATIONS
 * ONLY — the prophecy/effect text is rulebook expression and rides the
 * git-ignored prose overlay (D-N), keyed `dh2:divination:<lo>`.
 *
 * ENGINE: `applyDivination(doc, pack, { roll, choices, source })` applies the
 * row's MECHANICAL interpretation (api/data/chargen/divination-effects.mjs —
 * app-authored structured encodings, one per row): characteristic modifiers
 * by source, talent/skill grants at 0 XP with the already-holds fallback,
 * fate-threshold bump, disorder gain — and surfaces player choices
 * (+3 A or B, Resistance (Cold, Heat, or Fear)) as pending choices in the
 * same shape origin grants use. Session-conditional clauses stay in the book
 * (`manual: true` rows get the consult-the-book note only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyDivination, replayPurchases } from '../lib/advancement.mjs';
import { DIVINATION_EFFECTS } from '../data/chargen/divination-effects.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { migrateCharacter } from '../lib/character-schema.mjs';
import { dispatch } from '../lib/api-router.mjs';

const bare = () => {
    const doc = migrateCharacter({ schemaVersion: 4, kind: 'dh2.character', name: 'Div Probe', system: 'dh2' });
    doc.characteristics = Object.fromEntries(
        ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel']
            .map((k) => [k, { base: 30, advances: 0, modifiers: [] }]));
    doc.fate = { max: 2, current: 2 };
    return doc;
};

/* ── pack shape ─────────────────────────────────────────────────────────── */

test('pack.divinations: 25 rows, ranges tile 1-100, citations only — no prose', () => {
    const rows = CHARGEN_PACK.divinations;
    assert.equal(rows.length, 25);
    const covered = rows.flatMap((r) => {
        assert.match(r.ref, /^dh2:divination:\d+$/);
        assert.ok(r.citation?.book, `${r.ref} carries a citation`);
        assert.ok(!('prophecy' in r) && !('effect' in r) && !('text' in r),
            'rulebook text must not enter the public pack (D-N)');
        const [lo, hi] = r.range;
        return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    });
    assert.deepEqual([...covered].sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 1));
});

test('every pack row has a structured effect encoding, and no orphans', () => {
    const los = CHARGEN_PACK.divinations.map((r) => r.range[0]);
    for (const lo of los) assert.ok(DIVINATION_EFFECTS[lo], `effects missing for row ${lo}`);
    for (const k of Object.keys(DIVINATION_EFFECTS)) {
        assert.ok(los.includes(Number(k)), `orphan effect encoding for ${k}`);
    }
});

/* ── applyDivination ────────────────────────────────────────────────────── */

test('roll 3 ("Trust in your fear"): Perception +5 modifier, Phobia disorder, 0-XP ledger', () => {
    const { doc, entries } = applyDivination(bare(), CHARGEN_PACK, { roll: 3 });
    const mod = doc.characteristics.per.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    assert.equal(mod?.value, 5);
    assert.ok(doc.insanity.disorders.some((d) => /Phobia/.test(d.name ?? d)));
    assert.ok(entries.length >= 2);
    for (const e of entries) {
        assert.equal(e.cost, 0);
        assert.match(e.source, /^Divination \(Table 2-9, roll 3\)/);
    }
    assert.ok(doc.xp.ledger.length >= 2, 'entries land on the doc ledger');
});

test('roll 7 (Jaded row): grants the talent — or Willpower +2 when already held', () => {
    const { doc } = applyDivination(bare(), CHARGEN_PACK, { roll: 7 });
    assert.ok(doc.talents.some((t) => (t.name ?? t) === 'Jaded'));

    const held = bare();
    held.talents = [{ name: 'Jaded' }];
    const { doc: d2 } = applyDivination(held, CHARGEN_PACK, { roll: 7 });
    assert.equal(d2.talents.filter((t) => (t.name ?? t) === 'Jaded').length, 1, 'no duplicate grant');
    const mod = d2.characteristics.wp.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    assert.equal(mod?.value, 2, 'fallback applies instead');
});

test('roll 100: Fate threshold +1', () => {
    const { doc } = applyDivination(bare(), CHARGEN_PACK, { roll: 100 });
    assert.equal(doc.fate.max, 3);
    assert.equal(doc.fate.current, 3);
});

test('roll 20 (+3 Ag/Int, -3 WS/BS): both choices surface, resolving applies both', () => {
    const first = applyDivination(bare(), CHARGEN_PACK, { roll: 20 });
    assert.equal(first.pendingChoices.length, 2);
    for (const c of first.pendingChoices) {
        assert.ok(c.key, 'stable key');
        assert.ok(Array.isArray(c.options) && c.options.length === 2);
    }
    const [inc, dec] = first.pendingChoices;
    const { doc, pendingChoices } = applyDivination(bare(), CHARGEN_PACK, {
        roll: 20, choices: { [inc.key]: inc.options[0], [dec.key]: dec.options[1] },
    });
    assert.deepEqual(pendingChoices, []);
    const plus = doc.characteristics.ag.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    const minus = doc.characteristics.bs.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    assert.equal(plus?.value, 3);
    assert.equal(minus?.value, -3);
});

test('roll 78 (Resistance (Cold, Heat, or Fear)): specialist choice, resolved grant is the real spec', () => {
    const first = applyDivination(bare(), CHARGEN_PACK, { roll: 78 });
    const c = first.pendingChoices.find((x) => /Resistance/.test(x.key));
    assert.deepEqual(c.options, ['Resistance (Cold)', 'Resistance (Heat)', 'Resistance (Fear)']);
    const { doc } = applyDivination(bare(), CHARGEN_PACK, {
        roll: 78, choices: { [c.key]: 'Resistance (Cold)' },
    });
    assert.ok(doc.talents.some((t) => (t.name ?? t) === 'Resistance (Cold)'));
});

test('roll 90 (Dodge as Known skill): rank-1 grant — or Agility +2 when already known', () => {
    const { doc } = applyDivination(bare(), CHARGEN_PACK, { roll: 90 });
    assert.equal(doc.skills.Dodge.advances, 1);

    const held = bare();
    held.skills = { Dodge: { advances: 2, modifiers: [] } };
    const { doc: d2 } = applyDivination(held, CHARGEN_PACK, { roll: 90 });
    assert.equal(d2.skills.Dodge.advances, 2, 'existing rank untouched');
    const mod = d2.characteristics.ag.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    assert.equal(mod?.value, 2);
});

test('a session-conditional row applies its unconditional part and marks the rest manual', () => {
    // roll 12 (10-13): Agility -3 is unconditional; the crit-immunity clause is
    // a per-session rule the engine cannot track — consult-the-book note only.
    const { doc, manual } = applyDivination(bare(), CHARGEN_PACK, { roll: 12 });
    const mod = doc.characteristics.ag.modifiers.find((m) => /divination/i.test(m.source ?? ''));
    assert.equal(mod?.value, -3);
    assert.equal(manual, true);
});

test('an out-of-range or missing roll throws', () => {
    assert.throws(() => applyDivination(bare(), CHARGEN_PACK, { roll: 0 }), /roll/i);
    assert.throws(() => applyDivination(bare(), CHARGEN_PACK, {}), /roll/i);
});

/* ── replay: divination echoes regenerate, never double ─────────────────── */

test('replayPurchases skips 0-cost Divination-sourced entries (the rebuild re-applies them)', () => {
    const { doc } = applyDivination(bare(), CHARGEN_PACK, { roll: 7 });
    const n = doc.xp.ledger.length;
    assert.ok(n >= 1);
    const { doc: replayed, conflicts } = replayPurchases(bare(), CHARGEN_PACK, doc.xp.ledger);
    assert.deepEqual(conflicts, []);
    assert.equal((replayed.xp?.ledger ?? []).length, 0, 'echoes skipped — regenerated by the recipe, not the replay');
});

/* ── wizard integration (headless, real dispatch) ───────────────────────── */

const { createWizard, parseKitItem } = await import('../../ui/builder-core.mjs');
const wizApi = async (method, path, body) => {
    const r = dispatch(method, path, body);
    if (r.status >= 400) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
    return r.body;
};
/** rng: two midpoint draws feed the woundsFate d5/d10 first, then the given
 *  d100 divination rolls, then midpoints. */
const rollRng = (rolls) => {
    const seq = [0.45, 0.45, ...rolls.map((r) => (r - 0.5) / 100)];
    let i = 0;
    return () => (i < seq.length ? seq[i++] : 0.45);
};

async function wizardAtDivination(rng) {
    const wiz = createWizard({ pack: CHARGEN_PACK, api: wizApi, rng });
    await wiz.choose('homeWorld', { ref: 'dh2:home_world:feral_world' });
    await wiz.choose('background', { ref: 'dh2:background:outcast' });
    await wiz.choose('role', { ref: 'dh2:role:desperado', choices: { roleTalent: 'Quick Draw', 'Enemy (chosen group)': 'Enforcers' } });
    wiz.rollCharacteristics({ method: 'manual', values: Object.fromEntries([...['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'].map((k) => [k, 32]), ['influence', 30]]) });
    await wiz.choose('woundsFate');
    return wiz;
}

test('wizard rollDivination: recorded roll, engine-applied effects, tarot text, ledger sources', async () => {
    const wiz = await wizardAtDivination(rollRng([3]));       // d100 → 3 ("Trust in your fear")
    await wiz.rollDivination();
    assert.deepEqual(wiz.state.divinationRoll, { roll: 3, choices: {} });
    assert.match(wiz.state.doc.tarot.text, /Table 2-9 roll 3/);
    assert.ok(wiz.state.doc.characteristics.per.modifiers.some((m) => m.value === 5));
    assert.ok(wiz.state.doc.xp.ledger.some((e) => /^Divination \(Table 2-9, roll 3\)/.test(e.source)));
});

test('wizard re-roll REPLACES the old row — modifiers never stack', async () => {
    const wiz = await wizardAtDivination(rollRng([3, 100]));
    await wiz.rollDivination();
    await wiz.rollDivination({ override: false });
    assert.equal(wiz.state.divinationRoll.roll, 100);
    assert.ok(!wiz.state.doc.characteristics.per.modifiers.some((m) => /divination/i.test(m.source ?? '')),
        'roll-3 Perception modifier gone after re-roll');
    assert.ok(wiz.state.doc.fate.max >= 2, 'roll-100 fate bump applied on the rebuilt doc');
});

test('wizard divination choices resolve through rebuild (recipe path)', async () => {
    const wiz = await wizardAtDivination(rollRng([20]));      // 18-21: two characteristic choices
    await wiz.rollDivination();
    assert.equal(wiz.state.divinationPending.length, 2);
    const [inc, dec] = wiz.state.divinationPending;
    await wiz.setDivinationChoice(inc.key, inc.options[0]);
    await wiz.setDivinationChoice(dec.key, dec.options[1]);
    assert.deepEqual(wiz.state.divinationPending, []);
    const mods = Object.values(wiz.state.doc.characteristics)
        .flatMap((c) => c.modifiers ?? []).filter((m) => /divination/i.test(m.source ?? ''));
    assert.deepEqual(mods.map((m) => m.value).sort((a, b) => a - b), [-3, 3], 'exactly one +3 and one -3');
});

test('the recipe persists the divination roll and a reload re-applies it', async () => {
    const wiz = await wizardAtDivination(rollRng([100]));
    await wiz.rollDivination();
    const saved = structuredClone(wiz.state.doc);
    const fateBefore = saved.fate.max;
    const wiz2 = createWizard({ pack: CHARGEN_PACK, api: wizApi, rng: rollRng([]), doc: saved });
    assert.deepEqual(wiz2.state.divinationRoll, { roll: 100, choices: {} });
    assert.equal(wiz2.state.doc.fate.max, fateBefore, 'no re-application on load — doc already carries it');
});

/* ── kit parsing + equip step ───────────────────────────────────────────── */

test('parseKitItem: plain, plain-or, and "(or A and B)" bundles', () => {
    assert.deepEqual(parseKitItem('manacles').options, [{ label: 'manacles', items: ['manacles'] }]);
    assert.deepEqual(parseKitItem('Shotgun or shock maul').options.map((o) => o.items), [['Shotgun'], ['shock maul']]);
    assert.deepEqual(parseKitItem('Lasgun (or laspistol and sword)').options.map((o) => o.items),
        [['Lasgun'], ['laspistol', 'sword']]);
    assert.deepEqual(parseKitItem('monotask servo-skull (utility) or optical mechadendrite').options.map((o) => o.label),
        ['monotask servo-skull (utility)', 'optical mechadendrite']);
});

test('equipmentInfo surfaces the corpus kit; applying it lands gear + kitApplied', async () => {
    const wiz = await wizardAtDivination(rollRng([100]));
    const info = wiz.equipmentInfo();
    assert.ok(info.kit.length >= 4, 'Outcast kit present');
    assert.ok(info.kit.some((k) => /chainsword/.test(k.text)));
    assert.equal(info.kitApplied, false);
    const gear = info.kit.map((k) => k.options[0].items).flat().map((name) => ({ name, notes: 'starting kit' }));
    await wiz.choose('equipment', { gear, kit: true });
    assert.equal(wiz.equipmentInfo().kitApplied, true);
    assert.ok(wiz.state.doc.gear.some((g) => g.name === 'chainsword'));
    // the kit survives a rebuild (origin re-derivation keeps added gear)
    await wiz.choose('homeWorld', { ref: 'dh2:home_world:hive_world' });
    assert.ok(wiz.state.doc.gear.some((g) => g.name === 'chainsword'), 'gear survives origin change');
});

/* ── route ──────────────────────────────────────────────────────────────── */

test('POST /api/chargen/divination applies a roll and returns row identity + citation', () => {
    const r = dispatch('POST', '/api/chargen/divination', { doc: bare(), roll: 3 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.range, [2, 5]);
    assert.equal(r.body.ref, 'dh2:divination:2');
    assert.ok(r.body.citation?.book);
    assert.ok(r.body.doc.characteristics.per.modifiers.some((m) => m.value === 5));
    assert.ok(Array.isArray(r.body.entries));
});
