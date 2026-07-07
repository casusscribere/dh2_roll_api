/**
 * Deploy the walking-skeleton module into the live Foundry install
 * (ROADMAP Lane C — the Foundry mirror of the Pages deploy).
 *
 *   npm run deploy:foundry          (build:foundry runs first via the npm script)
 *
 * Copies foundry/dh2-roll-vm/ → <FoundryData>/Data/modules/dh2-roll-vm/.
 * The Foundry data directory is taken from the FOUNDRY_DATA env var, falling
 * back to the known local install. Foundry does NOT hot-reload esmodules —
 * reload the world (F5) after deploying.
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = join(root, 'foundry', 'dh2-roll-vm');

const dataDir = process.env.FOUNDRY_DATA ?? 'C:\\Users\\kirkl\\AppData\\Local\\FoundryVTT\\Data';
if (!existsSync(dataDir)) {
    console.error(`✗ Foundry data directory not found: ${dataDir}`);
    console.error('  Set FOUNDRY_DATA to your FoundryVTT Data directory (the one containing modules/ and systems/).');
    process.exit(1);
}
const bundle = join(srcDir, 'scripts', 'dh2-vm.js');
if (!existsSync(bundle)) {
    console.error('✗ Module bundle missing — run `npm run build:foundry` first (the deploy:foundry npm script does this).');
    process.exit(1);
}

const destDir = join(dataDir, 'modules', 'dh2-roll-vm');
mkdirSync(join(dataDir, 'modules'), { recursive: true });
// Clean copy: module.json + README + built scripts/ (NOT src/ — the module ships the bundle only).
rmSync(destDir, { recursive: true, force: true });
mkdirSync(join(destDir, 'scripts'), { recursive: true });
cpSync(join(srcDir, 'module.json'), join(destDir, 'module.json'));
cpSync(join(srcDir, 'README.md'), join(destDir, 'README.md'));
cpSync(join(srcDir, 'scripts'), join(destDir, 'scripts'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(srcDir, 'module.json'), 'utf8'));
console.log(`✓ Deployed ${manifest.id} v${manifest.version} → ${destDir}`);
console.log('  Targets: ' + manifest.relationships.systems.map((s) => s.id).join(', '));
console.log('  Next: launch Foundry → enable the module in the test world → reload (F5) if it was open.');
console.log('  Validate: node tools/foundry-test/test-dh2vm-smoke.mjs  (Foundry running at localhost:30000)');
