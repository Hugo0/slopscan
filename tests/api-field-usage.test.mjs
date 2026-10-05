import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runApiFields } from '../lib/analyzers/api-field-usage.mjs';

describe('api-field-usage analyzer', () => {
    let api, ui;
    beforeAll(() => {
        api = mkdtempSync(join(tmpdir(), 'apf-api-'));
        ui = mkdtempSync(join(tmpdir(), 'apf-ui-'));
        mkdirSync(join(api, 'src', 'routes'), { recursive: true });
        mkdirSync(join(ui, 'src'), { recursive: true });

        // API route with response schema returning bridgeFee + amount
        writeFileSync(join(api, 'src', 'routes', 'withdraw.ts'),
            `app.post('/withdraw', { schema: { response: { 200: Type.Object({
                amount: Type.Number(),
                bridgeFee: Type.Number(),
                feeBreakdown: Type.Number(),
            }) } } }, async () => {});`);

        // UI uses amount but never bridgeFee or feeBreakdown
        writeFileSync(join(ui, 'src', 'consume.ts'),
            `import { z } from 'whatever';
            export function show(d) { return d.amount; }`);
    });
    afterAll(() => {
        try { rmSync(api, { recursive: true, force: true }); } catch {}
        try { rmSync(ui, { recursive: true, force: true }); } catch {}
    });

    it('flags returned-but-unused fields', async () => {
        const r = await runApiFields({ cfg: { crossRoots: [{ root: api, label: 'api' }, { root: ui, label: 'ui' }] } });
        const f = r.findings.find((x) => x.kind === 'api-unused-response-field');
        expect(f).toBeDefined();
        expect(f.meta.unused).toContain('bridgeFee');
        expect(f.meta.unused).toContain('feeBreakdown');
        expect(f.meta.unused).not.toContain('amount');
    });

    it('skips when crossRoots not provided', async () => {
        const r = await runApiFields({ cfg: {} });
        expect(r.stats.skipped).toBeDefined();
    });
});
