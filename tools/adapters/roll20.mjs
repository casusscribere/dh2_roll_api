/**
 * Roll20 adapter (pipeline plan Task 3.1) — Roll20 character attribute JSON →
 * canonical character JSON v4 (api/lib/character-schema.mjs).
 *
 * Input shapes:
 *   - a bare `{ name, attribs: [{ name, current, max }, …] }` object (the
 *     userscript-export path — the original contract, kept working), or
 *   - one `characters[]` entry of a `roll20.character_dump.v1` envelope
 *     (`{ id, name, avatar, archived, attribs, … }`); use `fromRoll20Dump`
 *     to map a whole envelope.
 *
 * The attribute vocabulary is the DH2e community sheet as verified from the
 * 2026-07-23 campaign dump:
 *   - characteristics: flat `WeaponSkill`…`Fellowship` hold the sheet TOTAL;
 *     `<Name>Upgrades` holds the advance count (base = total − 5×advances,
 *     clamped ≥ 0); `<Name>Unnat` is the unnatural value (schema supports
 *     ws/bs/s/t/ag only); `<Name>Mod/Adj/Cond` and `disp*` are display/derived
 *     twins and are consumed silently.
 *   - vitals: MaxWounds/CurWounds, MaxFatePoints/CurFatePoints,
 *     Insanity/CurInsanity (Cur* preferred — it is the tracked value),
 *     Corruption/CurCorruption, CurFatigue, MaxPsy (psy rating; class "bound"
 *     when > 0 — the campaign's sanctioned-psyker assumption).
 *   - flat strings homeworld/background/role → v4 `origin` `{ name }` members
 *     ("", "N/A", "-" normalise to null); `Influence` → v4 `influence`.
 *   - skills: flat `<Skill>Ranks` (advances 0–4; `<Skill>Score` is the derived
 *     target and `<Skill>Misc` a sheet-side modifier — both consumed);
 *     specialist fixed slots (NvStellar/NvSurface/NvWarp → Navigate,
 *     OpAeronautica/OpSurface/OpVoidship → Operate, TradeName+TradeRanks →
 *     Trade) and numbered lore slots (`ForbiddenLore1`+`ForbiddenLoreRanks1`,
 *     …); repeating lore sections cls/fls/sls/lns (`<Lore>Names`/`<Lore>Ranks`
 *     per row; the *disps sections are display twins).
 *   - repeating weapons/talents/equipment/powers/profs sections
 *     (`repeating_<section>_<rowid>_<field>`).
 *
 * NOT on this sheet (verified absent): xp totals/ledger and aptitudes. They
 * are deliberately left empty with an `unmapped` note — per merge decision
 * D-A the xlsx roster wins build data (xp, aptitudes, advances bought) and
 * Roll20 wins volatile pools (wounds, fate, fatigue, insanity, corruption),
 * so the merge lane (Task 4.1) fills them from the workbook side.
 *
 * Anything genuinely unknown is returned in `unmapped` (attribute names plus
 * free-text notes) so the user can see gaps; schema validation downstream
 * reports field-level consequences.
 */
import { emptyCharacter, CHARACTER_SCHEMA_VERSION, canonicalSkillName } from '../../api/lib/character-schema.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
const blank = (v) => String(v ?? '').trim() === '';
const NULLISH_STRINGS = new Set(['', 'n/a', 'na', '-', 'none']);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** canonical key → the sheet's full attribute stem (normalised). */
const CHAR_STEM = {
    ws: 'weaponskill', bs: 'ballisticskill', s: 'strength', t: 'toughness',
    ag: 'agility', int: 'intelligence', per: 'perception', wp: 'willpower', fel: 'fellowship',
};
/** canonical → candidate Roll20 attribute names (normalised, first hit wins).
 *  Full sheet names first, then the legacy userscript-export abbreviations. */
const CHAR_MAP = {
    ws: ['weaponskill', 'ws'],
    bs: ['ballisticskill', 'bs'],
    s: ['strength', 'str', 's'],
    t: ['toughness', 'tou', 't'],
    ag: ['agility', 'agi', 'ag'],
    int: ['intelligence', 'int'],
    per: ['perception', 'per'],
    wp: ['willpower', 'wp', 'will'],
    fel: ['fellowship', 'fel'],
};
const ARMOUR_MAP = {
    head: ['headarmor', 'armourhead', 'armorhead', 'aphead'],
    body: ['bodyarmor', 'armourbody', 'armorbody', 'apbody'],
    leftArm: ['leftarmarmor', 'armourleftarm', 'armorleftarm', 'apleftarm'],
    rightArm: ['rightarmarmor', 'armourrightarm', 'armorrightarm', 'aprightarm'],
    leftLeg: ['leftlegarmor', 'armourleftleg', 'armorleftleg', 'apleftleg'],
    rightLeg: ['rightlegarmor', 'armourrightleg', 'armorrightleg', 'aprightleg'],
};

/** Flat basic-skill stems (normalised) — `<stem>ranks` → advances. The
 *  canonical schema name comes from canonicalSkillName at build time. */
const FLAT_SKILL_STEMS = [
    'acrobatics', 'athletics', 'awareness', 'charm', 'command', 'commerce',
    'deceive', 'dodge', 'inquiry', 'interrogation', 'intimidate', 'logic',
    'medicae', 'parry', 'psyniscience', 'scrutiny', 'security', 'sleightofhand',
    'stealth', 'survival', 'techuse',
];
/** Fixed specialist slots: stem → [skill, speciality]. */
const SPEC_FLAT = {
    nvstellar: ['Navigate', 'Stellar'], nvsurface: ['Navigate', 'Surface'], nvwarp: ['Navigate', 'Warp'],
    opaeronautica: ['Operate', 'Aeronautica'], opsurface: ['Operate', 'Surface'], opvoidship: ['Operate', 'Voidship'],
};
/** Numbered lore slots (stem + 1…4) and their repeating-section twins. */
const LORE_STEMS = {
    commonlore: 'Common Lore', forbiddenlore: 'Forbidden Lore',
    scholasticlore: 'Scholastic Lore', linguistics: 'Linguistics',
};
const LORE_SECTIONS = { cls: 'Common Lore', fls: 'Forbidden Lore', sls: 'Scholastic Lore', lns: 'Linguistics' };

const DAMAGE_TYPE_BY_INITIAL = { i: 'Impact', e: 'Energy', x: 'Explosive', r: 'Rending' };
const WEAPON_CLASSES = ['melee', 'pistol', 'basic', 'heavy', 'thrown'];
const CRAFTSMANSHIP = { poor: 'Poor', common: 'Common', good: 'Good', best: 'Best' };

/** Known display/derived/sheet-internal attribute patterns — consumed
 *  silently (they duplicate mapped state or carry no character truth). */
const CONSUMED_PATTERNS = [
    /^disp/,                                    // disp* display twins (dispWeaponSkill, dispwpn*, disppsy*, dispequip*, DispHalfMove, …)
    /^(weaponskill|ballisticskill|strength|toughness|agility|intelligence|perception|willpower|fellowship|influence)(mod|adj|cond|unnat|upgrades)$/,
    /^(acrobatics|athletics|awareness|charm|command|commerce|deceive|dodge|inquiry|interrogation|intimidate|logic|medicae|parry|psyniscience|scrutiny|security|sleightofhand|stealth|survival|techuse|trade|nvstellar|nvsurface|nvwarp|opaeronautica|opsurface|opvoidship)(score|ranks|misc|name)$/,
    /^(commonlore|forbiddenlore|scholasticlore|linguistics)(score|ranks|misc)?[1-4]$/,
    /^fat(a|bs|f|i|in|p|s|t|wp|ws)$/,           // per-characteristic fatigue flags
    /^(fatigued|charfatigued|dblfatigued|fatiguedchars)$/,
    /^(maxinsanity|maxcorruption|maxcapacity|curcapacity|encumbered)$/,
    /^(initval|initmod|charname|psy)$/,         // derived initiative; name twin; Psy (current-use twin of MaxPsy)
    /^(head|body|leftarm|rightarm|leftleg|rightleg)reduction$/,
    /^wpn(pwr)?sel/,                            // flat weapon-roller selection toggles (wpnselsw1, wpnpwrsel2, …)
    /^reporder/,                                // _reporder_repeating_* bookkeeping (norm strips the underscores)
    /^talentstring$/,                           // dot-mashed twin of the repeating talents section (used as fallback)
    /^playername$/,                             // deliberately NOT mapped — privacy decision D9
];

/** Parse one Roll20 character (bare export or dump entry) → { character, unmapped }. */
export function fromRoll20(json, { sourceName = 'roll20-dump-v4', exportedAt = null } = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const attribs = data.attribs ?? data.attributes ?? [];
    const byName = new Map();
    for (const a of attribs) byName.set(norm(a.name), a);

    const doc = emptyCharacter(data.name ?? 'Roll20 import');
    doc.source = {
        adapter: sourceName,
        roll20CharacterId: data.id ?? null,
        roll20Name: data.name ?? null,
        exportedAt,
        importedAt: null,
    };
    const used = new Set();
    const notes = [];
    const pick = (candidates) => {
        for (const c of candidates) if (byName.has(c)) { used.add(c); return byName.get(c); }
        return null;
    };
    const intOf = (a, prop = 'current') => (a ? parseInt(a[prop], 10) || 0 : 0);
    const intAt = (name) => intOf(pick([name]));
    const strAt = (name) => { const a = pick([name]); return a ? String(a.current ?? '').trim() : ''; };

    // --- characteristics: flat <Name> = sheet TOTAL; <Name>Upgrades = advances.
    // base = total − 5×advances (clamped ≥ 0). When the sheet gives no Upgrades
    // attribute (legacy userscript exports), advances are 0 and the total IS
    // the base — total-preserving either way.
    //
    // The no-Upgrades branch used to emit the v1 flat-int shorthand, on the
    // stated grounds that "migrateCharacter normalises". It does not: this
    // adapter stamps schemaVersion = CHARACTER_SCHEMA_VERSION below, and the
    // v1→v2 flat-int normalisation is gated on the document's version, so it
    // can never fire on anything this adapter produces. The result was two
    // different characteristic shapes inside documents that both claimed v4 —
    // exactly the mixed-shape hazard behind R-1 and R-7. Normalise here, at
    // the boundary, which is where the shape is decided.
    for (const [key, candidates] of Object.entries(CHAR_MAP)) {
        const a = pick(candidates);
        if (!a) continue;
        const total = intOf(a);
        const upName = `${CHAR_STEM[key]}upgrades`;
        if (byName.has(upName)) {
            used.add(upName);
            const advances = clamp(intOf(byName.get(upName)), 0, 5);
            doc.characteristics[key] = { base: Math.max(0, total - 5 * advances), advances, modifiers: [] };
        } else {
            doc.characteristics[key] = { base: total, advances: 0, modifiers: [] };
        }
    }
    // unnatural: `<Name>Unnat` (this sheet) or `unnatural_<name>` (legacy).
    // Schema supports ws/bs/s/t/ag; the sheet's other *Unnat twins are consumed.
    for (const key of ['ws', 'bs', 's', 't', 'ag']) {
        const a = pick([`${CHAR_STEM[key]}unnat`, ...CHAR_MAP[key].map((c) => `unnatural${c}`)]);
        if (a && intOf(a) > 0) doc.unnatural[key] = intOf(a);
    }
    // influence is a tenth pseudo-characteristic on this sheet → v4 flat int
    const infl = pick(['influence']);
    if (infl) doc.influence = Math.max(0, intOf(infl));

    // --- armour by location -------------------------------------------------
    for (const [loc, candidates] of Object.entries(ARMOUR_MAP)) {
        const a = pick(candidates);
        if (a) doc.armour[loc] = Math.max(0, intOf(a));
    }

    // --- vitals ---------------------------------------------------------------
    const maxWounds = pick(['maxwounds']);
    const curWounds = pick(['curwounds']);
    if (maxWounds || curWounds) {
        doc.wounds.max = intOf(maxWounds) || intOf(curWounds, 'max');
        doc.wounds.current = intOf(curWounds);
    } else {
        const wounds = pick(['wounds', 'woundsmax', 'wound']);   // legacy export
        if (wounds) { doc.wounds.max = intOf(wounds, 'max') || intOf(wounds); doc.wounds.current = intOf(wounds); }
    }
    const maxFate = pick(['maxfatepoints']);
    const curFate = pick(['curfatepoints']);
    if (maxFate || curFate) {
        doc.fate.max = intOf(maxFate);
        doc.fate.current = intOf(curFate);
    } else {
        const fate = pick(['fate', 'fatepoints', 'fatemax']);    // legacy export
        if (fate) { doc.fate.max = intOf(fate, 'max') || intOf(fate); doc.fate.current = intOf(fate); }
    }
    const insanity = pick(['curinsanity', 'insanity']);          // Cur* is the tracked value
    if (insanity) doc.insanity.points = clamp(intOf(insanity), 0, 100);
    const corruption = pick(['curcorruption', 'corruption']);
    if (corruption) doc.corruption.points = clamp(intOf(corruption), 0, 100);
    const fatigue = pick(['curfatigue']);
    if (fatigue) doc.fatigue.current = Math.max(0, intOf(fatigue));
    const psyRating = intAt('maxpsy');
    if (psyRating > 0) doc.psy = { ...doc.psy, rating: psyRating, class: 'bound' };

    // --- origin (v4): flat strings → { name } (refs resolved later) ----------
    const originMember = (name) => {
        const v = strAt(name);
        return NULLISH_STRINGS.has(v.toLowerCase()) ? null : { name: v };
    };
    doc.origin.homeworld = originMember('homeworld');
    doc.origin.background = originMember('background');
    doc.origin.role = originMember('role');

    // --- skills ---------------------------------------------------------------
    // Ranks map 1:1 onto schema advances (rank 1 = trained +0 … rank 4 = +30;
    // verified against live-sheet Score = characteristic + 10×(rank−1) + Misc).
    const skillEntry = (canonical) => {
        doc.skills[canonical] ??= { modifiers: [] };
        return doc.skills[canonical];
    };
    const addBasicSkill = (canonical, advances) => {
        if (advances > 0) skillEntry(canonical).advances = clamp(advances, 0, 4);
    };
    const addSpeciality = (canonical, spec, advances) => {
        const entry = skillEntry(canonical);
        entry.specialities ??= {};
        const key = Object.keys(entry.specialities).find((k) => norm(k) === norm(spec)) ?? spec;
        const prev = entry.specialities[key]?.advances ?? 0;
        entry.specialities[key] = { advances: clamp(Math.max(prev, advances), 0, 4), modifiers: [] };
    };
    for (const stem of FLAT_SKILL_STEMS) {
        const canonical = canonicalSkillName(stem);
        if (!canonical) { notes.push(`skill stem "${stem}" did not resolve to a DH2 skill`); continue; }
        addBasicSkill(canonical, intAt(`${stem}ranks`));
        pick([`${stem}score`, `${stem}misc`]);   // derived target + sheet-side modifier: consumed
    }
    for (const [stem, [skill, spec]] of Object.entries(SPEC_FLAT)) {
        const ranks = intAt(`${stem}ranks`);
        if (ranks > 0) addSpeciality(skill, spec, ranks);
        pick([`${stem}score`, `${stem}misc`]);
    }
    { // Trade: one named slot (TradeName + TradeRanks)
        const name = strAt('tradename');
        const ranks = intAt('traderanks');
        if (!NULLISH_STRINGS.has(name.toLowerCase()) && ranks > 0) addSpeciality('Trade', name, ranks);
        pick(['tradescore', 'trademisc']);
    }
    // numbered lore slots: <Lore>{i} (name) + <Lore>Ranks{i}
    for (const [stem, skill] of Object.entries(LORE_STEMS)) {
        for (let i = 1; i <= 4; i++) {
            const name = strAt(`${stem}${i}`);
            const ranks = intAt(`${stem}ranks${i}`);
            pick([`${stem}score${i}`, `${stem}misc${i}`]);
            if (NULLISH_STRINGS.has(name.toLowerCase())) continue;
            if (ranks > 0) addSpeciality(skill, name, ranks);
            else { addSpeciality(skill, name, 1); notes.push(`${skill} (${name}): slot has no rank — assumed known (advances 1)`); }
        }
    }

    // --- repeating sections: repeating_<section>_<rowid>_<field> --------------
    const repeating = new Map();   // section → rowid → { normfield: value }
    for (const a of attribs) {
        const m = /^repeating_([a-z0-9]+)_([-A-Za-z0-9]+)_(.+)$/.exec(a.name ?? '');
        if (!m) continue;
        used.add(norm(a.name));
        const [, section, rowId, field] = m;
        if (!repeating.has(section)) repeating.set(section, new Map());
        const row = repeating.get(section);
        if (!row.has(rowId)) row.set(rowId, {});
        row.get(rowId)[norm(field)] = a.current;
    }
    const rows = (section) => [...(repeating.get(section) ?? new Map()).values()];

    // weapons — this sheet's wpn* vocabulary first, legacy userscript fields as fallback
    for (const section of ['weapons', 'weapon', 'attacks']) {
        for (const row of rows(section)) {
            const name = row.wpnnames ?? row.name ?? row.weaponname ?? row.weapon;
            if (blank(name)) continue;
            const sheetVocab = row.wpnnames !== undefined;
            // damage: legacy exports carry a formula string; this sheet carries
            // components (numdice d dice + static) → compose "XdY+Z".
            let damage;
            if (typeof row.damage === 'string' && !blank(row.damage)) damage = String(row.damage).trim();
            else {
                const nd = parseInt(row.wpndmgnumdices, 10);
                const dd = parseInt(row.wpndmgdices, 10);
                const st = parseInt(row.wpndmgstatics, 10) || 0;
                if (!Number.isInteger(nd) || !Number.isInteger(dd)) notes.push(`weapon "${name}": damage dice not on sheet — defaulted to 1d10${st >= 0 ? `+${st}` : st}`);
                const x = Number.isInteger(nd) ? nd : 1, y = Number.isInteger(dd) ? dd : 10;
                damage = `${x}d${y}${st >= 0 ? `+${st}` : st}`;
            }
            const rof = {
                single: !['-', '0'].includes(String(row.wpnsingleshots ?? '').trim()),
                burst: parseInt(row.wpnsemishots ?? row.rofburst ?? row.semi, 10) || 0,
                full: parseInt(row.wpnautoshots ?? row.roffull ?? row.full, 10) || 0,
            };
            // class: the sheet's category when it matches; otherwise infer melee
            // ONLY for sheet-vocabulary rows with no range and no ranged RoF
            // evidence (legacy rows keep the old /melee/-marker behaviour).
            let cls;
            const cat = String(row.wpncats ?? '').trim().toLowerCase();
            if (WEAPON_CLASSES.includes(cat)) cls = cat;
            else if (/melee/i.test(String(row.class ?? row.type ?? ''))) cls = 'melee';
            else if (sheetVocab) {
                const hasRange = (parseInt(row.wpnranges, 10) || 0) > 0;
                const hasRof = rof.burst > 0 || rof.full > 0;
                if (!hasRange && !hasRof) cls = 'melee';
                else notes.push(`weapon "${name}": class not inferred (category "${cat || '—'}" unrecognised)`);
            }
            const dt = norm(String(row.wpndmgtypes ?? row.damagetype ?? (sheetVocab ? '' : row.type) ?? 'i')).charAt(0);
            const weapon = {
                name: String(name),
                class: cls,
                damage,
                pen: parseInt(row.wpnpens ?? row.pen ?? row.penetration, 10) || 0,
                damageType: DAMAGE_TYPE_BY_INITIAL[dt] ?? 'Impact',
                rof,
                qualities: String(row.wpnspecials ?? row.qualities ?? row.special ?? '').split(',').map((x) => x.trim()).filter(Boolean),
            };
            const craft = CRAFTSMANSHIP[String(row.wpnqualitys ?? '').trim().toLowerCase()];
            if (craft) weapon.craftsmanship = craft;
            const clipMax = parseInt(row.wpnclipmaxs, 10), clipCur = parseInt(row.wpnclipcurs, 10);
            if (Number.isInteger(clipMax) || Number.isInteger(clipCur)) {
                weapon.clip = { max: Math.max(0, clipMax || 0), value: Math.max(0, clipCur || 0) };
            }
            const weight = parseFloat(row.wpnweights);
            if (Number.isFinite(weight) && weight >= 0) weapon.weight = weight;
            if (weapon.class === undefined) delete weapon.class;
            doc.weapons.push(weapon);
        }
    }
    // talents / traits
    for (const row of rows('talents')) {
        const name = row.talentnames ?? row.name;
        if (!blank(name)) doc.talents.push(String(name).trim());
    }
    if (!doc.talents.length) {
        // fallback: the flat dot-mashed talentstring twin (older rows lost)
        const ts = strAt('talentstring');
        if (ts) {
            doc.talents = ts.split('.').map((t) => t.trim()).filter(Boolean);
            notes.push('talents parsed from flat talentstring (no repeating talents rows)');
        }
    } else used.add('talentstring');
    for (const row of rows('traits')) {
        if (!blank(row.name)) doc.traits.push(String(row.name).trim());
    }
    // equipment → gear (equipselects "1"/"0" is the row's equipped toggle —
    // assumption from the live sheet, where worn items carry "1")
    for (const row of rows('equipment')) {
        const name = row.equipnames;
        if (blank(name)) continue;
        const item = { name: String(name).trim() };
        const weight = parseFloat(row.equipweights);
        if (Number.isFinite(weight) && weight >= 0) item.weight = weight;
        const sel = String(row.equipselects ?? '').trim();
        if (sel === '0') item.equipped = false;
        else if (sel === '1') item.equipped = true;
        if (!blank(row.equipdescs)) item.description = String(row.equipdescs).trim();
        doc.gear.push(item);
    }
    // psychic powers (name only — ranges/effects/actions are rulebook copies)
    for (const row of rows('powers')) {
        if (!blank(row.psynames)) doc.psychicPowers.push({ name: String(row.psynames).trim() });
    }
    // weapon-training proficiencies → v4 weaponTrainings[]
    for (const row of rows('profs')) {
        for (const t of String(row.wpnprofs ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
            if (!doc.weaponTrainings.some((w) => norm(w) === norm(t))) doc.weaponTrainings.push(t);
        }
    }
    // repeating lore sections (cls/fls/sls/lns): <Lore>Names + <Lore>Ranks per
    // row (deduped against the numbered flat slots — max advances wins)
    for (const [section, skill] of Object.entries(LORE_SECTIONS)) {
        const stem = norm(skill);   // "commonlore" etc — matches the row field names
        for (const row of rows(section)) {
            const name = String(row[`${stem}names`] ?? '').trim();
            if (NULLISH_STRINGS.has(name.toLowerCase())) continue;
            const ranks = parseInt(row[`${stem}ranks`], 10) || 0;
            addSpeciality(skill, name, ranks > 0 ? ranks : 1);
        }
    }

    // --- unmapped: attributes we neither mapped nor recognise -----------------
    const unmapped = [];
    for (const a of attribs) {
        const n = norm(a.name);
        if (used.has(n) || /^repeating_/.test(a.name ?? '')) continue;
        if (CONSUMED_PATTERNS.some((re) => re.test(n))) continue;
        // A nameless attribute still carries an unimported value, so it IS a gap
        // and must be reported — but `unmapped` is rendered in the importer UI,
        // where a literal `undefined` (or '') shows as nothing. Report it under
        // the same placeholder convention the xlsx importer uses for unnamed
        // weapons rather than skipping it, so the gap stays visible (D-8).
        unmapped.push(String(a.name ?? '').trim() ? a.name : '(unnamed attribute)');
    }
    // The sheet has no xp or aptitude attributes at all (verified) — never
    // invent them; the merge lane (decision D-A) fills both from the xlsx side.
    notes.push('xp/aptitudes absent from Roll20 sheet (merge lane fills from xlsx)');
    unmapped.push(...notes);

    doc.schemaVersion = CHARACTER_SCHEMA_VERSION;
    return { character: doc, unmapped };
}

/** Map a whole `roll20.character_dump.v1` envelope → one result per character. */
export function fromRoll20Dump(json, opts = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(data?.characters)) throw new Error('Not a roll20.character_dump.v1 envelope (no characters[])');
    const exportedAt = opts.exportedAt ?? data.generated_at ?? null;
    return data.characters.map((c) => fromRoll20(c, { ...opts, exportedAt }));
}
