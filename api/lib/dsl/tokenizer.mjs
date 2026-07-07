/**
 * DH2 Trait DSL — tokenizer.
 *
 * Text → flat token stream with line/col positions. Purely lexical: it knows
 * nothing about rules, checkpoints or facts. See grammar.md for the token set.
 */

/** Parse/lex error carrying a source position for friendly UI reporting. */
export class DslError extends Error {
    constructor(message, line, col) {
        super(`${message} (line ${line}, col ${col})`);
        this.name = 'DslError';
        this.rawMessage = message;
        this.line = line;
        this.col = col;
    }
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isIdentStart = (ch) => ch === '_' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
const isIdentPart = (ch) => isIdentStart(ch) || isDigit(ch);

const TWO_CHAR_OPS = new Set(['==', '!=', '>=', '<=', '+=', '=>']);
const ONE_CHAR_OPS = new Set(['>', '<', '=', '+', '-', '*', '/']);
const PUNCT = new Set(['{', '}', '(', ')', ',', ';', ':', '.']);   // '.' joins scoped fact paths (target.tb)

/**
 * Tokenize DSL source. Token shape:
 *   { type: 'ident'|'number'|'dice'|'string'|'op'|'punct'|'eof', ... , line, col }
 * `dice` carries { count, sides }; everything else carries `value`.
 */
export function tokenize(src) {
    const s = String(src);
    const tokens = [];
    let i = 0, line = 1, col = 1;

    const advance = (n = 1) => {
        for (let k = 0; k < n; k++) {
            if (s[i] === '\n') { line++; col = 1; } else { col++; }
            i++;
        }
    };

    while (i < s.length) {
        const ch = s[i];

        // whitespace
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { advance(); continue; }
        // line comments
        if ((ch === '/' && s[i + 1] === '/') || ch === '#') {
            while (i < s.length && s[i] !== '\n') advance();
            continue;
        }

        const startLine = line, startCol = col;

        // string
        if (ch === '"' || ch === "'") {
            const quote = ch;
            advance();
            let value = '';
            while (i < s.length && s[i] !== quote) {
                if (s[i] === '\\' && i + 1 < s.length) { advance(); value += s[i]; advance(); }
                else { value += s[i]; advance(); }
            }
            if (i >= s.length) throw new DslError('Unterminated string', startLine, startCol);
            advance(); // closing quote
            tokens.push({ type: 'string', value, line: startLine, col: startCol });
            continue;
        }

        // number or dice (INT 'd' INT)
        if (isDigit(ch)) {
            let intPart = '';
            while (i < s.length && isDigit(s[i])) { intPart += s[i]; advance(); }
            if ((s[i] === 'd' || s[i] === 'D') && isDigit(s[i + 1])) {
                advance(); // the 'd'
                let sides = '';
                while (i < s.length && isDigit(s[i])) { sides += s[i]; advance(); }
                tokens.push({ type: 'dice', count: parseInt(intPart), sides: parseInt(sides), line: startLine, col: startCol });
            } else {
                tokens.push({ type: 'number', value: parseInt(intPart), line: startLine, col: startCol });
            }
            continue;
        }

        // identifier / keyword (keywords are matched by the parser, not here)
        if (isIdentStart(ch)) {
            let value = '';
            while (i < s.length && isIdentPart(s[i])) { value += s[i]; advance(); }
            tokens.push({ type: 'ident', value, line: startLine, col: startCol });
            continue;
        }

        // punctuation
        if (PUNCT.has(ch)) { advance(); tokens.push({ type: 'punct', value: ch, line: startLine, col: startCol }); continue; }

        // operators (longest match first)
        const two = s.substr(i, 2);
        if (TWO_CHAR_OPS.has(two)) { advance(2); tokens.push({ type: 'op', value: two, line: startLine, col: startCol }); continue; }
        if (ONE_CHAR_OPS.has(ch)) { advance(); tokens.push({ type: 'op', value: ch, line: startLine, col: startCol }); continue; }

        throw new DslError(`Unexpected character '${ch}'`, startLine, startCol);
    }

    tokens.push({ type: 'eof', value: null, line, col });
    return tokens;
}
