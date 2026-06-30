# DH2 Trait DSL — grammar

A small, line-oriented language for authoring DH2 rule interpretations (qualities,
talents, traits, conditions, configurations, actions, roll tables, …) as
**checkpoint effects**. Most constructs are *rules* that compile to the same
`{ id, ruleId, source, checkpoint, priority, when, apply }` shape the engine runs
from a `Registry` (see `lib/pipeline.mjs`), so DSL-authored rules and native-JS
rules are interchangeable and the engine never changes. Two constructs —
`roll_table` and `action` — are top-level **declarations** compiled into their own
registries at load (not checkpoint rules).

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
program     = { rule | roll_table | action_decl } ;

(* --- rule: compiles to one Effect per branch --- *)
rule        = kind STRING [ "tier" INT ] "{" { clause } "}" ;
kind        = "quality" | "talent" | "trait" | "circumstance" | "condition"
            | "configuration" | "mechanic" | "miscellaneous"
            | "status" | "generic" | "rule" ;   (* aliases, normalised below *)
            (* The kind is the player-facing CATEGORY label; gate behaviour with
               the matching has_*()/configuration() function. Aliases normalise:
               status -> condition, generic/rule -> miscellaneous. The old
               situational `condition` sense is now `circumstance`; the active
               sense (On Fire, Aiming, Stunned) is `condition`. *)

(* A rule body has exactly one `on`, an optional `priority`, and one or more
   `when …? then …` branches (any order, but a `when` must be immediately
   followed by its `then`). Each branch compiles to its own effect. A branch with
   no `when` is unconditional. *)
clause      = "on" IDENT                          (* checkpoint; required, once *)
            | "priority" INT                       (* ordering; optional *)
            | branch ;
branch      = [ "when" predicate ] "then" action { ";" action } ;

(* --- roll_table: a die + range→outcome rows, invoked by the roll_on action --- *)
roll_table  = "roll_table" STRING "{" "die" DICE { table_row } "}" ;
table_row   = INT [ "-" INT ] ":" STRING [ "=>" STRING { "," STRING } ] [ ";" ] ;
            (* lo[-hi]: "outcome" [=> "Status", …]  — the optional statuses are
               applied to the target when that row is rolled. *)

(* --- action declaration: the Actions taxonomy, compiled once at load --- *)
action_decl = "action" STRING "{" { "type" action_type | "attack" | "subtype" IDENT } "}" ;
action_type = "Half" | "Full" | "Reaction" | "Free" ;
            (* `type` required. `attack` is sugar for `subtype attack` — the key
               subtype, read via is_attack / action_subtype("…") (e.g. Defensive's
               -10 to attacks). Hooked via is_action("…"), action_type, is_reaction(). *)

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
            | "add_die" expr                       (* extra pool dice (weapon die size) *)
            | "keep_highest"                        (* keep the original die count, highest *)
            | "add_hits" expr
            | "multiply_hits" expr
            | "set" "pen" ( "+=" | "=" ) expr
            | "set" "rf_threshold" "=" expr
            | "set" "jam_threshold" "=" expr
            | "set" "scatter" ( "+=" | "=" ) expr   (* base / DSL-alterable scatter distance *)
            | "set" "damage_type" "=" expr          (* override hit damage type (Sanctified → "Holy") *)
            | "floor_die" expr                      (* raise any die below N to N (Proven) *)
            | "cap_die" expr                        (* cap any die above N at N (Primitive) *)
            | "emit" STRING [ "," STRING ]          (* push a named effect [+ description] *)
            | "fail"                                (* cancel success (e.g. Jam) *)
            | "suppress" STRING                     (* skip another rule by name this run (Overheats → Jam) *)
            | "prevent_parry"                       (* mark the attack un-Parryable (Flexible) *)
            | "cannot_parry"                        (* mark THIS weapon unable to Parry (Unwieldy) *)
            | "detonate"                            (* resolve damage at the scatter point (Blast) *)
            | "corrode" expr                        (* Corrosive: reduce struck-location AP *)
            | "bump_quality" STRING "by" expr       (* raise an existing quality's rating *)
            | "add_quality" STRING                  (* grant a quality this shot (Maximal → Recharge) *)
            | "reduce_unnatural_toughness" expr     (* Felling: cut the target's Unnatural Toughness *)
            | "roll_on" STRING [ "+" expr ] [ "area" expr ]   (* roll on a roll_table (+ modifier; optional radius surfaced with the result — Haywire) *)
            | "require_test" STRING expr STRING [ "=>" ( "roll_on" STRING | "apply_status" STRING { "value" expr | "duration" expr | "location" expr } ) ]
            | "apply_status" STRING { "value" expr | "duration" expr | "location" expr } [ "," STRING ] ;

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
- operators `== != >= <= += => > < = + - * /`; punctuation `{ } ( ) , ; :`
- comments: `// ...` or `# ...` to end of line

## Checkpoints (`on`)
`MODIFIERS`, `POST_ROLL`, `ON_MISS`, `HIT_COUNT_MULT`, `HIT_COUNT_BONUS`,
`PENETRATION`, `DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS`, `ON_HIT`, `PARRY`,
`POST_PARRY`, `EVASION` (validated by the compiler against `lib/pipeline.mjs`).

## Vocabulary (`when` / expressions)
Facts and functions are exposed to the interpreter over a whitelist. **The
authoritative, always-current list lives in `lib/dsl/docs.mjs`, served at
`/api/dsl-docs` and rendered on the Rules page.** Highlights:

- weapon/actor: `is_melee`, `is_ranged`, `pen`, `sb`, `tb`, `bs_bonus`, `ws_bonus`
- test/outcome: `roll`, `dos`, `dof`, `success`
- action context: `action`, `action_type`, `is_attack`, `aim`, `half_aim`,
  `full_aim`, `range`, `location`, `damage_type`, `hit_index`
- mechanic: `jam_threshold`, `craftsmanship`
- per-hit/target: `damage_dealt`, `wounds`, `target_sb`, `target_tb`, `target_armour`,
  `target_unnatural_toughness`
- combat state: `dual_wielding`, `firing_offhand`, `firing_both`
- parry: `opposing_present`, `opposing_has_quality("…")` (the parried attacking
  weapon — Power Field)
- functions: `has_quality`, `has_talent`, `has_trait`, `target_has_trait`,
  `has_condition`
  (`has_status` alias), `has_circumstance`, `circumstance_severity`,
  `configuration` (`firing_mode` alias),
  `is_action`, `is_reaction`, `action_subtype`, `quality_level`, `trait_level`,
  `condition_severity`, `condition_duration`, `condition_location`, `tens`,
  `is_natural`

## Examples

```
// Tier-1 talent, two independently-activated branches.
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

// An active Condition (was `status`): aiming adds the to-hit bonus.
condition "Full Aim" {
  on MODIFIERS  when has_condition("Full Aim")  then add modifier "aim" = 20
}

// A per-character Configuration toggle that rewrites the profile this shot.
configuration "Maximal" {
  on DAMAGE_MODS  when has_quality("Maximal") and configuration("Maximal")
  then add modifier "maximal" = 1d10; bump_quality "Blast" by 2
}

// On-hit Condition with structured variables (severity + hit location).
quality "Crippling" {
  on ON_HIT  when has_quality("Crippling") and wounds > 0
  then apply_status "Crippled" value quality_level("Crippling", 1) location location, "inflicted a wound"
}

// On-hit test that, on failure, rolls on a table.
quality "Hallucinogenic" {
  on ON_HIT  when has_quality("Hallucinogenic")
  then require_test "Toughness" (-10 * quality_level("Hallucinogenic", 1)) "delusion" => roll_on "Hallucinogenic Effects"
}

// A roll table (invoked by roll_on); rows may apply statuses.
roll_table "Hallucinogenic Effects" {
  die 1d10
  1: "Bugs! He claws at imaginary insects." => "Prone", "Stunned"
  8: "Berserk rage — he attacks the nearest foe." => "Frenzied"
}

// An action declaration — the Actions taxonomy, compiled once at load.
action "Standard Attack" { type Half attack }
action "Parry"           { type Reaction }
```
