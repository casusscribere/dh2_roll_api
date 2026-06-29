/**
 * DH2 Roll API — minimalist Express server.
 * Run:  npm install && npm start   (default http://localhost:3210)
 */
import express from 'express';
import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import {
    rollTest, rollDamage, resolveAttack, resolveParry, applySoak,
    COMBAT_ACTIONS, RANGE_BANDS, AIM_MODES, HIT_LOCATIONS,
} from './lib/engine.mjs';
import { availableTalents, availableTraits, availableStatuses, availableQualities, buildRegistry, builtinSources, builtinRules } from './lib/rules/index.mjs';
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
}));

// GET /api/rules  — selectable names the rule set understands, by category
app.get('/api/rules', (req, res) => res.json({
    talents: availableTalents,
    traits: availableTraits,
    statuses: availableStatuses,
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
