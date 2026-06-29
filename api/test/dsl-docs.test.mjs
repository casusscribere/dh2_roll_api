/**
 * DSL documentation parity tests — node --test.
 *
 * Guarantees the human-readable reference (lib/dsl/docs.mjs) documents EXACTLY
 * the checkpoints, facts and functions the engine actually exposes — so the
 * Rules-page reference can never silently drift from the implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINTS } from '../lib/pipeline.mjs';
import { FACTS, FUNCTIONS } from '../lib/dsl/interpreter.mjs';
import { DSL_DOCS, DOCUMENTED_CHECKPOINTS, DOCUMENTED_FACTS, DOCUMENTED_FUNCTIONS } from '../lib/dsl/docs.mjs';

const sorted = (a) => [...a].sort();

test('docs cover exactly the engine checkpoints', () => {
    assert.deepEqual(sorted(DOCUMENTED_CHECKPOINTS), sorted(Object.values(CHECKPOINTS)));
});

test('docs cover exactly the interpreter facts', () => {
    assert.deepEqual(sorted(DOCUMENTED_FACTS), sorted(Object.keys(FACTS)));
});

test('docs cover exactly the interpreter functions', () => {
    assert.deepEqual(sorted(DOCUMENTED_FUNCTIONS), sorted(Object.keys(FUNCTIONS)));
});

test('every documented checkpoint/fact/function/action has a summary', () => {
    for (const c of DSL_DOCS.checkpoints) assert.ok(c.summary && c.use, `checkpoint ${c.name}`);
    for (const f of DSL_DOCS.facts) assert.ok(f.type && f.summary, `fact ${f.name}`);
    for (const f of DSL_DOCS.functions) assert.ok(f.returns && f.summary, `function ${f.signature}`);
    for (const a of DSL_DOCS.actions) assert.ok(a.syntax && a.summary, `action ${a.syntax}`);
});
