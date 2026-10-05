import { describe, it, expect } from 'vitest';
import { run as runCommitCorr } from '../lib/analyzers/commit-correlation.mjs';

describe('commit-correlation analyzer', () => {
    it('skips when crossRoots missing', async () => {
        const r = await runCommitCorr({ cfg: {} });
        expect(r.stats.skipped).toBeDefined();
        expect(r.findings).toEqual([]);
    });

    it('handles non-git directories gracefully', async () => {
        const r = await runCommitCorr({ cfg: { crossRoots: [{ root: '/tmp/nonexistent-x-12345', label: 'A' }, { root: '/tmp/nonexistent-y-67890', label: 'B' }] } });
        expect(r.stats.error).toBeDefined();
    });

    // Real correlation is exercised by integration runs on real repos — synthetic
    // git repos here would need full setup. Smoke-test only.
});
