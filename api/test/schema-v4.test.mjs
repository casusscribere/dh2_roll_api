/**
 * Character schema v4: origin (refs-capable), influence, weapon trainings,
 * cybernetics, extensions (opaque namespaces), the privacy-guarded player
 * field, plus the BUILDER ADDENDUM (docs/CHARACTER_BUILDER_PLAN_2026-07-24.md
 * Part 2.2): typed XP-ledger entries (kind/ref/rank/matches) and uniform
 * { name, ref?, dsl? } talent/trait/psychic-power entries. Includes the v3→v4
 * migration, the Foundry-actor v4 mappings, and the roster regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_SCHEMA_VERSION, emptyCharacter, validateCharacter, migrateCharacter,
    characterToCombatant,
} from '../lib/character-schema.mjs';
import { characterToFoundryActor } from '../lib/foundry-actor.mjs';
import { CHARACTER_ROSTER } from '../data/characters/roster.mjs';

test('v4: empty character is a valid v4 document with the new defaults', () => {
    assert.equal(CHARACTER_SCHEMA_VERSION, 4);
    const doc = emptyCharacter();
    const r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(doc.origin, { homeworld: null, background: null, role: null, eliteAdvances: [] });
    assert.equal(doc.influence, 0);
    assert.deepEqual(doc.weaponTrainings, []);
    assert.deepEqual(doc.cybernetics, []);
    assert.deepEqual(doc.extensions, {});
});

test('v4 migration: v3 docs gain additive defaults; v1 docs migrate all the way', () => {
    const v3 = { ...emptyCharacter(), schemaVersion: 3 };
    delete v3.origin; delete v3.influence; delete v3.weaponTrainings; delete v3.cybernetics; delete v3.extensions;
    const d = migrateCharacter(v3);
    assert.equal(d.schemaVersion, 4);
    assert.deepEqual(d.origin, { homeworld: null, background: null, role: null, eliteAdvances: [] });
    assert.equal(d.influence, 0);
    assert.deepEqual(d.cybernetics, []);
    assert.ok(validateCharacter(d).ok);

    const v1 = { schemaVersion: 1, kind: 'dh2.character', name: 'Old', characteristics: { ws: 30, bs: 30, s: 30, t: 30, ag: 30, int: 30, per: 30, wp: 30, fel: 30 } };
    const m = migrateCharacter(v1);
    assert.equal(m.schemaVersion, 4);
    assert.deepEqual(m.weaponTrainings, []);
    assert.ok(validateCharacter(m).ok);
});

test('v4 migration: string origin members normalize to { name }; aptitude sources normalize casing', () => {
    const v3 = { ...emptyCharacter(), schemaVersion: 3 };
    v3.origin = { homeworld: 'Feral World', background: { name: 'Outcast', ref: 'dh2:background:outcast' }, role: 'Assassin' };
    v3.aptitudes = [{ name: 'Toughness', source: 'Homeworld' }, { name: 'Knowledge', source: 'BG' }, { name: 'Fieldcraft', source: 'Role' }, 'General'];
    const d = migrateCharacter(v3);
    assert.deepEqual(d.origin.homeworld, { name: 'Feral World' });
    assert.deepEqual(d.origin.background, { name: 'Outcast', ref: 'dh2:background:outcast' });
    assert.deepEqual(d.origin.role, { name: 'Assassin' });
    assert.deepEqual(d.origin.eliteAdvances, []);
    assert.equal(d.aptitudes[0].source, 'homeworld');
    assert.equal(d.aptitudes[1].source, 'background');
    assert.equal(d.aptitudes[2].source, 'role');
    assert.equal(d.aptitudes[3], 'General');           // bare strings untouched
    assert.ok(validateCharacter(d).ok, JSON.stringify(validateCharacter(d).errors));
});

test('v4 validation: origin / influence / weaponTrainings / cybernetics shapes', () => {
    const doc = emptyCharacter();
    doc.origin = { homeworld: { name: 'Hive World' }, background: null, role: 42, eliteAdvances: [{ name: 'Psyker', ref: 'dh2:elite_advance:psyker', cost: 300 }, 7] };
    doc.influence = -3;
    doc.weaponTrainings = ['Bolt', 9];
    doc.cybernetics = ['Mind Impulse Unit', { name: 'Bionic Eyes', location: 'head', notes: 'Good craftsmanship' }, 12];
    const r = validateCharacter(doc);
    const paths = r.errors.map((e) => e.path);
    for (const p of ['origin.role', 'origin.eliteAdvances[1]', 'influence', 'weaponTrainings[1]', 'cybernetics[2]']) {
        assert.ok(paths.includes(p), `expected error at ${p}: ${JSON.stringify(paths)}`);
    }
    assert.ok(!paths.includes('origin.homeworld'), 'object member fine');
    assert.ok(!paths.includes('origin.background'), 'null member fine');
    assert.ok(!paths.includes('cybernetics[0]'), 'string cybernetic fine');
});

test('v4 builder addendum: typed ledger entries validate; bad kind warns; bad rank/matches error', () => {
    const doc = emptyCharacter();
    doc.xp = {
        total: 1000,
        ledger: [
            { name: 'Mighty Shot', cost: 600, kind: 'talent', ref: 'dh2:talent:mighty_shot', matches: 2 },
            { name: 'WS advance 1', cost: 250, kind: 'characteristic', ref: 'ws', rank: 1, matches: 1 },
            { name: 'Legacy entry', cost: 100 },                       // untyped stays valid
        ],
    };
    let r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));

    doc.xp.ledger.push({ name: 'Odd', cost: 100, kind: 'mystery' });   // unknown kind → warning
    r = validateCharacter(doc);
    assert.ok(r.ok, 'unknown kind must not error');
    assert.ok(r.warnings.some((w) => w.path === 'xp.ledger[3].kind'), JSON.stringify(r.warnings));

    doc.xp.ledger.push({ name: 'Bad', cost: 100, kind: 'skill', rank: 0, matches: 5 });
    r = validateCharacter(doc);
    const paths = r.errors.map((e) => e.path);
    assert.ok(paths.includes('xp.ledger[4].rank'), JSON.stringify(paths));
    assert.ok(paths.includes('xp.ledger[4].matches'), JSON.stringify(paths));
});

test('v4 builder addendum: talent/trait/psychicPower entries accept { name, ref?, dsl? }', () => {
    const doc = emptyCharacter();
    doc.talents = [
        'Jaded',
        { name: 'Custom Deadeye', ref: 'dh2:talent:custom_deadeye', dsl: 'talent "Custom Deadeye" { on test.MODIFIERS when is_test("BS") then add modifier "deadeye" = 10 }' },
    ];
    doc.traits = [{ name: 'Custom Grit', dsl: 'trait "Custom Grit" { on test.MODIFIERS when is_test("T") then add modifier "grit" = 10 }' }];
    doc.psychicPowers = [{ name: 'Custom Bolt', ref: 'dh2:psychic_power:custom_bolt' }];
    let r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));

    doc.talents.push({ name: 'Bad DSL', dsl: 42 });
    doc.traits.push({ name: 'Bad Ref', ref: 7 });
    r = validateCharacter(doc);
    const paths = r.errors.map((e) => e.path);
    assert.ok(paths.includes('talents[2].dsl'), JSON.stringify(paths));
    assert.ok(paths.includes('traits[1].ref'), JSON.stringify(paths));
    // malformed ref pattern is a warning, not an error (other systems may prefix differently)
    doc.talents.pop();                                             // drop the bad-dsl entry
    doc.traits[1] = { name: 'Odd Ref', ref: 'not a ref' };
    r = validateCharacter(doc);
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.ok(r.warnings.some((w) => w.path === 'traits[1].ref'), JSON.stringify(r.warnings));
});

test('v4 privacy guard: player field warns unless allowPlayer', () => {
    const doc = emptyCharacter();
    doc.player = 'A. Person';
    let r = validateCharacter(doc);
    assert.ok(r.ok);
    assert.ok(r.warnings.some((w) => w.path === 'player'), JSON.stringify(r.warnings));
    r = validateCharacter(doc, { allowPlayer: true });
    assert.ok(!r.warnings.some((w) => w.path === 'player'));
});

test('v4 extensions: opaque namespaces pass through migration and validation untouched', () => {
    const v3 = { ...emptyCharacter(), schemaVersion: 3, extensions: { 'dramatic-moments': { pool: 3, notes: ['spent one'] } } };
    const d = migrateCharacter(v3);
    assert.deepEqual(d.extensions['dramatic-moments'], { pool: 3, notes: ['spent one'] });
    assert.ok(validateCharacter(d).ok);
    d.extensions = 'nope';
    assert.ok(!validateCharacter(d).ok);
});

test('v4 foundry mapping: origin→bio, influence→characteristic, trainings→talent items, cybernetics→items, extensions→flags', () => {
    const doc = emptyCharacter('Interop Test');
    doc.origin = { homeworld: { name: 'Feral World', ref: 'dh2:home_world:feral_world' }, background: { name: 'Outcast' }, role: { name: 'Assassin' }, eliteAdvances: [{ name: 'Psyker', cost: 300 }] };
    doc.influence = 27;
    doc.weaponTrainings = ['Bolt', 'Las'];
    doc.cybernetics = [{ name: 'Bionic Eyes', location: 'head', notes: 'Good' }];
    doc.extensions = { 'dramatic-moments': { pool: 2 } };
    doc.talents = [{ name: 'Custom Deadeye', ref: 'dh2:talent:custom_deadeye', dsl: 'talent "Custom Deadeye" { on test.MODIFIERS then add modifier "x" = 10 }' }];
    doc.xp = { total: 1000, ledger: [{ name: 'Custom Deadeye', cost: 300, kind: 'talent', ref: 'dh2:talent:custom_deadeye', matches: 2 }] };

    const actor = characterToFoundryActor(doc);
    assert.equal(actor.system.bio.homeWorld, 'Feral World');
    assert.equal(actor.system.bio.background, 'Outcast');
    assert.equal(actor.system.bio.role, 'Assassin');
    assert.equal(actor.system.bio.elite, 'Psyker');
    assert.equal(actor.system.characteristics.influence.base, 27);
    const trainings = actor.items.filter((i) => i.type === 'talent' && /^Weapon Training \(/.test(i.name));
    assert.deepEqual(trainings.map((i) => i.name).sort(), ['Weapon Training (Bolt)', 'Weapon Training (Las)']);
    const cyber = actor.items.find((i) => i.type === 'cybernetic');
    assert.equal(cyber.name, 'Bionic Eyes');
    assert.equal(actor.flags['dh2-roll-vm'].extensions['dramatic-moments'].pool, 2);
    assert.deepEqual(actor.flags['dh2-roll-vm'].origin, doc.origin);
    const talent = actor.items.find((i) => i.type === 'talent' && i.name === 'Custom Deadeye');
    assert.equal(talent.flags['dh2-roll-vm'].ref, 'dh2:talent:custom_deadeye');
    assert.ok(typeof talent.flags['dh2-roll-vm'].dsl === 'string');
    // typed ledger fields ride the flags verbatim
    assert.equal(actor.flags['dh2-roll-vm'].xpLedger[0].kind, 'talent');
    assert.equal(actor.flags['dh2-roll-vm'].xpLedger[0].matches, 2);
});

test('v4 combatant mapping still resolves object-form talents by name', () => {
    const doc = emptyCharacter();
    doc.talents = [{ name: 'Iron Jaw', ref: 'dh2:talent:iron_jaw' }];
    const c = characterToCombatant(doc);
    // canonList canonicalizes entries to { name, level } — the engine's
    // has_talent matching reads entryName, so the name must survive.
    assert.ok(c.talents.some((t) => (t && typeof t === 'object' ? t.name : t) === 'Iron Jaw'), JSON.stringify(c.talents));
});

test('v4 JSON Schema artifact: generated shape is sane and the committed file is fresh', async () => {
    const { buildJsonSchema } = await import('../../tools/generate-json-schema.mjs');
    const { readFileSync } = await import('fs');
    const schema = buildJsonSchema();
    assert.equal(schema['x-schema-version'], CHARACTER_SCHEMA_VERSION);
    assert.deepEqual([...schema.required].sort(), ['characteristics', 'kind', 'name', 'schemaVersion']);
    assert.equal(schema.properties.influence.type, 'integer');
    assert.ok(schema.properties.characteristics.properties.ws, 'characteristic keys enumerated');
    assert.ok(schema.properties.origin.properties.eliteAdvances, 'origin subtree present');
    const ledger = schema.properties.xp.properties.ledger.items;
    assert.ok(ledger.properties.kind && ledger.properties.matches, 'typed ledger fields present');
    const talentItems = schema.properties.talents.items;
    assert.ok(talentItems.anyOf?.some((b) => b.type === 'string'), 'talent entries may be strings');
    assert.ok(talentItems.anyOf?.some((b) => b.properties?.ref && b.properties?.dsl), 'talent object branch has ref/dsl');
    // drift guard: the committed artifact must match a fresh build
    const committed = JSON.parse(readFileSync(new URL(`../../docs/character.schema.v${CHARACTER_SCHEMA_VERSION}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(committed, schema, 'docs/character.schema.v4.json is stale — run npm run schema:json');
});

test('v4 roster regression: every roster doc migrates to v4 and validates cleanly', () => {
    for (const { id, doc } of CHARACTER_ROSTER) {
        const d = migrateCharacter(doc);
        assert.equal(d.schemaVersion, 4, id);
        const r = validateCharacter(d, { allowPlayer: true });
        assert.ok(r.ok, `${id}: ${JSON.stringify(r.errors)}`);
    }
});
