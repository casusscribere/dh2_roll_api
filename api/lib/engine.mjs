/**
 * DH2 roll ENGINE — mechanism only.
 *
 * This layer owns the control flow and the universal d100 / damage / soak math.
 * It deliberately contains NO interpretation of any specific trait, talent or
 * weapon quality: every rule lands as a checkpoint effect in lib/rules/ and is
 * pulled from a Registry at run time. Swap the registry and the same engine
 * resolves a different rule set (the basis for the planned trait DSL).
 *
 * Mechanics ported from the dark-heresy-3rd-edition Foundry system
 * (module/rolls/*.mjs, module/rules/*.mjs) and verified against the DH2 core
 * codification (codified-systems/dark_heresy_2e).
 */
import { d, parseDamageFormula, getDegree } from './dice.mjs';
import { getHitLocationForRoll, ADDITIONAL_HIT_LOCATIONS, HIT_LOCATIONS } from './hit-locations.mjs';
import { getCriticalDamage } from './critical-damage.mjs';
import { CHECKPOINTS, runCheckpoint } from './pipeline.mjs';
import { RollContext } from './context.mjs';
import {
    defaultRegistry,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES,
} from './rules/index.mjs';

// Re-export the primitives + reference tables that callers/tests expect from
// this module, so the public surface is unchanged by the restructure.
export {
    d, parseDamageFormula, getDegree,
    getHitLocationForRoll, ADDITIONAL_HIT_LOCATIONS, HIT_LOCATIONS,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES,
    CHECKPOINTS, defaultRegistry,
};

// ------------------------------------------------------------ d100 test -----

/**
 * Resolve a d100 test (pure mechanism — no checkpoints; callers pass the final
 * modifier set). Mirrors ActionData._calculateHit + calculateSuccessOrFailure:
 *  - modifiers summed and capped at ±60
 *  - natural 1 always succeeds, natural 100 always fails
 *  - DoS = 1 + tens(target) - tens(roll); DoF likewise inverted
 */
export function rollTest({ target = 0, modifiers = {} }, rng = Math.random, forcedRoll = null) {
    let modifierTotal = Object.values(modifiers).reduce((a, b) => a + (Number(b) || 0), 0);
    if (modifierTotal > 60) modifierTotal = 60;
    if (modifierTotal < -60) modifierTotal = -60;

    const modifiedTarget = Number(target) + modifierTotal;
    const roll = forcedRoll ?? d(100, rng);
    const success = roll === 1 || (roll <= modifiedTarget && roll !== 100);

    return {
        roll,
        target: Number(target),
        modifiers,
        modifierTotal,
        modifiedTarget,
        success,
        dos: success ? 1 + getDegree(modifiedTarget, roll) : 0,
        dof: success ? 0 : 1 + getDegree(roll, modifiedTarget),
        autoFailure: roll === 100,
        autoSuccess: roll === 1,
    };
}

// ------------------------------------------------------------ damage roll ---

/**
 * Roll one hit's damage. The engine owns dice rolling, keep-highest selection,
 * the Righteous Fury check and totalling; the dice-pool / per-die / modifier
 * decisions are delegated to rule effects at the DAMAGE_POOL / DIE_ADJUST /
 * DAMAGE_MODS checkpoints (see lib/rules/weapon-qualities.mjs).
 */
export function rollDamage(opts, rng = Math.random, registry = defaultRegistry) {
    const {
        formula, qualities = [], sbTimes = 0, strengthBonus = 0,
        dos = 1, action = 'Standard Attack', location = 'Body', damageType = 'Impact',
        // Character-side facts so talent/trait/status rules can gate at the
        // per-hit damage checkpoints (e.g. Brutal Charge at DAMAGE_MODS, or
        // Accurate which requires aiming).
        talents = [], traits = [], statuses = [], isMelee = false, aimValue = 0,
    } = opts;

    const parsed = parseDamageFormula(formula);
    if (!parsed) return { error: `Cannot parse damage formula "${formula}"` };

    const ctx = new RollContext({
        parsed, formula, qualities, sbTimes, strengthBonus, dos, action, location, damageType, rng,
        talents, traits, statuses, isMelee, aimValue,
        // accumulators the effects mutate:
        extraDice: 0, keepHighest: null, tearing: false,
        rfThreshold: 10, dieTransforms: [], proven: null, primitive: null,
        modifiers: {},
    });

    // --- shape the dice pool (Tearing, ...) ---------------------------------
    runCheckpoint(registry, CHECKPOINTS.DAMAGE_POOL, ctx);

    const rolled = [];
    const diceToRoll = parsed.count + ctx.extraDice;
    for (let i = 0; i < diceToRoll; i++) rolled.push(d(parsed.sides, rng));

    let kept = [...rolled];
    let discarded = [];
    if (ctx.keepHighest != null) {
        kept = [...rolled].sort((a, b) => b - a).slice(0, ctx.keepHighest);
        const pool = [...rolled];
        kept.forEach((k) => pool.splice(pool.indexOf(k), 1));
        discarded = pool;
    }
    ctx.kept = kept;
    ctx.discarded = discarded;

    // --- per-die adjusters + RF threshold (Proven, Primitive, Vengeful) -----
    runCheckpoint(registry, CHECKPOINTS.DIE_ADJUST, ctx);

    const righteousFury = [];
    const adjusted = kept.map((die) => {
        if (die >= ctx.rfThreshold) {
            const rfRoll = d(5, rng);
            righteousFury.push({
                naturalRoll: die,
                rfRoll,
                effect: getCriticalDamage(damageType, location, rfRoll) ?? '',
            });
        }
        let v = die;
        for (const transform of ctx.dieTransforms) v = transform(v);
        return v;
    });

    // Engine-owned damage modifiers: flat (formula) and melee Strength Bonus.
    if (parsed.flat) ctx.modifiers['weapon'] = parsed.flat;
    if (sbTimes > 0) ctx.modifiers['strength bonus'] = strengthBonus * sbTimes;

    // --- bonus-dice modifiers (Accurate, ...) -------------------------------
    runCheckpoint(registry, CHECKPOINTS.DAMAGE_MODS, ctx);

    const diceTotal = adjusted.reduce((a, b) => a + b, 0);
    const total = diceTotal + Object.values(ctx.modifiers).reduce((a, b) => a + b, 0);

    return {
        formula, tearing: ctx.tearing,
        dice: { rolled, kept, adjusted, discarded },
        modifiers: ctx.modifiers, righteousFury,
        proven: ctx.proven, primitive: ctx.primitive,
        total,
    };
}

// ------------------------------------------------------------ soak ----------

/** Apply a hit to armour + toughness (pure mechanism). */
export function applySoak({ damage, penetration = 0, armour = 0, toughnessBonus = 0 }) {
    const usableArmour = Math.max(0, armour - penetration);
    const reduction = usableArmour + toughnessBonus;
    return {
        armour, penetration, usableArmour, toughnessBonus,
        reduction,
        woundsInflicted: Math.max(0, damage - reduction),
    };
}

// ------------------------------------------------------------ full attack ---

/**
 * Resolve a full weapon attack: test -> hit count -> locations -> damage -> soak.
 * The engine sequences the flow and computes the base numbers; rule effects fire
 * at MODIFIERS / POST_ROLL / HIT_COUNT_* / PENETRATION (and inside rollDamage).
 */
export function resolveAttack(input, rng = Math.random, registry = defaultRegistry) {
    const { characteristics = {}, weapon = {}, target } = input;
    const action = input.action ?? 'Standard Attack';
    const actionInfo = COMBAT_ACTIONS[action] ?? COMBAT_ACTIONS['Standard Attack'];
    const isMelee = !!weapon.isMelee;
    const qualities = weapon.qualities ?? [];

    const baseTarget = isMelee ? (characteristics.ws ?? 0) : (characteristics.bs ?? 0);
    const rangeBand = isMelee ? 'Melee' : (input.rangeBand ?? 'Normal Range');
    const aimValue = AIM_MODES[input.aim ?? 'None'] ?? 0;

    const ctx = new RollContext({
        input, characteristics, weapon, target,
        action, actionInfo, isMelee, qualities, rangeBand, aimValue, rng,
        // Character-side rule inputs (default empty so existing attacks are
        // unchanged): talents (XP-bought), traits (innate DH2.0 traits), and
        // statuses (active conditions like "On Fire", "Full Aim").
        talents: input.talents ?? [],
        traits: input.traits ?? [],
        statuses: input.statuses ?? [],
        // Combat state drives the talent/trait rules (e.g. Ambidextrous).
        // Accept a `combat` object or convenience top-level flags; default off so
        // single-weapon attacks behave exactly as before.
        combat: {
            dualWielding: !!(input.combat?.dualWielding ?? input.dualWielding),
            firingOffhand: !!(input.combat?.firingOffhand ?? input.firingOffhand),
            firingBoth: !!(input.combat?.firingBoth ?? input.firingBoth),
        },
        modifiers: {},
    });

    // --- attack test ---------------------------------------------------------
    runCheckpoint(registry, CHECKPOINTS.MODIFIERS, ctx);

    const test = rollTest({ target: baseTarget, modifiers: ctx.modifiers }, rng);
    test.characteristic = isMelee ? 'WS' : 'BS';
    ctx.test = test;
    ctx.success = test.success;
    ctx.effects = [];

    // Jam / overheat / all-out (POST_ROLL effects may flip ctx.success).
    runCheckpoint(registry, CHECKPOINTS.POST_ROLL, ctx);

    const result = {
        weapon: weapon.name ?? 'Unnamed weapon',
        action, rangeBand,
        test: { ...test, success: ctx.success },
        effects: ctx.effects,
        hits: [],
        log: ctx.log, // audit trail of which rule effects fired (by reference)
    };
    if (!ctx.success) {
        // On a miss, ON_MISS effects (e.g. Blast scatter) may fire. A rule sets a
        // base scatter distance (`set scatter = …`) and may add DSL-alterable
        // modifiers (`set scatter += …`); the engine rolls the direction and
        // computes the final distance (min 0).
        ctx.scatterModifiers = {};
        runCheckpoint(registry, CHECKPOINTS.ON_MISS, ctx);
        if (ctx.scatter?.active) {
            const modTotal = Object.values(ctx.scatterModifiers).reduce((a, b) => a + b, 0);
            result.scatter = {
                direction: d(10, rng),                 // 1d10 clock face (DH2 core p.230)
                baseDistance: ctx.scatter.base,
                modifiers: ctx.scatterModifiers,
                distance: Math.max(0, ctx.scatter.base + modTotal),
            };
        }
        return result;
    }

    // --- number of hits -------------------------------------------------------
    const fireRate = actionInfo.rate === 'semi' ? (weapon.rof?.burst ?? 1)
        : actionInfo.rate === 'full' ? (weapon.rof?.full ?? 1) : 1;

    if (actionInfo.rate === 'semi') ctx.additionalHits = Math.floor((test.dos - 1) / 2);
    else if (actionInfo.rate === 'full') ctx.additionalHits = test.dos - 1;
    else ctx.additionalHits = 0;
    ctx.fireRate = fireRate;

    runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_MULT, ctx);              // e.g. Storm ×2
    if (actionInfo.rate !== 'single' && ctx.additionalHits > fireRate - 1) {
        ctx.additionalHits = fireRate - 1;                                // RoF cap (mechanism)
    }
    runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_BONUS, ctx);            // e.g. Twin-Linked +1
    const additionalHits = ctx.additionalHits;

    // --- per-hit damage -------------------------------------------------------
    const sb = Math.floor((characteristics.s ?? 0) / 10);
    const sbTimes = isMelee ? (weapon.sbMultiplier || 1) : (weapon.sbMultiplier || 0);
    const firstLocation = (action === 'Called Shot' && input.calledShotLocation)
        ? input.calledShotLocation
        : getHitLocationForRoll(test.roll);

    const pen = Number(weapon.pen) || 0;
    ctx.pen = pen;
    ctx.penModifiers = {};
    ctx.firstLocation = firstLocation;
    runCheckpoint(registry, CHECKPOINTS.PENETRATION, ctx);               // e.g. Razor Sharp / Melta
    const penModifiers = ctx.penModifiers;
    const totalPen = pen + Object.values(penModifiers).reduce((a, b) => a + b, 0);

    for (let i = 0; i <= additionalHits; i++) {
        const location = (action === 'Called Shot' && input.calledShotLocation)
            ? input.calledShotLocation
            : ADDITIONAL_HIT_LOCATIONS[firstLocation][Math.min(i, 5)];

        const dmg = rollDamage({
            formula: weapon.damage,
            qualities,
            sbTimes,
            strengthBonus: sb,
            dos: test.dos,
            action,
            location,
            damageType: weapon.damageType ?? 'Impact',
            talents: ctx.talents, traits: ctx.traits, statuses: ctx.statuses, isMelee,
            aimValue,
        }, rng, registry);

        const hit = {
            hitNumber: i + 1,
            location,
            damageType: weapon.damageType ?? 'Impact',
            damage: dmg,
            penetration: pen,
            penetrationModifiers: penModifiers,
            totalPenetration: totalPen,
        };
        if (target && !dmg.error) {
            hit.soak = applySoak({
                damage: dmg.total,
                penetration: totalPen,
                armour: Number(target.armour) || 0,
                toughnessBonus: target.toughnessBonus ?? Math.floor((characteristics.t ?? 0) / 10),
            });
        }
        result.hits.push(hit);
    }

    result.totalWounds = target
        ? result.hits.reduce((a, h) => a + (h.soak?.woundsInflicted ?? 0), 0)
        : undefined;

    return result;
}

// ------------------------------------------------------------ parry ---------

/**
 * Resolve a Parry — a defensive WS test made with a melee weapon to negate an
 * incoming attack. Rule effects fire at the PARRY checkpoint (e.g. Balanced
 * +10, Defensive +15). A separate flow from resolveAttack: no aim/range/RoF.
 *
 * input = { characteristics: { ws }, weapon: { name, qualities }, customModifier?,
 *           talents?, traits?, statuses? }
 */
export function resolveParry(input, rng = Math.random, registry = defaultRegistry) {
    const { characteristics = {}, weapon = {} } = input;
    const qualities = weapon.qualities ?? [];

    const ctx = new RollContext({
        input, characteristics, weapon, qualities,
        action: 'Parry', isMelee: true, rangeBand: 'Melee', aimValue: 0, rng,
        talents: input.talents ?? [], traits: input.traits ?? [], statuses: input.statuses ?? [],
        combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
        modifiers: {},
    });
    if (input.customModifier) ctx.modifiers.modifier = Number(input.customModifier) || 0;

    runCheckpoint(registry, CHECKPOINTS.PARRY, ctx);   // Balanced, Defensive, …

    const test = rollTest({ target: characteristics.ws ?? 0, modifiers: ctx.modifiers }, rng);
    test.characteristic = 'WS';

    return {
        weapon: weapon.name ?? 'Unnamed weapon',
        action: 'Parry',
        test,
        log: ctx.log,
    };
}
