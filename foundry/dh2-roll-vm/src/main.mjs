/**
 * DH2 Roll VM — Foundry walking skeleton (ROADMAP.md Phase 1 Lane C).
 *
 * THROWAWAY-QUALITY seam validation, not a product: proves the DSL VM (engine +
 * pipeline + rules, the same bundle the GitHub Pages build ships) runs inside
 * Foundry against the `dark-heresy-2nd` system's Actor data, end to end:
 *
 *   /dh2attack           — attacker = first controlled token, defender = first
 *                          target; maps both Actors → engagement inputs, runs
 *                          resolveEngagement, posts the report to chat.
 *   game.dh2vm           — the whole VM surface for macro/console exploration
 *                          (resolveAttack, resolveEngagement, buildRegistry,
 *                          rollTest, builtinRules, DSL_DOCS, …).
 *
 * What this skeleton VALIDATES (record findings in FOUNDRY_MIGRATION.md):
 *   1. the VM bundle loads as a Foundry esmodule (no Node APIs leak);
 *   2. Actor/Item data (characteristics.*.total, weapon items, attackSpecial
 *      nested items) maps onto the engagement input shape;
 *   3. chat-message rendering of the engagement report;
 *   4. determinism survives (forcedRolls could drive a seeded replay later).
 */
import {
    resolveAttack, resolveEngagement, resolveParry, rollTest, rollDamage, applySoak,
} from '../../../api/lib/engine.mjs';
import { rollScript } from '../../../api/lib/dice.mjs';
import { buildRegistry, builtinRules, availableQualities } from '../../../api/lib/rules/index.mjs';
import { DSL_DOCS } from '../../../api/lib/dsl/docs.mjs';
import { compile } from '../../../api/lib/dsl/compiler.mjs';
import { validateCharacter, migrateCharacter, characterToCombatant } from '../../../api/lib/character-schema.mjs';

const MODULE_ID = 'dh2-roll-vm';

/** dark-heresy-2nd Actor → the engine's combatant shape (best-effort skeleton map). */
function mapActor(actor) {
    const c = actor?.system?.characteristics ?? actor?.characteristics ?? {};
    const total = (k) => Number(c?.[k]?.total ?? c?.[k]?.base ?? 0) || 0;
    // equipped weapon: first equipped weapon Item, else first weapon Item
    const weapons = actor?.items?.filter?.((i) => i.type === 'weapon') ?? [];
    const w = weapons.find((i) => i.system?.equipped) ?? weapons[0];
    // nested attackSpecial items are the system's qualities — 1:1 with our {name, level}
    const specials = (w?.items ?? w?.system?.specials ?? [])
        .filter?.((s) => s.type === 'attackSpecial' || s.system?.level !== undefined) ?? [];
    const qualities = specials.map((s) => ({ name: s.name, level: s.system?.level ?? null }));
    return {
        name: actor?.name ?? 'Unknown',
        characteristics: {
            ws: total('weaponSkill'), bs: total('ballisticSkill'),
            s: total('strength'), t: total('toughness'),
            ag: total('agility'), wp: total('willpower'),
        },
        weapon: w ? {
            name: w.name,
            isMelee: (w.system?.class ?? '').toLowerCase() === 'melee',
            damage: w.system?.damage ?? '1d10',
            pen: Number(w.system?.penetration ?? w.system?.pen ?? 0) || 0,
            damageType: w.system?.damageType ?? 'Impact',
            rof: { single: true, burst: Number(w.system?.rateOfFire?.burst ?? 0) || 0, full: Number(w.system?.rateOfFire?.full ?? 0) || 0 },
            qualities,
            craftsmanship: w.system?.craftsmanship ?? 'Common',
        } : undefined,
        talents: (actor?.items?.filter?.((i) => i.type === 'talent') ?? []).map((t) => t.name),
        traits: (actor?.items?.filter?.((i) => i.type === 'trait') ?? []).map((t) => ({ name: t.name, level: t.system?.level ?? null })),
    };
}

/** Run one engagement between the controlled token and the first target. */
async function dh2Attack() {
    const attackerToken = canvas.tokens.controlled[0];
    const targetToken = game.user.targets.first?.() ?? [...game.user.targets][0];
    if (!attackerToken || !targetToken) {
        ui.notifications.warn('dh2-roll-vm: select an attacker token and target another token.');
        return;
    }
    const atk = mapActor(attackerToken.actor);
    const def = mapActor(targetToken.actor);
    const inputs = {
        attacker: { ...atk, action: 'Standard Attack' },
        defender: {
            characteristics: def.characteristics,
            armour: Number(targetToken.actor?.system?.armour?.body?.total ?? 0) || 0,   // body AP as the skeleton simplification
            toughnessBonus: Math.floor(def.characteristics.t / 10),
            weapon: def.weapon, talents: def.talents, traits: def.traits,
            evasion: { mode: 'dodge' },
        },
        options: { autoResolveTests: true },
    };
    const rng = rollScript([]);
    const out = resolveEngagement(inputs, rng, buildRegistry());
    const t = out.attack.test;
    const lines = [
        `<b>${atk.name}</b> attacks <b>${def.name}</b> with <b>${out.attack.weapon}</b>`,
        `To-hit: ${t.roll} vs ${t.modifiedTarget} — <b>${t.success ? `HIT (${t.dos} DoS)` : `MISS (${t.dof} DoF)`}</b>`,
        ...(out.attack.effects ?? []).map((e) => `⚡ ${e.name}${e.effect ? ` — ${e.effect}` : ''}`),
        ...(out.attack.hits ?? []).map((h) => `Hit ${h.hitNumber} @ ${h.location}: dmg ${h.damage?.total ?? '—'} (${h.damageType}, Pen ${h.totalPenetration})`
            + (h.soak ? ` → soak ${h.soak.reduction} → <b>${h.soak.woundsInflicted} wounds</b>` : '')),
        out.reaction ? `Reaction: ${out.reaction.prevented ? 'Parry PREVENTED' : `${out.reaction.mode} ${out.reaction.test?.success ? 'EVADED' : 'failed'}`}` : null,
        out.attack.totalWounds !== undefined ? `<b>Total wounds: ${out.attack.totalWounds}</b>` : null,
        `<span style="opacity:.6">${rng.trace.length} dice · dh2-roll-vm walking skeleton</span>`,
    ].filter(Boolean);
    await ChatMessage.create({ content: lines.join('<br>') });
    return out;
}

/**
 * Canonical character JSON (schema v1 — api/lib/character-schema.mjs) →
 * dark-heresy-2nd Actor. The Phase-2 "one schema, two consumers" proof: the
 * same document the Roll UI loads creates a Foundry Actor with embedded
 * weapon/talent/trait Items. Usage (console/macro):
 *   game.dh2vm.importCharacter(<paste JSON>)
 */
async function importCharacter(raw) {
    const doc = migrateCharacter(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const v = validateCharacter(doc);
    if (!v.ok) {
        console.error('dh2-roll-vm | character validation failed:', v.errors);
        ui.notifications.error(`Character invalid: ${v.errors.map((e) => e.path).join(', ')}`);
        return null;
    }
    const c = doc.characteristics;
    const char = (base) => ({ base: Number(base) || 0, advance: 0, modifier: 0 });
    const actor = await Actor.create({
        name: doc.name,
        type: 'acolyte',
        system: {
            characteristics: {
                weaponSkill: char(c.ws), ballisticSkill: char(c.bs),
                strength: char(c.s), toughness: char(c.t), agility: char(c.ag),
                intelligence: char(c.int), perception: char(c.per),
                willpower: char(c.wp), fellowship: char(c.fel),
            },
            wounds: { max: doc.wounds?.max ?? 10, value: doc.wounds?.current ?? doc.wounds?.max ?? 10 },
            fate: { max: doc.fate?.max ?? 0, value: doc.fate?.current ?? doc.fate?.max ?? 0 },
        },
    });
    const items = [
        ...(doc.weapons ?? []).map((w) => ({
            name: w.name, type: 'weapon',
            system: {
                class: w.class ?? 'basic', damage: w.damage,
                penetration: w.pen ?? 0, damageType: w.damageType ?? 'Impact',
                craftsmanship: w.craftsmanship ?? 'Common',
                rateOfFire: { single: 1, burst: w.rof?.burst ?? 0, full: w.rof?.full ?? 0 },
            },
        })),
        ...(doc.talents ?? []).map((t) => {
            const e = typeof t === 'object' ? t : { name: t };
            return { name: e.name, type: 'talent', system: {} };
        }),
        ...(doc.traits ?? []).map((t) => {
            const e = typeof t === 'object' ? t : { name: t };
            return { name: e.name, type: 'trait', system: e.level != null ? { level: e.level } : {} };
        }),
    ];
    if (items.length) await actor.createEmbeddedDocuments('Item', items);
    ui.notifications.info(`dh2-roll-vm: imported "${doc.name}" (${items.length} items).`);
    console.log('dh2-roll-vm | imported Actor', actor, '— schema warnings:', v.warnings);
    return actor;
}

Hooks.once('ready', () => {
    game.dh2vm = {
        resolveAttack, resolveEngagement, resolveParry, rollTest, rollDamage, applySoak,
        rollScript, buildRegistry, compile, builtinRules, availableQualities, DSL_DOCS,
        validateCharacter, migrateCharacter, characterToCombatant, importCharacter,
        mapActor, dh2Attack,
    };
    console.log(`${MODULE_ID} | DH2 Roll VM ready — ${builtinRules.length} rules loaded. Try game.dh2vm.dh2Attack() or /dh2attack.`);
    ui.notifications?.info('DH2 Roll VM loaded (walking skeleton).');
});

// /dh2attack chat command
Hooks.on('chatMessage', (log, message) => {
    if (message.trim().toLowerCase() === '/dh2attack') {
        dh2Attack();
        return false;   // swallow the command
    }
    return true;
});
