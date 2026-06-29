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
import { DslError } from './tokenizer.mjs';

const num = (x) => Number(x) || 0;

/** Case-insensitive membership test over a list of named strings (prefix match
 *  so "Brutal Charge (3)" satisfies has_trait("Brutal Charge")). */
const hasNamed = (list, name) => (list ?? [])
    .map(String).some((x) => x.toLowerCase().startsWith(String(name).toLowerCase()));

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
    // action context
    action:      (c) => c.action ?? '',
    range:       (c) => c.rangeBand ?? '',
    aim:         (c) => c.aimValue ?? 0,
    // Aiming conditions — true via the Aim action (aimValue 10/20) OR an applied
    // "Half Aim" / "Full Aim" status.
    half_aim:    (c) => c.aimValue === 10 || hasNamed(c.statuses, 'Half Aim'),
    full_aim:    (c) => c.aimValue === 20 || hasNamed(c.statuses, 'Full Aim'),
    location:    (c) => c.location ?? '',
    damage_type: (c) => c.damageType ?? '',
    hit_index:   (c) => c.hitIndex ?? 0,
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
    has_status:    (c, [name]) => hasNamed(c.statuses ?? c.actor?.statuses, name),
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
            for (let k = 0; k < node.count; k++) sum += d(node.sides, ctx.rng);
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
