import { describe, it, expect } from 'vitest';
import {
    makeFinding, dedupe, sortFindings, groupByFile, buildFindingsDoc,
    SEVERITY, FINDINGS_VERSION,
} from '../lib/core/findings.mjs';

describe('makeFinding', () => {
    it('builds a valid finding with defaults', () => {
        const f = makeFinding({ kind: 'complexity', file: 'a.ts', message: 'CC=50' });
        expect(f.severity).toBe('medium');
        expect(f.line).toBeNull();
        expect(f.score).toBeNull();
        expect(f.kind).toBe('complexity');
    });
    it('rejects unknown severity', () => {
        expect(() => makeFinding({ kind: 'x', file: 'a', message: 'm', severity: 'oops' })).toThrow();
    });
    it('requires kind/file/message', () => {
        expect(() => makeFinding({ file: 'a', message: 'm' })).toThrow();
        expect(() => makeFinding({ kind: 'x', message: 'm' })).toThrow();
        expect(() => makeFinding({ kind: 'x', file: 'a' })).toThrow();
    });
});

describe('dedupe', () => {
    it('deduplicates by (kind, file, line, message)', () => {
        const a = makeFinding({ kind: 'k', file: 'a.ts', line: 5, message: 'x' });
        const b = makeFinding({ kind: 'k', file: 'a.ts', line: 5, message: 'x' });
        const c = makeFinding({ kind: 'k', file: 'a.ts', line: 6, message: 'x' });
        expect(dedupe([a, b, c]).length).toBe(2);
    });
});

describe('sortFindings', () => {
    it('sorts by severity desc, then score desc, then file', () => {
        const out = sortFindings([
            makeFinding({ kind: 'k', file: 'a', message: 'x', severity: 'low', score: 100 }),
            makeFinding({ kind: 'k', file: 'b', message: 'x', severity: 'critical', score: 1 }),
            makeFinding({ kind: 'k', file: 'c', message: 'x', severity: 'high', score: 50 }),
        ]);
        expect(out[0].severity).toBe('critical');
        expect(out[1].severity).toBe('high');
        expect(out[2].severity).toBe('low');
    });
});

describe('groupByFile', () => {
    it('groups findings by file', () => {
        const findings = [
            makeFinding({ kind: 'k', file: 'a.ts', message: '1' }),
            makeFinding({ kind: 'k', file: 'a.ts', message: '2' }),
            makeFinding({ kind: 'k', file: 'b.ts', message: '3' }),
        ];
        const m = groupByFile(findings);
        expect(m.get('a.ts').length).toBe(2);
        expect(m.get('b.ts').length).toBe(1);
    });
});

describe('buildFindingsDoc', () => {
    it('includes version, root, generatedAt, count', () => {
        const findings = [makeFinding({ kind: 'k', file: 'a', message: 'm' })];
        const doc = buildFindingsDoc({ findings, root: '/r', label: 'l', analyzers: ['k'] });
        expect(doc.version).toBe(FINDINGS_VERSION);
        expect(doc.count).toBe(1);
        expect(doc.root).toBe('/r');
        expect(doc.analyzers).toEqual(['k']);
    });
});

describe('SEVERITY', () => {
    it('has expected ordering', () => {
        expect(SEVERITY.critical).toBeGreaterThan(SEVERITY.high);
        expect(SEVERITY.high).toBeGreaterThan(SEVERITY.medium);
        expect(SEVERITY.medium).toBeGreaterThan(SEVERITY.low);
    });
});
