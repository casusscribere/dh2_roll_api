/**
 * DH2 Trait DSL — interpreter.
 *
 * Evaluates a parsed AST against a RollContext. Safety is the whole point:
 * predicates/expressions are walked over a WHITELISTED fact + function table —
 * there is no `eval`, no `Function`, and no access to context properties beyond
 * what FACTS/FUNCTIONS expose. User-supplied rule text therefore cannot reach
 * arbitrary state or code.
 *
 * The fact table is the single seam that maps DSL names onto the engine's
 * context shape; growing the vocabulary means adding an entry here (and nothing
 * in the engine changes).
 */
import { d } from '../dice.mjs';
import { hasQuality, qualityLevel } from '../rules/_util.mjs';
import { actionType, isReaction, isAction, actionHasSubtype } from '../actions.mjs';
import { DslError } from './tokenizer.mjs';

const num = (x) => Number(x) || 0;

/** The display name of a list entry, which may be a bare string ("On Fire") or a
 *  structured Condition object ({ name, severity?, duration?, location? }). */
const nameOf = (x) => (x && typeof x === 'object') ? String(x.name ?? '') : String(x ?? '');

/** Case-insensitive membership test over a list of named strings/objects (prefix
 *  match so "Brutal Charge (3)" satisfies has_trait("Brutal Charge")). */
const hasNamed = (list, name) => (list ?? [])
    .some((x) => nameOf(x).toLowerCase().startsWith(String(name).toLowerCase()));

/** Find the first list entry matching `name` (for reading a Condition's variables). */
const findNamed = (list, name) => (list ?? [])
    .find((x) => nameOf(x).toLowerCase().startsWith(String(name).toLowerCase()));

/** Read-only facts exposed to `when` predicates and action expressions. */
export const FACTS = {
    // weapon / actor
    is_melee:    (c) => !!c.isMelee,
    is_ranged:   (c) => (c.isMelee === undefined ? true : !c.isMelee),
    pen:         (c) => c.pen ?? 0,
    sb:          (c) => c.strengthBonus ?? Math.floor(num(c.characteristics?.s) / 10),
    tb:          (c) => c.toughnessBonus ?? Math.floor(num(c.characteristics?.t) / 10),
    bs_bonus:    (c) => Math.floor(num(c.characteristics?.bs) / 10),
    ws_bonus:    (c) => Math.floor(num(c.characteristics?.ws) / 10),
    // test / outcome
    roll:        (c) => c.test?.roll ?? c.roll ?? 0,
    dos:         (c) => c.test?.dos ?? c.dos ?? 0,
    dof:         (c) => c.test?.dof ?? c.dof ?? 0,
    success:     (c) => c.test?.success ?? c.success ?? false,
    // weapon mechanic / craftsmanship
    jam_threshold:  (c) => c.jamThreshold ?? 96,   // ranged weapon jams on roll > this
    craftsmanship:  (c) => c.craftsmanship ?? 'Common',
    // action context
    action:      (c) => c.action ?? '',
    action_type: (c) => actionType(c.action),   // 'Half' | 'Full' | 'Reaction' | 'Free'
    is_attack:   (c) => actionHasSubtype(c.action, 'attack'),   // the action has the key 'attack' subtype
    range:       (c) => c.rangeBand ?? '',
    aim:         (c) => c.aimValue ?? 0,
    // Aiming conditions — true via the Aim action (aimValue 10/20) OR an applied
    // "Half Aim" / "Full Aim" status.
    half_aim:    (c) => c.aimValue === 10 || hasNamed(c.statuses, 'Half Aim'),
    full_aim:    (c) => c.aimValue === 20 || hasNamed(c.statuses, 'Full Aim'),
    location:    (c) => c.location ?? '',
    damage_type: (c) => c.damageType ?? '',
    hit_index:   (c) => c.hitIndex ?? 0,
    // per-hit target outcome (ON_HIT): damage dealt and wounds after soak, plus
    // the target's S/T bonuses (from the optional target block).
    damage_dealt: (c) => c.damageDealt ?? 0,
    wounds:       (c) => c.woundsInflicted ?? 0,
    target_sb:    (c) => c.target?.strengthBonus ?? Math.floor(num(c.target?.strength) / 10),
    target_tb:    (c) => c.target?.toughnessBonus ?? Math.floor(num(c.target?.toughness) / 10),
    target_unnatural_toughness: (c) => num(c.target?.unnaturalToughness),   // the Unnatural Toughness bonus (Felling reduces it)
    // current Armour Points at the struck location (base AP minus any already
    // corroded this attack); 0 if unarmoured. Read at ON_HIT.
    target_armour: (c) => c.targetArmour ?? num(c.target?.armour),
    // parry context: the OPPOSING (attacking) weapon being parried — used by
    // Power Field (destroys the attacker's weapon unless it is immune).
    opposing_present: (c) => !!c.opposingProvided,
    // combat state (populated in the dual-wield step; safe defaults until then)
    dual_wielding:  (c) => !!c.combat?.dualWielding,
    firing_offhand: (c) => !!c.combat?.firingOffhand,
    firing_both:    (c) => !!c.combat?.firingBoth,
};

/** Whitelisted functions callable from the DSL. */
export const FUNCTIONS = {
    has_quality:   (c, [name]) => hasQuality(c.qualities, String(name)),
    has_talent:    (c, [name]) => hasNamed(c.talents ?? c.actor?.talents, name),
    has_trait:     (c, [name]) => hasNamed(c.traits ?? c.actor?.traits, name),
    target_has_trait: (c, [name]) => hasNamed(c.target?.traits, name),   // a TRAIT on the target/defender (e.g. Daemonic, From Beyond) — for Sanctified
    opposing_has_quality: (c, [name]) => hasQuality(c.opposingQualities, String(name)),   // the parried (attacking) weapon's quality — for Power Field
    has_status:    (c, [name]) => hasNamed(c.statuses ?? c.actor?.statuses, name),   // alias of has_condition
    has_condition: (c, [name]) => hasNamed(c.statuses ?? c.actor?.statuses, name),   // active Conditions (Stunned, On Fire, Aiming, …)
    has_circumstance: (c, [name]) => hasNamed(c.circumstances ?? c.actor?.circumstances, name),   // environmental Circumstances
    circumstance_severity: (c, [name, dflt]) => findNamed(c.circumstances ?? c.actor?.circumstances, name)?.severity ?? num(dflt),   // severity of a structured Circumstance (e.g. Haywire Field)
    configuration: (c, [name]) => hasNamed(c.configs ?? c.firingModes, name),   // per-character toggle (Maximal, grip, …)
    firing_mode:   (c, [name]) => hasNamed(c.configs ?? c.firingModes, name),   // alias of configuration()
    // structured-Condition variable accessors (when conditions[] carry objects)
    condition_severity: (c, [name, dflt]) => findNamed(c.statuses ?? c.actor?.statuses, name)?.severity ?? num(dflt),
    condition_duration: (c, [name, dflt]) => findNamed(c.statuses ?? c.actor?.statuses, name)?.duration ?? num(dflt),
    condition_location: (c, [name]) => findNamed(c.statuses ?? c.actor?.statuses, name)?.location ?? '',
    is_action:     (c, [name]) => isAction(c.action, name),
    is_reaction:   (c) => isReaction(c.action),
    action_subtype: (c, [name]) => actionHasSubtype(c.action, name),   // the action carries a named subtype
    quality_level: (c, [name, dflt]) => qualityLevel(c.qualities, String(name), dflt),
    trait_level:   (c, [name, dflt]) => qualityLevel(c.traits, String(name), dflt),
    tens:          (c, [n]) => Math.floor(num(n) / 10),
    is_natural:    (c, [n]) => (c.test?.roll ?? c.roll) === n,
};

/** Evaluate any predicate/expression node against the context. */
export function evalNode(node, ctx) {
    switch (node.type) {
        case 'Number':
        case 'String':
        case 'Boolean':
            return node.value;
        case 'Dice': {
            let sum = 0;
            for (let k = 0; k < node.count; k++) sum += d(node.sides, ctx.rng, ctx.rollLabel ?? 'dsl');
            return sum;
        }
        case 'Identifier': {
            const fact = FACTS[node.name];
            if (!fact) throw new DslError(`Unknown fact '${node.name}'`, 0, 0);
            return fact(ctx);
        }
        case 'Call': {
            const fn = FUNCTIONS[node.name];
            if (!fn) throw new DslError(`Unknown function '${node.name}'`, 0, 0);
            return fn(ctx, node.args.map((a) => evalNode(a, ctx)));
        }
        case 'Unary':
            return node.op === 'neg' ? -evalNode(node.operand, ctx) : !evalNode(node.operand, ctx);
        case 'Logical':
            return node.op === 'and'
                ? Boolean(evalNode(node.left, ctx)) && Boolean(evalNode(node.right, ctx))
                : Boolean(evalNode(node.left, ctx)) || Boolean(evalNode(node.right, ctx));
        case 'Comparison': {
            const l = evalNode(node.left, ctx);
            const r = evalNode(node.right, ctx);
            switch (node.op) {
                case '==': return l === r;
                case '!=': return l !== r;
                case '>':  return l > r;
                case '<':  return l < r;
                case '>=': return l >= r;
                case '<=': return l <= r;
            }
            break;
        }
        case 'Binary': {
            const l = evalNode(node.left, ctx);
            const r = evalNode(node.right, ctx);
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
            }
            break;
        }
    }
    throw new DslError(`Cannot evaluate node '${node.type}'`, 0, 0);
}

/** Apply one action node's mutation to the context. `meta.penKey` names the
 *  penetration-modifier slot for `set pen += …` (defaults from the rule name). */
export function applyAction(action, ctx, meta = {}) {
    // label any dice rolled while evaluating this action's value (corrode, scatter
    // base, bonus dice) so the debug roll trace can name them.
    ctx.rollLabel = meta.ruleName ?? action.name ?? action.action;
    switch (action.action) {
        case 'add_modifier':
        case 'set_modifier':
            ctx.modifiers[action.name] = evalNode(action.value, ctx);
            break;
        case 'cancel_modifier':
            delete ctx.modifiers[action.name];
            break;
        case 'add_die':
            ctx.extraDice = (ctx.extraDice || 0) + evalNode(action.value, ctx);
            break;
        case 'keep_highest':
            ctx.keepHighest = ctx.parsed.count;
            ctx.tearing = true;
            break;
        case 'add_hits':
            ctx.additionalHits = (ctx.additionalHits || 0) + evalNode(action.value, ctx);
            break;
        case 'multiply_hits':
            ctx.additionalHits = (ctx.additionalHits || 0) * evalNode(action.value, ctx);
            break;
        case 'set_pen':
            if (action.op === '+=') {
                const key = meta.penKey ?? 'penetration';
                ctx.penModifiers[key] = (ctx.penModifiers[key] || 0) + evalNode(action.value, ctx);
            } else {
                ctx.pen = evalNode(action.value, ctx);
            }
            break;
        case 'set_rf_threshold':
            ctx.rfThreshold = evalNode(action.value, ctx);
            break;
        case 'set_jam_threshold':
            ctx.jamThreshold = evalNode(action.value, ctx);
            break;
        case 'set_damage_type':
            // override the damage type of this hit (e.g. Sanctified → "Holy",
            // Force → "Energy"). rollDamage surfaces ctx.damageType on the result.
            ctx.damageType = evalNode(action.value, ctx);
            break;
        case 'set_scatter':
            if (action.op === '+=') {
                // a DSL-alterable scatter-distance modifier (keyed by rule name)
                const key = meta.penKey ?? 'scatter';
                ctx.scatterModifiers[key] = (ctx.scatterModifiers[key] || 0) + evalNode(action.value, ctx);
            } else {
                // set the base scatter distance and activate scatter for this miss
                ctx.scatter = { active: true, base: evalNode(action.value, ctx) };
            }
            break;
        case 'floor_die': {
            const n = evalNode(action.value, ctx);
            ctx.proven = n;
            ctx.dieTransforms.push((v) => (v < n ? n : v));
            break;
        }
        case 'cap_die': {
            const n = evalNode(action.value, ctx);
            ctx.primitive = n;
            ctx.dieTransforms.push((v) => (v > n ? n : v));
            break;
        }
        case 'emit':
            ctx.effects.push({ name: action.name, effect: action.text ?? '' });
            break;
        case 'fail':
            ctx.success = false;
            break;
        case 'suppress':
            // suppress another rule by name for the rest of this checkpoint run
            // (e.g. Overheats suppressing the baseline Jam mechanic). runCheckpoint
            // skips any effect whose name is in ctx.suppressed.
            (ctx.suppressed ??= new Set()).add(action.name);
            break;
        case 'prevent_parry':
            // the attack cannot be Parried (e.g. Flexible); the engine refuses a
            // Parry reaction and notes it
            ctx.preventParry = true;
            break;
        case 'cannot_parry':
            // THIS weapon cannot be used to Parry (e.g. Unwieldy); the parry flow
            // refuses the reaction and notes it.
            ctx.cannotParry = true;
            break;
        case 'detonate':
            // mark that this (scattering) weapon detonates at the scatter point,
            // so the engine still resolves its damage on a miss (e.g. Blast)
            ctx.detonate = true;
            break;
        case 'bump_quality': {
            // increase an existing weapon quality's rating in place (e.g. Maximal
            // raising Blast (3) → Blast (5)). No-op if the weapon lacks it.
            const by = evalNode(action.value, ctx);
            const list = ctx.qualities ?? [];
            const idx = list.findIndex((q) => String(q).toLowerCase().startsWith(String(action.name).toLowerCase()));
            if (idx >= 0) {
                const cur = qualityLevel([list[idx]], action.name, 0);
                // replace with a fresh array — never mutate the caller's weapon.qualities
                ctx.qualities = list.map((q, i) => (i === idx ? `${action.name} (${cur + by})` : q));
                // named after the bumped quality (not the rule) so it doesn't read
                // as a duplicate of the rule's own note (e.g. "Blast ↑", not "Maximal")
                (ctx.effects ??= []).push({ name: `${action.name} ↑`, effect: `${action.name} (${cur}) → (${cur + by})` });
            }
            break;
        }
        case 'add_quality': {
            // add a weapon quality this shot (e.g. Maximal granting Recharge).
            // Fresh array — never mutate the caller's weapon.qualities. No-op if present.
            const list = ctx.qualities ?? [];
            if (!list.some((q) => String(q).toLowerCase().startsWith(String(action.name).toLowerCase()))) {
                ctx.qualities = [...list, action.name];
            }
            break;
        }
        case 'reduce_unnatural_toughness':
            // Felling: reduce the target's Unnatural Toughness bonus for this damage
            // calc only (accumulated; the engine clamps at the soak step).
            ctx.unnaturalToughnessReduction = (ctx.unnaturalToughnessReduction || 0) + evalNode(action.value, ctx);
            break;
        case 'require_test':
            // declare a test the target must pass, or suffer `onFail`; on failure,
            // optionally roll a roll_table (onFailRollTable) or apply a Condition
            // (onFailApply, e.g. Flame → On Fire).
            ctx.targetEffects.tests.push({
                source: meta.ruleName ?? meta.penKey,
                characteristic: action.characteristic,
                modifier: evalNode(action.value, ctx),
                onFail: action.onFail,
                onFailRollTable: action.onFailRollTable ?? null,
                // evaluate the on-fail condition's structured vars now (e.g. Flame
                // → On Fire with a duration), so the engine just attaches them.
                onFailApply: action.onFailApply ? {
                    name: action.onFailApply.name,
                    value: action.onFailApply.value != null ? evalNode(action.onFailApply.value, ctx) : null,
                    duration: action.onFailApply.duration != null ? evalNode(action.onFailApply.duration, ctx) : null,
                    location: action.onFailApply.location != null ? evalNode(action.onFailApply.location, ctx) : null,
                } : null,
            });
            break;
        case 'roll_on':
            // declare a roll on a named roll_table; the engine resolves it after
            // the checkpoint (works in any flow — ON_HIT effects, ON_MISS scatter).
            // `area` (e.g. Haywire's X-metre radius) is surfaced with the result.
            (ctx.tableRolls ??= []).push({
                source: meta.ruleName ?? meta.penKey,
                table: action.table,
                modifier: action.value != null ? evalNode(action.value, ctx) : 0,
                area: action.area != null ? evalNode(action.area, ctx) : null,
            });
            break;
        case 'corrode':
            // declare Corrosive armour damage; the engine resolves the AP loss
            // and the Toughness-ignoring excess after ON_HIT (see resolveCorrosion)
            (ctx.targetEffects.armour ??= []).push({ source: meta.ruleName ?? meta.penKey, amount: evalNode(action.value, ctx) });
            break;
        case 'apply_status':
            // apply a Condition with optional structured variables (severity,
            // duration in rounds, hit location)
            ctx.targetEffects.statuses.push({
                source: meta.ruleName ?? meta.penKey, status: action.name,
                value: action.value != null ? evalNode(action.value, ctx) : null,
                duration: action.duration != null ? evalNode(action.duration, ctx) : null,
                location: action.location != null ? evalNode(action.location, ctx) : null,
                reason: action.reason ?? null,
            });
            break;
        default:
            throw new DslError(`Unknown action '${action.action}'`, 0, 0);
    }
}

/** Collect Identifier (fact) and Call (function) names used in a node, for
 *  compile-time validation against the whitelists. */
export function collectNames(node, acc = { facts: new Set(), calls: new Set() }) {
    if (!node || typeof node !== 'object') return acc;
    switch (node.type) {
        case 'Identifier': acc.facts.add(node.name); break;
        case 'Call': acc.calls.add(node.name); node.args.forEach((a) => collectNames(a, acc)); break;
        case 'Logical':
        case 'Comparison':
        case 'Binary': collectNames(node.left, acc); collectNames(node.right, acc); break;
        case 'Unary': collectNames(node.operand, acc); break;
    }
    return acc;
}
