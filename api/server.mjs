/**
 * DH2 Roll API — minimalist Express server.
 * Run:  npm install && npm start   (default http://localhost:3210)
 */
import express from 'express';
import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import {
    rollTest, rollDamage, resolveAttack, resolveParry, resolveEngagement, applySoak,
    engageAttackRoll, engageDamage, engageEvasion, engageOnHit,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES, HIT_LOCATIONS,
} from './lib/engine.mjs';
import { rollScript } from './lib/dice.mjs';
import { availableTalents, availableTraits, availableConditions, availableCircumstances, availableConfigurations, availableQualities, availableActionNames, FIRING_MODES, buildRegistry, builtinSources, builtinRules } from './lib/rules/index.mjs';
import { compile } from './lib/dsl/compiler.mjs';
import { DslError } from './lib/dsl/tokenizer.mjs';
import { DSL_DOCS } from './lib/dsl/docs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const weaponData = JSON.parse(readFileSync(join(__dirname, 'data', 'weapons.json'), 'utf8'));

const app = express();
app.use(express.json());
// Serve the front-end (UI) from the sibling ui/ directory.
app.use(express.static(join(__dirname, '..', 'ui')));

const handle = (fn) => (req, res) => {
    try {
        res.json(fn(req));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Reference data for building forms
app.get('/api/weapons', (req, res) => res.json(weaponData));
app.get('/api/options', (req, res) => res.json({
    actions: Object.entries(COMBAT_ACTIONS).map(([name, a]) => ({ name, ...a })),
    rangeBands: RANGE_BANDS,
    aimModes: AIM_MODES,
    hitLocations: HIT_LOCATIONS,
    firingModes: FIRING_MODES,
}));

// GET /api/rules  — selectable names the rule set understands, by category
app.get('/api/rules', (req, res) => res.json({
    talents: availableTalents,
    traits: availableTraits,
    conditions: availableConditions,
    circumstances: availableCircumstances,
    configurations: availableConfigurations,
    actions: availableActionNames,
    statuses: availableConditions,   // back-compat alias
    qualities: availableQualities,
}));

// GET /api/dsl-docs  — full DSL reference (checkpoints, facts, functions, actions)
app.get('/api/dsl-docs', (req, res) => res.json(DSL_DOCS));

// GET /api/rules/source  — raw DSL source + per-rule list of the built-in set
app.get('/api/rules/source', (req, res) => res.json({ builtins: builtinSources, rules: builtinRules }));

// POST /api/rules/validate  { rules: "<dsl text>" } — parse-check without rolling
app.post('/api/rules/validate', (req, res) => {
    const text = req.body?.rules ?? '';
    try {
        const effects = compile(text);
        res.json({
            ok: true,
            count: effects.length,
            effects: effects.map((e) => ({ id: e.id, name: e.name, source: e.source, checkpoint: e.checkpoint, priority: e.priority })),
        });
    } catch (err) {
        const body = { ok: false, error: err.message };
        if (err instanceof DslError) { body.message = err.rawMessage; body.line = err.line; body.col = err.col; }
        res.status(400).json(body);
    }
});

// POST /api/test  { target, modifiers: { any: number } }
app.post('/api/test', handle((req) => rollTest(req.body ?? {})));

// POST /api/damage  { formula, ..., customRules?, disabledRules? }
app.post('/api/damage', handle((req) => {
    const body = req.body ?? {};
    const out = rollDamage(body, undefined, buildRegistry(body.customRules, body.disabledRules));
    if (out.error) throw new Error(out.error);
    return out;
}));

// POST /api/soak  { damage, penetration, armour, toughnessBonus }
app.post('/api/soak', handle((req) => applySoak(req.body ?? {})));

// POST /api/parry  — a defensive WS test; runs PARRY rules (Balanced, Defensive)
app.post('/api/parry', handle((req) => {
    const body = req.body ?? {};
    return resolveParry(body, undefined, buildRegistry(body.customRules, body.disabledRules));
}));

// POST /api/resolve  — full engagement: attack → evasion/field → soak → apply → on-hit
// { attacker, defender, options:{ autoResolveTests }, customRules?, disabledRules?, forcedRolls? }
// forcedRolls is a sparse array of forced die FACES by roll index (debug); the
// response carries `rollTrace` describing every d-roll made, in order.
app.post('/api/resolve', handle((req) => {
    const body = req.body ?? {};
    const rng = rollScript(body.forcedRolls ?? []);
    const out = resolveEngagement(body, rng, buildRegistry(body.customRules, body.disabledRules));
    out.rollTrace = rng.trace;
    return out;
}));

// POST /api/engage  — resolve ONE engagement phase, for the stepped UI (pause /
// reroll between phases). The client is stateless on the server: it holds the
// accumulated `state` and posts it back each step. Re-posting the same phase
// rerolls just that phase (e.g. a Fate Point reroll) with fresh dice. `forcedRolls`
// (sparse array of die faces by index, this phase) lets the user pin any roll; the
// response carries `rollTrace` listing every d-roll the phase made, in order.
// { phase: 'attack'|'damage'|'evasion'|'onhit', attacker, defender, options, state, forcedRolls?, customRules?, disabledRules? }
app.post('/api/engage', handle((req) => {
    const { phase, attacker = {}, defender = {}, options = {}, state = {} } = req.body ?? {};
    const reg = buildRegistry(req.body?.customRules, req.body?.disabledRules);
    const rng = rollScript(req.body?.forcedRolls ?? []);
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
}));

// POST /api/attack  — full resolution; accepts talents[], traits[], statuses[],
// combat{}, customRules, and disabledRules[] (built-in rule ids to suppress)
app.post('/api/attack', handle((req) => {
    const body = req.body ?? {};
    return resolveAttack(body, undefined, buildRegistry(body.customRules, body.disabledRules));
}));

// Export the app so tests can mount it on an ephemeral port without listening.
export { app, weaponData };

// Start a server only when run directly (node server.mjs), not when imported.
// realpathSync canonicalises symlinks so the comparison holds under bind mounts.
const isMain = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();
if (isMain) {
    const PORT = process.env.PORT || 3210;
    app.listen(PORT, () => console.log(`DH2 Roll API listening on http://localhost:${PORT}`));
}
