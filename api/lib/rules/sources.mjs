/**
 * Rule + weapon DATA sources (Node).
 *
 * The single place that loads the on-disk DSL rule files and the weapon corpus
 * from `api/data/`. Keeping this behind one module means the rest of the engine
 * never touches the filesystem — and the static (GitHub Pages) build can swap in
 * a generated, inlined twin (`sources.browser.mjs`) at bundle time without any
 * other code change. See scripts/build-static.mjs and the esbuild alias there.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');
const read = (rel) => readFileSync(join(dataDir, rel), 'utf8');

/** The nine built-in rule files, keyed by filename (the keys the engine reads). */
export const RULE_FILES = [
    'weapon-qualities.dsl', 'talents.dsl', 'traits.dsl', 'conditions.dsl',
    'circumstances.dsl', 'configurations.dsl', 'mechanics.dsl', 'roll-tables.dsl',
    'actions.dsl',
];

/** filename → raw DSL source text. */
export const ruleSources = Object.fromEntries(RULE_FILES.map((f) => [f, read(join('rules', f))]));

/** The weapon corpus (parsed weapons.json). */
export const weaponsJson = JSON.parse(read('weapons.json'));
