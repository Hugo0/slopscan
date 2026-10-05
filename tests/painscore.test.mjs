import { describe, it, expect } from 'vitest';
import { computePainscore, rankByPainscore, DEFAULT_WEIGHTS } from '../lib/core/painscore.mjs';

describe('computePainscore', () => {
    it('produces a score per file', () => {
        const sigs = new Map([
            ['a.ts', { cyclomatic: 50, maintainability: 40, sloc: 200, churn: 10 }],
            ['b.ts', { cyclomatic: 5, maintainability: 90, sloc: 30, churn: 1 }],
        ]);
        const out = computePainscore(sigs);
        expect(out.size).toBe(2);
        const a = out.get('a.ts');
        const b = out.get('b.ts');
        expect(a.painscore).toBeGreaterThan(b.painscore);
    });
    it('inverse_mi inverts maintainability', () => {
        const sigs = new Map([
            ['a.ts', { maintainability: 100 }],
            ['b.ts', { maintainability: 0 }],
        ]);
        const out = computePainscore(sigs);
        expect(out.get('a.ts').breakdown.inverse_mi.raw).toBe(0);
        expect(out.get('b.ts').breakdown.inverse_mi.raw).toBe(100);
    });
    it('weight overrides scale signals', () => {
        const sigs = new Map([['a.ts', { cyclomatic: 100 }]]);
        const lowW = computePainscore(sigs, { weights: { cyclomatic: 0.0 } });
        const highW = computePainscore(sigs, { weights: { cyclomatic: 1.0 } });
        expect(highW.get('a.ts').painscore).toBeGreaterThan(lowW.get('a.ts').painscore);
    });
});

describe('rankByPainscore', () => {
    it('returns array sorted desc', () => {
        const sigs = new Map([
            ['a.ts', { cyclomatic: 10 }],
            ['b.ts', { cyclomatic: 50 }],
            ['c.ts', { cyclomatic: 30 }],
        ]);
        const ranked = rankByPainscore(computePainscore(sigs));
        expect(ranked[0].file).toBe('b.ts');
        expect(ranked[2].file).toBe('a.ts');
    });
    it('top-N truncates', () => {
        const sigs = new Map(Array.from({ length: 10 }, (_, i) => [`f${i}.ts`, { cyclomatic: i }]));
        const top = rankByPainscore(computePainscore(sigs), 3);
        expect(top.length).toBe(3);
    });
});

describe('DEFAULT_WEIGHTS', () => {
    it('weights sum to roughly 1.0', () => {
        const total = Object.values(DEFAULT_WEIGHTS).reduce((s, w) => s + w, 0);
        expect(total).toBeGreaterThan(0.95);
        expect(total).toBeLessThan(1.10);
    });
});
