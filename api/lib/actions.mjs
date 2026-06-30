/**
 * DH2 combat Actions taxonomy — reference data (mechanism), shared by the rule
 * interpreter (so `when` predicates can condition on the action) and the server
 * (so the UI can list actions). Each action has a `type` (Half | Full | Reaction
 * | Free) and a set of `subtypes` (designations rules can gate on). **`attack` is
 * the key subtype** — referenced by many rules (e.g. Defensive's -10 to attacks).
 * Reactions (Parry, Dodge) are first-class so talents/qualities can gate on them.
 */
export const ACTIONS = {
    'Standard Attack':  { type: 'Half',     subtypes: ['attack'] },
    'Semi-Auto Burst':  { type: 'Half',     subtypes: ['attack'] },
    'Full Auto Burst':  { type: 'Half',     subtypes: ['attack'] },
    'All Out Attack':   { type: 'Full',     subtypes: ['attack'] },
    'Charge':           { type: 'Full',     subtypes: ['attack'] },
    'Called Shot':      { type: 'Full',     subtypes: ['attack'] },
    'Swift Attack':     { type: 'Full',     subtypes: ['attack'] },
    'Lightning Attack': { type: 'Full',     subtypes: ['attack'] },
    'Defensive Stance': { type: 'Full',     subtypes: [] },
    'Aim':              { type: 'Half',     subtypes: [] },
    'Parry':            { type: 'Reaction', subtypes: [] },
    'Dodge':            { type: 'Reaction', subtypes: [] },
};

const norm = (name) => String(name ?? '').trim().toLowerCase();
const byName = (name) => {
    const k = norm(name);
    for (const [n, meta] of Object.entries(ACTIONS)) if (norm(n) === k) return meta;
    return null;
};

/** Merge DSL-declared `action` declarations into the registry. Called once at
 *  load (rules/index.mjs) — "compiled at startup". DSL entries override defaults. */
export function registerActions(list = []) {
    for (const a of list) if (a && a.name) ACTIONS[a.name] = { type: a.type, subtypes: a.subtypes ?? [] };
}
/** Names of every known action (defaults + DSL-declared), for the UI/API. */
export const availableActions = () => Object.keys(ACTIONS).sort();

/** The action's type ('Half' | 'Full' | 'Reaction' | 'Free'), or '' if unknown. */
export const actionType = (name) => byName(name)?.type ?? '';
/** True if the named action is a Reaction (Parry, Dodge, …). */
export const isReaction = (name) => byName(name)?.type === 'Reaction';
/** The action's subtype designations (e.g. ['attack']). */
export const actionSubtypes = (name) => byName(name)?.subtypes ?? [];
/** True if the named action carries the given subtype (case-insensitive). */
export const actionHasSubtype = (name, subtype) =>
    actionSubtypes(name).some((s) => norm(s) === norm(subtype));
/** Case-insensitive equality test for the current action. */
export const isAction = (current, name) => norm(current) === norm(name);
