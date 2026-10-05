import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runLint } from '../lib/analyzers/lint.mjs';

// Synthetic eslint --format json output
const fakeReport = JSON.stringify([
    {
        filePath: '/repo/src/foo.ts',
        messages: [
            { ruleId: 'no-unused-vars', message: 'x is defined but never used', line: 5, severity: 1 },
            { ruleId: 'no-undef', message: 'foo is not defined', line: 10, severity: 2 },
        ],
    },
    {
        filePath: '/repo/src/bar.ts',
        messages: [],
    },
]);

describe('lint analyzer', () => {
    let dir, jsonPath;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'lint-'));
        jsonPath = join(dir, 'eslint.json');
        writeFileSync(jsonPath, fakeReport);
    });
    afterAll(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    it('parses pre-computed eslint json', async () => {
        const r = await runLint({ root: '/repo', cfg: { eslintJsonPath: jsonPath } });
        expect(r.findings.length).toBe(2);
        const errs = r.findings.filter((f) => f.kind === 'lint-error');
        const warns = r.findings.filter((f) => f.kind === 'lint-warning');
        expect(errs.length).toBe(1);
        expect(warns.length).toBe(1);
    });

    it('counts per file in raw signals', async () => {
        const r = await runLint({ root: '/repo', cfg: { eslintJsonPath: jsonPath } });
        const sig = r.rawSignals.get('src/foo.ts');
        expect(sig.lint_errors).toBe(1);
        expect(sig.lint_warnings).toBe(1);
        expect(r.rawSignals.has('src/bar.ts')).toBe(false); // empty messages skipped
    });

    it('skips when neither path nor run-eslint set', async () => {
        const r = await runLint({ root: '/repo', cfg: {} });
        expect(r.findings).toEqual([]);
        expect(r.stats.skipped).toBeDefined();
    });

    it('handles missing report file', async () => {
        const r = await runLint({ root: '/repo', cfg: { eslintJsonPath: '/nope/missing.json' } });
        expect(r.stats.error).toContain('missing');
    });
});
