import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runCognitive } from '../lib/analyzers/cognitive.mjs';

describe('cognitive analyzer', () => {
    let dir;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'cog-'));
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
            join(dir, 'src', 'plain.ts'),
            `export function plain(a, b) {
                const x = a + b;
                const y = x * 2;
                return y + 1;
            }`,
        );
        // High-DLT: many distinct callees
        writeFileSync(
            join(dir, 'src', 'high-dlt.ts'),
            `export function busy(state) {
                const a = parseInt(state.a, 10);
                const b = JSON.stringify(state);
                const c = String(a);
                const d = Math.floor(b.length);
                const e = Array.from(state.list);
                const f = Object.keys(state);
                const g = Object.values(state);
                const h = Object.entries(state);
                const i = Number(c);
                const j = isNaN(i);
                const k = parseFloat(c);
                const l = Math.abs(k);
                const m = Math.round(l);
                const n = String(m);
                const o = btoa(n);
                const p = atob(o);
                return p;
            }`,
        );
    });
    afterAll(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    it('emits high-dlt for fn with many distinct callees', async () => {
        const r = await runCognitive({ root: dir, walk: { root: dir, include: ['src'], extensions: ['.ts'] }, cfg: { dltThreshold: 10 } });
        const dlt = r.findings.find((f) => f.kind === 'high-dlt');
        expect(dlt).toBeDefined();
        expect(dlt.meta.value).toBeGreaterThanOrEqual(10);
    });

    it('produces per-file averages in raw signals', async () => {
        const r = await runCognitive({ root: dir, walk: { root: dir, include: ['src'], extensions: ['.ts'] }, cfg: { mddThreshold: 100, dltThreshold: 100 } });
        // Force only signals (no findings) by making thresholds unreachable
        expect(r.rawSignals.size).toBeGreaterThan(0);
        for (const [, sig] of r.rawSignals) {
            expect(sig).toHaveProperty('cognitive_dlt_avg');
            expect(sig).toHaveProperty('cognitive_mdd_avg');
        }
    });

    it('skips empty files', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'cog-empty-'));
        const r = await runCognitive({ root: empty, walk: { root: empty, include: [], extensions: ['.ts'] } });
        expect(r.findings).toEqual([]);
        rmSync(empty, { recursive: true, force: true });
    });
});
