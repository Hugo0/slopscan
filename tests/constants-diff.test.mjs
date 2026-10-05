import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runConstants } from '../lib/analyzers/constants-diff.mjs';

describe('constants-diff analyzer', () => {
    let a, b;
    beforeAll(() => {
        a = mkdtempSync(join(tmpdir(), 'cd-a-'));
        b = mkdtempSync(join(tmpdir(), 'cd-b-'));
        mkdirSync(join(a, 'src'), { recursive: true });
        mkdirSync(join(b, 'src'), { recursive: true });
        writeFileSync(join(a, 'src', 'k.ts'),
            `export const SAME_NAME_DIFF_VALUE = 100;
export const SHARED_VALUE_A = 42;
export const ALONE_A = 1;`);
        writeFileSync(join(b, 'src', 'k.ts'),
            `export const SAME_NAME_DIFF_VALUE = 200;
export const SHARED_VALUE_B = 42;
export const ALONE_B = 9;`);
    });
    afterAll(() => {
        try { rmSync(a, { recursive: true, force: true }); } catch {}
        try { rmSync(b, { recursive: true, force: true }); } catch {}
    });

    it('emits constants-drift for same-name different-value', async () => {
        const r = await runConstants({ cfg: { crossRoots: [{ root: a, label: 'A' }, { root: b, label: 'B' }] } });
        expect(r.findings.some((f) => f.kind === 'constants-drift' && f.meta.name === 'SAME_NAME_DIFF_VALUE')).toBe(true);
    });

    it('emits constants-shared-value for different-name same-value', async () => {
        const r = await runConstants({ cfg: { crossRoots: [{ root: a, label: 'A' }, { root: b, label: 'B' }] } });
        const f = r.findings.find((x) => x.kind === 'constants-shared-value');
        expect(f).toBeDefined();
        expect(f.meta.value).toBe(42);
    });

    it('skips when crossRoots not provided', async () => {
        const r = await runConstants({ cfg: {} });
        expect(r.stats.skipped).toBeDefined();
    });
});
