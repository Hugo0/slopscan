// Tests for baseline snapshot store + delta computation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveBaseline, loadBaseline, listBaselines, computeDelta } from '../lib/core/baseline.mjs';

let outputRoot;
beforeEach(() => {
    outputRoot = mkdtempSync(join(tmpdir(), 'baseline-test-'));
});
afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
});

describe('baseline store', () => {
    it('saves and loads a baseline round-trip', () => {
        const doc = { version: 1, generatedAt: '2026-04-01T00:00:00Z', findings: [{ kind: 'complexity', file: 'a.ts', message: 'cc=10', severity: 'high', line: null }] };
        const scorecard = { generatedAt: '2026-04-01T00:00:00Z', files: [{ file: 'a.ts', painscore: 12.3 }] };
        saveBaseline({ outputRoot, ref: 'abc1234', runLabel: 'my-app', doc, scorecard });
        const loaded = loadBaseline({ outputRoot, ref: 'abc1234', runLabel: 'my-app' });
        expect(loaded).toBeTruthy();
        expect(loaded.doc.findings.length).toBe(1);
        expect(loaded.scorecard.files[0].painscore).toBe(12.3);
    });

    it('returns null for missing baseline', () => {
        expect(loadBaseline({ outputRoot, ref: 'nonexistent', runLabel: 'my-app' })).toBeNull();
    });

    it('lists baselines newest-first', async () => {
        const doc = { version: 1, generatedAt: '2026-04-01T00:00:00Z', findings: [] };
        const sc = { files: [] };
        saveBaseline({ outputRoot, ref: 'old', runLabel: 'my-app', doc, scorecard: sc });
        await new Promise((r) => setTimeout(r, 5));
        saveBaseline({ outputRoot, ref: 'new', runLabel: 'my-app', doc, scorecard: sc });
        const list = listBaselines(outputRoot);
        expect(list.map((b) => b.ref)).toEqual(['new', 'old']);
    });
});

describe('computeDelta', () => {
    const baseline = {
        doc: {
            version: 1,
            generatedAt: '2026-04-01T00:00:00Z',
            findings: [
                { kind: 'complexity', file: 'a.ts', line: 10, severity: 'high', message: 'cc=12' },
                { kind: 'complexity', file: 'b.ts', line: null, severity: 'medium', message: 'cc=8' },
            ],
        },
        scorecard: {
            files: [
                { file: 'a.ts', painscore: 20 },
                { file: 'b.ts', painscore: 15 },
            ],
        },
    };

    const current = {
        doc: {
            version: 1,
            generatedAt: '2026-04-15T00:00:00Z',
            findings: [
                { kind: 'complexity', file: 'a.ts', line: 10, severity: 'high', message: 'cc=12' }, // unchanged
                { kind: 'complexity', file: 'c.ts', line: 5, severity: 'critical', message: 'cc=20' }, // added
            ],
        },
        scorecard: {
            files: [
                { file: 'a.ts', painscore: 18 }, // improved -2
                { file: 'b.ts', painscore: 15 }, // same
                { file: 'c.ts', painscore: 25 }, // new
            ],
        },
    };

    it('counts findings added + resolved', () => {
        const d = computeDelta({ current, baseline });
        expect(d.summary.addedCount).toBe(1);
        expect(d.summary.resolvedCount).toBe(1);
        expect(d.findings.added[0].file).toBe('c.ts');
        expect(d.findings.resolved[0].file).toBe('b.ts');
    });

    it('computes per-file painscore delta', () => {
        const d = computeDelta({ current, baseline });
        const aDelta = d.painscoreDelta.perFile.find((p) => p.file === 'a.ts');
        expect(aDelta.delta).toBe(-2);
        expect(aDelta.before).toBe(20);
        expect(aDelta.after).toBe(18);
        const cDelta = d.painscoreDelta.perFile.find((p) => p.file === 'c.ts');
        expect(cDelta.delta).toBe(25);
        expect(cDelta.before).toBe(0);
    });

    it('totals before/after correctly', () => {
        const d = computeDelta({ current, baseline });
        expect(d.painscoreDelta.totalBefore).toBe(35);
        expect(d.painscoreDelta.totalAfter).toBe(58);
        expect(d.painscoreDelta.totalDelta).toBe(23);
    });

    it('returns null when baseline is null', () => {
        expect(computeDelta({ current, baseline: null })).toBeNull();
    });

    it('counts improved/worsened files', () => {
        const d = computeDelta({ current, baseline });
        expect(d.summary.painscoreImproved).toBe(1); // a.ts -2
        expect(d.summary.painscoreWorsened).toBe(1); // c.ts +25
    });
});
