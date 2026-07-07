/**
 * DH2 Trait DSL — compiler.
 *
 * Rule AST → executable Effect ({ id, source, checkpoint, priority, when, apply }),
 * the exact shape the engine's Registry runs. This is the SEMANTIC layer: it
 * validates that the checkpoint is real and that every fact/function the rule
 * references exists in the interpreter's whitelist, failing with a positioned
 * DslError otherwise.
 */
import { parse } from './parser.mjs';
import { DslError } from './tokenizer.mjs';
import { CHECKPOINTS } from '../pipeline.mjs';
import { FACTS, FUNCTIONS, evalNode, applyAction, collectNames } from './interpreter.mjs';
import { SCOPED_FACTS, SCOPED_FUNCTIONS, SCOPE_NAMES, SLOT_DEFS, FLAG_DEFS } from './vocabulary.mjs';

const KNOWN_CHECKPOINTS = new Set(Object.values(CHECKPOINTS));

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Compile one Rule AST node into an array of Effects — one per `when … then …`
 * branch. All branches of a rule share the same `ruleId` (so the UI can toggle
 * the whole rule with one click) but get distinct effect `id`s when there is
 * more than one branch.
 */
export function compileRule(rule, pkg = null) {
    // Namespaced pipelines (Phase 3): the `attack` pipeline is the default
    // namespace — `on attack.MODIFIERS` normalises to the unqualified id.
    const checkpoint = rule.on?.startsWith('attack.') ? rule.on.slice('attack.'.length) : rule.on;
    if (!KNOWN_CHECKPOINTS.has(checkpoint)) {
        throw new DslError(`Unknown checkpoint '${rule.on}' in rule "${rule.name}"`, rule.line, rule.col);
    }

    // Validate every referenced name across all branches.
    const names = { facts: new Set(), calls: new Set(), scopedFacts: new Set(), scopedCalls: new Set() };
    for (const br of rule.branches) {
        if (br.when) collectNames(br.when, names);
        for (const a of br.actions) if (a.value) collectNames(a.value, names);
    }
    for (const f of names.facts) {
        if (!(f in FACTS)) throw new DslError(`Unknown fact '${f}' in rule "${rule.name}"`, rule.line, rule.col);
    }
    for (const c of names.calls) {
        if (!(c in FUNCTIONS)) throw new DslError(`Unknown function '${c}()' in rule "${rule.name}"`, rule.line, rule.col);
    }
    // Scoped paths (Stage 2): the scope must exist AND the fact/function must be
    // available in that scope (e.g. `target.tb` yes; `target.jam_threshold` no).
    for (const sf of names.scopedFacts) {
        const [scope, f] = sf.split('.');
        if (!SCOPE_NAMES.includes(scope)) throw new DslError(`Unknown scope '${scope}' in rule "${rule.name}" (scopes: ${SCOPE_NAMES.join(', ')})`, rule.line, rule.col);
        if (!(f in SCOPED_FACTS[scope])) throw new DslError(`Fact '${f}' is not available in scope '${scope}' in rule "${rule.name}"`, rule.line, rule.col);
    }
    for (const sc of names.scopedCalls) {
        const [scope, c] = sc.split('.');
        if (!SCOPE_NAMES.includes(scope)) throw new DslError(`Unknown scope '${scope}' in rule "${rule.name}" (scopes: ${SCOPE_NAMES.join(', ')})`, rule.line, rule.col);
        if (!(c in SCOPED_FUNCTIONS[scope])) throw new DslError(`Function '${c}()' is not available in scope '${scope}' in rule "${rule.name}"`, rule.line, rule.col);
    }
    // Slots / flags (Stage 3): validate against the registered tables, incl. the
    // slot's allowed modes (e.g. `set jam_threshold += …` is rejected).
    for (const br of rule.branches) {
        for (const a of br.actions) {
            if (a.action === 'set_slot') {
                const slot = SLOT_DEFS[a.slot];
                if (!slot) throw new DslError(`Unknown slot '${a.slot}' in rule "${rule.name}" (slots: ${Object.keys(SLOT_DEFS).join(', ')})`, rule.line, rule.col);
                if (!slot.modes.includes(a.op ?? '=')) throw new DslError(`Slot '${a.slot}' does not support '${a.op}' in rule "${rule.name}" (modes: ${slot.modes.join(', ')})`, rule.line, rule.col);
            } else if (a.action === 'set_flag' && !FLAG_DEFS[a.flag]) {
                throw new DslError(`Unknown flag '${a.flag}' in rule "${rule.name}" (flags: ${Object.keys(FLAG_DEFS).join(', ')})`, rule.line, rule.col);
            }
        }
    }

    // `set pen += …` writes to a named penetration-modifier slot; default it to
    // the rule's display name (e.g. "Razor Sharp" → "razor sharp").
    const ruleId = slug(rule.name);
    const meta = { penKey: ruleId.replace(/-/g, ' '), ruleName: rule.name };
    const multi = rule.branches.length > 1;

    return rule.branches.map((br, i) => ({
        id: multi ? `${ruleId}#${i + 1}` : ruleId,
        ruleId,
        // Stable qualified id — unique across packages (Stage 5 layering keys on
        // this; ruleId stays the toggle key for back-compat).
        qualifiedId: pkg?.name ? `${pkg.name}/${ruleId}` : ruleId,
        name: rule.name,
        tier: rule.tier ?? null,
        source: rule.kind,
        checkpoint,
        priority: rule.priority ?? 0,            // branch order preserved by insertion order
        // layered-registry override (Phase 3): qualified/rule ids this rule replaces
        replaces: rule.replaces ?? null,
        // Provenance (Stage 0): rule meta + the file's package header.
        page: rule.meta?.page ?? null,
        ref: rule.meta?.ref ?? null,
        package: pkg?.name ?? null,
        system: pkg?.system ?? null,
        sourceBook: rule.meta?.source ?? pkg?.source ?? null,
        when: br.when ? (ctx) => Boolean(evalNode(br.when, ctx)) : undefined,
        apply: (ctx) => { for (const a of br.actions) applyAction(a, ctx, meta); },
    }));
}

/** Compile DSL source (or a pre-parsed Program) into a flat array of Effects. */
export function compile(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    return program.rules.flatMap((r) => compileRule(r, program.package ?? null));
}

/** File-level info: the `dsl` version pragma and `package` header (or defaults).
 *  Used to surface per-file provenance without recompiling effects. */
export function programInfo(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    return {
        dslVersion: program.dslVersion ?? 1,
        package: program.package
            ? { name: program.package.name, system: program.package.system, source: program.package.source, requires: program.package.requires ?? [] }
            : null,
    };
}

/** Compile one roll_table AST node into a runtime table: { name, die, rows }.
 *  Rows are sorted and validated to cover the die's range without gaps/overlaps. */
export function compileTable(table) {
    const rows = [...table.rows].sort((a, b) => a.lo - b.lo);
    for (const r of rows) {
        if (r.hi < r.lo) throw new DslError(`Table "${table.name}" has a reversed range ${r.lo}-${r.hi}`, table.line, table.col);
    }
    return { name: table.name, die: table.die, rows };
}

/** Compile the roll_tables in DSL source (or a pre-parsed Program). */
export function compileTables(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    return (program.tables ?? []).map(compileTable);
}

/** Compile the action declarations: [{ name, type, attack }]. These are the
 *  Actions taxonomy (hooked via is_action()/action_type()), compiled once at load. */
export function compileActions(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    return (program.actions ?? []).map((a) => ({ name: a.name, type: a.actionType, subtypes: a.subtypes ?? [] }));
}

/**
 * Extract the player-facing names a rule set references via has_talent("…"),
 * has_trait("…"), has_quality("…") and has_status("…"). These are the names the
 * system understands — used to populate the UI's selectable lists without
 * leaking the internal rule names.
 */
export function referencedNames(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    const buckets = { talents: new Set(), traits: new Set(), qualities: new Set(), conditions: new Set(), circumstances: new Set(), configurations: new Set() };
    const byFn = {
        has_talent: 'talents', has_trait: 'traits', has_quality: 'qualities',
        has_condition: 'conditions', has_status: 'conditions', has_circumstance: 'circumstances',
        configuration: 'configurations', firing_mode: 'configurations',
    };

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'Call') {
            const lit = node.args[0]?.type === 'String' ? node.args[0].value : null;
            const bucket = byFn[node.name];
            if (lit && bucket) buckets[bucket].add(lit);
            node.args.forEach(visit);
        } else {
            for (const k of ['left', 'right', 'operand']) if (node[k]) visit(node[k]);
        }
    };

    for (const rule of program.rules) {
        for (const br of rule.branches) {
            if (br.when) visit(br.when);
            for (const a of br.actions) if (a.value) visit(a.value);
        }
    }
    return {
        talents: [...buckets.talents].sort(),
        traits: [...buckets.traits].sort(),
        qualities: [...buckets.qualities].sort(),
        conditions: [...buckets.conditions].sort(),
        circumstances: [...buckets.circumstances].sort(),
        configurations: [...buckets.configurations].sort(),
    };
}

/**
 * Extract the names of rules that take a numeric severity / level variable — i.e.
 * whose DSL reads a level/severity accessor keyed by name (`trait_level("X")`,
 * `quality_level("X")`, `circumstance_severity("X")`, `condition_severity("X")`).
 * The UI uses this to show a value input ONLY for those rules (e.g. Brutal Charge,
 * Haywire Field), not boolean ones (On Fire, Darkness, Ambidextrous).
 */
export function valuedNames(src) {
    const program = typeof src === 'string' ? parse(src) : src;
    const LEVEL_FNS = new Set(['quality_level', 'trait_level', 'circumstance_severity', 'condition_severity']);
    const valued = new Set();

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'Call') {
            if (LEVEL_FNS.has(node.name)) {
                const lit = node.args[0]?.type === 'String' ? node.args[0].value : null;
                if (lit) valued.add(lit);
            }
            node.args.forEach(visit);
        } else {
            for (const k of ['left', 'right', 'operand']) if (node[k]) visit(node[k]);
        }
    };

    for (const rule of program.rules) {
        for (const br of rule.branches) {
            if (br.when) visit(br.when);
            for (const a of br.actions) if (a.value) visit(a.value);
        }
    }
    return [...valued].sort();
}
