/**
 * RollContext — the shared, mutable state that flows through the checkpoint
 * pipeline. The engine populates the mechanism fields; rule effects (lib/rules/)
 * read facts off it and mutate the accumulator fields.
 *
 * `log` records which effects fired (for an explainable roll); it is internal
 * to a resolution and is not part of any API response shape yet.
 */
export class RollContext {
    constructor(init = {}) {
        this.log = [];
        Object.assign(this, init);
    }
}
