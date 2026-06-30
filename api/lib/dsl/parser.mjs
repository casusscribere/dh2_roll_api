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
        const rules = [], tables = [], actions = [];
        while (!this.atEof()) {
            if (this.isKw('roll_table')) tables.push(this.parseTable());
            else if (this.isKw('action')) actions.push(this.parseActionDecl());
            else rules.push(this.parseRule());
        }
        return { type: 'Program', rules, tables, actions };
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
            tier: null, on: null, priority: null, branches: [],
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
            throw this.err(`Unexpected '${t.value ?? t.type}' in rule body (expected on | priority | when | then)`);
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
            if (this.isPunct('(')) {
                this.next();
                const args = [];
                if (!this.isPunct(')')) {
                    args.push(this.parseExpr());
                    while (this.isPunct(',')) { this.next(); args.push(this.parseExpr()); }
                }
                this.expectPunct(')');
                return { type: 'Call', name: t.value, args };
            }
            return { type: 'Identifier', name: t.value };
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
                this.next();
                if (this.isKw('modifier')) {
                    this.next();
                    const name = this.expectString('a modifier name');
                    if (!this.isOp('=')) throw this.err("Expected '=' after modifier name");
                    this.next();
                    return { type: 'Action', action: 'set_modifier', name, value: this.parseExpr() };
                }
                if (this.isKw('pen')) {
                    this.next();
                    let op;
                    if (this.isOp('+=')) op = '+=';
                    else if (this.isOp('=')) op = '=';
                    else throw this.err("Expected '=' or '+=' after pen");
                    this.next();
                    return { type: 'Action', action: 'set_pen', op, value: this.parseExpr() };
                }
                if (this.isKw('rf_threshold')) {
                    this.next();
                    if (!this.isOp('=')) throw this.err("Expected '=' after rf_threshold");
                    this.next();
                    return { type: 'Action', action: 'set_rf_threshold', value: this.parseExpr() };
                }
                if (this.isKw('jam_threshold')) {
                    this.next();
                    if (!this.isOp('=')) throw this.err("Expected '=' after jam_threshold");
                    this.next();
                    return { type: 'Action', action: 'set_jam_threshold', value: this.parseExpr() };
                }
                if (this.isKw('scatter')) {
                    this.next();
                    let op;
                    if (this.isOp('+=')) op = '+=';
                    else if (this.isOp('=')) op = '=';
                    else throw this.err("Expected '=' or '+=' after scatter");
                    this.next();
                    return { type: 'Action', action: 'set_scatter', op, value: this.parseExpr() };
                }
                if (this.isKw('damage_type')) {
                    this.next();
                    if (!this.isOp('=')) throw this.err("Expected '=' after damage_type");
                    this.next();
                    return { type: 'Action', action: 'set_damage_type', value: this.parseExpr() };
                }
                throw this.err("Expected 'modifier', 'pen', 'rf_threshold', 'jam_threshold', 'scatter' or 'damage_type' after 'set'");
            }
            case 'cancel': {
                this.next();
                this.expectKw('modifier');
                return { type: 'Action', action: 'cancel_modifier', name: this.expectString('a modifier name') };
            }
            case 'add_die': { this.next(); return { type: 'Action', action: 'add_die', value: this.parseExpr() }; }
            case 'keep_highest': { this.next(); return { type: 'Action', action: 'keep_highest' }; }
            case 'add_hits': { this.next(); return { type: 'Action', action: 'add_hits', value: this.parseExpr() }; }
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
            case 'fail': { this.next(); return { type: 'Action', action: 'fail' }; }
            case 'suppress': {                           // suppress "Jam" — skip another rule this checkpoint run
                this.next();
                return { type: 'Action', action: 'suppress', name: this.expectString('the name of a rule to suppress') };
            }
            case 'prevent_parry': { this.next(); return { type: 'Action', action: 'prevent_parry' }; }
            case 'cannot_parry': { this.next(); return { type: 'Action', action: 'cannot_parry' }; }
            case 'detonate': { this.next(); return { type: 'Action', action: 'detonate' }; }
            case 'corrode': { this.next(); return { type: 'Action', action: 'corrode', value: this.parseExpr() }; }
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
            case 'reduce_unnatural_toughness': {         // reduce_unnatural_toughness <expr> (Felling)
                this.next();
                return { type: 'Action', action: 'reduce_unnatural_toughness', value: this.parseExpr() };
            }
            case 'require_test': {
                this.next();
                const characteristic = this.expectString('a characteristic name (e.g. "Toughness")');
                const value = this.parseExpr();                       // the test modifier
                const onFail = this.expectString('the on-fail consequence text');
                // optional follow-up on a FAILED test: roll on a roll_table OR
                // apply a condition (e.g. Flame → On Fire).
                let onFailRollTable = null, onFailApply = null;
                if (this.isOp('=>')) {
                    this.next();
                    if (this.isKw('roll_on')) { this.next(); onFailRollTable = this.expectString('a roll_table name after roll_on'); }
                    else if (this.isKw('apply_status')) {
                        this.next();
                        const name = this.expectString('a condition name after apply_status');
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
            case 'roll_on': {
                this.next();
                const table = this.expectString('a roll_table name');
                let value = null, area = null;                        // roll_on "X" [+ <modifier>] [area <expr>]
                if (this.isOp('+')) { this.next(); value = this.parseExpr(); }
                if (this.isKw('area')) { this.next(); area = this.parseExpr(); }
                return { type: 'Action', action: 'roll_on', table, value, area };
            }
            case 'apply_status': {
                this.next();
                const name = this.expectString('a status name');
                // optional structured variables in any order, then optional reason:
                //   value <expr> | duration <expr> | location <expr>
                let value = null, duration = null, location = null, reason = null;
                while (this.isKw('value') || this.isKw('duration') || this.isKw('location')) {
                    if (this.isKw('value')) { this.next(); value = this.parseExpr(); }
                    else if (this.isKw('duration')) { this.next(); duration = this.parseExpr(); }
                    else { this.next(); location = this.parseExpr(); }
                }
                if (this.isPunct(',')) { this.next(); reason = this.expectString('a reason'); }
                return { type: 'Action', action: 'apply_status', name, value, duration, location, reason };
            }
            default:
                throw this.err(`Unknown action '${kw}'`);
        }
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
