/**
 * Fixes for three advancement defects reported in
 * monorepo docs/DH2_ROLL_API_FINDINGS_2026-07-30.md:
 *
 *  D-1  the chargen pack keys willpower "wil" (corpus vocabulary) while
 *       character documents key it "wp" — WIL advances were mispriced,
 *       uncapped and unbuyable (listAvailableAdvances offered what
 *       applyAdvance rejected with a 400).
 *  D-3  validateBuild built `expSkill` from typed skill ledger entries and
 *       never compared it, so skill drift was silently accepted.
 *  D-12 validateBuild built a `granted` set from the origin and never
 *       consulted it, so origin-granted talents warned forever.
 *
 * The characterisation tests that pinned the OLD behaviour live in
 * actor-advancement-coverage.test.mjs and were updated in the same change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCharacter } from '../lib/character-schema.mjs';
import { CHARGEN_PACK as PACK } from '../data/chargen/pack.mjs';
import {
    listAvailableAdvances, applyAdvance, applyOrigin, validateBuild, docCharKey,
} from '../lib/advancement.mjs';
import { dispatch } from '../lib/api-router.mjs';

/** Document characteristic keys — the authority the pack has to reconcile to. */
const DOC_CHAR_KEYS = ['ws', 'bs', 's', 't', 'ag', 'int', 'per', 'wp', 'fel'];

const mk = (aptitudes = [], xpTotal = 1000) => {
    const d = emptyCharacter('Adv Fix Test');
    d.aptitudes = aptitudes.map((name) => ({ name, source: 'extra' }));
    d.xp = { total: xpTotal, ledger: [] };
    return d;
};

// --- D-1 --------------------------------------------------------------------

test('D-1 (guard): EVERY pack characteristic key resolves to a document key', () => {
    // Re-sync safety net: pack.mjs is generated from the T1 corpus, so a future
    // sync could introduce another corpus-vs-document key divergence. This
    // fails the build if one appears, instead of silently mispricing advances.
    for (const packKey of Object.keys(PACK.characteristicAptitudes)) {
        assert.ok(DOC_CHAR_KEYS.includes(docCharKey(packKey)),
            `pack characteristic key "${packKey}" resolves to "${docCharKey(packKey)}", which is not a document key — add it to DOC_CHAR_KEY_BY_PACK_KEY in advancement.mjs`);
    }
    // and every document key is reachable (no characteristic silently unbuyable)
    const reachable = new Set(Object.keys(PACK.characteristicAptitudes).map(docCharKey));
    assert.deepEqual([...DOC_CHAR_KEYS].filter((k) => !reachable.has(k)), []);
    // the alias is a pass-through for keys that already agree
    assert.equal(docCharKey('ws'), 'ws');
    assert.equal(docCharKey('wp'), 'wp');
    assert.equal(docCharKey('wil'), 'wp');
});

test('D-1: a willpower advance is priced from the STORED wp advances, not from zero', () => {
    const d = mk(['Willpower', 'Psyker'], 5000);
    d.characteristics.wp = { base: 40, advances: 3, modifiers: [] };

    const list = listAvailableAdvances(d, PACK);
    const wp = list.find((a) => a.kind === 'characteristic' && a.ref === 'wp');
    assert.ok(wp, 'a willpower advance is offered under the DOCUMENT key');
    assert.ok(!list.some((a) => a.kind === 'characteristic' && a.ref === 'wil'),
        'the corpus key never leaks into the API surface');
    assert.equal(wp.rank, 4, 'the 3 stored advances are visible');
    assert.equal(wp.matches, 2, 'Willpower + Psyker both held');
    assert.equal(wp.cost, PACK.costs.characteristic.matches_2[3], 'priced as a 4th advance');
    assert.equal(wp.name, 'WP advance 4');
});

test('D-1: the 5-advance characteristic cap fires for willpower', () => {
    const d = mk(['Willpower'], 20000);
    d.characteristics.wp = { base: 40, advances: 5, modifiers: [] };
    const list = listAvailableAdvances(d, PACK);
    assert.ok(!list.some((a) => a.kind === 'characteristic' && (a.ref === 'wp' || a.ref === 'wil')),
        'a maxed characteristic is not offered again');
});

test('D-1: applyAdvance writes a willpower advance to doc.characteristics.wp', () => {
    const d = mk(['Willpower', 'Psyker'], 5000);
    d.characteristics.wp = { base: 40, advances: 3, modifiers: [] };
    const wp = listAvailableAdvances(d, PACK).find((a) => a.ref === 'wp');
    const { doc: next, entry } = applyAdvance(d, PACK, wp);
    assert.equal(next.characteristics.wp.advances, 4);
    assert.equal(entry.ref, 'wp');
    assert.equal(entry.rank, 4);
    assert.deepEqual(validateBuild(next, PACK), { ok: true, errors: [], warnings: [] },
        'the ledger entry reconciles against the doc it wrote');
});

test('D-1: applyAdvance still accepts the legacy corpus key "wil" (stored/older clients)', () => {
    const d = mk(['Willpower'], 5000);
    const wil = { kind: 'characteristic', ref: 'wil', name: 'WIL advance 1', rank: 1, matches: 1, cost: 250 };
    const { doc: next } = applyAdvance(d, PACK, wil);
    assert.equal(next.characteristics.wp.advances, 1, 'aliased onto the document key');
    assert.equal(next.characteristics.wil, undefined, 'no phantom "wil" characteristic is created');
});

test('D-1: validateBuild reconciles a legacy "wil" ledger ref against doc.characteristics.wp', () => {
    const d = mk([], 5000);
    d.characteristics.wp = { base: 40, advances: 2, modifiers: [] };
    d.xp.ledger = [
        { kind: 'characteristic', ref: 'wil', name: 'WIL advance 1', rank: 1, cost: 250 },
        { kind: 'characteristic', ref: 'wil', name: 'WIL advance 2', rank: 2, cost: 500 },
    ];
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });
    d.characteristics.wp.advances = 0;
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['characteristic wp: ledger implies 2 advances, doc has 0']);
});

test('D-1 (end to end): /api/chargen/advances offers a willpower advance /advance accepts', async () => {
    const doc = mk(['Willpower', 'Psyker'], 5000);
    doc.characteristics.wp = { base: 40, advances: 3, modifiers: [] };
    const list = await dispatch('POST', '/api/chargen/advances', { doc });
    assert.equal(list.status, 200);
    const wp = list.body.advances.find((a) => a.kind === 'characteristic' && a.ref === 'wp');
    assert.ok(wp, 'willpower is offered');
    const buy = await dispatch('POST', '/api/chargen/advance', { doc, advance: wp });
    assert.equal(buy.status, 200, `expected 200, got ${buy.status}: ${JSON.stringify(buy.body)}`);
    assert.equal(buy.body.doc.characteristics.wp.advances, 4);
    assert.equal(buy.body.xp.spent, PACK.costs.characteristic.matches_2[3]);
});

// --- D-3 --------------------------------------------------------------------

test('D-3: typed SKILL ledger drift is an error, matching the characteristic path', () => {
    const d = mk([], 2000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 1, cost: 300, date: '2026-01-01' },
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 2, cost: 600, date: '2026-01-02' },
    ];
    d.skills = { Dodge: { advances: 0 } };
    const r = validateBuild(d, PACK);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['skill Dodge: ledger implies 2 advances, doc has 0']);
});

test('D-3: a skill ledger that agrees with the doc reconciles clean', () => {
    const d = mk([], 2000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 1, cost: 300 },
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 2, cost: 600 },
    ];
    d.skills = { Dodge: { advances: 2 } };
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });
    // spelling-blind, exactly like skillTarget
    d.skills = { dodge: { advances: 2 } };
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });
});

test('D-3: specialist skills reconcile per SPECIALITY', () => {
    const d = mk([], 4000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:forbidden_lore', name: 'Forbidden Lore (Xenos)', rank: 1, cost: 300 },
        { kind: 'skill', ref: 'dh2:skill:forbidden_lore', name: 'Forbidden Lore (Xenos)', rank: 2, cost: 600 },
        { kind: 'skill', ref: 'dh2:skill:forbidden_lore', name: 'Forbidden Lore (Heresy)', rank: 1, cost: 300 },
    ];
    d.skills = { 'Forbidden Lore': { specialities: { Xenos: { advances: 2 }, Heresy: { advances: 1 } } } };
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });

    d.skills['Forbidden Lore'].specialities.Heresy.advances = 0;
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Forbidden Lore (Heresy): ledger implies 1 advances, doc has 0'],
        'one drifted speciality does not hide behind a healthy sibling');
});

test('D-3: applyAdvance writes a ledger entry that reconciles (incl. specialist skills)', () => {
    const d = mk([], 4000);
    const list = listAvailableAdvances(d, PACK);
    const dodge = list.find((a) => a.kind === 'skill' && a.name === 'Dodge');
    const { doc: d2 } = applyAdvance(d, PACK, dodge);
    assert.deepEqual(validateBuild(d2, PACK), { ok: true, errors: [], warnings: [] });

    const tmpl = list.find((a) => a.kind === 'skill' && a.name === 'Scholastic Lore (new speciality)');
    const { doc: d3, entry } = applyAdvance(d2, PACK, { ...tmpl, speciality: 'Occult' });
    assert.equal(entry.name, 'Scholastic Lore (Occult)',
        'the ledger records WHICH speciality was bought (was: "Scholastic Lore (new speciality)")');
    assert.equal(d3.skills['Scholastic Lore'].specialities.Occult.advances, 1);
    assert.deepEqual(validateBuild(d3, PACK), { ok: true, errors: [], warnings: [] });
});

test('D-3: an untyped ledger entry keeps skill drift a WARNING (legacy docs never error)', () => {
    const d = mk([], 2000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:dodge', name: 'Dodge', rank: 2, cost: 600 },
        { name: 'mystery import', cost: 0 },
    ];
    d.skills = { Dodge: { advances: 0 } };
    const r = validateBuild(d, PACK);
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, ['skill Dodge: ledger implies 2 advances, doc has 0']);
});

test('D-3: an unresolvable skill ledger entry is skipped, never a false error', () => {
    const d = mk([], 2000);
    d.xp.ledger = [{ kind: 'skill', ref: 'dh2:skill:xenoarchaeology', name: 'Xenoarchaeology', rank: 1, cost: 300 }];
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });

    // a nameless entry falls back to the pack ref…
    const byRef = mk([], 2000);
    byRef.xp.ledger = [{ kind: 'skill', ref: 'dh2:skill:dodge', rank: 1, cost: 300 }];
    assert.deepEqual(validateBuild(byRef, PACK).errors, ['skill Dodge: ledger implies 1 advances, doc has 0'],
        'and the doc slot it never wrote reads as 0 advances (no skills block at all)');
    // …and a nameless entry with an unknown ref resolves to nothing at all
    const nothing = mk([], 2000);
    nothing.xp.ledger = [{ kind: 'skill', ref: 'dh2:skill:nope', rank: 1, cost: 300 }];
    assert.deepEqual(validateBuild(nothing, PACK), { ok: true, errors: [], warnings: [] });
});

test('D-3: a specialist entry that names no speciality reconciles against the best one held', () => {
    // Ledgers written before applyAdvance recorded the speciality (and hand-made
    // imports) carry a bare "Common Lore". That addresses no single slot, so the
    // highest speciality advance held answers for it: drift still shows, a real
    // build never trips a false error.
    const d = mk([], 4000);
    d.xp.ledger = [
        { kind: 'skill', ref: 'dh2:skill:common_lore', name: 'Common Lore', rank: 1, cost: 300 },
        { kind: 'skill', ref: 'dh2:skill:common_lore', name: 'Common Lore', rank: 2, cost: 600 },
    ];
    d.skills = { 'Common Lore': { specialities: { Imperium: { advances: 2 }, Underworld: { advances: 1 } } } };
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });

    d.skills['Common Lore'].specialities.Imperium.advances = 1;      // the best held is now 1
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Common Lore: ledger implies 2 advances, doc has 1']);

    // the pre-fix "(new speciality)" placeholder is treated the same way
    d.xp.ledger[1].name = 'Common Lore (new speciality)';
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Common Lore: ledger implies 2 advances, doc has 1']);

    // a malformed speciality entry counts as 0, it does not crash the replay
    d.skills['Common Lore'].specialities.Underworld = null;
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Common Lore: ledger implies 2 advances, doc has 1']);

    // a specialist skill the doc has no entry for at all
    const none = mk([], 2000);
    none.xp.ledger = [{ kind: 'skill', ref: 'dh2:skill:common_lore', name: 'Common Lore', rank: 1, cost: 300 }];
    assert.deepEqual(validateBuild(none, PACK).errors,
        ['skill Common Lore: ledger implies 1 advances, doc has 0']);
});

test('D-3: a named speciality that the doc does not hold (or holds blank) reads as 0', () => {
    const d = mk([], 2000);
    d.xp.ledger = [{ kind: 'skill', ref: 'dh2:skill:trade', name: 'Trade (Armourer)', rank: 1, cost: 300 }];
    d.skills = { Trade: { specialities: { Voidfarer: { advances: 1 } } } };   // a different speciality
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Trade (Armourer): ledger implies 1 advances, doc has 0']);

    d.skills.Trade.specialities.Armourer = {};                                // present, advances absent
    assert.deepEqual(validateBuild(d, PACK).errors,
        ['skill Trade (Armourer): ledger implies 1 advances, doc has 0']);
});

// --- D-12 -------------------------------------------------------------------

test('D-12: talents granted by the recorded origin no longer warn', () => {
    const built = applyOrigin(emptyCharacter('Origin Grant'), PACK, {
        homeworldRef: 'dh2:home_world:feral_world',
        backgroundRef: 'dh2:background:outcast',
        roleRef: 'dh2:role:assassin',
        choices: { roleTalent: 'Leap Up' },
    }).doc;
    built.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    built.characteristics.ws.advances = 1;

    const r = validateBuild(built, PACK);
    assert.deepEqual(r.warnings, [], 'Leap Up came from the role — the grant is recorded, so it is not a mystery');
    assert.deepEqual(r.errors, []);
});

test('D-12: an elite-advance grant also satisfies the escape', () => {
    const d = mk([], 2000);
    d.origin.eliteAdvances = [{ name: 'Jaded', ref: 'dh2:elite:jaded', cost: 400 }];
    d.talents = [{ name: 'Jaded' }];
    d.xp.ledger = [{ kind: 'elite_advance', ref: 'dh2:elite:jaded', name: 'Jaded', cost: 400 }];
    assert.deepEqual(validateBuild(d, PACK), { ok: true, errors: [], warnings: [] });
});

test('D-12: origin members are matched by NAME when they carry no ref (migrated docs)', () => {
    const d = mk([], 2000);
    d.origin.background = { name: 'Outcast' };                    // v3→v4 migration keeps names only
    d.origin.role = { name: 'Assassin' };
    d.talents = [{ name: 'Enemy (chosen group)' }, { name: 'Jaded' }];
    d.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    d.characteristics.ws.advances = 1;
    assert.deepEqual(validateBuild(d, PACK).warnings, [],
        'Enemy from the background, Jaded from the role talent choice');

    // an origin naming something the pack does not know grants nothing
    const unknown = mk([], 2000);
    unknown.origin.background = { name: 'Nonexistent World' };
    unknown.origin.eliteAdvances = [{ name: '' }];                // malformed import: blank grant
    unknown.talents = [{ name: 'Jaded' }];
    unknown.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    unknown.characteristics.ws.advances = 1;
    assert.deepEqual(validateBuild(unknown, PACK).warnings,
        ['talent "Jaded" held without a ledger purchase (origin grant or import)']);
});

test('D-12: an "X or Y" grant covers either option, and Weapon Training by its base name', () => {
    const d = mk([], 2000);
    // dh2:background:adeptus_astra_telepathica-style grants read
    // "Weapon Training (Flame or Las, Chain)" — a held "Weapon Training (Las)"
    // must not be reported as a mystery holding.
    const bg = PACK.backgrounds.find((b) => b.talentsGranted.some((g) => /^Weapon Training/.test(g)));
    assert.ok(bg, 'the pack still carries a Weapon Training grant');
    d.origin.background = { ref: bg.ref, name: bg.name };
    d.talents = [{ name: 'Weapon Training (Las)' }];
    d.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    d.characteristics.ws.advances = 1;
    assert.deepEqual(validateBuild(d, PACK).warnings, []);
});

test('D-12: a pack talent with NO grant and NO purchase still warns, and never errors', () => {
    const d = mk([], 2000);
    d.xp.ledger = [{ kind: 'characteristic', ref: 'ws', name: 'WS advance 1', rank: 1, cost: 500 }];
    d.characteristics.ws.advances = 1;
    d.talents = [{ name: 'Jaded' }];
    const r = validateBuild(d, PACK);
    assert.equal(r.ok, true, 'held-without-purchase is a WARNING even for a fully-typed ledger');
    assert.deepEqual(r.warnings, ['talent "Jaded" held without a ledger purchase (origin grant or import)']);
    assert.deepEqual(r.errors, []);
});
