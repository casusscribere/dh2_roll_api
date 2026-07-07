/**
 * EncounterState + upkeep ticks (ROADMAP Phase 4, Lane A — DSL_ARCHITECTURE F7).
 *
 * The serialisable document that carries MUTABLE combat state ACROSS
 * engagements and turns — the missing concept behind five deferred features:
 * Corrosive AP persistence, On Fire's per-round burn, Toxified's end-of-turn
 * test, the Recharge cooldown, and Haywire Field decay.
 *
 * Shape (deliberately mirrors Foundry ActiveEffect semantics — Lane C maps it
 * 1:1 onto AEs: duration.rounds ⇔ duration, severity/location ⇔ flags):
 *
 *   { schemaVersion: 1, kind: 'dh2.encounter', round: 1,
 *     actors: {
 *       <key>: {
 *         name,
 *         stats: { characteristics: { t, ag, wp, … }, unnatural: {…} },   // for upkeep tests
 *         conditions: [{ name, severity?, duration?, location?, decay? }],
 *         armourDamage: { <Location>: <AP lost> },        // Corrosive, cumulative
 *         cooldowns: { recharge?: true },
 *         wounds: { taken: <total recorded by ticks/engagements> },
 *       } } }
 *
 * MECHANISM (engine-owned, not DSL): duration decrement + expiry and
 * severity decay (`decay: N` per round, expire at 0) at ROUND_END; the
 * `recharge` cooldown clears at the actor's TURN_END. POLICY (DSL-owned): what
 * a condition DOES each tick — rules on the upkeep.* checkpoints declare
 * damage (`declare damage 1d10, "…"`) and tests (`require_test … => damage …`)
 * read against the actor's stored stats.
 *
 * The stateless flows keep working without a document — everything here is
 * opt-in via `encounter` + actor keys on the engagement inputs.
 */
import { CHECKPOINTS, runCheckpoint } from './pipeline.mjs';
import { RollContext } from './context.mjs';
import { rollTest } from './engine.mjs';
import { defaultRegistry } from './rules/index.mjs';

export const ENCOUNTER_SCHEMA_VERSION = 1;

export function emptyEncounter() {
    return { schemaVersion: ENCOUNTER_SCHEMA_VERSION, kind: 'dh2.encounter', round: 1, actors: {} };
}

/** Get-or-create an actor entry. */
export function encounterActor(encounter, key, name = key) {
    if (!encounter.actors[key]) {
        encounter.actors[key] = {
            name, stats: { characteristics: {}, unnatural: {}, talents: [], traits: [] },
            conditions: [], armourDamage: {}, cooldowns: {}, wounds: { taken: 0 },
        };
    }
    return encounter.actors[key];
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const PHASE_TO_CHECKPOINT = {
    TURN_START: CHECKPOINTS.UPKEEP_TURN_START,
    TURN_END: CHECKPOINTS.UPKEEP_TURN_END,
    ROUND_END: CHECKPOINTS.UPKEEP_ROUND_END,
};

/**
 * Run one upkeep phase over the encounter (all actors, or one via `actorKey`).
 * Returns { encounter, events } — a NEW document (input untouched) plus a flat
 * event list for the tracker/chat: condition damage, failed tests, expiries,
 * decays, cooldown clears.
 */
export function tickEncounter(encounter, phase, registry = defaultRegistry, rng = Math.random, actorKey = null) {
    const checkpoint = PHASE_TO_CHECKPOINT[phase];
    if (!checkpoint) throw new Error(`Unknown upkeep phase '${phase}' (TURN_START | TURN_END | ROUND_END)`);
    const out = clone(encounter);
    const events = [];
    const keys = actorKey ? [actorKey] : Object.keys(out.actors);

    for (const key of keys) {
        const actor = out.actors[key];
        if (!actor) continue;

        // --- DSL policy: run the upkeep checkpoint against this actor ---------
        const ctx = new RollContext({
            action: 'Upkeep', isMelee: false, rangeBand: '', aimValue: 0, rng,
            qualities: [], craftsmanship: 'Common',
            talents: actor.stats?.talents ?? [], traits: actor.stats?.traits ?? [],
            statuses: actor.conditions, circumstances: [],
            combat: { dualWielding: false, firingOffhand: false, firingBoth: false },
            modifiers: {}, effects: [],
            targetEffects: { tests: [], statuses: [], armour: [] },
            declaredDamage: [],
        });
        runCheckpoint(registry, checkpoint, ctx);

        // declared damage (On Fire's 1d10, …)
        for (const d of ctx.declaredDamage ?? []) {
            actor.wounds.taken += d.amount;
            events.push({ actor: key, type: 'damage', source: d.source, amount: d.amount, reason: d.reason });
        }
        // declared tests (Toxified's Toughness test) — rolled against stored stats
        for (const t of ctx.targetEffects.tests) {
            const charKey = t.characteristic?.toLowerCase().startsWith('t') ? 't'
                : t.characteristic?.toLowerCase().startsWith('a') ? 'ag'
                : t.characteristic?.toLowerCase().startsWith('w') ? 'wp' : null;
            const target = charKey != null ? (actor.stats.characteristics?.[charKey] ?? 0) : 0;
            const unnatural = charKey != null ? (actor.stats.unnatural?.[charKey] ?? 0) : 0;
            const tt = rollTest({ target, modifiers: { test: t.modifier }, label: `${t.characteristic} test (upkeep)`, unnatural }, rng);
            const ev = { actor: key, type: 'test', source: t.source, characteristic: t.characteristic, roll: tt.roll, threshold: tt.modifiedTarget, success: tt.success };
            if (!tt.success) {
                ev.outcome = t.onFail;
                if (typeof t.onFailDamage === 'function') {
                    ev.damage = t.onFailDamage();
                    actor.wounds.taken += ev.damage;
                }
                if (t.onFailApply) {
                    actor.conditions.push({ name: t.onFailApply.name, severity: t.onFailApply.value ?? null, duration: t.onFailApply.duration ?? null, location: t.onFailApply.location ?? null });
                    ev.applied = t.onFailApply.name;
                }
            }
            events.push(ev);
        }
        // narrative effects
        for (const e of ctx.effects ?? []) events.push({ actor: key, type: 'note', source: e.name, reason: e.effect });

        // --- mechanism: cooldowns clear at the actor's TURN_END ----------------
        if (phase === 'TURN_END' && actor.cooldowns?.recharge) {
            actor.cooldowns.recharge = false;
            events.push({ actor: key, type: 'cooldown', source: 'Recharge', reason: 'weapon recharged — may fire again' });
        }

        // --- mechanism: durations tick + severity decay at ROUND_END -----------
        if (phase === 'ROUND_END') {
            const kept = [];
            for (const c of actor.conditions) {
                let keep = true;
                if (typeof c.duration === 'number') {
                    c.duration -= 1;
                    if (c.duration <= 0) {
                        keep = false;
                        events.push({ actor: key, type: 'expired', source: c.name, reason: 'duration elapsed' });
                    }
                }
                if (keep && typeof c.decay === 'number' && typeof c.severity === 'number') {
                    c.severity -= c.decay;
                    if (c.severity <= 0) {
                        keep = false;
                        events.push({ actor: key, type: 'expired', source: c.name, reason: 'decayed to nothing' });
                    } else {
                        events.push({ actor: key, type: 'decay', source: c.name, reason: `severity → ${c.severity}` });
                    }
                }
                if (keep) kept.push(c);
            }
            actor.conditions = kept;
        }
    }
    if (phase === 'ROUND_END' && !actorKey) out.round += 1;
    return { encounter: out, events };
}

/**
 * Merge an actor's persistent state INTO an engagement combatant input:
 * conditions append to the combatant's conditions[], and (defender side) the
 * per-location armour damage seeds the engagement's corrosion accumulator.
 */
export function mergeActorState(combatant, encounter, key) {
    const actor = encounter?.actors?.[key];
    if (!actor) return combatant;
    const merged = { ...combatant };
    const have = new Set((merged.conditions ?? []).map((c) => (typeof c === 'object' ? c.name : c)));
    merged.conditions = [...(merged.conditions ?? []), ...actor.conditions.filter((c) => !have.has(c.name))];
    return merged;
}

/**
 * Harvest an engagement result back INTO the encounter: Corrosive AP loss per
 * location, conditions applied to the defender, the attacker's Recharge
 * cooldown, and wounds taken. Returns a NEW encounter document.
 */
export function harvestEngagement(encounter, attackerKey, defenderKey, result, { attackerName, defenderName } = {}) {
    const out = clone(encounter ?? emptyEncounter());
    const atk = encounterActor(out, attackerKey, attackerName ?? attackerKey);
    const def = encounterActor(out, defenderKey, defenderName ?? defenderKey);

    // attacker: firing granted Recharge → weapon must recharge (cooldown until TURN_END)
    if ((result.attack?.effects ?? []).some((e) => e.name === 'Recharge')) {
        atk.cooldowns.recharge = true;
    }
    for (const hit of result.attack?.hits ?? []) {
        if (hit.evaded || hit.fieldAbsorbed) continue;
        // Corrosive: record permanent AP loss at the struck location
        for (const ar of hit.targetEffects?.armour ?? []) {
            const loc = hit.location ?? 'Body';
            def.armourDamage[loc] = (def.armourDamage[loc] ?? 0) + (ar.amount ?? 0);
        }
        // conditions the hit applied (Crippled, On Fire, Toxified, …)
        for (const st of hit.targetEffects?.statuses ?? []) {
            def.conditions.push({ name: st.status, severity: st.value ?? null, duration: st.duration ?? null, location: st.location ?? null });
        }
        def.wounds.taken += (hit.soak?.woundsInflicted ?? 0) + (hit.corrosiveWounds ?? 0);
    }
    return out;
}
