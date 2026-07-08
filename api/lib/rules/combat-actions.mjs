/**
 * Combat-action interpretation: the action / aim / range modifier tables and
 * the effects that apply them to a to-hit test. This is rule CONTENT (one
 * codification of DH2 combat-actions.mjs), kept separate from the roll engine.
 *
 * Each effect declares the checkpoint it binds to, an optional activation
 * predicate (`when`), and the mutation (`apply`). The engine never references
 * any of these rules by name — it just runs whatever the registry holds.
 */
import { CHECKPOINTS } from '../pipeline.mjs';

/** Attack-action modifiers (combat-actions.mjs allCombatActions).
 *  `rate` drives the hit CAP (single / weapon semi RoF / weapon full RoF);
 *  `hitAccrual` overrides how DoS become extra hits when it differs from the
 *  rate (Suppressing Fire (Full): per-2-DoS accrual, full-RoF cap — p.224);
 *  `cap: 'wsb'` caps at the attacker's WS bonus instead of RoF (the melee
 *  multi-attacks, p.223/225); `talent` names the talent that gates the action
 *  (surfaced by the UI and the action-legality rules in actions.dsl). */
export const COMBAT_ACTIONS = {
    'Standard Attack':  { modifier: 10,  rate: 'single', melee: true, ranged: true },
    'All Out Attack':   { modifier: 30,  rate: 'single', melee: true, ranged: false },
    'Charge':           { modifier: 20,  rate: 'single', melee: true, ranged: false },
    'Called Shot':      { modifier: -20, rate: 'single', melee: true, ranged: true },
    'Swift Attack':     { modifier: 0,   rate: 'semi',   melee: true, ranged: false, cap: 'wsb', talent: 'Swift Attack' },
    'Lightning Attack': { modifier: -10, rate: 'full',   melee: true, ranged: false, cap: 'wsb', talent: 'Lightning Attack' },
    'Semi-Auto Burst':  { modifier: 0,   rate: 'semi',   melee: false, ranged: true },
    'Full Auto Burst':  { modifier: -10, rate: 'full',   melee: false, ranged: true },
    'Suppressing Fire (Semi)': { modifier: -20, rate: 'semi', melee: false, ranged: true },
    'Suppressing Fire (Full)': { modifier: -20, rate: 'full', melee: false, ranged: true, hitAccrual: 'semi' },
};

export const RANGE_BANDS = {
    'Melee': 0,
    'Point Blank': 30,
    'Short Range': 10,
    'Normal Range': 0,
    'Long Range': -10,
    'Extreme Range': -30,
};

export const AIM_MODES = { 'None': 0, 'Half': 10, 'Full': 20 };

/**
 * Effects for these rules. The engine pre-computes the resolved action info,
 * range band and aim value onto the context (mechanism); these effects decide
 * what — if anything — lands in the to-hit modifier set.
 */
export const combatActionEffects = [
    {
        id: 'action-modifier',
        source: 'combat-action',
        checkpoint: CHECKPOINTS.MODIFIERS,
        priority: 0,
        apply: (ctx) => { ctx.modifiers.attack = ctx.actionInfo.modifier; },
    },
    {
        id: 'aim-modifier',
        source: 'combat-action',
        checkpoint: CHECKPOINTS.MODIFIERS,
        priority: 10,
        // Aim only helps if you actually aimed, and is cancelled by All Out Attack.
        when: (ctx) => ctx.aimValue > 0 && ctx.action !== 'All Out Attack',
        apply: (ctx) => { ctx.modifiers.aim = ctx.aimValue; },
    },
    {
        id: 'range-modifier',
        source: 'combat-action',
        checkpoint: CHECKPOINTS.MODIFIERS,
        priority: 20,
        // Only a non-zero band shifts the target (Normal Range / Melee are 0).
        when: (ctx) => !!RANGE_BANDS[ctx.rangeBand],
        apply: (ctx) => { ctx.modifiers.range = RANGE_BANDS[ctx.rangeBand]; },
    },
    {
        id: 'custom-modifier',
        source: 'combat-action',
        checkpoint: CHECKPOINTS.MODIFIERS,
        priority: 30,
        when: (ctx) => !!ctx.input.customModifier,
        apply: (ctx) => { ctx.modifiers.modifier = Number(ctx.input.customModifier) || 0; },
    },
    {
        id: 'all-out-attack',
        source: 'combat-action',
        checkpoint: CHECKPOINTS.POST_ROLL,
        priority: 30,
        when: (ctx) => ctx.action === 'All Out Attack',
        apply: (ctx) => ctx.effects.push({
            name: 'All Out Attack',
            effect: 'The character cannot attempt Evasion reactions until the beginning of his next turn.',
        }),
    },
];
