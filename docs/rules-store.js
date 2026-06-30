/*
 * Shared client-side rule store (window.RulesStore).
 *
 * User-authored DSL rules are kept in localStorage so they are shared across
 * pages of this origin (the rules manager edits them; the roll page applies
 * them). Validation is delegated to the server (/api/rules/validate) so the
 * single source of truth for the grammar stays server-side. Rolls apply the
 * enabled+valid rules by sending their concatenated DSL as `customRules`.
 *
 * Entry shape: { id, dsl, enabled, valid, effects[], error, line, col }
 */
(function () {
  const KEY = 'dh2.userRules';
  const DKEY = 'dh2.disabledBuiltins'; // ids of built-in rules toggled OFF

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  };
  const save = (rules) => localStorage.setItem(KEY, JSON.stringify(rules));

  // --- built-in rule toggles (active by default; we persist the OFF set) -----
  const loadDisabled = () => {
    try { return JSON.parse(localStorage.getItem(DKEY)) || []; }
    catch { return []; }
  };
  const saveDisabled = (ids) => localStorage.setItem(DKEY, JSON.stringify(ids));
  const disabledBuiltins = () => loadDisabled();
  const isBuiltinActive = (id) => !loadDisabled().includes(id);
  function setBuiltinActive(id, active) {
    const set = new Set(loadDisabled());
    if (active) set.delete(id); else set.add(id);
    saveDisabled([...set]);
  }
  const genId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function validate(dsl) {
    return fetch('/api/rules/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: dsl }),
    }).then((r) => r.json());
  }

  /** Build an entry from a validation response. */
  const toEntry = (id, dsl, enabled, v) => ({
    id, dsl, enabled: enabled && !!v.ok, valid: !!v.ok,
    effects: v.ok ? v.effects : [],
    error: v.ok ? null : (v.message || v.error || 'invalid'),
    line: v.line ?? null, col: v.col ?? null,
  });

  async function add(dsl) {
    const v = await validate(dsl);
    const rules = load();
    const entry = toEntry(genId(), dsl, true, v);
    rules.push(entry); save(rules);
    return entry;
  }

  async function update(id, dsl, enabled) {
    const rules = load();
    const i = rules.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const v = await validate(dsl);
    rules[i] = toEntry(id, dsl, enabled ?? rules[i].enabled, v);
    save(rules);
    return rules[i];
  }

  async function revalidate(id) {
    const rules = load();
    const entry = rules.find((r) => r.id === id);
    if (!entry) return null;
    return update(id, entry.dsl, entry.enabled);
  }

  function setEnabled(id, enabled) {
    const rules = load();
    const entry = rules.find((r) => r.id === id);
    if (!entry) return;
    entry.enabled = enabled && entry.valid;
    save(rules);
  }

  function remove(id) { save(load().filter((r) => r.id !== id)); }

  /** Concatenated DSL of every enabled + valid rule (for `customRules`). */
  const activeDsl = () => load().filter((r) => r.enabled && r.valid).map((r) => r.dsl).join('\n\n');
  const activeCount = () => load().filter((r) => r.enabled && r.valid).length;

  window.RulesStore = {
    load, save, validate, add, update, revalidate, setEnabled, remove, activeDsl, activeCount,
    disabledBuiltins, isBuiltinActive, setBuiltinActive,
  };
})();
