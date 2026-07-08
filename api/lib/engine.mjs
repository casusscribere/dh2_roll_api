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
import { canonList, hasQuality } from './rules/_util.mjs';
import {
    defaultRegistry,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES, canonicalAction,
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
export function rollTest({ target = 0, modifiers = {}, label = 'test', unnatural = 0 }, rng = Math.random, forcedRoll = null) {
    let modifierTotal = Object.values(modifiers).reduce((a, b) => a + (Number(b) || 0), 0);
    if (modifierTotal > 60) modifierTotal = 60;
    if (modifierTotal < -60) modifierTotal = -60;

    const modifiedTarget = Number(target) + modifierTotal;
    const roll = forcedRoll ?? d(100, rng, label);
    const success = roll === 1 || (roll <= modifiedTarget && roll !== 100);

    // Unnatural Characteristic (DH2 core p.139): a SUCCESSFUL test using a
    // characteristic with an Unnatural value gains bonus degrees of success equal
    // to HALF that value, rounded up (p.18 rounding rule). The target number is
    // not changed — only the DoS on a success. Failures are unaffected.
    const unnaturalValue = Number(unnatural) || 0;
    const bonusDos = success && unnaturalValue > 0 ? Math.ceil(unnaturalValue / 2) : 0;

    return {
        roll,
        target: Number(target),
        modifiers,
        modifierTotal,
        modifiedTarget,
        success,
        dos: success ? 1 + getDegree(modifiedTarget, roll) + bonusDos : 0,
        dof: success ? 0 : 1 + getDegree(roll, modifiedTarget),
        unnatural: unnaturalValue,
        bonusDos,
        autoFailure: roll === 100,
        autoSuccess: roll === 1,
    };
}

// ------------------------------------------------------------ generic test --

/**
 * Resolve a GENERIC characteristic/skill test through the `test.*` pipeline
 * (Phase 3): rule effects at test.MODIFIERS accumulate modifiers (gated on
 * test_name / talents / conditions / circumstances), the d100 rolls (with the
 * Unnatural bonus-DoS), then test.POST_ROLL fires for narrative effects (which
 * may `fail` the result). This is the pipeline behind /api/test — and, later,
 * Fear/Pinning and acquisition tests.
 *
 * input = { target, testName?, modifiers?{...}, unnatural?, talents?, traits?,
 *           conditions?, circumstances?, label?, foe? }
 */
export function resolveTest(input, rng = Math.random, registry = defaultRegistry) {
    const ctx = new RollContext({
        input,
        action: 'Test', testName: input.testName ?? '',
        isMelee: false, rangeBand: '', aimValue: 0, rng,
        qualities: [], craftsmanship: 'Common',
        talents: canonList(input.talents), traits: canonList(input.traits),
        statuses: input.conditions ?? input.statuses ?? [], circumstances: input.circumstances ?? [],
        combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
        modifiers: { ...(input.modifiers ?? {}) },
        // `foe` = the creature the test is ABOUT (the Fear source, the grappler),
        // exposed through the target.* scope so target-scoped rules (the Fear
        // trait) can read its traits. input.target stays the TEST TARGET NUMBER.
        target: (input.foe && typeof input.foe === 'object')
            ? { ...input.foe, traits: canonList(input.foe.traits) } : null,
        effects: [],
    });
    runCheckpoint(registry, CHECKPOINTS.TEST_MODIFIERS, ctx);
    const test = rollTest({
        target: input.target ?? 0, modifiers: ctx.modifiers,
        label: input.label ?? (input.testName ? `${input.testName} test` : 'test'),
        unnatural: input.unnatural ?? 0,
    }, rng);
    ctx.test = test;
    ctx.success = test.success;
    runCheckpoint(registry, CHECKPOINTS.TEST_POST_ROLL, ctx);
    return { ...test, success: ctx.success, testName: ctx.testName, effects: ctx.effects, log: ctx.log };
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
        rangeBand = 'Normal Range',   // so range-gated damage rules (e.g. Scatter) can read `range`
        // Character-side facts so talent/trait/status rules can gate at the
        // per-hit damage checkpoints (e.g. Brutal Charge at DAMAGE_MODS, or
        // Accurate which requires aiming).
        talents = [], traits = [], statuses = [], firingModes = [], configs = [], isMelee = false, aimValue = 0, craftsmanship = 'Common',
        targetArmour = 0,   // the target's AP at the struck location, for Graviton (+damage = armour)
        target = null,      // the (normalised) target block, so target.* scoped facts work at the damage checkpoints
        psyRating = 0,      // Force weapons (p.145): +psy rating damage/pen in a psyker's hands
        characteristics = {},   // so ws_bonus/bs_bonus work at the damage checkpoints (Mighty Shot, Crushing Blow)
    } = opts;

    const parsed = parseDamageFormula(formula);
    if (!parsed) return { error: `Cannot parse damage formula "${formula}"` };

    const ctx = new RollContext({
        parsed, formula, qualities: canonList(qualities), sbTimes, strengthBonus, dos, action, location, damageType, rangeBand, rng,
        talents: canonList(talents), traits: canonList(traits), statuses, firingModes, configs, isMelee, aimValue, craftsmanship, targetArmour, target, psyRating, characteristics,
        // accumulators the effects mutate:
        extraDice: 0, keepHighest: null, tearing: false,
        rfThreshold: 10, dieTransforms: [], proven: null, primitive: null,
        modifiers: {},
    });

    // --- shape the dice pool (Tearing, ...) ---------------------------------
    runCheckpoint(registry, CHECKPOINTS.DAMAGE_POOL, ctx);

    const rolled = [];
    const diceToRoll = parsed.count + ctx.extraDice;
    for (let i = 0; i < diceToRoll; i++) rolled.push(d(parsed.sides, rng, `damage die ${i + 1}`));

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
            const rfRoll = d(5, rng, 'Righteous Fury crit');
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

    const result = {
        formula, tearing: ctx.tearing,
        dice: { rolled, kept, adjusted, discarded },
        modifiers: ctx.modifiers, righteousFury,
        proven: ctx.proven, primitive: ctx.primitive,
        // the (possibly overridden) damage type — a DAMAGE_POOL rule may change it
        // (Sanctified → "Holy"); defaults to the weapon's type.
        damageType: ctx.damageType ?? damageType,
        total,
    };
    // Spray (p.149): the weapon jams if the firer rolls a NATURAL 9 on any
    // damage die (before modifiers/transforms). The hit still resolves; the
    // weapon is jammed afterwards (surfaced as an effect by the caller).
    if (hasQuality(ctx.qualities, 'Spray') && rolled.includes(9)) result.sprayJam = true;
    return result;
}

// ------------------------------------------------------------ soak ----------

/** Apply a hit to armour + toughness (pure mechanism). Toughness soak is the base
 *  Toughness Bonus PLUS any Unnatural Toughness bonus; Felling (`felling`) reduces
 *  only the Unnatural Toughness part for this hit, never the base TB. */
export function applySoak({ damage, penetration = 0, armour = 0, toughnessBonus = 0, unnaturalToughness = 0, felling = 0 }) {
    const usableArmour = Math.max(0, armour - penetration);
    const effUnnatural = Math.max(0, unnaturalToughness - felling);
    const reduction = usableArmour + toughnessBonus + effUnnatural;
    return {
        armour, penetration, usableArmour, toughnessBonus,
        unnaturalToughness, felling, effectiveUnnatural: effUnnatural,
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
/**
 * Strength Bonus is a MELEE damage bonus in DH2 — ranged weapons add no SB. The
 * only exception is a thrown weapon (flagged `thrown: true`), which adds SB like
 * a melee weapon. `sbMultiplier` sets the multiple (default ×1); it is ignored
 * for ordinary ranged weapons, so SB can never leak onto a ranged attack.
 */
function strengthBonusMultiple(weapon = {}, isMelee = false) {
    return (isMelee || weapon.thrown === true) ? (weapon.sbMultiplier || 1) : 0;
}

/**
 * Run the to-hit test: build the context, accumulate modifiers, roll the d100,
 * fire POST_ROLL (jam/overheat) and, on a hit, compute the hit count, per-hit
 * locations and penetration. On a miss, compute Blast scatter. Returns the live
 * ctx plus `base` (the serialisable result skeleton) and `hitMeta`. Used by both
 * resolveAttack and the per-phase engageAttackRoll.
 */
function runToHit(input, rng, registry) {
    const { characteristics = {}, weapon = {}, target } = input;
    // canonicalise the spelling ("swift_attack" / "SwiftAttack" → "Swift Attack")
    // so the modifier table AND every downstream exact compare see one form.
    const action = canonicalAction(input.action) ?? input.action ?? 'Standard Attack';
    const actionInfo = COMBAT_ACTIONS[action] ?? COMBAT_ACTIONS['Standard Attack'];
    const isMelee = !!weapon.isMelee;
    const qualities = canonList(weapon.qualities);   // canonical { name, level } (Stage 1)
    const baseTarget = isMelee ? (characteristics.ws ?? 0) : (characteristics.bs ?? 0);
    const rangeBand = isMelee ? 'Melee' : (input.rangeBand ?? 'Normal Range');
    const aimValue = AIM_MODES[input.aim ?? 'None'] ?? 0;
    // Unnatural Characteristic values for this attacker (p.139): WS/BS grant bonus
    // DoS on the to-hit test; Strength folds into the melee damage Strength Bonus.
    const unnatural = input.unnatural ?? {};
    const unnaturalToHit = isMelee ? (Number(unnatural.ws) || 0) : (Number(unnatural.bs) || 0);
    const unnaturalStrength = Number(unnatural.s) || 0;

    const ctx = new RollContext({
        input, characteristics, weapon, target,
        action, actionInfo, isMelee, qualities, rangeBand, aimValue, rng,
        talents: canonList(input.talents), traits: canonList(input.traits), statuses: input.conditions ?? input.statuses ?? [], circumstances: input.circumstances ?? [], firingModes: input.firingModes ?? [], configs: input.configs ?? input.firingModes ?? [],
        craftsmanship: weapon.craftsmanship ?? 'Common',
        psyRating: Number(input.psyRating) || 0,   // Force weapons (p.145)
        combat: {
            dualWielding: !!(input.combat?.dualWielding ?? input.dualWielding),
            firingOffhand: !!(input.combat?.firingOffhand ?? input.firingOffhand),
            firingBoth: !!(input.combat?.firingBoth ?? input.firingBoth),
        },
        modifiers: {}, effects: [],   // effects exists from MODIFIERS on (emit is legal there)
    });

    runCheckpoint(registry, CHECKPOINTS.MODIFIERS, ctx);
    // Spray (p.149) — THE no-attack-roll mode: the weapon does not test BS; every
    // creature in the cone is struck (this tool models one representative target,
    // always the Body) and makes a Challenging (+0) Agility test to AVOID the hit
    // (the quality's ON_HIT `require_test … avoids_hit`). No Called Shots.
    const isSpray = hasQuality(qualities, 'Spray');
    let test;
    if (isSpray) {
        test = {
            roll: 0, target: baseTarget, modifiers: {}, modifierTotal: 0, modifiedTarget: baseTarget,
            success: true, dos: 1, dof: 0, unnatural: 0, bonusDos: 0,
            autoFailure: false, autoSuccess: false, autoHit: true,
        };
    } else {
        test = rollTest({ target: baseTarget, modifiers: ctx.modifiers, label: 'to-hit', unnatural: unnaturalToHit }, rng);
    }
    test.characteristic = isMelee ? 'WS' : 'BS';
    ctx.test = test;
    ctx.success = test.success;
    if (isSpray) {
        ctx.effects.push({ name: 'Spray', effect: 'no attack roll — everyone in the 30° cone is struck unless they pass a Challenging (+0) Agility test; always hits the Body; cannot make Called Shots' });
    }
    runCheckpoint(registry, CHECKPOINTS.POST_ROLL, ctx);   // jam / overheat / all-out

    const base = {
        weapon: weapon.name ?? 'Unnamed weapon', action, rangeBand,
        test: { ...test, success: ctx.success }, effects: ctx.effects, log: ctx.log,
        preventsParry: !!ctx.preventParry,   // Flexible: the defender cannot Parry this attack
    };

    if (!ctx.success) {
        ctx.scatterModifiers = {};
        runCheckpoint(registry, CHECKPOINTS.ON_MISS, ctx);
        let scatter;
        if (ctx.scatter?.active) {
            const modTotal = Object.values(ctx.scatterModifiers).reduce((a, b) => a + b, 0);
            // Direction comes from the Scatter Diagram roll_table when the rule
            // declared one (Blast: `roll_on "Scatter Diagram"`); otherwise fall
            // back to a raw 1d10. Either way it consumes a single d10 here.
            const declared = (ctx.tableRolls ?? [])[0];
            const dirTable = declared && registry.table(declared.table);
            let direction, directionText = null;
            if (dirTable) { const res = resolveTable(dirTable, rng, declared.modifier); direction = res.roll; directionText = res.text; }
            else direction = d(10, rng, 'scatter direction');
            scatter = {
                direction, baseDistance: ctx.scatter.base,
                modifiers: ctx.scatterModifiers, distance: Math.max(0, ctx.scatter.base + modTotal),
            };
            if (directionText) scatter.directionText = directionText;
            // A weapon that detonates (Blast) still resolves its damage at the
            // scatter point even though the attacker missed — it may catch other
            // targets in the area. `detonate` is set by the DSL rule; it is not
            // reached on a jam (the Blast rule gates itself on roll ≤ jam_threshold).
            if (ctx.detonate) {
                const sb = Math.floor((characteristics.s ?? 0) / 10) + unnaturalStrength;
                const sbTimes = strengthBonusMultiple(weapon, isMelee);
                ctx.pen = Number(weapon.pen) || 0; ctx.penModifiers = {}; ctx.firstLocation = 'Body';
                runCheckpoint(registry, CHECKPOINTS.PENETRATION, ctx);
                const totalPen = ctx.pen + Object.values(ctx.penModifiers).reduce((a, b) => a + b, 0);
                const damage = rollHitDamage(weapon, action, { sb, sbTimes }, 'Body', test.dos ?? 0, input, rng, registry);
                scatter.hit = {
                    location: 'Body', damageType: damage.damageType ?? weapon.damageType ?? 'Impact', damage,
                    penetration: ctx.pen, penetrationModifiers: ctx.penModifiers, totalPenetration: totalPen,
                };
            }
            // Smoke (p.149): the smokescreen still lands at the scatter point —
            // WITHOUT damage unless the weapon also detonates (Blast composes).
            if (ctx.smokeScreens?.length) scatter.smoke = ctx.smokeScreens;
        }
        return { ctx, base, success: false, scatter, hitMeta: null };
    }

    // hit count. Accrual (how DoS become extra hits) and cap (how many hits at
    // most) are separate axes: Semi-Auto/Swift accrue per 2 DoS, Full Auto/
    // Lightning per DoS; ranged actions cap at the weapon's RoF while the melee
    // multi-attacks cap at the attacker's WS BONUS (p.223/225) — `cap: 'wsb'`.
    // Suppressing Fire (Full) mixes them: per-2-DoS accrual, full-RoF cap (p.224).
    const accrual = actionInfo.hitAccrual ?? actionInfo.rate;
    const fireRate = actionInfo.cap === 'wsb'
        ? Math.max(1, Math.floor((characteristics.ws ?? 0) / 10) + (Number(unnatural.ws) || 0))
        : actionInfo.rate === 'semi' ? Math.max(1, weapon.rof?.burst ?? 1)
        : actionInfo.rate === 'full' ? Math.max(1, weapon.rof?.full ?? 1) : 1;
    if (accrual === 'semi') ctx.additionalHits = Math.floor((test.dos - 1) / 2);
    else if (accrual === 'full') ctx.additionalHits = test.dos - 1;
    else ctx.additionalHits = 0;
    ctx.fireRate = fireRate;
    runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_MULT, ctx);
    if (actionInfo.rate !== 'single' && ctx.additionalHits > fireRate - 1) ctx.additionalHits = fireRate - 1;
    if (ctx.additionalHits < 0) ctx.additionalHits = 0;
    runCheckpoint(registry, CHECKPOINTS.HIT_COUNT_BONUS, ctx);
    const additionalHits = ctx.additionalHits;

    // locations + penetration
    const sb = Math.floor((characteristics.s ?? 0) / 10) + unnaturalStrength;
    const sbTimes = strengthBonusMultiple(weapon, isMelee);
    // Spray always strikes the Body and cannot make Called Shots (p.149)
    const firstLocation = isSpray ? 'Body'
        : (action === 'Called Shot' && input.calledShotLocation)
            ? input.calledShotLocation : getHitLocationForRoll(test.roll);
    const pen = Number(weapon.pen) || 0;
    ctx.pen = pen; ctx.penModifiers = {}; ctx.firstLocation = firstLocation;
    runCheckpoint(registry, CHECKPOINTS.PENETRATION, ctx);
    const penModifiers = ctx.penModifiers;
    const totalPen = pen + Object.values(penModifiers).reduce((a, b) => a + b, 0);
    const locations = [];
    for (let i = 0; i <= additionalHits; i++) {
        locations.push((!isSpray && action === 'Called Shot' && input.calledShotLocation)
            ? input.calledShotLocation : ADDITIONAL_HIT_LOCATIONS[firstLocation][Math.min(i, 5)]);
    }

    const fellingReduction = ctx.unnaturalToughnessReduction || 0;   // Felling (set at PENETRATION)
    return { ctx, base, success: true, scatter: undefined, hitMeta: { locations, sb, sbTimes, pen, penModifiers, totalPen, fellingReduction } };
}

/** Roll one hit's damage given the resolved attack context. `targetArmour` is the
 *  defender's AP at the struck location (for Graviton: +damage = armour). */
function rollHitDamage(weapon, action, hitMeta, location, dos, src, rng, registry, targetArmour = 0) {
    return rollDamage({
        formula: weapon.damage, qualities: weapon.qualities ?? [],
        sbTimes: hitMeta.sbTimes, strengthBonus: hitMeta.sb, dos, action, location,
        damageType: weapon.damageType ?? 'Impact',
        talents: src.talents ?? [], traits: src.traits ?? [], statuses: src.conditions ?? src.statuses ?? [], circumstances: src.circumstances ?? [], firingModes: src.firingModes ?? [], configs: src.configs ?? src.firingModes ?? [],
        isMelee: !!weapon.isMelee, aimValue: AIM_MODES[src.aim ?? 'None'] ?? 0,
        rangeBand: weapon.isMelee ? 'Melee' : (src.rangeBand ?? 'Normal Range'),
        craftsmanship: weapon.craftsmanship ?? 'Common', targetArmour,
        target: src.target ?? null,   // target.* scoped facts at the damage checkpoints
        psyRating: Number(src.psyRating) || 0,   // Force (p.145)
        characteristics: src.characteristics ?? {},   // ws_bonus/bs_bonus (Mighty Shot, Crushing Blow)
    }, rng, registry);
}

/** Run ON_HIT for a landed hit, attaching declared target tests/statuses and
 *  resolving Corrosive armour damage. `reduced` is a per-location accumulator of
 *  Armour Points already corroded this attack (cumulative across hits); `effArmour`
 *  is the struck location's current AP (base − already corroded), surfaced to the
 *  DSL as the `target_armour` fact. */
function applyOnHit(hit, attacker, target, dmg, registry, rng, autoRoll, reduced = new Map(), effArmour = null) {
    const ctx = new RollContext({
        qualities: canonList(attacker.weapon?.qualities), target, location: hit.location, rng,
        targetArmour: effArmour ?? (Number(target?.armour) || 0),
        characteristics: attacker.characteristics ?? {},   // bs_bonus etc. for ON_HIT expressions (Indirect's 1d10 − bs_bonus)
        isMelee: !!attacker.weapon?.isMelee, action: attacker.action ?? 'Standard Attack',
        talents: canonList(attacker.talents), traits: canonList(attacker.traits), statuses: attacker.conditions ?? attacker.statuses ?? [], circumstances: attacker.circumstances ?? [],
        damageDealt: dmg.error ? 0 : dmg.total, woundsInflicted: hit.soak?.woundsInflicted ?? null,
        targetEffects: { tests: [], statuses: [], armour: [] },
    });
    runCheckpoint(registry, CHECKPOINTS.ON_HIT, ctx);
    const te = ctx.targetEffects;
    if (te.armour.length && target) resolveCorrosion(te.armour, hit, target, reduced);
    // unconditional roll_on declarations (e.g. Haywire) — roll each table now and
    // apply any statuses its row carries to the target.
    const tableRolls = [];
    for (const tr of (ctx.tableRolls ?? [])) {
        const tbl = registry.table(tr.table);
        if (!tbl) { tableRolls.push({ table: tr.table, error: 'unknown roll_table', source: tr.source }); continue; }
        const res = resolveTable(tbl, rng, tr.modifier);
        res.source = tr.source;
        if (tr.area != null) res.area = tr.area;   // e.g. Haywire's X-metre field radius
        tableRolls.push(res);
        for (const st of res.statuses) te.statuses.push({ source: res.table, status: st, value: null, reason: `rolled ${res.roll} on ${res.table}` });
    }
    if (target) resolveTargetTests(te.tests, target, rng, autoRoll, registry);
    // a failed test's linked table (Hallucinogenic) or condition (Flame → On Fire)
    for (const t of te.tests) {
        for (const st of (t.resolved?.tableRoll?.statuses ?? []))
            te.statuses.push({ source: t.resolved.tableRoll.table, status: st, value: null, reason: `failed ${t.characteristic} test → rolled ${t.resolved.tableRoll.roll}` });
        if (t.resolved?.appliedCondition) {
            const ac = t.resolved.appliedCondition;
            te.statuses.push({ source: t.source, status: ac.name, value: ac.value ?? null, duration: ac.duration ?? null, location: ac.location ?? null, reason: `failed ${t.characteristic} test` });
        }
    }
    // a PASSED avoids_hit test negates the hit entirely (Spray, p.149) —
    // wounds are voided by the caller when totalling.
    if (te.tests.some((t) => t.avoidsHit && t.resolved?.success)) {
        hit.avoided = true;
        hit.avoidedBy = te.tests.find((t) => t.avoidsHit && t.resolved?.success)?.characteristic;
    }
    // smokescreens declared at the impact point (Smoke (X), p.149)
    if (ctx.smokeScreens?.length) hit.smoke = ctx.smokeScreens;
    // per-hit scatter (Indirect (X), p.147): direction from the Scatter Diagram
    if (ctx.hitScatterDistance != null) {
        const dirTable = registry.table('Scatter Diagram');
        const dir = dirTable ? resolveTable(dirTable, rng) : { roll: d(10, rng, 'scatter direction') };
        hit.scatter = { direction: dir.roll, distance: ctx.hitScatterDistance };
        if (dir.text) hit.scatter.directionText = dir.text;
    }
    if (te.tests.length || te.statuses.length || te.armour.length || tableRolls.length) {
        if (tableRolls.length) te.tableRolls = tableRolls;
        hit.targetEffects = te;
    }
}

/** Apply Corrosive (DH2 core p.145): each declaration corrodes the struck
 *  location's Armour Points by `amount` (permanent, cumulative per location); any
 *  amount beyond the current AP — or the whole amount if unarmoured — is dealt to
 *  the target as wounds, NOT reduced by Toughness. Normal soak for this hit has
 *  already happened, so the reduction only lowers AP for subsequent hits; the
 *  current hit gains only the overflow. Records the AP change for the report and
 *  accumulates the overflow on `hit.corrosiveWounds`. */
function resolveCorrosion(declarations, hit, target, reduced) {
    const baseArmour = Number(target.armour) || 0;
    for (const dec of declarations) {
        const already = reduced.get(hit.location) || 0;
        const apBefore = Math.max(0, baseArmour - already);
        dec.rolled = dec.amount;
        dec.apBefore = apBefore;
        dec.apAfter = Math.max(0, apBefore - dec.amount);
        dec.excessToWounds = Math.max(0, dec.amount - apBefore);
        reduced.set(hit.location, already + dec.amount);
        hit.corrosiveWounds = (hit.corrosiveWounds || 0) + dec.excessToWounds;
    }
}

export function resolveAttack(input, rng = Math.random, registry = defaultRegistry) {
    const { weapon = {}, target, characteristics = {} } = input;
    const autoResolveTests = !!input.autoResolveTests;
    const action = canonicalAction(input.action) ?? input.action ?? 'Standard Attack';
    const { ctx, base, success, scatter, hitMeta } = runToHit(input, rng, registry);
    const result = { ...base, hits: [] };
    if (!success) { if (scatter) result.scatter = scatter; return result; }

    const reduced = new Map();   // location → AP corroded so far (Corrosive, cumulative)
    for (let i = 0; i < hitMeta.locations.length; i++) {
        const location = hitMeta.locations[i];
        const dmg = rollHitDamage(weapon, action, hitMeta, location, ctx.test.dos, input, rng, registry, Number(target?.armour) || 0);
        const hit = {
            hitNumber: i + 1, location, damageType: dmg.damageType ?? weapon.damageType ?? 'Impact', damage: dmg,
            penetration: hitMeta.pen, penetrationModifiers: hitMeta.penModifiers, totalPenetration: hitMeta.totalPen,
        };
        const effArmour = Math.max(0, (Number(target?.armour) || 0) - (reduced.get(location) || 0));
        if (target && !dmg.error) {
            hit.soak = applySoak({
                damage: dmg.total, penetration: hitMeta.totalPen,
                armour: effArmour,
                toughnessBonus: target.toughnessBonus ?? Math.floor((characteristics.t ?? 0) / 10),
                unnaturalToughness: Number(target.unnaturalToughness) || 0,
                felling: hitMeta.fellingReduction || 0,
            });
        }
        applyOnHit(hit, input, target, dmg, registry, rng, autoResolveTests, reduced, effArmour);
        // Spray: a natural 9 on any damage die jams the weapon (after this attack)
        if (dmg.sprayJam && !result.effects.some((e) => e.name === 'Jam')) {
            result.effects.push({ name: 'Jam', effect: 'Spray: a natural 9 was rolled on a damage die — the weapon jams after this attack (p.149)' });
        }
        result.hits.push(hit);
    }
    result.totalWounds = target
        ? result.hits.reduce((a, h) => a + (h.avoided ? 0 : (h.soak?.woundsInflicted ?? 0) + (h.corrosiveWounds ?? 0)), 0)
        : undefined;
    return result;
}

const CHARACTERISTIC_KEY = { toughness: 'toughness', agility: 'agility', strength: 'strength', willpower: 'willpower' };

/** Roll a compiled roll_table: roll its die (+modifier), find the matching row,
 *  and return { table, roll, modifier, text, statuses }. The die roll is labelled
 *  with the table name so it appears in the debug roll trace and is forceable. */
function resolveTable(table, rng, modifier = 0) {
    let natural = 0;
    for (let k = 0; k < table.die.count; k++) natural += d(table.die.sides, rng, table.name);
    const roll = natural + modifier;
    const max = table.die.count * table.die.sides;
    const lookup = Math.min(max, Math.max(table.die.count, roll));   // clamp into the table's range
    const row = table.rows.find((r) => lookup >= r.lo && lookup <= r.hi);
    return { table: table.name, roll, modifier, text: row?.text ?? '(no matching row)', statuses: row?.statuses ?? [] };
}

/**
 * For each required target test, record the threshold (target characteristic +
 * modifier) so the report can always show what is rolled against; and, when
 * `autoRoll` is set, roll it and record the pass/fail + consequence. If a failed
 * test has a linked roll_table (Hallucinogenic), roll it and attach the result.
 */
function resolveTargetTests(tests, target, rng, autoRoll = true, registry = null) {
    for (const t of tests) {
        const key = CHARACTERISTIC_KEY[String(t.characteristic).toLowerCase()];
        const charVal = key ? target?.[key] : undefined;
        if (charVal == null) { t.note = `no defender ${t.characteristic} supplied`; continue; }
        t.characteristicValue = charVal;
        t.threshold = charVal + t.modifier;          // what the defender rolls ≤ to pass
        if (autoRoll) {
            const tt = rollTest({ target: charVal, modifiers: { test: t.modifier }, label: `${t.characteristic} test` }, rng);
            t.resolved = {
                roll: tt.roll, modifiedTarget: tt.modifiedTarget, success: tt.success, dof: tt.dof,
                outcome: tt.success ? 'resisted' : t.onFail,
            };
            if (!tt.success && t.onFailRollTable) {
                const tbl = registry?.table(t.onFailRollTable);
                t.resolved.tableRoll = tbl ? resolveTable(tbl, rng) : { table: t.onFailRollTable, error: 'unknown roll_table' };
            }
            if (!tt.success && t.onFailApply) t.resolved.appliedCondition = t.onFailApply;   // Flame → On Fire
            // lazy on-fail damage (Toxified's 1d10) — the dice roll only happens here
            if (!tt.success && typeof t.onFailDamage === 'function') t.resolved.damage = t.onFailDamage();
        } else if (t.onFailApply) {
            t.appliedConditionOnFail = t.onFailApply;   // manual mode: note what a failure applies
        }
        // thunks are not serialisable — replace with a marker for the report
        if (typeof t.onFailDamage === 'function') t.onFailDamage = 'rolled on failure';
    }
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
    const qualities = canonList(weapon.qualities);   // canonical { name, level } (Stage 1)
    // the OPPOSING (attacking) weapon being parried — supplied as input.against in
    // an engagement so Power Field can read its qualities (and immunities).
    const opposing = input.against ?? null;

    const ctx = new RollContext({
        input, characteristics, weapon, qualities,
        opposingProvided: !!opposing, opposingQualities: canonList(opposing?.qualities),
        action: 'Parry', isMelee: true, rangeBand: 'Melee', aimValue: 0, rng,
        craftsmanship: weapon.craftsmanship ?? 'Common',
        talents: canonList(input.talents), traits: canonList(input.traits), statuses: input.conditions ?? input.statuses ?? [], circumstances: input.circumstances ?? [],
        combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
        effects: [],
        modifiers: {},
    });
    if (input.customModifier) ctx.modifiers.modifier = Number(input.customModifier) || 0;

    runCheckpoint(registry, CHECKPOINTS.PARRY, ctx);   // Balanced, Defensive, Unbalanced, Unwieldy, …

    // A weapon that cannot Parry (Unwieldy) refuses the reaction before any roll.
    if (ctx.cannotParry) {
        return {
            weapon: weapon.name ?? 'Unnamed weapon', action: 'Parry',
            prevented: true,
            note: 'Parry impossible — the weapon is Unwieldy (cannot be used to Parry)',
            test: { success: false, characteristic: 'WS', cannotParry: true },
            effects: ctx.effects, log: ctx.log,
        };
    }

    const test = rollTest({ target: characteristics.ws ?? 0, modifiers: ctx.modifiers, label: 'parry (WS)', unnatural: Number(input.unnatural?.ws) || 0 }, rng);
    test.characteristic = 'WS';
    ctx.test = test;
    ctx.success = test.success;

    // POST_PARRY: rules that fire once the parry's success is known (Power Field
    // rolls to destroy the attacker's weapon on a successful parry).
    ctx.tableRolls = [];
    runCheckpoint(registry, CHECKPOINTS.POST_PARRY, ctx);
    const tableRolls = [];
    for (const tr of ctx.tableRolls) {
        const tbl = registry.table(tr.table);
        if (!tbl) { tableRolls.push({ table: tr.table, error: 'unknown roll_table', source: tr.source }); continue; }
        const res = resolveTable(tbl, rng, tr.modifier);
        res.source = tr.source;
        tableRolls.push(res);
    }

    const out = {
        weapon: weapon.name ?? 'Unnamed weapon',
        action: 'Parry',
        test,
        effects: ctx.effects,
        log: ctx.log,
    };
    if (tableRolls.length) out.tableRolls = tableRolls;
    return out;
}

// ------------------------------------------------------------ evasion -------

/** Resolve a Dodge (Agility) evasion test. Parry evasion delegates to resolveParry. */
function resolveDodge(defender, rng, registry) {
    const c = defender.characteristics ?? {};
    const ctx = new RollContext({
        input: defender, characteristics: c, weapon: {}, qualities: [],
        action: 'Dodge', isMelee: false, rangeBand: 'Melee', aimValue: 0, rng, craftsmanship: 'Common',
        talents: canonList(defender.talents), traits: canonList(defender.traits), statuses: defender.conditions ?? defender.statuses ?? [], circumstances: defender.circumstances ?? [],
        combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
        modifiers: {},
    });
    if (defender.evasion?.modifier) ctx.modifiers.modifier = Number(defender.evasion.modifier) || 0;
    runCheckpoint(registry, CHECKPOINTS.EVASION, ctx);
    const test = rollTest({ target: c.agility ?? c.ag ?? 0, modifiers: ctx.modifiers, label: 'dodge (Ag)', unnatural: Number(defender.unnatural?.ag) || 0 }, rng);
    test.characteristic = 'Ag';
    return { mode: 'dodge', test, log: ctx.log };
}

// ------------------------------------------------------------ engagement ----

const defenderTarget = (d) => ({
    armour: Number(d.armour) || 0,
    toughnessBonus: d.toughnessBonus ?? Math.floor((d.characteristics?.t ?? 0) / 10),
    unnaturalToughness: Number(d.unnaturalToughness) || 0,
    toughness: d.characteristics?.t ?? 0,
    strength: d.characteristics?.s ?? 0,
    agility: d.characteristics?.ag ?? d.characteristics?.agility ?? 0,
    willpower: d.characteristics?.wp ?? d.characteristics?.willpower ?? 0,
    traits: canonList(d.traits),   // so target_has_trait() works (Sanctified vs Daemonic)
});

// The engagement is decomposed into four re-rollable phases (each rolls its own
// dice from fresh, so a phase can be re-rolled — e.g. a Fate Point reroll —
// without affecting earlier phases). resolveEngagement composes them; the same
// functions back the step-by-step /api/engage flow.

/** Phase ① — to-hit: the attack test, hit count, locations (no damage yet).
 *  `defender` is optional; when supplied, its normalized stats/traits are put on
 *  the to-hit context so PENETRATION rules that read the target work in the
 *  stepped flow too (e.g. Sanctified negating a Daemonic target's Unnatural
 *  Toughness — that reduction is computed at PENETRATION and carried in meta). */
export function engageAttackRoll(attacker, registry = defaultRegistry, rng = Math.random, defender = null) {
    const input = defender ? { ...attacker, target: defenderTarget(defender) } : attacker;
    const { base, success, scatter, hitMeta } = runToHit(input, rng, registry);
    const out = { ...base, success, hits: [] };
    if (scatter) out.scatter = scatter;
    if (success) {
        out.hits = hitMeta.locations.map((location, i) => ({ hitNumber: i + 1, location }));
        out.meta = { dos: out.test.dos, sb: hitMeta.sb, sbTimes: hitMeta.sbTimes, pen: hitMeta.pen, penModifiers: hitMeta.penModifiers, totalPen: hitMeta.totalPen, fellingReduction: hitMeta.fellingReduction };
    }
    return out;
}

/** Phase ② — damage: roll each hit's damage (using the phase-① meta). `defender`
 *  is optional and only supplies the target armour for Graviton (+damage = armour). */
export function engageDamage(attacker, attackState, registry = defaultRegistry, rng = Math.random, defender = null) {
    const weapon = attacker.weapon ?? {};
    const action = attacker.action ?? 'Standard Attack';
    const meta = attackState.meta ?? {};
    const targetArmour = Number(defender?.armour) || 0;
    // thread the normalised defender in as `target` so target.* scoped facts work
    const src = defender ? { ...attacker, target: defenderTarget(defender) } : attacker;
    const hits = (attackState.hits ?? []).map((h) => {
        const dmg = rollHitDamage(weapon, action, meta, h.location, meta.dos, src, rng, registry, targetArmour);
        return { hitNumber: h.hitNumber, location: h.location, damageType: dmg.damageType ?? weapon.damageType ?? 'Impact', damage: dmg, penetration: meta.pen, penetrationModifiers: meta.penModifiers, totalPenetration: meta.totalPen, fellingReduction: meta.fellingReduction || 0 };
    });
    return { hits };
}

/** Phase ③ — defender reaction: Dodge (Ag) or Parry (WS). `attackPreventsParry`
 *  (Flexible) overrides any attempt to Parry — the safeguard. */
export function engageEvasion(defender, attackDos, registry = defaultRegistry, rng = Math.random, attackPreventsParry = false, attackerWeapon = null) {
    const mode = defender.evasion?.mode;
    if (mode !== 'dodge' && mode !== 'parry') return { reaction: null, evaded: 0 };
    if (mode === 'parry' && attackPreventsParry) {
        return { reaction: { mode: 'parry', prevented: true, note: 'Parry prevented — the attacking weapon is Flexible (cannot be Parried)' }, evaded: 0 };
    }
    const reaction = mode === 'parry'
        ? { mode: 'parry', ...resolveParry({ characteristics: { ws: defender.characteristics?.ws ?? 0 }, weapon: defender.weapon ?? {}, against: attackerWeapon, customModifier: defender.evasion?.modifier, unnatural: defender.unnatural, talents: defender.talents, traits: defender.traits, statuses: defender.conditions ?? defender.statuses, circumstances: defender.circumstances }, rng, registry) }
        : resolveDodge(defender, rng, registry);
    // A refused parry (Unwieldy weapon) negates nothing.
    if (reaction.prevented) return { reaction, evaded: 0 };
    // A successful Dodge negates more hits by DoS; a Parry negates one.
    const evaded = reaction.test.success ? (mode === 'parry' ? 1 : 1 + Math.floor(reaction.test.dos / 2)) : 0;
    return { reaction, evaded };
}

/** Phase ④ — soak & apply: per hit, Force Field → soak → on-hit target effects. */
export function engageOnHit(attacker, defender, damageHits, evaded, options = {}, registry = defaultRegistry, rng = Math.random) {
    const target = defenderTarget(defender);
    const field = defender.field;
    let fieldDown = false;
    const reduced = new Map();   // location → AP corroded so far (Corrosive, cumulative)
    // Phase 4: persistent AP damage from earlier engagements (EncounterState's
    // armourDamage) seeds the accumulator, so corrosion carries across attacks.
    for (const [loc, n] of Object.entries(options.armourDamage ?? {})) reduced.set(loc, Number(n) || 0);
    const hits = damageHits.map((h, i) => {
        const hit = { ...h };
        if (i < evaded) { hit.evaded = true; return hit; }
        if (field && field.rating > 0 && !fieldDown) {
            const roll = d(100, rng, `force field (hit ${i + 1})`);
            const absorbed = roll <= field.rating;
            const overloaded = field.overloadMax > 0 && roll <= field.overloadMax;
            hit.field = { roll, rating: field.rating, absorbed, overloaded };
            if (overloaded) fieldDown = true;
            if (absorbed) { hit.fieldAbsorbed = true; return hit; }
        }
        const effArmour = Math.max(0, (Number(target.armour) || 0) - (reduced.get(hit.location) || 0));
        if (!hit.damage.error) {
            hit.soak = applySoak({ damage: hit.damage.total, penetration: hit.totalPenetration, armour: effArmour, toughnessBonus: target.toughnessBonus, unnaturalToughness: target.unnaturalToughness, felling: hit.fellingReduction || 0 });
        }
        applyOnHit(hit, attacker, target, hit.damage, registry, rng, options.autoResolveTests, reduced, effArmour);
        return hit;
    });
    const totalWounds = hits.reduce((a, h) => a + ((h.evaded || h.fieldAbsorbed || h.avoided) ? 0 : ((h.soak?.woundsInflicted ?? 0) + (h.corrosiveWounds ?? 0))), 0);
    return { hits, totalWounds, fieldDown };
}

/**
 * Resolve a full engagement atomically by composing the four phases:
 * attack → damage → defender reaction → soak/apply/on-hit.
 * input = { attacker, defender, options }
 */
export function resolveEngagement(input, rng = Math.random, registry = defaultRegistry) {
    const { attacker = {}, defender = {}, options = {} } = input;
    const attack = engageAttackRoll(attacker, registry, rng, defender);
    const result = { attack, reaction: null, defender: { evaded: 0, fieldDown: false } };
    if (!attack.success || !attack.hits.length) return result;

    attack.hits = engageDamage(attacker, attack, registry, rng, defender).hits;

    const ev = engageEvasion(defender, attack.test.dos, registry, rng, attack.preventsParry, attacker.weapon ?? null);
    result.reaction = ev.reaction;
    const evaded = Math.min(ev.evaded, attack.hits.length);
    result.defender.evaded = evaded;

    const onhit = engageOnHit(attacker, defender, attack.hits, evaded, options, registry, rng);
    attack.hits = onhit.hits;
    attack.totalWounds = onhit.totalWounds;
    result.defender.fieldDown = onhit.fieldDown;
    return result;
}
