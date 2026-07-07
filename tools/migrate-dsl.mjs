/**
 * DSL v1/v2 → v3 migrator (the legacy-removal codemod).
 *
 *   node tools/migrate-dsl.mjs <file.dsl> [--write]      (default: print to stdout)
 *   node tools/migrate-dsl.mjs --all [--write]           (all api/data/rules/*.dsl)
 *
 * dsl 3 removes the redundant v1 surfaces (see DSL_ARCHITECTURE.md):
 *   - prefixed alias facts/functions  → scoped paths (target.armour, …)
 *   - has_status / firing_mode        → has_condition / configuration
 *   - kind aliases status|generic|rule → condition | miscellaneous
 *   - thin sugar verbs                → slot/flag primitives
 *       add_die e                     → set extra_dice += e
 *       add_hits e                    → set extra_hits += e
 *       reduce_unnatural_toughness e  → set unnatural_toughness_reduction += e
 *       keep_highest                  → flag keep_highest
 *       fail                          → flag attack_failed
 *       prevent_parry                 → flag no_parry
 *       cannot_parry                  → flag cannot_parry
 *       detonate                      → flag detonate
 *   - `dsl 1|2` pragma                → dsl 3 (added if missing)
 *
 * The rewrite is COMMENT- AND STRING-SAFE: replacements apply only in code
 * regions (a mini-scanner mirrors the tokenizer's string/comment rules), and
 * only at word boundaries — formatting and comments are preserved exactly.
 */
import { readFileSync, writeFileSync } from 'fs';
import { readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Longest-first so e.g. target_unnatural_toughness wins over target_tb prefixes.
const REPLACEMENTS = [
    ['target_unnatural_toughness', 'target.unnatural_toughness'],
    ['reduce_unnatural_toughness', 'set unnatural_toughness_reduction +='],
    ['opposing_has_quality', 'opposing_weapon.has_quality'],
    ['opposing_present', 'opposing_weapon.present'],
    ['target_has_trait', 'target.has_trait'],
    ['target_armour', 'target.armour'],
    ['prevent_parry', 'flag no_parry'],
    ['cannot_parry', 'flag cannot_parry'],
    ['keep_highest', 'flag keep_highest'],
    ['firing_mode', 'configuration'],
    ['has_status', 'has_condition'],
    ['target_sb', 'target.sb'],
    ['target_tb', 'target.tb'],
    ['add_hits', 'set extra_hits +='],
    ['detonate', 'flag detonate'],
    ['add_die', 'set extra_dice +='],
    ['fail', 'flag attack_failed'],
].sort((a, b) => b[0].length - a[0].length);

const KIND_MAP = { status: 'condition', generic: 'miscellaneous', rule: 'miscellaneous' };
const isWord = (ch) => ch !== undefined && /[A-Za-z0-9_.]/.test(ch);

/** Migrate DSL source text to v3. Pure; returns { text, changes }. */
export function migrateDsl(src) {
    const s = String(src);
    let out = '';
    let i = 0;
    let changes = 0;
    let sawPragma = false;

    while (i < s.length) {
        const ch = s[i];
        // comments — copy verbatim to end of line
        if ((ch === '/' && s[i + 1] === '/') || ch === '#') {
            const nl = s.indexOf('\n', i);
            const end = nl === -1 ? s.length : nl;
            out += s.slice(i, end);
            i = end;
            continue;
        }
        // strings — copy verbatim incl. escapes
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let j = i + 1;
            while (j < s.length && s[j] !== quote) j += (s[j] === '\\' ? 2 : 1);
            out += s.slice(i, Math.min(j + 1, s.length));
            i = Math.min(j + 1, s.length);
            continue;
        }
        // identifiers — the replacement site
        if (/[A-Za-z_]/.test(ch) && !isWord(s[i - 1])) {
            let j = i;
            while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
            const word = s.slice(i, j);
            // pragma version bump
            if (word === 'dsl' && /^\s*\d+/.test(s.slice(j))) {
                const m = /^(\s*)(\d+)/.exec(s.slice(j));
                if (+m[2] < 3) changes++;
                out += `dsl${m[1]}3`;
                i = j + m[0].length;
                sawPragma = true;
                continue;
            }
            // kind aliases only where a rule can start (start of line, ws before)
            const lineStart = out.length === 0 || /\n\s*$/.test(out);
            if (lineStart && KIND_MAP[word] && /^\s*"/.test(s.slice(j))) {
                out += KIND_MAP[word];
                i = j;
                changes++;
                continue;
            }
            const hit = REPLACEMENTS.find(([from]) => from === word && !isWord(s[j]));
            if (hit) {
                out += hit[1];
                i = j;
                changes++;
                continue;
            }
            out += word;
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    if (!sawPragma) {
        out = `dsl 3\n${out}`;
        changes++;
    }
    return { text: out, changes };
}

// ---- CLI ---------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const args = process.argv.slice(2);
    const write = args.includes('--write');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const files = args.includes('--all')
        ? readdirSync(join(root, 'api', 'data', 'rules')).filter((f) => f.endsWith('.dsl')).map((f) => join(root, 'api', 'data', 'rules', f))
        : args.filter((a) => !a.startsWith('--'));
    if (!files.length) {
        console.error('usage: node tools/migrate-dsl.mjs <file.dsl>|--all [--write]');
        process.exit(2);
    }
    for (const f of files) {
        const { text, changes } = migrateDsl(readFileSync(f, 'utf8'));
        if (write) {
            writeFileSync(f, text);
            console.log(`✓ ${f} — ${changes} change(s)`);
        } else {
            process.stdout.write(text);
        }
    }
}
