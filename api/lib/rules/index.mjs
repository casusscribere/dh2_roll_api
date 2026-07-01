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
import { Registry } from '../pipeline.mjs';
import { compile, compileTables, compileActions, referencedNames, valuedNames } from '../dsl/compiler.mjs';
import { combatActionEffects, COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES } from './combat-actions.mjs';
import { qualityConflictEffects } from './quality-conflicts.mjs';
import { registerActions, availableActions } from '../actions.mjs';
import { ruleSources } from './sources.mjs';

const readRule = (name) => ruleSources[name];

const qualitiesSrc = readRule('weapon-qualities.dsl');
const talentsSrc = readRule('talents.dsl');
const traitsSrc = readRule('traits.dsl');
const conditionsSrc = readRule('conditions.dsl');
const circumstancesSrc = readRule('circumstances.dsl');
const configurationsSrc = readRule('configurations.dsl');
const mechanicsSrc = readRule('mechanics.dsl');
const rollTablesSrc = readRule('roll-tables.dsl');
const actionsSrc = readRule('actions.dsl');

// Compile the Action declarations once at load and register them into the actions
// taxonomy (is_action/action_type/is_reaction read this). "Checked at startup."
registerActions(compileActions(actionsSrc));
/** Names of every known action (defaults + DSL-declared). */
export const availableActionNames = availableActions();

/** Each rule category, compiled from its DSL source at load time. */
export const weaponQualityEffects = compile(qualitiesSrc);
export const talentEffects = compile(talentsSrc);   // Talents only (XP-bought; has_talent)
export const traitEffects = compile(traitsSrc);      // Traits only (innate DH2.0; has_trait)
export const conditionEffects = compile(conditionsSrc);       // active Conditions (On Fire, Aiming, …)
export const circumstanceEffects = compile(circumstancesSrc); // environmental Circumstances (off-hand, …)
export const configurationEffects = compile(configurationsSrc); // per-character toggles (Maximal, …)
export const mechanicEffects = compile(mechanicsSrc);   // Jam mechanic + craftsmanship

/** Built-in roll tables (Scatter Diagram, Haywire, Hallucinogenic), for roll_on. */
export const rollTables = compileTables(rollTablesSrc);
export const availableTables = rollTables.map((t) => ({ name: t.name, die: `${t.die.count}d${t.die.sides}`, rows: t.rows.length }));

/** Player-facing names the rule set understands (for the UI / /api/rules).
 *  Qualities are aggregated across ALL rule sources, so a weapon quality gating a
 *  rule elsewhere (e.g. Maximal — both a quality and a Configuration: the quality
 *  gates the config's availability) is recognised. */
export const availableQualities = referencedNames(
    [qualitiesSrc, talentsSrc, traitsSrc, conditionsSrc, circumstancesSrc, configurationsSrc, mechanicsSrc].join('\n\n'),
).qualities;
export const availableTalents = referencedNames(talentsSrc).talents;
export const availableTraits = referencedNames(traitsSrc).traits;
export const availableConditions = referencedNames(conditionsSrc).conditions;
export const availableCircumstances = referencedNames(circumstancesSrc).circumstances;
export const availableConfigurations = referencedNames(configurationsSrc).configurations;
/** Names of rules that take a numeric severity/level variable (Brutal Charge,
 *  Haywire Field, …) — the UI shows a value input only for these. */
export const availableValued = valuedNames(
    [qualitiesSrc, talentsSrc, traitsSrc, conditionsSrc, circumstancesSrc, configurationsSrc, mechanicsSrc].join('\n\n'),
);
/** @deprecated alias kept for callers expecting the old name */
export const availableStatuses = availableConditions;

/** Raw DSL source of the built-in rule set, by category (for /api/rules/source). */
export const builtinSources = [
    { category: 'Weapon qualities', file: 'weapon-qualities.dsl', source: qualitiesSrc },
    { category: 'Talents', file: 'talents.dsl', source: talentsSrc },
    { category: 'Traits', file: 'traits.dsl', source: traitsSrc },
    { category: 'Conditions', file: 'conditions.dsl', source: conditionsSrc },
    { category: 'Circumstances', file: 'circumstances.dsl', source: circumstancesSrc },
    { category: 'Configurations', file: 'configurations.dsl', source: configurationsSrc },
    { category: 'Mechanical', file: 'mechanics.dsl', source: mechanicsSrc },
    { category: 'Actions', file: 'actions.dsl', source: actionsSrc },
    { category: 'Roll tables', file: 'roll-tables.dsl', source: rollTablesSrc },
];

/** Flat per-RULE list of the (toggleable) built-in rules — one entry per rule
 *  (multi-branch rules collapse to a single ruleId), keyed by ruleId so one
 *  toggle controls all of a rule's effects. Grouped by rule KIND, not by source
 *  file. Combat-action core mechanics are excluded as they are not toggleable. */
// The nine player-facing categories (KIND → category). Foundry targets for each
// are in FOUNDRY_MIGRATION.md.
const KIND_GROUP = {
    quality: 'Weapon qualities',
    talent: 'Talents',
    trait: 'Traits',
    circumstance: 'Circumstances',
    condition: 'Conditions',
    action: 'Actions',
    configuration: 'Configurations',
    mechanic: 'Mechanical',
    miscellaneous: 'Miscellaneous',
};
const GROUP_ORDER = [
    'Weapon qualities', 'Talents', 'Traits', 'Circumstances', 'Conditions',
    'Actions', 'Configurations', 'Mechanical', 'Miscellaneous',
];

export const builtinRules = (() => {
    const all = [...weaponQualityEffects, ...talentEffects, ...traitEffects, ...conditionEffects, ...circumstanceEffects, ...configurationEffects, ...mechanicEffects];
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

/** Weapon qualities that act as a firing-mode toggle (modify the profile when
 *  fired, rather than adding an Action). The UI offers a toggle for each one the
 *  weapon has; the active modes are passed back as `firingModes` and gate the
 *  rules via firing_mode("…"). */
/** Available per-character Configurations (toggles), derived from the DSL.
 *  FIRING_MODES kept as a back-compat alias. */
export const availableConfigs = availableConfigurations;
export const FIRING_MODES = availableConfigurations;

/** Build a fresh registry holding the built-in (Claude-codified) rule set. */
export function buildDefaultRegistry() {
    return new Registry()
        .addAll(combatActionEffects)
        .addAll(qualityConflictEffects)
        .addAll(weaponQualityEffects)
        .addAll(talentEffects)
        .addAll(traitEffects)
        .addAll(conditionEffects)
        .addAll(circumstanceEffects)
        .addAll(configurationEffects)
        .addAll(mechanicEffects)
        .addTables(rollTables);
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
        .addAll(qualityConflictEffects)
        .addAll(keep(weaponQualityEffects))
        .addAll(keep(talentEffects))
        .addAll(keep(traitEffects))
        .addAll(keep(conditionEffects))
        .addAll(keep(circumstanceEffects))
        .addAll(keep(configurationEffects))
        .addAll(keep(mechanicEffects))
        .addTables(rollTables);
    if (customRules && String(customRules).trim()) {
        registry.addAll(compile(customRules));
        registry.addTables(compileTables(customRules));   // user-defined roll tables
    }
    return registry;
}

/** Shared default registry used by the engine's public functions. */
export const defaultRegistry = buildDefaultRegistry();
