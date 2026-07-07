/**
 * DH2 Trait DSL — recursive-descent parser.
 *
 * Tokens → AST. Purely syntactic: it enforces the grammar (grammar.md) and
 * reports line/col errors, but does NOT check whether a checkpoint / fact /
 * action name is meaningful — that semantic validation belongs to the compiler.
 *
 * AST node types:
 *   Program    { rules: Rule[] }
 *   Rule       { kind, name, tier|null, on|null, priority|null, branches:[{when|null, actions}], line, col }
 *              (single-branch rules also expose `when`/`actions` aliases)
 *   Logical    { op:'and'|'or', left, right }
 *   Unary      { op:'not'|'neg', operand }
 *   Comparison { op, left, right }
 *   Binary     { op:'+|-|*|/', left, right }
 *   Call       { name, args: Node[] }
 *   Identifier { name }   Number { value }   String { value }
 *   Boolean    { value }  Dice { count, sides }
 *   Action     { action, ...fields }
 */
import { tokenize, DslError } from './tokenizer.mjs';

// Canonical rule kinds + accepted aliases. Aliases normalise to a canonical kind
// (see KIND_ALIAS): the old `status` → `condition`, `condition`'s old situational
// sense is now `circumstance`, and `generic`/`rule` → `miscellaneous`.
const RULE_KINDS = new Set([
    'quality', 'talent', 'trait', 'circumstance', 'condition', 'configuration', 'mechanic', 'miscellaneous',
    'status', 'generic', 'rule',   // back-compat aliases
]);
// `roll_table` and `action` are top-level DECLARATIONS, not checkpoint rules.
const ACTION_TYPES = new Set(['Half', 'Full', 'Reaction', 'Free']);
const KIND_ALIAS = { status: 'condition', generic: 'miscellaneous', rule: 'miscellaneous' };
const COMPARE_OPS = new Set(['==', '!=', '>=', '<=', '>', '<']);

class Parser {
    constructor(tokens) { this.toks = tokens; this.pos = 0; }

    peek(offset = 0) { return this.toks[this.pos + offset]; }
    next() { return this.toks[this.pos++]; }
    atEof() { return this.peek().type === 'eof'; }

    err(message, tok = this.peek()) { return new DslError(message, tok.line, tok.col); }

    isKw(value, offset = 0) { const t = this.peek(offset); return t.type === 'ident' && t.value === value; }
    isPunct(value, offset = 0) { const t = this.peek(offset); return t.type === 'punct' && t.value === value; }
    isOp(value, offset = 0) { const t = this.peek(offset); return t.type === 'op' && t.value === value; }

    expectPunct(value) { if (!this.isPunct(value)) throw this.err(`Expected '${value}'`); return this.next(); }
    expectKw(value) { if (!this.isKw(value)) throw this.err(`Expected '${value}'`); return this.next(); }
    expectString(what = 'a quoted string') {
        const t = this.peek();
        if (t.type !== 'string') throw this.err(`Expected ${what}`);
        return this.next().value;
    }

    // --- program / rule ------------------------------------------------------
    parseProgram() {
        const rules = [], tables = [], actions = [], packages = [];
        let dslVersion = null;
        // `dsl <N>` pragmas and `package` blocks may appear at any top level
        // position (the FIRST of each wins) — several sources are routinely
        // concatenated for cross-file scans (referencedNames/valuedNames), so a
        // joined text contains one header per original file.
        while (!this.atEof()) {
            if (this.isKw('dsl') && this.peek(1)?.type === 'number') {
                this.next();
                const v = this.next().value;
                if (dslVersion === null) dslVersion = v;
            }
            else if (this.isKw('roll_table')) tables.push(this.parseTable());
            else if (this.isKw('action')) actions.push(this.parseActionDecl());
            else if (this.isKw('package')) packages.push(this.parsePackage());
            else rules.push(this.parseRule());
        }
        return { type: 'Program', rules, tables, actions, dslVersion: dslVersion ?? 1, package: packages[0] ?? null, packages };
    }

    // package "dh2.core.weapon-qualities" { system "dh2"  source "Book"  [requires "pkg"]* }
    // File-level provenance: the rule system this content belongs to, the source
    // book, and (future — layered registries) package dependencies.
    parsePackage() {
        const kw = this.expectKw('package');
        const name = this.expectString('a quoted package name');
        this.expectPunct('{');
        let system = null, source = null;
        const requires = [];
        while (!this.isPunct('}')) {
            if (this.atEof()) throw this.err("Unterminated package (expected '}')");
            if (this.isKw('system')) { this.next(); system = this.expectString('a system id (e.g. "dh2")'); }
            else if (this.isKw('source')) { this.next(); source = this.expectString('a source book name'); }
            else if (this.isKw('requires')) { this.next(); requires.push(this.expectString('a package name')); }
            else throw this.err("Unexpected clause in package body (expected 'system', 'source' or 'requires')");
        }
        this.expectPunct('}');
        return { type: 'Package', name, system, source, requires, line: kw.line, col: kw.col };
    }

    // action "Name" { type Half|Full|Reaction|Free  [attack] [subtype <name>]* }
    //   `attack` is sugar for `subtype attack` — the key subtype many rules read.
    parseActionDecl() {
        const kw = this.expectKw('action');
        const name = this.expectString('a quoted action name');
        this.expectPunct('{');
        let actionType = null;
        const subtypes = [];
        const addSub = (s) => { if (!subtypes.includes(s)) subtypes.push(s); };
        while (!this.isPunct('}')) {
            if (this.atEof()) throw this.err("Unterminated action (expected '}')");
            if (this.isKw('type')) {
                this.next();
                const t = this.peek();
                if (t.type !== 'ident' || !ACTION_TYPES.has(t.value)) throw this.err('Expected an action type (Half | Full | Reaction | Free)');
                this.next();
                actionType = t.value;
            } else if (this.isKw('attack')) {
                this.next();
                addSub('attack');
            } else if (this.isKw('subtype')) {
                this.next();
                const t = this.peek();
                if (t.type !== 'ident' && t.type !== 'string') throw this.err('Expected a subtype name after subtype');
                this.next();
                addSub(t.value);
            } else {
                throw this.err("Unexpected clause in action body (expected 'type', 'attack' or 'subtype')");
            }
        }
        this.expectPunct('}');
        if (!actionType) throw new DslError(`Action "${name}" is missing a 'type' clause`, kw.line, kw.col);
        return { type: 'ActionDecl', name, actionType, subtypes, line: kw.line, col: kw.col };
    }

    // roll_table "Name" { die 1d10  <lo>[-<hi>]: "text" [=> "Status", …]  … }
    parseTable() {
        const kw = this.expectKw('roll_table');
        const name = this.expectString('a quoted table name');
        this.expectPunct('{');
        this.expectKw('die');
        const dieTok = this.peek();
        if (dieTok.type !== 'dice') throw this.err('Expected a dice literal (e.g. 1d10) after die');
        this.next();
        const rows = [];
        while (!this.isPunct('}')) {
            if (this.atEof()) throw this.err("Unterminated roll_table (expected '}')");
            rows.push(this.parseTableRow());
        }
        this.expectPunct('}');
        return { type: 'Table', name, die: { count: dieTok.count, sides: dieTok.sides }, rows, line: kw.line, col: kw.col };
    }

    parseTableRow() {
        const lo = this.peek();
        if (lo.type !== 'number') throw this.err('Expected a roll value (e.g. 1 or 1-2) for a table row');
        this.next();
        let hi = lo.value;
        if (this.isOp('-')) {
            this.next();
            const h = this.peek();
            if (h.type !== 'number') throw this.err('Expected the end of a roll range after -');
            this.next();
            hi = h.value;
        }
        this.expectPunct(':');
        const text = this.expectString('the row outcome text');
        const statuses = [];
        if (this.isOp('=>')) {                          // optional statuses applied to the target
            this.next();
            statuses.push(this.expectString('a status name'));
            while (this.isPunct(',')) { this.next(); statuses.push(this.expectString('a status name')); }
        }
        if (this.isPunct(';')) this.next();             // optional row separator
        return { lo: lo.value, hi, text, statuses };
    }

    parseRule() {
        const kindTok = this.peek();
        if (kindTok.type !== 'ident' || !RULE_KINDS.has(kindTok.value)) {
            throw this.err('Expected a rule kind (quality | talent | trait | circumstance | condition | configuration | mechanic | miscellaneous)');
        }
        this.next();
        const name = this.expectString('a quoted rule name');

        const rule = {
            type: 'Rule', kind: KIND_ALIAS[kindTok.value] ?? kindTok.value, name,
            tier: null, on: null, priority: null, meta: null, branches: [],
            line: kindTok.line, col: kindTok.col,
        };

        if (this.isKw('tier')) {
            this.next();
            const n = this.peek();
            if (n.type !== 'number') throw this.err('Expected an integer after tier');
            this.next();
            rule.tier = n.value;
        }

        this.expectPunct('{');
        while (!this.isPunct('}')) {
            if (this.atEof()) throw this.err("Unterminated rule body (expected '}')");
            this.parseClause(rule);
        }
        this.expectPunct('}');

        if (!rule.on) throw new DslError(`Rule "${name}" is missing an 'on <checkpoint>' clause`, rule.line, rule.col);
        if (!rule.branches.length) throw new DslError(`Rule "${name}" is missing a 'then ...' clause`, rule.line, rule.col);

        // Convenience aliases for the common single-branch case.
        if (rule.branches.length === 1) {
            rule.when = rule.branches[0].when;
            rule.actions = rule.branches[0].actions;
        }
        return rule;
    }

    // Rule-level clauses (`on`, `priority`) and `when …? then …` branches.
    parseClause(rule) {
        const t = this.peek();
        if (this.isKw('on')) {
            this.next();
            const cp = this.peek();
            if (cp.type !== 'ident') throw this.err('Expected a checkpoint name after on');
            this.next();
            if (rule.on) throw this.err("Duplicate 'on' clause", t);
            rule.on = cp.value;
        } else if (this.isKw('priority')) {
            this.next();
            const n = this.peek();
            if (n.type !== 'number') throw this.err('Expected an integer after priority');
            this.next();
            rule.priority = n.value;
        } else if (this.isKw('meta')) {
            // meta { page <INT> [ref "…"] [source "…"] } — rule-level provenance.
            // `source` overrides the package's source book for this rule.
            this.next();
            this.expectPunct('{');
            const meta = { page: null, ref: null, source: null };
            while (!this.isPunct('}')) {
                if (this.atEof()) throw this.err("Unterminated meta (expected '}')");
                if (this.isKw('page')) {
                    this.next();
                    const n = this.peek();
                    if (n.type !== 'number') throw this.err('Expected a page number after page');
                    this.next();
                    meta.page = n.value;
                } else if (this.isKw('ref')) { this.next(); meta.ref = this.expectString('a reference string'); }
                else if (this.isKw('source')) { this.next(); meta.source = this.expectString('a source book name'); }
                else throw this.err("Unexpected clause in meta body (expected 'page', 'ref' or 'source')");
            }
            this.expectPunct('}');
            rule.meta = meta;
        } else if (this.isKw('when')) {
            this.next();
            const when = this.parsePredicate();
            if (!this.isKw('then')) throw this.err("Expected 'then' after a 'when' condition");
            this.next();
            rule.branches.push({ when, actions: this.parseActionList() });
        } else if (this.isKw('then')) {
            this.next();
            rule.branches.push({ when: null, actions: this.parseActionList() });
        } else {
            throw this.err(`Unexpected '${t.value ?? t.type}' in rule body (expected on | priority | meta | when | then)`);
        }
    }

    parseActionList() {
        const actions = [this.parseAction()];
        while (this.isPunct(';')) {
            this.next();
            if (this.isPunct('}') || this.atClauseKeyword()) break; // trailing ';' before a new branch / end
            actions.push(this.parseAction());
        }
        return actions;
    }

    atClauseKeyword() {
        return this.isKw('on') || this.isKw('priority') || this.isKw('when') || this.isKw('then');
    }

    // --- predicates (boolean) ------------------------------------------------
    parsePredicate() { return this.parseOr(); }

    parseOr() {
        let left = this.parseAnd();
        while (this.isKw('or')) { this.next(); left = { type: 'Logical', op: 'or', left, right: this.parseAnd() }; }
        return left;
    }
    parseAnd() {
        let left = this.parseNot();
        while (this.isKw('and')) { this.next(); left = { type: 'Logical', op: 'and', left, right: this.parseNot() }; }
        return left;
    }
    parseNot() {
        if (this.isKw('not')) { this.next(); return { type: 'Unary', op: 'not', operand: this.parseNot() }; }
        return this.parseComparison();
    }
    parseComparison() {
        const left = this.parseAtomPred();
        const t = this.peek();
        if (t.type === 'op' && COMPARE_OPS.has(t.value)) {
            this.next();
            return { type: 'Comparison', op: t.value, left, right: this.parseValue() };
        }
        return left;
    }
    parseAtomPred() {
        if (this.isPunct('(')) {
            this.next();
            const inner = this.parsePredicate();
            this.expectPunct(')');
            return inner;
        }
        return this.parseValue();
    }

    // --- arithmetic expressions (action values) ------------------------------
    parseExpr() { return this.parseAdd(); }
    parseAdd() {
        let left = this.parseMul();
        while (this.isOp('+') || this.isOp('-')) {
            const op = this.next().value;
            left = { type: 'Binary', op, left, right: this.parseMul() };
        }
        return left;
    }
    parseMul() {
        let left = this.parseUnary();
        while (this.isOp('*') || this.isOp('/')) {
            const op = this.next().value;
            left = { type: 'Binary', op, left, right: this.parseUnary() };
        }
        return left;
    }
    parseUnary() {
        if (this.isOp('-')) { this.next(); return { type: 'Unary', op: 'neg', operand: this.parseUnary() }; }
        return this.parseFactor();
    }
    parseFactor() {
        if (this.isPunct('(')) {
            this.next();
            const e = this.parseExpr();
            this.expectPunct(')');
            return e;
        }
        return this.parseValue();
    }

    // --- shared value/atom ---------------------------------------------------
    parseValue() {
        const t = this.peek();
        if (t.type === 'number') { this.next(); return { type: 'Number', value: t.value }; }
        if (t.type === 'string') { this.next(); return { type: 'String', value: t.value }; }
        if (t.type === 'dice') { this.next(); return { type: 'Dice', count: t.count, sides: t.sides }; }
        if (t.type === 'ident') {
            if (t.value === 'true' || t.value === 'false') { this.next(); return { type: 'Boolean', value: t.value === 'true' }; }
            this.next();
            // Scoped path (Stage 2): `scope.fact` or `scope.fn(args)` — e.g.
            // target.tb, weapon.pen, opposing_weapon.has_quality("Force"). The
            // scope's validity is checked by the compiler, not here.
            let scope = null, name = t.value;
            if (this.isPunct('.') && this.peek(1)?.type === 'ident') {
                this.next();                                   // the '.'
                scope = name;
                name = this.next().value;
            }
            if (this.isPunct('(')) {
                this.next();
                const args = [];
                if (!this.isPunct(')')) {
                    args.push(this.parseExpr());
                    while (this.isPunct(',')) { this.next(); args.push(this.parseExpr()); }
                }
                this.expectPunct(')');
                return scope ? { type: 'Call', scope, name, args } : { type: 'Call', name, args };
            }
            return scope ? { type: 'Identifier', scope, name } : { type: 'Identifier', name };
        }
        throw this.err(`Expected a value, got '${t.value ?? t.type}'`);
    }

    // --- actions -------------------------------------------------------------
    parseAction() {
        const t = this.peek();
        if (t.type !== 'ident') throw this.err('Expected an action');
        const kw = t.value;

        switch (kw) {
            case 'add': {
                this.next();
                this.expectKw('modifier');
                const name = this.expectString('a modifier name');
                if (!this.isOp('=')) throw this.err("Expected '=' after modifier name");
                this.next();
                return { type: 'Action', action: 'add_modifier', name, value: this.parseExpr() };
            }
            case 'set': {
                // `set modifier "key" = e` (named to-hit/damage modifier) or the
                // generic Stage-3 form `set <slot> (=|+=) e` over the registered
                // SLOT table (vocabulary.mjs). The old specials (pen,
                // jam_threshold, scatter, damage_type, …) ARE slots now — the
                // grammar is uniform; the compiler validates slot names/modes.
                this.next();
                if (this.isKw('modifier')) {
                    this.next();
                    const name = this.expectString('a modifier name');
                    if (!this.isOp('=')) throw this.err("Expected '=' after modifier name");
                    this.next();
                    return { type: 'Action', action: 'set_modifier', name, value: this.parseExpr() };
                }
                const slotTok = this.peek();
                if (slotTok.type !== 'ident') throw this.err("Expected 'modifier' or a slot name after 'set'");
                this.next();
                let op;
                if (this.isOp('+=')) op = '+=';
                else if (this.isOp('=')) op = '=';
                else throw this.err(`Expected '=' or '+=' after slot '${slotTok.value}'`);
                this.next();
                return { type: 'Action', action: 'set_slot', slot: slotTok.value, op, value: this.parseExpr() };
            }
            case 'cancel': {
                this.next();
                this.expectKw('modifier');
                return { type: 'Action', action: 'cancel_modifier', name: this.expectString('a modifier name') };
            }
            // --- sugar over slots/flags (Stage 3): the v1 verbs parse to the
            // same set_slot / set_flag actions the generic forms produce -------
            case 'add_die': { this.next(); return { type: 'Action', action: 'set_slot', slot: 'extra_dice', op: '+=', value: this.parseExpr() }; }
            case 'keep_highest': { this.next(); return { type: 'Action', action: 'set_flag', flag: 'keep_highest' }; }
            case 'add_hits': { this.next(); return { type: 'Action', action: 'set_slot', slot: 'extra_hits', op: '+=', value: this.parseExpr() }; }
            case 'multiply_hits': { this.next(); return { type: 'Action', action: 'multiply_hits', value: this.parseExpr() }; }
            case 'floor_die': { this.next(); return { type: 'Action', action: 'floor_die', value: this.parseExpr() }; }
            case 'cap_die': { this.next(); return { type: 'Action', action: 'cap_die', value: this.parseExpr() }; }
            case 'emit': {
                this.next();
                const name = this.expectString('an effect name');
                let text = null;
                if (this.isPunct(',')) { this.next(); text = this.expectString('effect description text'); }
                return { type: 'Action', action: 'emit', name, text };
            }
            case 'fail': { this.next(); return { type: 'Action', action: 'set_flag', flag: 'attack_failed' }; }
            case 'suppress': {                           // suppress "Jam" — skip another rule this checkpoint run
                this.next();
                return { type: 'Action', action: 'suppress', name: this.expectString('the name of a rule to suppress') };
            }
            case 'prevent_parry': { this.next(); return { type: 'Action', action: 'set_flag', flag: 'no_parry' }; }
            case 'cannot_parry': { this.next(); return { type: 'Action', action: 'set_flag', flag: 'cannot_parry' }; }
            case 'detonate': { this.next(); return { type: 'Action', action: 'set_flag', flag: 'detonate' }; }
            case 'flag': {                               // generic Stage-3 form: flag <name>
                this.next();
                const t2 = this.peek();
                if (t2.type !== 'ident') throw this.err('Expected a flag name after flag');
                this.next();
                return { type: 'Action', action: 'set_flag', flag: t2.value };
            }
            case 'corrode': { this.next(); return { type: 'Action', action: 'corrode', value: this.parseExpr() }; }
            case 'declare': {
                // Stage-3 declaration namespace — alternative surface syntax for
                // the record-producing verbs: declare test | status | table_roll |
                // armour_damage | event.
                this.next();
                if (this.isKw('test')) { this.next(); return this.parseRequireTest(); }
                if (this.isKw('status')) { this.next(); return this.parseApplyStatus(); }
                if (this.isKw('table_roll')) { this.next(); return this.parseRollOn(); }
                if (this.isKw('armour_damage')) { this.next(); return { type: 'Action', action: 'corrode', value: this.parseExpr() }; }
                if (this.isKw('event')) {
                    this.next();
                    const name = this.expectString('an event name');
                    let text = null;
                    if (this.isPunct(',')) { this.next(); text = this.expectString('event description text'); }
                    return { type: 'Action', action: 'emit', name, text };
                }
                throw this.err("Expected 'test', 'status', 'table_roll', 'armour_damage' or 'event' after declare");
            }
            case 'bump_quality': {                       // bump_quality "Blast" by <expr>
                this.next();
                const name = this.expectString('a quality name');
                this.expectKw('by');
                return { type: 'Action', action: 'bump_quality', name, value: this.parseExpr() };
            }
            case 'add_quality': {                        // add_quality "Recharge"
                this.next();
                return { type: 'Action', action: 'add_quality', name: this.expectString('a quality name') };
            }
            case 'reduce_unnatural_toughness': {         // sugar: set unnatural_toughness_reduction += <expr> (Felling)
                this.next();
                return { type: 'Action', action: 'set_slot', slot: 'unnatural_toughness_reduction', op: '+=', value: this.parseExpr() };
            }
            case 'require_test': { this.next(); return this.parseRequireTest(); }
            case 'roll_on': { this.next(); return this.parseRollOn(); }
            case 'apply_status': { this.next(); return this.parseApplyStatus(); }
            default:
                throw this.err(`Unknown action '${kw}'`);
        }
    }

    // --- declaration bodies (shared by the legacy verbs and `declare …`) ------

    // require_test "Char" <modifier-expr> "on-fail" [=> roll_on "T" | apply_status …]
    parseRequireTest() {
        const characteristic = this.expectString('a characteristic name (e.g. "Toughness")');
        const value = this.parseExpr();                       // the test modifier
        const onFail = this.expectString('the on-fail consequence text');
        // optional follow-up on a FAILED test: roll on a roll_table OR
        // apply a condition (e.g. Flame → On Fire).
        let onFailRollTable = null, onFailApply = null;
        if (this.isOp('=>')) {
            this.next();
            if (this.isKw('roll_on') || this.isKw('table_roll')) { this.next(); onFailRollTable = this.expectString('a roll_table name'); }
            else if (this.isKw('apply_status') || this.isKw('status')) {
                this.next();
                const name = this.expectString('a condition name');
                let value = null, duration = null, location = null;   // same optional vars as apply_status
                while (this.isKw('value') || this.isKw('duration') || this.isKw('location')) {
                    if (this.isKw('value')) { this.next(); value = this.parseExpr(); }
                    else if (this.isKw('duration')) { this.next(); duration = this.parseExpr(); }
                    else { this.next(); location = this.parseExpr(); }
                }
                onFailApply = { name, value, duration, location };
            } else throw this.err("Expected 'roll_on' or 'apply_status' after =>");
        }
        return { type: 'Action', action: 'require_test', characteristic, value, onFail, onFailRollTable, onFailApply };
    }

    // roll_on "Table" [+ <modifier>] [area <expr>]
    parseRollOn() {
        const table = this.expectString('a roll_table name');
        let value = null, area = null;
        if (this.isOp('+')) { this.next(); value = this.parseExpr(); }
        if (this.isKw('area')) { this.next(); area = this.parseExpr(); }
        return { type: 'Action', action: 'roll_on', table, value, area };
    }

    // apply_status "Name" [value e] [duration e] [location e] [, "reason"]
    parseApplyStatus() {
        const name = this.expectString('a status name');
        let value = null, duration = null, location = null, reason = null;
        while (this.isKw('value') || this.isKw('duration') || this.isKw('location')) {
            if (this.isKw('value')) { this.next(); value = this.parseExpr(); }
            else if (this.isKw('duration')) { this.next(); duration = this.parseExpr(); }
            else { this.next(); location = this.parseExpr(); }
        }
        if (this.isPunct(',')) { this.next(); reason = this.expectString('a reason'); }
        return { type: 'Action', action: 'apply_status', name, value, duration, location, reason };
    }
}

/** Tokenize + parse DSL source into a Program AST. Throws DslError on failure. */
export function parse(src) {
    return new Parser(tokenize(src)).parseProgram();
}

/** Parse a single rule (convenience for tests / one-off snippets). */
export function parseRule(src) {
    const program = parse(src);
    if (program.rules.length !== 1) {
        throw new DslError(`Expected exactly one rule, found ${program.rules.length}`, 1, 1);
    }
    return program.rules[0];
}

export { DslError };
