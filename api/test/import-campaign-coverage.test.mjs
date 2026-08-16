/**
 * tools/import-campaign.mjs — coverage extension (companion to
 * import-campaign.test.mjs, which owns the v4 CREATION/TRAINING/CYBERNETICS
 * blocks). This file drives the parser paths that file leaves cold:
 *
 *   - the SKILLS table (plain rows, Misc modifiers, characteristic override,
 *     "Trade: Linguist" colon-specialities, group headers + speciality rows,
 *     rank clamping, placeholder/unknown rows)
 *   - the speciality SIDE TABLES ("<Specialist> | Ranks") and their
 *     don't-overwrite-the-main-table rule
 *   - the ARMAMENTS blocks (parseWeaponBlock: ranged/melee, damage types,
 *     craftsmanship, RoF/clip, and the three ways a block is rejected)
 *   - the EQUIPMENT / Stored Inventory gear blocks (weight column, per-unit
 *     weight from a leading quantity, ALL-CAPS section break, no weight column)
 *   - PSY POWERS, SHIELDING, the Unnatural column, pools, the XP-spending
 *     ledger tab, and the filename-derived name fallback
 *   - loadWorkbook/parseSheet and the CLI main() block, via a --dry run
 *
 * The CLI runs FIRST, at module load, on the SAME module instance the grid
 * tests use: main() is guarded by `process.argv[1] === this file`, so it can
 * only be triggered on a fresh instance, and `node --test`'s coverage report
 * keys a file by path with the last-loaded instance winning — a cache-busted
 * second copy would silently discard the grid tests' coverage.
 *
 * All grid fixtures are synthetic. The only filesystem contact is the CLI run,
 * which is read-only and passes --dry so nothing is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const IMPORTER = join(REPO, 'tools', 'import-campaign.mjs');
const ROSTER = join(REPO, 'api', 'data', 'characters', 'roster.mjs');

// --- CLI main(), run once at load on the instance the tests below share -----
const rosterBefore = existsSync(ROSTER) ? statSync(ROSTER) : null;
const cliLines = [];
const importer = await (async () => {
    const savedArgv = process.argv;
    const savedLog = console.log;
    const savedWarn = console.warn;
    try {
        process.argv = [savedArgv[0], IMPORTER, '--dry'];
        console.log = (...a) => cliLines.push(a.join(' '));
        console.warn = (...a) => cliLines.push(a.join(' '));
        return await import('../../tools/import-campaign.mjs');
    } finally {
        process.argv = savedArgv;
        console.log = savedLog;
        console.warn = savedWarn;
    }
})();
const { parseGrids } = importer;

// ---------------------------------------------------------------------------
// Fixture A — a "full" sheet exercising every anchored block at once.
// ---------------------------------------------------------------------------

/** Character Sheet grid with characteristics/unnatural, pools, shielding,
 *  four ARMAMENTS blocks (three of which must be rejected), EQUIPMENT,
 *  PSY POWERS, named sections, two speciality side tables, a SKILLS table
 *  and the v4 CREATION / TRAINING / CYBERNETICS / DRAMATIC MOMENTS blocks. */
function fullSheet() {
    return [
        /*  0 */ ['[Name]'],                                   // → filename fallback
        /*  1 */ [],
        /*  2 */ ['CHARACTERISTICS:'],
        /*  3 */ ['Type', 'Score', 'TypeAlpha', 'Upgrades', 'Unnatural'],
        /*  4 */ ['Weapon Skill', '45', 'Weapon Skill', '1', '2'],
        /*  5 */ ['Ballistic Skill', '40', 'Ballistic Skill', '2', ''],
        /*  6 */ ['Intelligence', '38', 'Intelligence', '0', '3'],   // unnatural int → unmapped
        /*  7 */ ['Insanity', '12'],
        /*  8 */ ['Corruption', '5'],
        /*  9 */ [],
        /* 10 */ ['STATS'],
        /* 11 */ ['Wounds', '9', '14'],
        /* 12 */ ['Fate Points', '2', '3'],
        /* 13 */ ['Fatigue', '1', ''],
        /* 14 */ ['Psy Rating', '3', ''],
        /* 15 */ ['Armor', '5'],
        /* 16 */ [],
        /* 17 */ ['SHIELDING'],
        /* 18 */ ['', '6'],                                     // rating in the 2nd column
        /* 19 */ [],
        /* 20 */ ['ARMAMENTS'],
        /* 21 */ ['Name:'],
        /* 22 */ ['Hellgun'],
        /* 23 */ ['Quality', 'RoF', 'Range'],
        /* 24 */ ['Good', 'S/3/10', '100m'],
        /* 25 */ ['Damage', 'Pen', 'Clip'],
        /* 26 */ ['1d10+4 E', '4', '40'],
        /* 27 */ ['Special'],
        /* 28 */ ['Reliable, Accurate, -'],                     // the "-" filler is dropped
        /* 29 */ [],
        /* 30 */ ['Name:'],
        /* 31 */ ['Chainsword'],
        /* 32 */ ['Quality', 'RoF', 'Range'],
        /* 33 */ ['Best', '-', '-'],                            // no digits in RoF → melee
        /* 34 */ ['Damage', 'Pen', 'Clip'],
        /* 35 */ ['1 d 10 + 2 R', '2', '5'],                    // spaced formula; stray Clip value
        /* 36 */ ['Special'],
        /* 37 */ ['Tearing'],
        /* 38 */ [],
        /* 39 */ ['Name:'],
        /* 40 */ [''],                                          // blank name cell
        /* 41 */ ['', 'Quality'],
        /* 42 */ ['Quality', 'RoF'],                            // Quality one row further down
        /* 43 */ ['Poor', '-/-/6'],
        /* 44 */ [''],
        /* 45 */ ['Damage', 'Pen', 'Clip'],                     // Damage one row further down
        /* 46 */ ['2d10 X', '0', '1'],
        /* 47 */ [],
        /* 48 */ ['Name:'],
        /* 49 */ ['Broken Block'],
        /* 50 */ ['NotQuality'],                                // no Quality row → rejected
        /* 51 */ [],
        /* 52 */ ['Name:'],
        /* 53 */ ['No Damage Row'],
        /* 54 */ ['Quality', 'RoF'],
        /* 55 */ ['Normal', '3'],
        /* 56 */ ['Nothing'],                                   // no Damage row → rejected
        /* 57 */ [],
        /* 58 */ ['Name:'],
        /* 59 */ ['Placeholder Gun'],
        /* 60 */ ['Quality', 'RoF'],
        /* 61 */ ['Common', 'S/-/-'],
        /* 62 */ ['Damage', 'Pen', 'Clip'],
        /* 63 */ ['—', '', ''],                                 // no damage formula → rejected
        /* 64 */ [],
        /* 65 */ ['EQUIPMENT'],
        /* 66 */ ['Item', 'Weight'],
        /* 67 */ ['3 Smoke Grenades', '1.5'],                   // row total → per-unit weight
        /* 68 */ ['Flak Cloak', '2 kg'],
        /* 69 */ [''],                                          // a single blank does not end it
        /* 70 */ ['Rebreather', ''],
        /* 71 */ ['MEDICAE SUPPLIES', ''],                      // ALL-CAPS → section break
        /* 72 */ [],
        /* 73 */ ['PSY POWERS'],
        /* 74 */ ['Power', 'Tree', 'Notes'],
        /* 75 */ ['Telepathic Link', 'Telepathy', 'free action'],
        /* 76 */ ['Smite', '', ''],
        /* 77 */ ['OTHER SECTION'],
        /* 78 */ [],
        /* 79 */ ['MUTATIONS / MALIGNANCIES'],
        /* 80 */ ['Hideous Mutation'],
        /* 81 */ ['Palsy'],
        /* 82 */ [],
        /* 83 */ [],
        /* 84 */ ['MENTAL DISORDERS'],
        /* 85 */ ['Phobia'],
        /* 86 */ [],
        /* 87 */ [],
        /* 88 */ ['Trade', 'Ranks'],                            // side table for a main-table group
        /* 89 */ ['Linguist', '4'],                             // already in SKILLS → not overwritten
        /* 90 */ ['Copyist', '2'],
        /* 91 */ ['Notarow', ''],                               // no rank → skipped
        /* 92 */ ['ANOTHER SECTION', ''],
        /* 93 */ [],
        /* 94 */ ['Scholastic Lores', 'Ranks'],                 // side table with no main-table entry
        /* 95 */ ['Occult', '3'],
        /* 96 */ ['Legend', '2'],
        /* 97 */ ['* footnote', ''],                            // footnote → break
        /* 98 */ [],
        /* 99 */ ['SKILLS'],
        /*100 */ ['Name', 'Characteristic', 'Score', 'Rank', 'Misc'],
        /*101 */ ['Type', '', '', '', ''],                      // placeholder row
        /*102 */ ['Dodge', 'Agility', '35', '2', '5'],
        /*103 */ ['Awareness', 'Intelligence', '30', '0', '0'], // characteristic differs from the def
        /*104 */ ['Notes', '', '', '', ''],                     // non-skill group header → clears group
        /*105 */ ['Mystery Column', 'Intelligence', '1', '1', '0'],  // unknown standalone → skipped
        /*106 */ ['Trade: Linguist', 'Intelligence', '30', '3', '2'],
        /*107 */ ['Forbidden Lores', '', '', '', ''],           // specialist group header
        /*108 */ ['Xenos', 'Intelligence', '30', '2', '0'],
        /*109 */ ['Heresy', 'Intelligence', '30', '9', '1'],    // rank 9 → clamped to 4
        /*110 */ ['Athletics', 'Strength', '30', '1', '0'],
        /*111 */ [],
        /*112 */ [],
        /*113 */ [],
        /*114 */ ['Total', '3000'],
        /*115 */ ['Used', '2500'],
        /*116 */ [],
        /*117 */ ['CREATION'],
        /*118 */ ['Background', 'Outcast'],
        /*119 */ ['Role', 'Assassin'],
        /*120 */ ['Divination', 'Trust in your fear.'],
        /*121 */ ['Elite Advance', 'Psyker'],                   // label form (no ELITE ADVANCES section)
        /*122 */ [],
        /*123 */ ['WEAPON TRAINING'],
        /*124 */ ['Bolt'],
        /*125 */ ['Las'],
        /*126 */ [],
        /*127 */ ['CYBERNETICS'],
        /*128 */ ['Bionic Eyes'],
        /*129 */ [],
        /*130 */ ['TALENTS'],
        /*131 */ ['Talent'],
        /*132 */ ['Jaded'],
        /*133 */ ['Nerves of Steel'],
        /*134 */ [],
        /*135 */ ['DRAMATIC MOMENTS'],
        /*136 */ ['Saved the captain'],
    ];
}

/** Experience-spending tab: epoch markers in col A, name/cost in B/C. */
function xpGrid() {
    return [
        ['', 'Item', 'Cost'],                    // header — cost is not a number
        ['', 'Weapon Skill +5', '250'],          // before any epoch marker
        ['Session 1', 'Mighty Shot', '600'],
        ['', 'Sound Constitution', '250'],       // inherits the epoch
        ['', 'Remaining', '100'],                // bookkeeping rows are excluded
        ['', 'Total', '1100'],
        ['', '', ''],
    ];
}

/** Stored Inventory tab with NO weight column. */
function storedGrid() {
    return [
        ['STORED INVENTORY'],
        ['Item', 'Qty'],
        ['2 Spare Power Packs', '3'],
        ['Dataslate'],
    ];
}

const fullDoc = () => parseGrids(
    { sheet: fullSheet(), xp: xpGrid(), stored: storedGrid() },
    'Fullchar (matt) - sheet.xlsx');

// ---------------------------------------------------------------------------
// SKILLS table + speciality side tables
// ---------------------------------------------------------------------------

test('skills table: plain rows carry advances, Misc modifiers and a characteristic override', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.skills.Dodge, {
        advances: 2, modifiers: [{ value: 5, source: 'sheet Misc column' }],
    });
    // Awareness is a PER skill on the sheet's INT column → the override is carried
    assert.deepEqual(doc.skills.Awareness, { advances: 0, characteristic: 'int' });
    // Athletics' sheet characteristic matches the def → no override, no modifiers
    assert.deepEqual(doc.skills.Athletics, { advances: 1 });
    // "Type" placeholder rows and unknown standalone rows produce no entries
    assert.ok(!('Type' in doc.skills));
    assert.ok(!('Notes' in doc.skills));
    assert.ok(!Object.keys(doc.skills).includes('Mystery Column'));
});

test('skills table: "Trade: Linguist" becomes a speciality; group headers own the rows below', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.skills.Trade.specialities.Linguist, {
        advances: 3, modifiers: [{ value: 2, source: 'sheet Misc column' }],
    });
    assert.deepEqual(doc.skills['Forbidden Lore'].specialities.Xenos, { advances: 2 });
    // rank 9 clamps to the schema's 0–4 range, Misc still recorded
    assert.deepEqual(doc.skills['Forbidden Lore'].specialities.Heresy, {
        advances: 4, modifiers: [{ value: 1, source: 'sheet Misc column' }],
    });
});

test('speciality side tables merge in without overwriting the main SKILLS table', () => {
    const doc = fullDoc();
    // "Linguist" already came from the main table with advances 3 — the side
    // table's 4 must NOT win, but "Copyist" is new and is added.
    assert.equal(doc.skills.Trade.specialities.Linguist.advances, 3);
    assert.deepEqual(doc.skills.Trade.specialities.Copyist, { advances: 2 });
    assert.ok(!('Notarow' in doc.skills.Trade.specialities));   // blank rank → skipped
    // a side table for a specialist skill absent from the main table creates it
    assert.deepEqual(doc.skills['Scholastic Lore'].specialities, {
        Occult: { advances: 3 }, Legend: { advances: 2 },
    });
    assert.ok(!('footnote' in doc.skills['Scholastic Lore'].specialities));
});

// ---------------------------------------------------------------------------
// ARMAMENTS (parseWeaponBlock)
// ---------------------------------------------------------------------------

test('weapons: ranged block maps quality/RoF/damage/pen/clip and drops "-" qualities', () => {
    const doc = fullDoc();
    const hellgun = doc.weapons.find((w) => w.name === 'Hellgun');
    assert.deepEqual(hellgun, {
        name: 'Hellgun', class: 'basic', damage: '1d10+4', pen: 4, damageType: 'Energy',
        qualities: ['Reliable', 'Accurate'], craftsmanship: 'Good',
        rof: { single: true, burst: 3, full: 10 },
        clip: { max: 40, value: 40 },
    });
});

test('weapons: a digit-free RoF makes the block melee (sbMultiplier, no clip)', () => {
    const doc = fullDoc();
    const sword = doc.weapons.find((w) => w.name === 'Chainsword');
    assert.deepEqual(sword, {
        name: 'Chainsword', class: 'melee', damage: '1d10+2', pen: 2, damageType: 'Rending',
        qualities: ['Tearing'], craftsmanship: 'Best',
        rof: { single: true, burst: 0, full: 0 }, sbMultiplier: 1,
    });
    // the sheet's Clip column carries a 5, but a melee block never takes a clip
    assert.ok(!('clip' in sword));
});

test('weapons: a blank name cell still imports the block, visibly unnamed', () => {
    const doc = fullDoc();
    const w = doc.weapons.find((x) => x.name === '(unnamed weapon)');
    assert.equal(w.damageType, 'Explosive');
    assert.equal(w.damage, '2d10');
    assert.equal(w.craftsmanship, 'Poor');
    // "-/-/6": no leading S → single false; the "-" burst is 0, full is 6
    assert.deepEqual(w.rof, { single: false, burst: 0, full: 6 });
    assert.deepEqual(w.clip, { max: 1, value: 1 });
});

test('weapons: blocks without Quality, without Damage, or without a dice formula are rejected', () => {
    const doc = fullDoc();
    const names = doc.weapons.map((w) => w.name);
    assert.deepEqual(names, ['Hellgun', 'Chainsword', '(unnamed weapon)']);
    for (const rejected of ['Broken Block', 'No Damage Row', 'Placeholder Gun']) {
        assert.ok(!names.includes(rejected), `${rejected} should not import`);
    }
});

// ---------------------------------------------------------------------------
// EQUIPMENT / Stored Inventory
// ---------------------------------------------------------------------------

test('gear: equipped block derives per-unit weight from the leading quantity and stops at ALL-CAPS', () => {
    const doc = fullDoc();
    const equipped = doc.gear.filter((g) => g.equipped);
    assert.deepEqual(equipped, [
        { name: '3 Smoke Grenades', equipped: true, quantity: 3, weight: 0.5 },  // 1.5 total / 3
        { name: 'Flak Cloak', equipped: true, weight: 2 },                       // "2 kg" → 2
        { name: 'Rebreather', equipped: true },                                  // blank weight cell
    ]);
    assert.ok(!doc.gear.some((g) => g.name === 'MEDICAE SUPPLIES'));
});

test('gear: the Stored Inventory tab is appended unequipped, and a missing Weight column is fine', () => {
    const doc = fullDoc();
    const stored = doc.gear.filter((g) => !g.equipped);
    assert.deepEqual(stored, [
        { name: '2 Spare Power Packs', equipped: false, quantity: 2 },
        { name: 'Dataslate', equipped: false },
    ]);
    assert.ok(stored.every((g) => !('weight' in g)));
});

// ---------------------------------------------------------------------------
// pools, unnatural, shielding, psy powers, xp ledger, name fallback, v4 blocks
// ---------------------------------------------------------------------------

test('pools: label → current/max; psy rating > 0 implies a bound psyker', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.wounds, { critical: 0, current: 9, max: 14 });
    assert.deepEqual(doc.fate, { current: 2, max: 3 });
    assert.deepEqual(doc.fatigue, { current: 1 });
    assert.deepEqual(doc.psy, { rating: 3, class: 'bound', sustained: 0 });
    assert.equal(doc.armour.head, 5);
    assert.equal(doc.armour.rightLeg, 5);
});

test('unnatural column: schema-supported keys are carried, the rest become unmapped notes', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.unnatural, { ws: 2 });        // int is outside the schema's set
    assert.ok(doc.source.unmapped.includes('unnatural int (schema v1 limit)'));
    assert.ok(doc.source.unmapped.includes('armour is the STATS scalar applied to all locations'));
});

test('SHIELDING: the first numeric cell under the header becomes the field rating', () => {
    assert.deepEqual(fullDoc().field, { rating: 6, overloadMax: 0 });
});

test('PSY POWERS: Power/Tree/Notes columns map to name/discipline/notes, equipped by default', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.psychicPowers, [
        { name: 'Telepathic Link', equipped: true, discipline: 'Telepathy', notes: 'free action' },
        { name: 'Smite', equipped: true },
    ]);
});

test('named sections: MUTATIONS/MALIGNANCIES splits on the word "mutation"; disorders are separate', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.corruption, { points: 5, malignancies: ['Palsy'], mutations: ['Hideous Mutation'] });
    assert.deepEqual(doc.insanity, { points: 12, disorders: ['Phobia'] });
});

test('v4 blocks: talents, trainings, cybernetics, dramatic moments and the label-form elite advance', () => {
    const doc = fullDoc();
    assert.deepEqual(doc.talents, ['Jaded', 'Nerves of Steel']);
    assert.deepEqual(doc.weaponTrainings, ['Bolt', 'Las']);
    assert.deepEqual(doc.cybernetics, ['Bionic Eyes']);
    assert.deepEqual(doc.extensions['dramatic-moments'], { entries: ['Saved the captain'] });
    assert.deepEqual(doc.origin.background, { name: 'Outcast' });
    assert.deepEqual(doc.origin.role, { name: 'Assassin' });
    assert.deepEqual(doc.origin.eliteAdvances, [{ name: 'Psyker' }]);
    assert.equal(doc.tarot.text, 'Trust in your fear.');
    assert.equal(doc.origin.homeworld, null);         // no Home World label on this sheet
});

test('xp: the spending tab becomes the ledger, epochs inherited, bookkeeping rows dropped', () => {
    const doc = fullDoc();
    assert.equal(doc.xp.total, 3000);
    assert.equal(doc.xp.spent, 2500);
    assert.deepEqual(doc.xp.ledger, [
        { name: 'Weapon Skill +5', cost: 250 },                      // no epoch yet
        { name: 'Mighty Shot', cost: 600, source: 'Session 1' },
        { name: 'Sound Constitution', cost: 250, source: 'Session 1' },
    ]);
    assert.ok(!doc.xp.ledger.some((e) => /remaining|total/i.test(e.name)));
});

test('name: "[Name]" in A1 falls back to the cleaned filename stem, player parenthetical stripped', () => {
    const doc = fullDoc();
    assert.equal(doc.name, 'Fullchar');
    assert.equal(doc.source.file, 'Fullchar - sheet.xlsx');
});

// ---------------------------------------------------------------------------
// Fixture B — the "drifted" sheet: anchors present but out of position.
// ---------------------------------------------------------------------------

/** CHARACTERISTICS header whose Type column is more than 3 rows away (so the
 *  block is not trusted), empty pools, a labelled Influence cell, a Home World
 *  label with an empty value, an ELITE ADVANCES section, a source-less
 *  aptitude, an empty SHIELDING row, and a Quality/Damage block one row low. */
function driftedSheet() {
    return [
        /*  0 */ ['Named In A1'],
        /*  1 */ ['CHARACTERISTICS:'],
        /*  2 */ [],
        /*  3 */ [],
        /*  4 */ [],
        /*  5 */ ['Type', 'Score', '', 'Unnatural'],       // 4 rows below the header → ignored
        /*  6 */ ['Weapon Skill', '45', '', '4'],
        /*  7 */ [],
        /*  8 */ ['Wounds', '', ''],
        /*  9 */ ['Fate Points', '', ''],
        /* 10 */ ['Influence', '33'],
        /* 11 */ [],
        /* 12 */ ['Home World', ''],                       // labelled but empty → try the alias
        /* 13 */ ['Homeworld', 'Void Born'],
        /* 14 */ [],
        /* 15 */ ['ELITE ADVANCES'],
        /* 16 */ ['Sanctioned Psyker'],
        /* 17 */ ['Inquisitorial Acolyte'],
        /* 18 */ [],
        /* 19 */ [],
        /* 20 */ ['APTITUDES'],
        /* 21 */ ['Aptitude'],
        /* 22 */ ['Willpower'],                            // no Source cell → bare string
        /* 23 */ ['Psyker', '', 'role'],
        /* 24 */ [],
        /* 25 */ [],
        /* 26 */ ['SHIELDING'],
        /* 27 */ ['', '', ''],                             // no numeric cell → rating stays 0
        /* 28 */ [],
        /* 29 */ ['Name:'],
        /* 30 */ ['Cudgel'],
        /* 31 */ [''],
        /* 32 */ ['Quality', 'RoF'],                       // one row lower than the tight layout
        /* 33 */ ['Weird', ''],                            // unknown quality → Common
        /* 34 */ [''],
        /* 35 */ ['Damage', 'Pen'],
        /* 36 */ ['1d10', ''],                             // no type letter → Impact
    ];
}

const driftedDoc = () => parseGrids({ sheet: driftedSheet(), xp: null, stored: null }, 'Variant.xlsx');

test('drift: a CHARACTERISTICS block whose Type column is too far away is not read', () => {
    const doc = driftedDoc();
    assert.deepEqual(doc.characteristics.ws, { base: 0, advances: 0, modifiers: [] });
    assert.deepEqual(doc.unnatural, {});     // the Unnatural column needs the Type anchor
    assert.equal(doc.name, 'Named In A1');   // A1 wins over the filename
});

test('drift: empty pool cells fall back to the wounds/fate defaults', () => {
    const doc = driftedDoc();
    assert.deepEqual(doc.wounds, { critical: 0, max: 10, current: 10 });
    assert.deepEqual(doc.fate, { max: 0, current: 0 });
    assert.deepEqual(doc.psy, { rating: 0, class: 'none', sustained: 0 });
});

test('drift: influence falls back to a labelled cell; empty labels defer to the alias label', () => {
    const doc = driftedDoc();
    assert.equal(doc.influence, 33);
    assert.deepEqual(doc.origin.homeworld, { name: 'Void Born' });   // via "Homeworld", not "Home World"
    assert.equal(doc.origin.background, null);
    assert.equal(doc.origin.role, null);
    assert.deepEqual(doc.tarot, {});
});

test('drift: an ELITE ADVANCES section supplies eliteAdvances when no label cell exists', () => {
    assert.deepEqual(driftedDoc().origin.eliteAdvances, [
        { name: 'Sanctioned Psyker' }, { name: 'Inquisitorial Acolyte' },
    ]);
});

test('drift: a source-less aptitude row stays a bare string', () => {
    assert.deepEqual(driftedDoc().aptitudes, ['Willpower', { name: 'Psyker', source: 'role' }]);
});

test('drift: a SHIELDING block with no number keeps a zero field, and layout drift still parses a weapon', () => {
    const doc = driftedDoc();
    assert.deepEqual(doc.field, { rating: 0, overloadMax: 0 });
    assert.deepEqual(doc.weapons, [{
        name: 'Cudgel', class: 'melee', damage: '1d10', pen: 0, damageType: 'Impact',
        qualities: [], craftsmanship: 'Common',
        rof: { single: true, burst: 0, full: 0 }, sbMultiplier: 1,
    }]);
});

// ---------------------------------------------------------------------------
// CLI main() — asserted on the --dry run performed at module load above.
// ---------------------------------------------------------------------------

test('CLI: `import-campaign.mjs --dry` scans the roster folders and writes nothing', () => {
    const text = cliLines.join('\n');
    assert.match(text, /\(dry run\) would write .*roster\.mjs/);

    // Every scanned folder either parsed workbooks or reported itself missing.
    // (The workbook tree lives outside the repo and is not present everywhere.)
    const parsed = cliLines.filter((l) => l.startsWith('✓'));
    const missing = cliLines.filter((l) => l.includes('missing folder'));
    assert.ok(parsed.length > 0 || missing.length > 0,
        `expected either parsed sheets or missing-folder warnings, got:\n${text}`);
    for (const line of parsed) {
        assert.match(line, /\(\d+ weapons, \d+ talents, \d+ skills, \d+ aptitudes, \d+ xp entries\)$/);
    }

    // --dry must not touch the committed roster module.
    const after = existsSync(ROSTER) ? statSync(ROSTER) : null;
    assert.equal(after?.mtimeMs, rosterBefore?.mtimeMs, 'the --dry run must not rewrite roster.mjs');
    assert.equal(after?.size, rosterBefore?.size);
});
