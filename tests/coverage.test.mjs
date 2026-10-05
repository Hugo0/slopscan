import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runCoverage } from '../lib/analyzers/coverage.mjs';

const sampleLcov = `SF:/repo/src/foo.ts
LF:100
LH:90
end_of_record
SF:/repo/src/bar.ts
LF:50
LH:10
end_of_record
SF:/repo/src/baz.ts
LF:20
LH:20
end_of_record
`;

describe('coverage analyzer', () => {
    let dir, lcov;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'cov-'));
        lcov = join(dir, 'lcov.info');
        writeFileSync(lcov, sampleLcov);
    });
    afterAll(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    it('emits findings only for low-coverage files', async () => {
        const r = await runCoverage({ root: '/repo', cfg: { lcovPath: lcov, lowThreshold: 50 } });
        const files = r.findings.map((f) => f.file).sort();
        expect(files).toEqual(['src/bar.ts']); // 20% < 50%
    });

    it('emits raw signals for every file', async () => {
        const r = await runCoverage({ root: '/repo', cfg: { lcovPath: lcov, lowThreshold: 50 } });
        expect(r.rawSignals.size).toBe(3);
        expect(r.rawSignals.get('src/foo.ts').coverage_pct).toBeCloseTo(90, 1);
        expect(r.rawSignals.get('src/baz.ts').coverage_pct).toBe(100);
    });

    it('skips when no path provided', async () => {
        const r = await runCoverage({ root: '/repo', cfg: {} });
        expect(r.findings).toEqual([]);
        expect(r.stats.skipped).toBeDefined();
    });

    it('reports error on missing file', async () => {
        const r = await runCoverage({ root: '/repo', cfg: { lcovPath: '/nope/missing.info' } });
        expect(r.stats.error).toContain('missing');
    });
});
