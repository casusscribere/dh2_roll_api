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
import { qualityLevel } from '../rules/_util.mjs';
import { DslError } from './tokenizer.mjs';
import {
    FLAT_FACTS, FLAT_FUNCTIONS, SCOPED_FACTS, SCOPED_FUNCTIONS, SCOPE_NAMES, nameOf,
    SLOT_DEFS, FLAG_DEFS,
} from './vocabulary.mjs';

/** Read-only facts (unscoped + legacy aliases) — DERIVED from vocabulary.mjs
 *  (Stage 2, single source). The scoped tables back `target.tb`-style paths. */
export const FACTS = FLAT_FACTS;
/** Whitelisted functions — derived from vocabulary.mjs. */
export const FUNCTIONS = FLAT_FUNCTIONS;

/** Resolve a possibly-scoped fact getter, or throw. */
const factGetter = (scope, name) => {
    const get = scope ? SCOPED_FACTS[scope]?.[name] : FACTS[name];
    if (!get) {
        throw new DslError(scope
            ? `Unknown fact '${scope}.${name}'${SCOPE_NAMES.includes(scope) ? '' : ` (unknown scope '${scope}')`}`
            : `Unknown fact '${name}'`, 0, 0);
    }
    return get;
};
/** Resolve a possibly-scoped function, or throw. */
const fnGetter = (scope, name) => {
    const fn = scope ? SCOPED_FUNCTIONS[scope]?.[name] : FUNCTIONS[name];
    if (!fn) {
        throw new DslError(scope
            ? `Unknown function '${scope}.${name}()'${SCOPE_NAMES.includes(scope) ? '' : ` (unknown scope '${scope}')`}`
            : `Unknown function '${name}()'`, 0, 0);
    }
    return fn;
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
        case 'Identifier':
            return factGetter(node.scope ?? null, node.name)(ctx);
        case 'Call':
            return fnGetter(node.scope ?? null, node.name)(ctx, node.args.map((a) => evalNode(a, ctx)));
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
                // Integer semantics (Stage 3): division rounds UP — the DH2
                // global rounding rule (p.18). Use floor(a / b) for the rare
                // round-down case; half(n) is ceil(n/2).
                case '/': return Math.ceil(l / r);
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
        case 'set_slot': {
            // Generic Stage-3 mutation over the registered SLOT table
            // (vocabulary.mjs). All the old set-verbs (set pen, add_die,
            // reduce_unnatural_toughness, …) parse to this one case.
            const slot = SLOT_DEFS[action.slot];
            if (!slot) throw new DslError(`Unknown slot '${action.slot}'`, 0, 0);
            slot.apply(ctx, action.op ?? '=', evalNode(action.value, ctx), meta);
            break;
        }
        case 'set_flag': {
            // Generic boolean state over the registered FLAG table.
            const flag = FLAG_DEFS[action.flag];
            if (!flag) throw new DslError(`Unknown flag '${action.flag}'`, 0, 0);
            flag.apply(ctx);
            break;
        }
        case 'multiply_hits':
            ctx.additionalHits = (ctx.additionalHits || 0) * evalNode(action.value, ctx);
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
        case 'suppress':
            // suppress another rule by name for the rest of this checkpoint run
            // (e.g. Overheats suppressing the baseline Jam mechanic). runCheckpoint
            // skips any effect whose name is in ctx.suppressed.
            (ctx.suppressed ??= new Set()).add(action.name);
            break;
        case 'bump_quality': {
            // increase an existing weapon quality's rating in place (e.g. Maximal
            // raising Blast (3) → Blast (5)). No-op if the weapon lacks it.
            // Canonical form is { name, level } (Stage 1); tolerate raw strings.
            const by = evalNode(action.value, ctx);
            const list = ctx.qualities ?? [];
            const idx = list.findIndex((q) => nameOf(q).toLowerCase().startsWith(String(action.name).toLowerCase()));
            if (idx >= 0) {
                const cur = qualityLevel([list[idx]], action.name, 0);
                // replace with a fresh array — never mutate the caller's weapon.qualities
                ctx.qualities = list.map((q, i) => (i === idx ? { name: action.name, level: cur + by } : q));
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
            if (!list.some((q) => nameOf(q).toLowerCase().startsWith(String(action.name).toLowerCase()))) {
                ctx.qualities = [...list, { name: action.name, level: null }];
            }
            break;
        }
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
export function collectNames(node, acc = { facts: new Set(), calls: new Set(), scopedFacts: new Set(), scopedCalls: new Set() }) {
    if (!node || typeof node !== 'object') return acc;
    switch (node.type) {
        case 'Identifier':
            if (node.scope) acc.scopedFacts.add(`${node.scope}.${node.name}`);
            else acc.facts.add(node.name);
            break;
        case 'Call':
            if (node.scope) acc.scopedCalls.add(`${node.scope}.${node.name}`);
            else acc.calls.add(node.name);
            node.args.forEach((a) => collectNames(a, acc));
            break;
        case 'Logical':
        case 'Comparison':
        case 'Binary': collectNames(node.left, acc); collectNames(node.right, acc); break;
        case 'Unary': collectNames(node.operand, acc); break;
    }
    return acc;
}
