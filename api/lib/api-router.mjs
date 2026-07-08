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
    rollTest, resolveTest, rollDamage, resolveAttack, resolveParry, resolveEngagement, applySoak,
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
import { checkDependencies } from './rules/dependencies.mjs';
import { compile } from './dsl/compiler.mjs';
import { DslError } from './dsl/tokenizer.mjs';
import { DSL_DOCS } from './dsl/docs.mjs';
import {
    CHARACTER_SCHEMA_VERSION, CHARACTER_FIELDS, emptyCharacter,
    validateCharacter, migrateCharacter, characterToCombatant,
} from './character-schema.mjs';
import {
    emptyEncounter, encounterActor, tickEncounter, mergeActorState, harvestEngagement,
} from './encounter.mjs';

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
    // Character schema v1 (Phase 2): the field reference + an empty template.
    '/api/character/schema': () => ({
        version: CHARACTER_SCHEMA_VERSION,
        fields: CHARACTER_FIELDS,
        template: emptyCharacter(),
    }),
};

/** POST endpoints — engine calls. Each returns the response body, or throws to
 *  produce a 400 (mirroring the old Express `handle()` wrapper). */
const POST = {
    // Generic test through the test.* pipeline (Phase 3): rules gated on
    // test_name / talents / conditions apply; response stays flat (v1 shape)
    // plus `effects`. customRules/disabledRules select the rule layers.
    '/api/test': (body) => resolveTest(body, undefined, buildRegistry(body.customRules, body.disabledRules)),
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
        const input = withEncounter(body);
        const out = resolveEngagement(input, rng, buildRegistry(body.customRules, body.disabledRules));
        annotateRecharge(out, body);
        if (body.encounter || body.attackerKey || body.defenderKey) {
            out.encounter = harvestEngagement(body.encounter, body.attackerKey ?? 'attacker', body.defenderKey ?? 'defender', out,
                { attackerName: input.attacker?.weapon?.name ? input.attacker?.name : undefined, defenderName: input.defender?.name });
        }
        out.rollTrace = rng.trace;
        return out;
    },
    '/api/engage': (body) => {
        const { phase, options = {}, state = {} } = body;
        const { attacker = {}, defender = {}, options: opts } = withEncounter({ ...body, options });
        const reg = buildRegistry(body.customRules, body.disabledRules);
        const rng = rollScript(body.forcedRolls ?? []);
        let out;
        switch (phase) {
            case 'attack':  out = engageAttackRoll(attacker, reg, rng, defender); annotateRecharge({ attack: out }, body); break;
            case 'damage':  out = engageDamage(attacker, state.attack ?? {}, reg, rng, defender); break;
            case 'evasion': out = engageEvasion(defender, state.attack?.test?.dos ?? 0, reg, rng, state.attack?.preventsParry, attacker.weapon ?? null); break;
            case 'onhit': {
                out = engageOnHit(attacker, defender, state.attack?.hits ?? [], state.evaded ?? 0, opts, reg, rng);
                // final phase: hand back the updated encounter document
                if (body.encounter || body.attackerKey || body.defenderKey) {
                    out.encounter = harvestEngagement(body.encounter, body.attackerKey ?? 'attacker', body.defenderKey ?? 'defender',
                        { attack: { effects: state.attack?.effects ?? [], hits: out.hits } });
                }
                break;
            }
            default: throw new DslError(`Unknown engagement phase '${phase}'`, 0, 0);
        }
        out.rollTrace = rng.trace;
        return out;
    },
    // Phase 4: run one upkeep phase over the encounter document.
    // { encounter, phase: 'TURN_START'|'TURN_END'|'ROUND_END', actorKey?, customRules?, disabledRules? }
    '/api/encounter/tick': (body) => {
        const reg = buildRegistry(body.customRules, body.disabledRules);
        const rng = rollScript(body.forcedRolls ?? []);
        const out = tickEncounter(body.encounter ?? emptyEncounter(), body.phase, reg, rng, body.actorKey ?? null);
        out.rollTrace = rng.trace;
        return out;
    },
    // Configuration sanity: RAW prerequisite violations in the active talent/
    // trait toggles (the Roll page's Warnings/errors log). Prerequisites not in
    // the DSL (or characteristics not supplied) are skipped — see dependencies.mjs.
    // { talents?, traits?, characteristics? } → { warnings: [...] }
    '/api/config/check': (body) => ({
        warnings: checkDependencies(body ?? {}, { talents: availableTalents, traits: availableTraits }),
    }),
};

/** Merge persistent actor state (conditions, AP damage) into engagement inputs,
 *  and snapshot the combatants' stats into the document for later upkeep tests. */
function withEncounter(body) {
    const enc = body.encounter;
    if (!enc && !body.attackerKey && !body.defenderKey) return body;
    const input = { ...body };
    const atkKey = body.attackerKey ?? 'attacker', defKey = body.defenderKey ?? 'defender';
    if (enc?.actors) {
        if (input.attacker) input.attacker = mergeActorState(input.attacker, enc, atkKey);
        if (input.defender) {
            input.defender = mergeActorState(input.defender, enc, defKey);
            // persistent AP loss seeds the corrosion accumulator (per location)
            const dmg = enc.actors[defKey]?.armourDamage;
            if (dmg && Object.keys(dmg).length) input.options = { ...(input.options ?? {}), armourDamage: dmg };
        }
    }
    // snapshot stats for upkeep tests (Toughness/Agility/Willpower vs stored values)
    if (enc) {
        for (const [key, side] of [[atkKey, input.attacker], [defKey, input.defender]]) {
            if (!side?.characteristics) continue;
            const a = encounterActor(enc, key, side.name);
            a.stats.characteristics = { ...a.stats.characteristics, ...side.characteristics };
            if (side.unnatural) a.stats.unnatural = { ...a.stats.unnatural, ...side.unnatural };
            // talents/traits gate upkeep policy rules (Iron Jaw, Die Hard, Regeneration)
            if (side.talents?.length) a.stats.talents = side.talents;
            if (side.traits?.length) a.stats.traits = side.traits;
        }
    }
    return input;
}

/** A recharging weapon cannot fire (Recharge, p.148) — surface a warning effect
 *  when the attacker's cooldown is up. Advisory (the GM may allow other actions). */
function annotateRecharge(result, body) {
    const key = body.attackerKey ?? 'attacker';
    if (body.encounter?.actors?.[key]?.cooldowns?.recharge && result.attack) {
        (result.attack.effects ??= []).push({
            name: 'Recharging',
            effect: 'the weapon is still recharging from the previous shot (Recharge) — it cannot fire until after the wielder\'s next turn ends',
        });
    }
}

/** POST /api/character/validate — migrate + validate a character document;
 *  field-level errors/warnings, plus the migrated doc and the engine-side
 *  combatant preview when valid. Always 200 (the body carries ok:false). */
function validateCharacterRoute(body) {
    const doc = migrateCharacter(body?.character ?? body ?? {});
    const result = validateCharacter(doc);
    const out = { ok: result.ok, errors: result.errors, warnings: result.warnings, character: doc };
    if (result.ok) out.combatant = characterToCombatant(doc);
    return { status: 200, body: out };
}

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
                effects: effects.map((e) => ({ id: e.id, name: e.name, source: e.source, checkpoint: e.checkpoint, priority: e.priority, replaces: e.replaces ?? null })),
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
        if (path === '/api/character/validate') return validateCharacterRoute(body ?? {});
        const fn = POST[path];
        if (!fn) return { status: 404, body: { error: `Unknown endpoint ${path}` } };
        try { return { status: 200, body: fn(body ?? {}) }; }
        catch (err) { return { status: 400, body: { error: err.message } }; }
    }
    return { status: 405, body: { error: `Method ${verb} not allowed` } };
}
