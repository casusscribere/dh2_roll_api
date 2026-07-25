/**
 * CHARACTER_FIELDS → JSON Schema (draft-07) generator.
 *
 * Derives docs/character.schema.v4.json from the single truth table in
 * api/lib/character-schema.mjs so non-JS consumers (corpus Python, future RT
 * tools, the rogue-trader-2e Foundry pipeline) can validate character
 * documents without importing this package. The schema is PERMISSIVE by
 * design — unknown keys are warnings in validateCharacter, so
 * additionalProperties stays true throughout; exact business rules (skill
 * name canonicalisation, ref-pattern warnings, privacy guard) live only in
 * the JS validator.
 *
 * Path grammar interpreted from the FIELDS table:
 *   a.b          nested property      a.<x|y>     expands to one path per key
 *   a[]          array items          a.<Name>    wildcard → additionalProperties
 *   <a|b>[].f    fans out over the named lists
 *
 * Run:  npm run schema:json     (also invoked by scripts/build-static.mjs,
 * which wipes docs/ — the artifact is regenerated into the Pages build).
 * A drift-guard test (schema-v4.test.mjs) fails if the committed file lags.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CHARACTER_FIELDS, CHARACTER_SCHEMA_VERSION } from '../api/lib/character-schema.mjs';

/** Human type label → JSON Schema leaf (permissive fallback: {}). */
export function leafSchema(label) {
    const l = String(label).trim();
    const bounded = (s, schema) => {
        const ge = s.match(/≥\s*(-?\d+)/);
        if (ge) { schema.minimum = Number(ge[1]); return schema; }
        const range = s.match(/(−?-?\d+)\s*–\s*(−?-?\d+)/);        // en-dash ranges; U+2212 minus
        if (range) {
            const n = (x) => Number(String(x).replace('−', '-'));
            schema.minimum = n(range[1]); schema.maximum = n(range[2]);
        }
        return schema;
    };
    if (l === '(reserved)') return {};
    const arrayOf = l.match(/^\((.+)\)\[\]$/);                     // "(string | {…})[]" → array of X
    if (arrayOf) return { type: 'array', items: leafSchema(arrayOf[1]) };
    if (/^"([^"]+)"$/.test(l)) return { const: l.match(/^"([^"]+)"$/)[1] };
    if (/^int\b/.test(l)) return bounded(l, { type: 'integer' });
    if (/^number\b/.test(l)) return bounded(l, { type: 'number' });
    if (/^bool\b/.test(l)) return { type: 'boolean' };
    if (/^string\[\]$/.test(l)) return { type: 'array', items: { type: 'string' } };
    if (/^\(?string \| \{/.test(l)) return { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] };
    if (/^string\b/.test(l)) return { type: 'string' };
    if (/^\{/.test(l)) return { type: 'object', additionalProperties: true };
    if (/\|/.test(l) && !/[{}[\]<>]/.test(l)) {                    // "a | b | c" word enums
        const vals = l.split('|').map((x) => x.trim()).filter(Boolean);
        if (vals.every((v) => /^[\w"'. -]+$/.test(v))) return { enum: vals.map((v) => v.replace(/^"|"$/g, '')) };
    }
    return {};
}

/** Expand `<a|b|c>` segments into one concrete path per key (cross product). */
function expandPaths(path) {
    let paths = [''];
    for (const seg of path.split('.')) {
        const isArray = seg.endsWith('[]');
        const core = isArray ? seg.slice(0, -2) : seg;
        const alt = core.match(/^<(.+)>$/);
        const keys = (alt && alt[1].includes('|')) ? alt[1].split('|') : [core];   // <single> stays a wildcard marker
        const wildcard = alt && !alt[1].includes('|');
        paths = paths.flatMap((p) => keys.map((k) =>
            p + (p ? '.' : '') + (wildcard ? '*' : k) + (isArray ? '[]' : '')));
    }
    return paths;
}

/** The object schema to descend into (unwraps `anyOf [string, object]`). */
function objectBranch(node) {
    if (node.anyOf) {
        let obj = node.anyOf.find((b) => b.type === 'object');
        if (!obj) { obj = { type: 'object', additionalProperties: true }; node.anyOf.push(obj); }
        return obj;
    }
    delete node.enum; delete node.const;                            // a parent can't stay a scalar
    node.type = 'object';
    if (typeof node.additionalProperties !== 'object') node.additionalProperties ??= true;
    return node;
}

/** Insert one concrete path (segments: name, name[], or `*` wildcard). */
function insertPath(root, path, leaf, required, requiredTop) {
    const segs = path.split('.');
    let holder = root;                                              // object schema whose properties we attach to
    for (let i = 0; i < segs.length; i++) {
        let seg = segs[i];
        const isArray = seg.endsWith('[]');
        if (isArray) seg = seg.slice(0, -2);
        const last = i === segs.length - 1;
        const target = last ? structuredClone(leaf) : { type: 'object', additionalProperties: true };
        const wrapped = isArray ? { type: 'array', items: target } : target;

        let node;
        if (seg === '*') {                                          // wildcard → additionalProperties of holder
            if (typeof holder.additionalProperties !== 'object') holder.additionalProperties = wrapped;
            node = holder.additionalProperties;
        } else {
            holder.properties ??= {};
            if (!holder.properties[seg]) holder.properties[seg] = wrapped;
            node = holder.properties[seg];
            if (isArray) { node.type = 'array'; node.items ??= target; }
            if (required) {
                if (holder === root && i === 0 && !isArray) requiredTop.add(seg);   // nested-required never marks a list required
                if (holder !== root && i === segs.length - 1) { holder.required ??= []; if (!holder.required.includes(seg)) holder.required.push(seg); }
            }
        }
        if (last) {
            // enrich an existing node without clobbering deeper structure
            const dest = isArray ? (node.items ??= {}) : node;
            for (const [k, v] of Object.entries(leaf)) if (dest[k] === undefined) dest[k] = structuredClone(v);
            return;
        }
        holder = objectBranch(isArray ? (node.items = (typeof node.items === 'object' ? node.items : { type: 'object' })) : node);
    }
}

/** Build the full draft-07 schema object from CHARACTER_FIELDS. */
export function buildJsonSchema() {
    const root = { properties: {} };
    const requiredTop = new Set();
    // parents before children (stable): a list's own row must land before rows
    // that reach into its items, so `string | object` alternatives survive
    const rows = [...CHARACTER_FIELDS].sort((a, b) => a.path.split('.').length - b.path.split('.').length);
    for (const f of rows) {
        const leaf = { ...leafSchema(f.type), description: f.summary };
        for (const p of expandPaths(f.path)) insertPath(root, p, leaf, f.required, requiredTop);
    }
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'DH2 character document',
        description: `dh2_roll_api character schema v${CHARACTER_SCHEMA_VERSION} — generated from CHARACTER_FIELDS (api/lib/character-schema.mjs). Permissive: unknown keys are validator warnings, not schema errors.`,
        'x-schema-version': CHARACTER_SCHEMA_VERSION,
        type: 'object',
        properties: root.properties,
        required: [...requiredTop],
        additionalProperties: true,
    };
}

// CLI: write docs/character.schema.v<N>.json
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const out = join(root, 'docs', `character.schema.v${CHARACTER_SCHEMA_VERSION}.json`);
    writeFileSync(out, JSON.stringify(buildJsonSchema(), null, 2) + '\n');
    console.log(`✓ ${out}`);
}
