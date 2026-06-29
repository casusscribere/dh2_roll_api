# DH2 Trait DSL — grammar

A small, line-oriented language for authoring DH2 rule interpretations (traits,
talents, weapon qualities, custom modifiers) as **checkpoint effects**. Each rule
compiles to the same `{ id, source, checkpoint, priority, when, apply }` shape the
engine already runs from a `Registry` (see `lib/pipeline.mjs`), so DSL-authored
rules and native-JS rules are interchangeable and the engine never changes.

Pipeline: **text → `tokenize` → tokens → `parse` → AST → `compile` → Effect**.
This document and the tokenizer/parser cover the first half (text → AST). The
compiler/interpreter (AST → executable Effect) is a separate module.

## Design constraints

- **Declarative, not Turing-complete.** No loops, no user-defined functions, no
  assignment beyond the fixed action verbs. This keeps user-supplied rules safe
  to interpret over a whitelisted context (no `eval`, no `Function`).
- **Activation is separate from effect.** The `when` clause is the activation
  predicate ("is this rule in effect right now?"); `then` is the mutation. This
  is what lets e.g. Ambidextrous check *dual-wielding* before cancelling a penalty.
- **Parser is purely syntactic.** It validates structure and reports `line/col`
  errors. Whether a checkpoint / fact / action *name* is meaningful is the
  compiler's job (semantic validation), not the parser's.

## EBNF

```ebnf
program     = { rule } ;
rule        = kind STRING [ "tier" INT ] "{" { clause } "}" ;
kind        = "talent" | "trait" | "condition" | "quality" | "status" | "generic" ;
            (* talent: XP-bought; trait: innate DH2.0 trait; condition: situational
               (non-purchasable) rule; quality: weapon quality; status: active
               status condition; generic: no particular source ("rule" is an
               accepted alias). The kind is a label — gate with the matching
               has_*() function. *)

(* A rule body contains exactly one `on`, an optional `priority`, and one or
   more `when …? then …` branches (in any order, but a `when` must be
   immediately followed by its `then`). Each branch compiles to its own effect,
   evaluated independently. A branch with no `when` is unconditional. *)
clause      = "on" IDENT                         (* checkpoint; required, once *)
            | "priority" INT                      (* ordering; optional *)
            | branch ;
branch      = [ "when" predicate ] "then" action { ";" action } ;

(* --- activation predicate: boolean over whitelisted facts --- *)
predicate   = orExpr ;
orExpr      = andExpr { "or" andExpr } ;
andExpr     = notExpr { "and" notExpr } ;
notExpr     = [ "not" ] comparison ;
comparison  = atom [ ( "==" | "!=" | ">=" | "<=" | ">" | "<" ) value ] ;
atom        = "(" predicate ")" | value ;
value       = NUMBER | STRING | DICE | BOOL | call | IDENT ;
call        = IDENT "(" [ expr { "," expr } ] ")" ;

(* --- action: a fixed set of checkpoint-scoped mutations --- *)
action      = "add" "modifier" STRING "=" expr
            | "set" "modifier" STRING "=" expr
            | "cancel" "modifier" STRING
            | "add_die" expr                      (* extra pool dice (weapon die size) *)
            | "keep_highest"                       (* keep the original die count, highest *)
            | "add_hits" expr
            | "multiply_hits" expr
            | "set" "pen" ( "+=" | "=" ) expr
            | "set" "rf_threshold" "=" expr
            | "floor_die" expr                     (* raise any die below N to N (Proven) *)
            | "cap_die" expr                       (* cap any die above N at N (Primitive) *)
            | "emit" STRING [ "," STRING ]         (* push a named effect [+ description] *)
            | "fail" ;                             (* cancel success (e.g. Jam) *)

(* --- arithmetic expression (action values) --- *)
expr        = addExpr ;
addExpr     = mulExpr { ( "+" | "-" ) mulExpr } ;
mulExpr     = unary { ( "*" | "/" ) unary } ;
unary       = "-" unary | factor ;
factor      = "(" expr ")" | value ;
```

### Tokens
- `IDENT` — `[A-Za-z_][A-Za-z0-9_]*`
- `NUMBER` — non-negative integer (negatives come from unary `-`)
- `DICE` — `INT "d" INT`, e.g. `1d10` (rolled at apply time via the injected RNG)
- `STRING` — `"..."` or `'...'`, with `\` escapes
- `BOOL` — `true` | `false`
- operators `== != >= <= > < += = + - * /`; punctuation `{ } ( ) , ;`
- comments: `// ...` or `# ...` to end of line

## Checkpoints (`on`)
`MODIFIERS`, `POST_ROLL`, `HIT_COUNT_MULT`, `HIT_COUNT_BONUS`, `PENETRATION`,
`DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS` (validated by the compiler).

## Fact vocabulary (`when`)
Read-only facts the compiler will expose to the interpreter (illustrative):
`dual_wielding`, `firing_offhand`, `is_melee`, `is_ranged`, `action`, `aim`,
`range`, `roll`, `dos`, `dof`, `success`, `location`, `hit_index`, `damage_type`,
`sb`, `tb`; functions `has_quality("X")`, `has_talent("X")`, `has_trait("X")`,
`has_status("X")`, `quality_level("X", default)`, `trait_level("X", default)`,
`tens(n)`, `is_natural(n)`. (Authoritative list: `lib/dsl/docs.mjs`, served at `/api/dsl-docs`.)

## Examples

```
// Tier-1 talent with two branches, each independently activated: cancel the
// off-hand penalty when firing off-hand; reduce the dual-wield penalty to -10
// when wielding two weapons with Two-Weapon Wielder.
talent "Ambidextrous" tier 1 {
  on MODIFIERS
  priority 100                       // run after penalty injectors
  when has_talent("Ambidextrous") and firing_offhand and not dual_wielding
    then cancel modifier "off_hand"
  when has_talent("Ambidextrous") and has_talent("Two-Weapon Wielder") and dual_wielding
    then set modifier "two_weapon" = -10
}

// Stepped effect: one die at DoS>=3, a second only at DoS>=5.
quality "Accurate" {
  on DAMAGE_MODS
  when has_quality("Accurate") and dos >= 3 then add modifier "accurate" = 1d10
  when has_quality("Accurate") and dos >= 5 then add modifier "accurate x 2" = 1d10
}

quality "Tearing" {
  on DAMAGE_POOL
  when has_quality("Tearing")
  then add_die 1; keep_highest
}

quality "Jam" {
  on POST_ROLL
  when is_ranged and ((not has_quality("Reliable") and roll > 96) or roll == 100)
  then emit "Jam", "The weapon jams!"; fail
}

generic "Action modifier" {
  on MODIFIERS
  then add modifier "attack" = action_modifier
}
```
