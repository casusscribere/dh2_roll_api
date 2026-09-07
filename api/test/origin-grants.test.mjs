/**
 * Origin grant expansion, validation, and ledgering (user request 2026-08-27,
 * items 2 + 4).
 *
 * expandGrant is the context-aware parser for the pack's grant strings:
 *   "Charm or Intimidate"                  → one choice of two skills
 *   "Operate (Aeronautica or Voidship)"    → "Operate (Aeronautica)" / "(Voidship)"
 *   "Weapon Training (Flame or Las, Chain)"→ grant "(Chain)" + choose Flame/Las
 *   "Enemy (chosen group)"                 → a WRITE-IN choice (placeholder)
 * Every resolved grant is validated against the pack (legal skills/talents,
 * specialist entries get real specializations) and LEDGERED at 0 XP with a
 * "Character creation: <member>" source — so origin acquisitions show in the
 * same audit trail as purchases, and the advance list can grey them out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    expandGrant, applyOrigin, listAvailableAdvances, replayPurchases,
} from '../lib/advancement.mjs';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { migrateCharacter } from '../lib/character-schema.mjs';

const bare = () => migrateCharacter({ schemaVersion: 4, kind: 'dh2.character', name: 'Origin Probe', system: 'dh2' });

/* ── expandGrant ────────────────────────────────────────────────────────── */

test('plain strings grant directly; plain "or" is one choice', () => {
    assert.deepEqual(expandGrant('Awareness'), { grants: ['Awareness'], choices: [] });
    const r = expandGrant('Charm or Intimidate');
    assert.deepEqual(r.grants, []);
    assert.deepEqual(r.choices[0].options, ['Charm', 'Intimidate']);
});

test('a paren "or" splits INSIDE the parentheses, context-aware', () => {
    const r = expandGrant('Operate (Aeronautica or Voidship)');
    assert.deepEqual(r.grants, []);
    assert.deepEqual(r.choices[0].options, ['Operate (Aeronautica)', 'Operate (Voidship)']);
});

test('compound paren grants: fixed segments grant, "or" segments choose', () => {
    const r = expandGrant('Weapon Training (Flame or Las, Chain)');
    assert.deepEqual(r.grants, ['Weapon Training (Chain)']);
    assert.equal(r.choices.length, 1);
    assert.deepEqual(r.choices[0].options, ['Weapon Training (Flame)', 'Weapon Training (Las)']);
});

test('placeholder specs ("chosen group", "one weapon group") become WRITE-IN choices', () => {
    for (const [text, base] of [['Enemy (chosen group)', 'Enemy'], ['Weapon Training (one weapon group)', 'Weapon Training']]) {
        const r = expandGrant(text);
        assert.deepEqual(r.grants, [], text);
        assert.equal(r.choices[0].options, null, `${text}: write-in has no fixed options`);
        assert.equal(r.choices[0].base, base);
    }
});

/* ── applyOrigin: validated grants, resolved via choices ────────────────── */

const NAVY = {
    homeworldRef: 'dh2:home_world:voidborn',
    backgroundRef: CHARGEN_PACK.backgrounds.find((b) => b.name === 'Imperial Navy').ref,
    roleRef: 'dh2:role:desperado',
};

test('the Imperial Navy Operate grant surfaces as two legal specialities, never a torn string', () => {
    const { choicesNeeded } = applyOrigin(bare(), CHARGEN_PACK, NAVY);
    const op = choicesNeeded.find((c) => /Operate/.test(c.key));
    assert.ok(op, 'Operate choice missing');
    assert.deepEqual(op.options, ['Operate (Aeronautica)', 'Operate (Voidship)']);
    assert.ok(!choicesNeeded.some((c) => /^Voidship\)/.test(c.key ?? '')), 'torn paren fragment leaked');
});

test('resolving the paren choice trains the REAL speciality and ledgers it at 0 XP', () => {
    const { doc, choicesNeeded } = applyOrigin(bare(), CHARGEN_PACK, {
        ...NAVY,
        choices: {
            'Operate (Aeronautica or Voidship)': 'Operate (Voidship)',
            'Command or Intimidate': 'Command',
            'Weapon Training (Chain or Shock)': 'Weapon Training (Shock)',
            roleTalent: 'Quick Draw',
        },
    });
    assert.equal(doc.skills.Operate.specialities.Voidship.advances, 1);
    assert.ok(doc.talents.some((t) => (t.name ?? t) === 'Weapon Training (Shock)'), 'chosen WT spec granted');
    assert.ok(doc.talents.some((t) => (t.name ?? t) === 'Weapon Training (Solid Projectile)'), 'fixed WT segment granted');
    const creation = doc.xp.ledger.filter((e) => /^Character creation:/.test(e.source ?? ''));
    assert.ok(creation.some((e) => e.name === 'Operate (Voidship)' && e.kind === 'skill' && e.cost === 0));
    assert.ok(creation.some((e) => e.name === 'Weapon Training (Solid Projectile)' && e.kind === 'talent' && e.cost === 0));
    assert.ok(creation.some((e) => e.name === 'Quick Draw' && e.source === 'Character creation: Desperado'));
    assert.deepEqual(choicesNeeded.filter((c) => /Operate|Command|Chain or Shock/.test(c.key ?? '')), [],
        'resolved choices do not linger');
});

test('a duplicate aptitude offers REAL replacement options instead of a dead end', () => {
    // Feral World grants Toughness; a role whose aptitudes include Toughness
    // forces the RAW "pick another" — previously an unresolvable dead end
    // that stuck the creation flow before the characteristics step.
    const withDup = {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: CHARGEN_PACK.roles.find((r) => r.roleAptitudes.some((a) => /^Toughness$/i.test(a)))?.ref,
    };
    if (!withDup.roleRef) return;                        // pack carries no such role — nothing to test
    const { choicesNeeded } = applyOrigin(bare(), CHARGEN_PACK, withDup);
    const dup = choicesNeeded.find((c) => c.kind === 'duplicate_aptitude');
    assert.ok(dup, 'duplicate not surfaced');
    assert.ok(Array.isArray(dup.options) && dup.options.length > 0, 'no replacement options offered');
    assert.ok(!dup.options.includes('Toughness'), 'the duplicate itself is not an option');
    assert.ok(dup.key, 'needs a stable key so the UI can resolve it');
});

test('applyOrigin returns engine-computed choicePoints with values (resolved ones included)', () => {
    const { choicePoints } = applyOrigin(bare(), CHARGEN_PACK, {
        ...NAVY, choices: { 'Command or Intimidate': 'Command', roleTalent: 'Quick Draw' },
    });
    assert.ok(Array.isArray(choicePoints));
    const cmd = choicePoints.find((p) => p.key === 'Command or Intimidate');
    assert.equal(cmd.value, 'Command');
    assert.equal(cmd.member, 'backgroundRef');
    const rt = choicePoints.find((p) => p.key === 'roleTalent');
    assert.deepEqual(rt.options, ['Catfall', 'Quick Draw']);
    assert.equal(rt.value, 'Quick Draw');
    const wt = choicePoints.find((p) => /Chain or Shock/.test(p.key));
    assert.deepEqual(wt.options, ['Weapon Training (Chain)', 'Weapon Training (Shock)']);
});

test('origin-grant ledger echoes are skipped on replay (the rebuild regenerates them)', () => {
    const sel = { ...NAVY, choices: { 'Operate (Aeronautica or Voidship)': 'Operate (Voidship)', 'Command or Intimidate': 'Command', 'Weapon Training (Chain or Shock)': 'Weapon Training (Shock)', roleTalent: 'Quick Draw' } };
    const { doc } = applyOrigin(bare(), CHARGEN_PACK, sel);
    const grantCount = doc.xp.ledger.length;
    assert.ok(grantCount >= 4, 'fixture assumption');
    const { doc: fresh } = applyOrigin(bare(), CHARGEN_PACK, sel);
    const { doc: replayed, conflicts } = replayPurchases(fresh, CHARGEN_PACK, doc.xp.ledger);
    assert.deepEqual(conflicts, []);
    assert.equal(replayed.xp.ledger.length, grantCount, 'creation grants neither doubled nor dropped');
});

/* ── held talents grey out instead of vanishing ─────────────────────────── */

test('listAvailableAdvances includeHeld lists held talents flagged, never buyable rows by default', () => {
    const { doc } = applyOrigin(bare(), CHARGEN_PACK, {
        ...NAVY, choices: { roleTalent: 'Quick Draw', 'Command or Intimidate': 'Command', 'Operate (Aeronautica or Voidship)': 'Operate (Voidship)', 'Weapon Training (Chain or Shock)': 'Weapon Training (Shock)' },
    });
    doc.characteristics = Object.fromEntries(['ws','bs','s','t','ag','int','per','wp','fel'].map((k)=>[k,{base:32,advances:0,modifiers:[]}]));
    const plain = listAvailableAdvances(doc, CHARGEN_PACK);
    assert.ok(!plain.some((a) => a.kind === 'talent' && a.name === 'Quick Draw'), 'default list unchanged');
    const withHeld = listAvailableAdvances(doc, CHARGEN_PACK, { includeHeld: true });
    const qd = withHeld.find((a) => a.kind === 'talent' && a.name === 'Quick Draw');
    assert.equal(qd?.held, true, 'held talent not flagged');
});
