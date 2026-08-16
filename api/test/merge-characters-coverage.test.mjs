/**
 * tools/merge-characters.mjs — CLI coverage (companion to
 * merge-characters.test.mjs, which owns the merge/matching/report library
 * surface). This file drives the parts that only run when the module is
 * executed as a program: parseArgs, and main()'s roll20 loading (dump
 * envelope / bare doc / directory), the alias-file lookup, the output
 * writing, --emit-unmatched, the warning cap, --report and --strict.
 *
 * main() runs at import time behind the `process.argv[1] === this file` guard,
 * so it can only be triggered once per module instance. The widest scenario —
 * a directory of roll20 files with --report --emit-unmatched --strict — is run
 * IN-PROCESS on the plain module specifier (process.exit stubbed to throw so
 * an exiting run can be asserted on rather than killing the test process); the
 * narrower argument/error scenarios run as real child processes. A
 * cache-busted second in-process copy would be a deliberate mistake here:
 * `node --test` merges coverage per module URL, so a `?x=1` copy splits the
 * report and silently discards the other instances' coverage.
 *
 * Every write goes to a per-test fs.mkdtempSync directory, removed in finally.
 * The xlsx side is the committed api/data/characters/roster.mjs (read-only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const MERGER = path.join(REPO, 'tools', 'merge-characters.mjs');
const DEFAULT_ALIASES = path.join(REPO, 'tools', 'adapters', 'roster-aliases.json');

/** Run the CLI as a real child process → { status, out, err }. */
function runChild(argv) {
    const r = spawnSync(process.execPath, [MERGER, ...argv], { cwd: REPO, encoding: 'utf8' });
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** A `roll20.character_dump.v1` envelope. */
function dumpEnvelope(characters) {
    return { schema: 'roll20.character_dump.v1', generated_at: '2026-07-23T00:00:00.000Z', characters };
}

/** Dump attribs with live table state that differs from the roster's. */
function augustineAttribs() {
    return [
        { name: 'WeaponSkill', current: '40' },
        { name: 'MaxWounds', current: '10' },
        { name: 'CurWounds', current: '4' },
        { name: 'MaxFatePoints', current: '3' },
        { name: 'CurFatePoints', current: '1' },
        { name: 'CurFatigue', current: '2' },
        { name: 'Influence', current: '27' },
    ];
}

const tmpdir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `merge-cov-${label}-`));

// ---------------------------------------------------------------------------
// argument parsing / early exits (child processes)
// ---------------------------------------------------------------------------

test('CLI: missing --roll20/--out prints the usage line and exits 2', () => {
    const noArgs = runChild([]);
    assert.equal(noArgs.status, 2);
    assert.match(noArgs.err, /usage: node tools\/merge-characters\.mjs --roll20=/);

    // --roll20 alone is still incomplete (no --out)
    const onlyRoll20 = runChild(['--roll20=/nonexistent-on-purpose']);
    assert.equal(onlyRoll20.status, 2);
    assert.match(onlyRoll20.err, /--xlsx-roster/);
});

test('CLI: an unrecognised flag is rejected by name', () => {
    const r = runChild(['--roll20=x', '--out=y', '--frobnicate']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /unknown argument: --frobnicate/);
});

test('CLI: only --xlsx-roster mode is implemented', () => {
    const dir = tmpdir('noroster');
    try {
        const src = path.join(dir, 'r20.json');
        fs.writeFileSync(src, JSON.stringify({ schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Gnaeus' }));
        const r = runChild([`--roll20=${src}`, `--out=${path.join(dir, 'out')}`]);
        assert.notEqual(r.status, 0);
        assert.match(r.err, /only --xlsx-roster mode is implemented/);
        assert.ok(!fs.existsSync(path.join(dir, 'out')), 'nothing is written before the mode check');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// single-file roll20 input (child processes)
// ---------------------------------------------------------------------------

test('CLI: --roll20 may be a single file, and a missing --aliases file is simply empty', () => {
    const dir = tmpdir('file');
    try {
        const src = path.join(dir, 'dump.json');
        const outDir = path.join(dir, 'out');
        // "Jack" is an alias key in the committed map — pointed at an EMPTY
        // alias file it must NOT match, so the alias file is what matches it.
        fs.writeFileSync(src, JSON.stringify(dumpEnvelope([
            { id: '-KJack', name: 'Jack', attribs: [{ name: 'CurWounds', current: '7' }] },
        ])));

        const r = runChild([
            `--roll20=${src}`, '--xlsx-roster', `--out=${outDir}`,
            `--aliases=${path.join(dir, 'absent.json')}`,
        ]);
        assert.equal(r.status, 0, r.err);
        assert.match(r.out, /wrote 0 merged docs to /);
        assert.match(r.err + r.out, /no xlsx counterpart for roll20 character "Jack"/);
        assert.deepEqual(fs.readdirSync(outDir), []);   // the out dir is still created
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: a bare (non-envelope) roll20 doc merges, and --strict is quiet with no conflicts', () => {
    const dir = tmpdir('bare');
    try {
        const src = path.join(dir, 'ogg.json');
        const outDir = path.join(dir, 'out');
        fs.writeFileSync(src, JSON.stringify({
            schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Ogg',
        }));

        const r = runChild([`--roll20=${src}`, '--xlsx-roster', `--out=${outDir}`, '--strict']);
        assert.equal(r.status, 0, r.err);
        assert.match(r.out, /wrote 1 merged docs to /);
        const ogg = JSON.parse(fs.readFileSync(path.join(outDir, 'ogg.json'), 'utf8'));
        assert.equal(ogg.source.adapter, 'merge');
        assert.deepEqual(ogg.source.conflicts, []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// the widest run — in-process, so main()/parseArgs/mergeReport are measured
// ---------------------------------------------------------------------------

test('CLI: a directory of roll20 files, the committed alias map, --report, --emit-unmatched and --strict', async () => {
    assert.ok(fs.existsSync(DEFAULT_ALIASES), 'the committed alias map is the default lookup');
    const dir = tmpdir('dir');
    const savedArgv = process.argv;
    const savedExit = process.exit;
    const savedLog = console.log;
    const savedErr = console.error;
    const savedWarn = console.warn;
    const out = [], err = [];
    let exitCode = null, error = null;
    try {
        const inDir = path.join(dir, 'in');
        const outDir = path.join(dir, 'out');
        fs.mkdirSync(inDir);
        // a dump envelope: one name match, one alias match ("Jack"), plus 30
        // ghosts so the warning list overflows the 30-line print cap
        fs.writeFileSync(path.join(inDir, 'dump.json'), JSON.stringify(dumpEnvelope([
            { id: '-KAug', name: 'Augustine Haake', attribs: augustineAttribs() },
            { id: '-KJack', name: 'Jack', attribs: [{ name: 'CurWounds', current: '7' }] },
            ...Array.from({ length: 30 }, (_, i) => ({
                id: `-KGhost${i}`, name: `Ghost ${i}`, attribs: [{ name: 'WeaponSkill', current: '30' }],
            })),
        ])));
        // a bare v4 doc in the same directory — the other loadRoll20 branch
        fs.writeFileSync(path.join(inDir, 'gnaeus.json'), JSON.stringify({
            schemaVersion: 4, kind: 'dh2.character', system: 'dh2', name: 'Gnaeus',
            talents: ['Sound Constitution'],
        }));
        fs.writeFileSync(path.join(inDir, 'notes.txt'), 'not json — must be ignored');

        process.argv = [savedArgv[0], MERGER,
            `--roll20=${inDir}`, '--xlsx-roster', `--out=${outDir}`,
            '--report', '--emit-unmatched', '--strict'];
        process.exit = (code) => { exitCode = code; throw new Error(`__exit:${code}`); };
        console.log = (...a) => out.push(a.join(' '));
        console.warn = (...a) => out.push(a.join(' '));
        console.error = (...a) => err.push(a.join(' '));
        try {
            await import('../../tools/merge-characters.mjs');
        } catch (e) {
            if (!/^__exit:/.test(e.message)) error = e;
        }
        process.argv = savedArgv;
        process.exit = savedExit;
        console.log = savedLog;
        console.error = savedErr;
        console.warn = savedWarn;

        const stdout = out.join('\n'), stderr = err.join('\n');
        assert.equal(error, null, String(error?.stack));

        // three matches: two by normalized name, one through the committed alias map
        assert.match(stdout, /wrote 3 merged docs to /);
        assert.match(stdout, /\| Augustine Haake \| name \| \d+ \| ok/);
        assert.match(stdout, /\| Gnaeus \| name \| \d+ \| ok/);
        assert.match(stdout, /\| "Jack" "Balvdin\?" \(First Officer\) \| alias \|/);
        assert.match(stdout, /\| Ogg \| UNMATCHED \(xlsx only\) \| — \| — \|/);
        assert.match(stdout, /3 merged, 7 xlsx-unmatched, 30 roll20-unmatched\./);

        // warning cap: 30 printed, the rest summarised
        assert.equal((stdout.match(/^warn: /gm) ?? []).length, 30);
        assert.match(stdout, /… \d+ more warnings/);

        // merged docs are written under the xlsx roster id
        const written = fs.readdirSync(outDir).sort();
        assert.ok(written.includes('augustine-haake.json'));
        assert.ok(written.includes('gnaeus.json'));
        assert.ok(written.includes('jack-balvdin-first-officer.json'));
        // --emit-unmatched writes the 7 xlsx-only characters alongside
        assert.equal(written.filter((f) => f.endsWith('.unmatched.json')).length, 7);
        assert.ok(written.includes('uriel-yuri.unmatched.json'));

        const aug = JSON.parse(fs.readFileSync(path.join(outDir, 'augustine-haake.json'), 'utf8'));
        assert.equal(aug.source.adapter, 'merge');
        assert.equal(aug.wounds.current, 4);          // volatile state from roll20
        assert.equal(aug.fatigue.current, 2);
        assert.ok(aug.source.conflicts.length > 0);
        assert.ok(fs.readFileSync(path.join(outDir, 'gnaeus.json'), 'utf8').endsWith('}\n'));

        // --strict fails the run once everything has been written
        assert.equal(exitCode, 1);
        assert.match(stderr, /--strict: \d+ conflicts present/);
    } finally {
        process.argv = savedArgv;
        process.exit = savedExit;
        console.log = savedLog;
        console.error = savedErr;
        console.warn = savedWarn;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
