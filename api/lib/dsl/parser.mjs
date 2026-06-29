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

// `rule` is kept as a backward-compatible alias for `generic`.
const RULE_KINDS = new Set(['talent', 'trait', 'condition', 'quality', 'status', 'generic', 'rule']);
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
        const rules = [];
        while (!this.atEof()) rules.push(this.parseRule());
        return { type: 'Program', rules };
    }

    parseRule() {
        const kindTok = this.peek();
        if (kindTok.type !== 'ident' || !RULE_KINDS.has(kindTok.value)) {
            throw this.err('Expected a rule kind (talent | trait | condition | quality | status | generic)');
        }
        this.next();
        const name = this.expectString('a quoted rule name');

        const rule = {
            type: 'Rule', kind: kindTok.value, name,
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
                if (this.isKw('scatter')) {
                    this.next();
                    let op;
                    if (this.isOp('+=')) op = '+=';
                    else if (this.isOp('=')) op = '=';
                    else throw this.err("Expected '=' or '+=' after scatter");
                    this.next();
                    return { type: 'Action', action: 'set_scatter', op, value: this.parseExpr() };
                }
                throw this.err("Expected 'modifier', 'pen', 'rf_threshold' or 'scatter' after 'set'");
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
