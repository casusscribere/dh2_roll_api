/**
 * valuedNames: which rules take a numeric severity/level variable (so the Roll UI
 * shows a value input) vs boolean rules that only toggle. node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valuedNames } from '../lib/dsl/compiler.mjs';
import { availableValued } from '../lib/rules/index.mjs';

test('valuedNames flags rules that read a level/severity accessor for their name', () => {
    const src = `
        trait "Brutal Charge" { on DAMAGE_MODS when has_trait("Brutal Charge") then add modifier "bc" = trait_level("Brutal Charge", 0) }
        trait "Sturdy" { on DAMAGE_MODS when has_trait("Sturdy") then add modifier "s" = 5 }
        circumstance "Haywire Field" { on MODIFIERS when has_circumstance("Haywire Field") and circumstance_severity("Haywire Field", 0) == 2 then add modifier "h" = -10 }
        condition "On Fire" { on MODIFIERS when has_condition("On Fire") then add modifier "of" = -10 }
    `;
    const valued = valuedNames(src);
    assert.ok(valued.includes('Brutal Charge'));      // trait_level("Brutal Charge")
    assert.ok(valued.includes('Haywire Field'));      // circumstance_severity("Haywire Field")
    assert.ok(!valued.includes('Sturdy'));            // flat +5, no accessor
    assert.ok(!valued.includes('On Fire'));           // boolean severity
});

test('the built-in rule set: Brutal Charge & Haywire Field are valued; On Fire / Darkness / Ambidextrous are not', () => {
    assert.ok(availableValued.includes('Brutal Charge'));
    assert.ok(availableValued.includes('Haywire Field'));
    assert.ok(!availableValued.includes('On Fire'));
    assert.ok(!availableValued.includes('Darkness'));
    assert.ok(!availableValued.includes('Ambidextrous'));
});
