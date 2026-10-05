// Tests for ranked action items.

import { describe, it, expect } from 'vitest';
import { buildActionItems, renderActionItemsMd } from '../lib/render/action-items.mjs';

const scorecard = {
    files: [
        {
            file: 'src/big.ts',
            painscore: 45,
            breakdown: {
                cyclomatic: { contribution: 15 },
                churn: { contribution: 10 },
                inverse_mi: { contribution: 8 },
                sloc: { contribution: 0.2 }, // below threshold
            },
        },
        {
            file: 'src/small.ts',
            painscore: 5,
            breakdown: {
                semantic_dup: { contribution: 3 },
            },
        },
    ],
};

const doc = {
    findings: [
        { kind: 'complexity', file: 'src/big.ts', line: 12, severity: 'critical', message: 'CC=25' },
        { kind: 'any-usage', file: 'src/big.ts', line: 88, severity: 'medium', message: 'param: any' },
        { kind: 'semantic-dup', file: 'src/small.ts', line: 3, severity: 'low', message: 'duplicates X' },
    ],
};

describe('buildActionItems', () => {
    it('ranks files by painscore', () => {
        const items = buildActionItems({ scorecard, doc });
        expect(items[0].file).toBe('src/big.ts');
        expect(items[0].rank).toBe(1);
        expect(items[1].file).toBe('src/small.ts');
        expect(items[1].rank).toBe(2);
    });

    it('extracts dominant signals (>0.5 contribution)', () => {
        const [big] = buildActionItems({ scorecard, doc });
        expect(big.dominantSignals.map((d) => d.k)).toEqual(['cyclomatic', 'churn', 'inverse_mi']);
        expect(big.reasons).toEqual([
            'high cyclomatic complexity',
            'churns frequently',
            'low maintainability index',
        ]);
    });

    it('attaches top critical+high findings per file', () => {
        const [big] = buildActionItems({ scorecard, doc });
        expect(big.topFindings).toHaveLength(1);
        expect(big.topFindings[0].kind).toBe('complexity');
        expect(big.topFindings[0].severity).toBe('critical');
    });

    it('respects topN', () => {
        const items = buildActionItems({ scorecard, doc, topN: 1 });
        expect(items).toHaveLength(1);
    });

    it('emits suggested-action lines for each dominant signal', () => {
        const [big] = buildActionItems({ scorecard, doc });
        expect(big.suggestedActions.length).toBeGreaterThan(0);
        expect(big.suggestedActions[0]).toMatch(/extract|reduce|frequent|low/i);
    });
});

describe('renderActionItemsMd', () => {
    it('renders a markdown report with rank + file + reasons', () => {
        const items = buildActionItems({ scorecard, doc });
        const md = renderActionItemsMd(items);
        expect(md).toContain('## Action items');
        expect(md).toContain('### 1. `src/big.ts`');
        expect(md).toContain('high cyclomatic complexity');
    });

    it('returns an empty-state message when no items', () => {
        expect(renderActionItemsMd([])).toContain('No action items');
    });
});
