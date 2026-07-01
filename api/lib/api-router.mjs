/**
 * Transport-agnostic API router.
 *
 * The single source of truth for what each `/api/*` endpoint does. It is pure —
 * no Express, no `fs`, no globals — so it backs BOTH transports identically:
 *   - the Express dev server (api/server.mjs) wraps each route around dispatch();
 *   - the static GitHub Pages build (api/lib/pages-api.mjs) patches window.fetch
 *     to call dispatch() in-process.
 * Because there is one implementation, the two can never drift.
 *
 * dispatch(method, path, body) → { status, body }.
 */
import {
    rollTest, rollDamage, resolveAttack, resolveParry, resolveEngagement, applySoak,
    engageAttackRoll, engageDamage, engageEvasion, engageOnHit,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES, HIT_LOCATIONS,
} from './engine.mjs';
import { rollScript } from './dice.mjs';
import {
    availableTalents, availableTraits, availableConditions, availableCircumstances,
    availableConfigurations, availableQualities, availableActionNames, availableValued, FIRING_MODES,
    buildRegistry, builtinSources, builtinRules,
} from './rules/index.mjs';
import { weaponsJson } from './rules/sources.mjs';
import { compile } from './dsl/compiler.mjs';
import { DslError } from './dsl/tokenizer.mjs';
import { DSL_DOCS } from './dsl/docs.mjs';

/** GET endpoints — pure reads of the engine's static, load-time data. */
const GET = {
    '/api/weapons': () => weaponsJson,
    '/api/options': () => ({
        actions: Object.entries(COMBAT_ACTIONS).map(([name, a]) => ({ name, ...a })),
        rangeBands: RANGE_BANDS,
        aimModes: AIM_MODES,
        hitLocations: HIT_LOCATIONS,
        firingModes: FIRING_MODES,
    }),
    '/api/rules': () => ({
        talents: availableTalents,
        traits: availableTraits,
        conditions: availableConditions,
        circumstances: availableCircumstances,
        configurations: availableConfigurations,
        actions: availableActionNames,
        statuses: availableConditions,   // back-compat alias
        qualities: availableQualities,
        valued: availableValued,         // names that take a numeric severity/level variable
    }),
    '/api/dsl-docs': () => DSL_DOCS,
    '/api/rules/source': () => ({ builtins: builtinSources, rules: builtinRules }),
};

/** POST endpoints — engine calls. Each returns the response body, or throws to
 *  produce a 400 (mirroring the old Express `handle()` wrapper). */
const POST = {
    '/api/test': (body) => rollTest(body),
    '/api/damage': (body) => {
        const out = rollDamage(body, undefined, buildRegistry(body.customRules, body.disabledRules));
        if (out.error) throw new Error(out.error);
        return out;
    },
    '/api/soak': (body) => applySoak(body),
    '/api/parry': (body) => resolveParry(body, undefined, buildRegistry(body.customRules, body.disabledRules)),
    '/api/attack': (body) => resolveAttack(body, undefined, buildRegistry(body.customRules, body.disabledRules)),
    '/api/resolve': (body) => {
        const rng = rollScript(body.forcedRolls ?? []);
        const out = resolveEngagement(body, rng, buildRegistry(body.customRules, body.disabledRules));
        out.rollTrace = rng.trace;
        return out;
    },
    '/api/engage': (body) => {
        const { phase, attacker = {}, defender = {}, options = {}, state = {} } = body;
        const reg = buildRegistry(body.customRules, body.disabledRules);
        const rng = rollScript(body.forcedRolls ?? []);
        let out;
        switch (phase) {
            case 'attack':  out = engageAttackRoll(attacker, reg, rng, defender); break;
            case 'damage':  out = engageDamage(attacker, state.attack ?? {}, reg, rng, defender); break;
            case 'evasion': out = engageEvasion(defender, state.attack?.test?.dos ?? 0, reg, rng, state.attack?.preventsParry, attacker.weapon ?? null); break;
            case 'onhit':   out = engageOnHit(attacker, defender, state.attack?.hits ?? [], state.evaded ?? 0, options, reg, rng); break;
            default: throw new DslError(`Unknown engagement phase '${phase}'`, 0, 0);
        }
        out.rollTrace = rng.trace;
        return out;
    },
};

/** POST /api/rules/validate has a bespoke success/error shape (DSL line/col), so
 *  it is handled directly rather than through the throw→400 path. */
function validateRules(body) {
    const text = body?.rules ?? '';
    try {
        const effects = compile(text);
        return {
            status: 200,
            body: {
                ok: true,
                count: effects.length,
                effects: effects.map((e) => ({ id: e.id, name: e.name, source: e.source, checkpoint: e.checkpoint, priority: e.priority })),
            },
        };
    } catch (err) {
        const out = { ok: false, error: err.message };
        if (err instanceof DslError) { out.message = err.rawMessage; out.line = err.line; out.col = err.col; }
        return { status: 400, body: out };
    }
}

/**
 * Resolve one API call. `path` is the pathname only (no query string).
 * Returns { status, body } — never throws.
 */
export function dispatch(method, path, body = {}) {
    const verb = String(method || 'GET').toUpperCase();
    if (verb === 'GET') {
        const fn = GET[path];
        if (!fn) return { status: 404, body: { error: `Unknown endpoint ${path}` } };
        try { return { status: 200, body: fn() }; }
        catch (err) { return { status: 400, body: { error: err.message } }; }
    }
    if (verb === 'POST') {
        if (path === '/api/rules/validate') return validateRules(body ?? {});
        const fn = POST[path];
        if (!fn) return { status: 404, body: { error: `Unknown endpoint ${path}` } };
        try { return { status: 200, body: fn(body ?? {}) }; }
        catch (err) { return { status: 400, body: { error: err.message } }; }
    }
    return { status: 405, body: { error: `Method ${verb} not allowed` } };
}
