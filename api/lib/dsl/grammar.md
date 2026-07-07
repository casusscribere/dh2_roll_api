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
program     = [ pragma ] { rule | roll_table | action_decl | package } ;

(* --- v2 file header: version pragma + package provenance (Stage 0) --- *)
pragma      = "dsl" INT ;                        (* grammar version. CURRENT: 3 — pragma-less text
                                                    is treated as current; an explicit dsl 1/2 is
                                                    rejected (tools/migrate-dsl.mjs upgrades it) *)
package     = "package" STRING "{" { "system" STRING | "source" STRING | "requires" STRING } "}" ;
            (* one per file. `system` = rule system id ("dh2", "rt1", …);
               `source` = source book; `requires` = package dependency (reserved
               for the Stage-5 layered registry). Compiled effects carry
               package/system/sourceBook and a stable qualifiedId "pkg/rule-id". *)

(* --- rule: compiles to one Effect per branch --- *)
rule        = kind STRING [ "tier" INT ] "{" { clause } "}" ;
kind        = "quality" | "talent" | "trait" | "circumstance" | "condition"
            | "configuration" | "mechanic" | "miscellaneous" ;
            (* The kind is the player-facing CATEGORY label; gate behaviour with
               the matching has_*()/configuration() function. The v1 aliases
               (status/generic/rule) were REMOVED in dsl 3 — the migrator
               rewrites them. The situational sense is `circumstance`; the
               active sense (On Fire, Aiming, Stunned) is `condition`. *)

(* A rule body has exactly one `on`, an optional `priority`, and one or more
   `when …? then …` branches (any order, but a `when` must be immediately
   followed by its `then`). Each branch compiles to its own effect. A branch with
   no `when` is unconditional. *)
clause      = "on" IDENT [ "." IDENT ]            (* pipeline.checkpoint; required, once.
                                                      A bare name is the default `attack`
                                                      pipeline (an explicit `attack.` prefix
                                                      is normalised away); other pipelines
                                                      are qualified: `on test.MODIFIERS` *)
            | "priority" INT                       (* ordering; optional *)
            | "meta" "{" { "page" INT | "ref" STRING | "source" STRING } "}"
                                                   (* rule provenance: book page, free-text
                                                      cross-reference, per-rule source-book
                                                      override (else the package's) *)
            | "replaces" STRING                    (* layered override (Phase 3): drop the named
                                                      rule's effects entirely when this rule's
                                                      layer is active. Takes a qualifiedId
                                                      ("dh2.core.mechanics/jam") or bare rule id.
                                                      The static successor to `suppress` — prefer
                                                      it for cross-layer overrides; may repeat *)
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
value       = NUMBER | STRING | DICE | BOOL | call | path ;
path        = IDENT [ "." IDENT ] ;               (* scoped fact (Stage 2): target.tb, weapon.pen;
                                                     unscoped = the attacker scope *)
call        = path "(" [ expr { "," expr } ] ")" ;  (* scoped fn: opposing_weapon.has_quality("Force") *)

(* --- action (dsl 3): three PRIMITIVES + the retained rich verbs.
       The v1 thin-sugar verbs (add_die, keep_highest, add_hits, fail,
       prevent_parry, cannot_parry, detonate, reduce_unnatural_toughness) were
       REMOVED — tools/migrate-dsl.mjs rewrites old text to the primitives. --- *)
action      = "add" "modifier" STRING "=" expr
            | "set" "modifier" STRING "=" expr
            | "cancel" "modifier" STRING
            | "set" IDENT ( "+=" | "=" ) expr       (* PRIMITIVE: write a REGISTERED SLOT (pen,
                                                       jam_threshold, scatter, damage_type,
                                                       extra_dice, extra_hits, rf_threshold,
                                                       unnatural_toughness_reduction);
                                                       compiler validates name + mode *)
            | "flag" IDENT                          (* PRIMITIVE: raise a REGISTERED FLAG (no_parry,
                                                       cannot_parry, detonate, attack_failed,
                                                       keep_highest) *)
            | "declare" declaration                 (* PRIMITIVE: structured record the engine resolves *)
            (* --- retained rich verbs (ergonomic surface over the primitives) --- *)
            | "multiply_hits" expr
            | "floor_die" expr                      (* raise any die below N to N (Proven) *)
            | "cap_die" expr                        (* cap any die above N at N (Primitive) *)
            | "emit" STRING [ "," STRING ]          (* = declare event *)
            | "suppress" STRING                     (* skip another rule by name this run — RUNTIME
                                                       conditional override (Overheats → Jam);
                                                       `replaces` is the static cross-layer form *)
            | "corrode" expr                        (* = declare armour_damage (Corrosive) *)
            | "bump_quality" STRING "by" expr       (* raise an existing quality's rating *)
            | "add_quality" STRING                  (* grant a quality this shot (Maximal → Recharge) *)
            | "roll_on" STRING [ "+" expr ] [ "area" expr ]   (* = declare table_roll *)
            | "require_test" STRING expr STRING [ "=>" ( "roll_on" STRING | "apply_status" STRING { "value" expr | "duration" expr | "location" expr } ) ]
            | "apply_status" STRING { "value" expr | "duration" expr | "location" expr } [ "," STRING ] ;

declaration = "test" <require_test body> | "status" <apply_status body>
            | "table_roll" <roll_on body> | "armour_damage" expr
            | "damage" expr [ "," STRING ]          (* direct damage vs the actor (upkeep ticks —
                                                       On Fire's 1d10/round); reason optional *)
            | "event" STRING [ "," STRING ] ;
(* require_test's on-fail follow-up also accepts `=> damage <expr>` — the dice
   roll happens ONLY on a failed test (Toxified's end-of-turn 1d10). *)

(* --- arithmetic expression (action values) --- *)
expr        = addExpr ;
addExpr     = mulExpr { ( "+" | "-" ) mulExpr } ;
mulExpr     = unary { ( "*" | "/" ) unary } ;    (* "/" is integer division rounding UP —
                                                    the DH2 global rule (p.18); use floor()
                                                    for round-down, half(n) = ceil(n/2) *)
unary       = "-" unary | factor ;
factor      = "(" expr ")" | value ;
```

### Tokens
- `IDENT` — `[A-Za-z_][A-Za-z0-9_]*`
- `NUMBER` — non-negative integer (negatives come from unary `-`)
- `DICE` — `INT "d" INT`, e.g. `1d10` (rolled at apply time via the injected RNG)
- `STRING` — `"..."` or `'...'`, with `\` escapes
- `BOOL` — `true` | `false`
- operators `== != >= <= += => > < = + - * /`; punctuation `{ } ( ) , ; : .`
  (`.` joins scoped fact paths and pipeline-qualified checkpoints)
- comments: `// ...` or `# ...` to end of line

## Checkpoints (`on`)
`MODIFIERS`, `POST_ROLL`, `ON_MISS`, `HIT_COUNT_MULT`, `HIT_COUNT_BONUS`,
`PENETRATION`, `DAMAGE_POOL`, `DIE_ADJUST`, `DAMAGE_MODS`, `ON_HIT`, `PARRY`,
`POST_PARRY`, `EVASION` (validated by the compiler against `lib/pipeline.mjs`).

**Pipelines:** the ids above are the default **`attack`** pipeline (unqualified).
Other pipelines use qualified ids:
- **`test.MODIFIERS`**, **`test.POST_ROLL`** (Phase 3) — the generic
  characteristic/skill-test pipeline behind `/api/test`; gate rules on `test_name`.
- **`upkeep.TURN_START`**, **`upkeep.TURN_END`**, **`upkeep.ROUND_END`**
  (Phase 4) — per-actor ticks against the EncounterState (`/api/encounter/tick`).
  Rules read the actor's conditions and `declare damage …` / `require_test … =>
  damage …`; the ENGINE owns duration decrement/expiry, `decay: N` severity
  reduction (Haywire Field), and the Recharge cooldown clear at TURN_END.

Planned per ROADMAP.md: `power.*`, `ship_attack.*`.

## Vocabulary (`when` / expressions)
Facts and functions are exposed to the interpreter over a whitelist. **The
authoritative, always-current list lives in `lib/dsl/docs.mjs`, served at
`/api/dsl-docs` and rendered on the Rules page.** Highlights:

- weapon/actor: `is_melee`, `is_ranged`, `pen`, `sb`, `tb`, `bs_bonus`, `ws_bonus`
- test/outcome: `roll`, `dos`, `dof`, `success`; generic-test tag: `test_name`
- action context: `action`, `action_type`, `is_attack`, `aim`, `half_aim`,
  `full_aim`, `range`, `location`, `damage_type`, `hit_index`
- mechanic: `jam_threshold`, `craftsmanship`
- per-hit outcome: `damage_dealt`, `wounds`
- target scope: `target.sb`, `target.tb`, `target.armour`,
  `target.unnatural_toughness`, `target.has_trait("…")`, `target.trait_level(…)`
- combat state: `dual_wielding`, `firing_offhand`, `firing_both`
- parry (opposing_weapon scope): `opposing_weapon.present`,
  `opposing_weapon.has_quality("…")` (the parried attacking weapon — Power Field)
- functions: `has_quality`, `has_talent`, `has_trait`, `has_condition`,
  `has_circumstance`, `circumstance_severity`, `configuration`,
  `is_action`, `is_reaction`, `action_subtype`, `quality_level`, `trait_level`,
  `condition_severity`, `condition_duration`, `condition_location`, `tens`,
  `is_natural`, `ceil`, `floor`, `half`
  (dsl 3 removed the prefixed aliases `target_*`/`opposing_*` and the
  `has_status`/`firing_mode` aliases — use the scoped/canonical forms)

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
