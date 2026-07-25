/**
 * Chargen data pack (Task CB-1): shape, dimensions, ref uniqueness, the D-H
 * prose denylist (this repo is PUBLIC — no rulebook prose may ship), and the
 * dispatch endpoint. The pack is GENERATED (npm run sync:chargen) and
 * committed; these tests gate what the generator may emit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARGEN_PACK } from '../data/chargen/pack.mjs';
import { dispatch } from '../lib/api-router.mjs';

const PROSE_DENYLIST = new Set([
    'benefit', 'description', 'concept', 'skill_use', 'askellon_example',
    '_source_quote', '_source_quote_hash', '_source_quote_hash_note',
    'instant_changes', 'equipment_grant', 'unlocked_talents_section',
    'worked_example', '_errata_note', 'descriptors', '_authored_by',
    '_source_correction_note', '_lookup_note', '_application_note',
]);

function walk(node, path, hit) {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, hit));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (PROSE_DENYLIST.has(k)) hit.push(`${path}.${k}`);
            walk(v, `${path}.${k}`, hit);
        }
    }
}

test('pack: no prose key anywhere (decision D-H — public repo)', () => {
    const hits = [];
    walk(CHARGEN_PACK, 'pack', hits);
    assert.deepEqual(hits, [], `prose leaked into the public pack: ${hits.join(', ')}`);
});

test('pack: catalog dimensions and required fields', () => {
    assert.equal(CHARGEN_PACK.packVersion, 1);
    assert.equal(CHARGEN_PACK.startingXp, 1000);
    assert.equal(CHARGEN_PACK.aptitudes.length, 19);            // 10 named + 9 characteristic-based
    assert.equal(Object.keys(CHARGEN_PACK.characteristicAptitudes).length, 9);
    for (const pair of Object.values(CHARGEN_PACK.characteristicAptitudes)) assert.equal(pair.length, 2);
    assert.equal(CHARGEN_PACK.talents.length, 85);
    assert.ok(CHARGEN_PACK.talents.every((t) => [1, 2, 3].includes(t.tier) && Array.isArray(t.aptitudes) && t.ref.startsWith('dh2:talent:')));
    assert.equal(CHARGEN_PACK.skills.length, 28);
    assert.ok(CHARGEN_PACK.skills.every((s) => s.characteristic && Array.isArray(s.aptitudes)));
    assert.equal(CHARGEN_PACK.homeworlds.length, 15);
    assert.ok(CHARGEN_PACK.homeworlds.every((h) => h.aptitude && h.woundsFormula));
    assert.equal(CHARGEN_PACK.backgrounds.length, 13);
    assert.equal(CHARGEN_PACK.roles.length, 11);
    assert.equal(CHARGEN_PACK.traits.length, 41);
    assert.ok(CHARGEN_PACK.eliteAdvances.length >= 4);
});

test('pack: cost matrices have the rulebook dimensions', () => {
    const c = CHARGEN_PACK.costs;
    assert.equal(c.characteristic.ranks.length, 5);             // Simple→Expert (Table 2-2)
    for (const band of ['matches_2', 'matches_1', 'matches_0']) {
        assert.equal(c.characteristic[band].length, 5, band);
        assert.equal(c.skill[band].length, 4, band);            // Known→Veteran (Table 2-4)
    }
    for (const tier of ['tier_1', 'tier_2', 'tier_3']) {
        for (const band of ['matches_2', 'matches_1', 'matches_0']) {
            assert.ok(Number.isInteger(c.talent[tier][band]), `${tier}.${band}`);
        }
    }
    // costs strictly increase as matches decrease (sanity vs transposition)
    assert.ok(c.characteristic.matches_0[0] > c.characteristic.matches_2[0]);
    assert.equal(c.psyRating.perRating, 200);
});

test('pack: refs are unique and slug-shaped', () => {
    const seen = new Set();
    for (const list of ['homeworlds', 'backgrounds', 'roles', 'talents', 'traits', 'skills', 'eliteAdvances']) {
        for (const e of CHARGEN_PACK[list]) {
            assert.match(e.ref, /^dh2:[a-z0-9_]+:[a-z0-9_]+$/, e.ref);
            assert.ok(!seen.has(e.ref), `duplicate ref ${e.ref}`);
            seen.add(e.ref);
            assert.ok(e._source?.startsWith('src_dh2_'), `${e.ref} missing provenance`);
        }
    }
});

test('GET /api/chargen/pack serves the pack through dispatch', async () => {
    const res = await dispatch('GET', '/api/chargen/pack');
    assert.equal(res.status, 200);
    assert.equal(res.body.packVersion, 1);
    assert.equal(res.body.talents.length, 85);
});
