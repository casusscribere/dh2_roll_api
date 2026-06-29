/**
 * Rule registry assembly.
 *
 * This is the single seam between the roll engine and the rule INTERPRETATIONS.
 * The engine imports `defaultRegistry` and runs whatever effects it holds; all
 * concrete rule content lives outside the engine:
 *   - combat actions  → native effects in combat-actions.mjs
 *   - weapon qualities → DSL text in data/rules/weapon-qualities.dsl, compiled here
 *   - talents/conditions → DSL text in data/rules/talents.dsl, compiled here
 *   - traits (DH2.0)  → DSL text in data/rules/traits.dsl, compiled here
 *   - statuses        → DSL text in data/rules/statuses.dsl, compiled here
 *
 * Native effect lists and DSL-compiled effects share one shape, so they mix
 * freely; user-supplied DSL can later be compiled and merged the same way.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Registry } from '../pipeline.mjs';
import { compile, referencedNames } from '../dsl/compiler.mjs';
import { combatActionEffects, COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES } from './combat-actions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readRule = (name) => readFileSync(join(__dirname, '..', '..', 'data', 'rules', name), 'utf8');

const qualitiesSrc = readRule('weapon-qualities.dsl');
const talentsSrc = readRule('talents.dsl');
const traitsSrc = readRule('traits.dsl');
const statusesSrc = readRule('statuses.dsl');

/** Each rule category, compiled from its DSL source at load time. */
export const weaponQualityEffects = compile(qualitiesSrc);
export const talentEffects = compile(talentsSrc);   // talents + situational conditions
export const traitEffects = compile(traitsSrc);
export const statusEffects = compile(statusesSrc);

/** Player-facing names the rule set understands (for the UI / /api/rules). */
export const availableQualities = referencedNames(qualitiesSrc).qualities;
export const availableTalents = referencedNames(talentsSrc).talents;
export const availableTraits = referencedNames(traitsSrc).traits;
export const availableStatuses = referencedNames(statusesSrc).statuses;

/** Raw DSL source of the built-in rule set, by category (for /api/rules/source). */
export const builtinSources = [
    { category: 'Weapon qualities', file: 'weapon-qualities.dsl', source: qualitiesSrc },
    { category: 'Talents & conditions', file: 'talents.dsl', source: talentsSrc },
    { category: 'Traits (DH2.0)', file: 'traits.dsl', source: traitsSrc },
    { category: 'Statuses', file: 'statuses.dsl', source: statusesSrc },
];

/** Flat per-RULE list of the (toggleable) built-in rules — one entry per rule
 *  (multi-branch rules collapse to a single ruleId), keyed by ruleId so one
 *  toggle controls all of a rule's effects. Grouped by rule KIND, not by source
 *  file. Combat-action core mechanics are excluded as they are not toggleable. */
const KIND_GROUP = {
    quality: 'Weapon qualities',
    talent: 'Talents and traits',
    trait: 'Talents and traits',
    condition: 'Conditions',
    status: 'Statuses',
    generic: 'Generics',
};
const GROUP_ORDER = ['Weapon qualities', 'Talents and traits', 'Conditions', 'Statuses', 'Generics'];

export const builtinRules = (() => {
    const all = [...weaponQualityEffects, ...talentEffects, ...traitEffects, ...statusEffects];
    const seen = new Set();
    const out = [];
    for (const e of all) {
        if (seen.has(e.ruleId)) continue;
        seen.add(e.ruleId);
        out.push({ id: e.ruleId, name: e.name, kind: e.source, checkpoint: e.checkpoint, category: KIND_GROUP[e.source] ?? 'Other' });
    }
    // Order by the canonical group order; stable within each group.
    out.sort((a, b) => GROUP_ORDER.indexOf(a.category) - GROUP_ORDER.indexOf(b.category));
    return out;
})();

// Re-export the combat-action reference tables so the engine/server can surface
// them (e.g. /api/options) without reaching past the rules layer.
export { COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES };

/** Build a fresh registry holding the built-in (Claude-codified) rule set. */
export function buildDefaultRegistry() {
    return new Registry()
        .addAll(combatActionEffects)
        .addAll(weaponQualityEffects)
        .addAll(talentEffects)
        .addAll(traitEffects)
        .addAll(statusEffects);
}

/**
 * Build a registry = built-ins (minus any disabled by id) + optional
 * user-supplied DSL rules. Combat-action core mechanics are always included.
 * Throws a DslError if `customRules` fails to tokenize/parse/compile.
 */
export function buildRegistry(customRules, disabledIds = []) {
    const disabled = new Set(disabledIds);
    // Disable by ruleId (covers every branch of a multi-branch rule) or effect id.
    const keep = (effects) => effects.filter((e) => !disabled.has(e.ruleId) && !disabled.has(e.id));
    const registry = new Registry()
        .addAll(combatActionEffects)
        .addAll(keep(weaponQualityEffects))
        .addAll(keep(talentEffects))
        .addAll(keep(traitEffects))
        .addAll(keep(statusEffects));
    if (customRules && String(customRules).trim()) registry.addAll(compile(customRules));
    return registry;
}

/** Shared default registry used by the engine's public functions. */
export const defaultRegistry = buildDefaultRegistry();
