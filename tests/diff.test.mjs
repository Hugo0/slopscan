import { describe, it, expect } from 'vitest';
import { diffReports } from '../lib/core/diff.mjs';
import { makeFinding } from '../lib/core/findings.mjs';

function doc(findings) {
    return { version: 1, findings };
}
function scorecard(files) {
    return { files: files.map(([file, painscore]) => ({ file, painscore })) };
}

describe('diffReports', () => {
    it('detects new findings', () => {
        const base = doc([makeFinding({ kind: 'k', file: 'a', message: 'old' })]);
        const head = doc([
            makeFinding({ kind: 'k', file: 'a', message: 'old' }),
            makeFinding({ kind: 'k', file: 'b', message: 'new' }),
        ]);
        const diff = diffReports(base, head, scorecard([]), scorecard([]));
        expect(diff.counts.new).toBe(1);
        expect(diff.counts.resolved).toBe(0);
        expect(diff.counts.net).toBe(1);
    });
    it('detects resolved findings', () => {
        const base = doc([
            makeFinding({ kind: 'k', file: 'a', message: 'will-resolve' }),
            makeFinding({ kind: 'k', file: 'b', message: 'still' }),
        ]);
        const head = doc([makeFinding({ kind: 'k', file: 'b', message: 'still' })]);
        const diff = diffReports(base, head, scorecard([]), scorecard([]));
        expect(diff.counts.resolved).toBe(1);
        expect(diff.counts.new).toBe(0);
    });
    it('produces painscore deltas', () => {
        const base = doc([]);
        const head = doc([]);
        const baseSc = scorecard([['src/a.ts', 10], ['src/b.ts', 20]]);
        const headSc = scorecard([['src/a.ts', 30], ['src/b.ts', 5]]);
        const diff = diffReports(base, head, baseSc, headSc);
        expect(diff.totals.before).toBe(30);
        expect(diff.totals.after).toBe(35);
        expect(diff.totals.delta).toBe(5);
        const a = diff.deltas.find((d) => d.file === 'src/a.ts');
        expect(a.delta).toBe(20);
    });
    it('normalizes worktree path prefixes', () => {
        const base = doc([
            makeFinding({ kind: 'k', file: '/tmp/wt/src/a.ts', message: 'm' }),
        ]);
        const head = doc([
            makeFinding({ kind: 'k', file: '/work/repo/src/a.ts', message: 'm' }),
        ]);
        const diff = diffReports(base, head, scorecard([]), scorecard([]));
        // After normalization both → src/a.ts → identical → no diff
        expect(diff.counts.new).toBe(0);
        expect(diff.counts.resolved).toBe(0);
    });
});
