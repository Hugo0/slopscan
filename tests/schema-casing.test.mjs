import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runSchema } from '../lib/analyzers/schema-casing.mjs';

describe('schema-casing analyzer', () => {
    let dir;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'sc-'));
        mkdirSync(join(dir, 'src'), { recursive: true });
        // Mixed casing in a Type.Object
        writeFileSync(join(dir, 'src', 'mixed.ts'),
            `export const S = Type.Object({
                userId: Type.String(),
                user_name: Type.String(),
                email_verified_at: Type.String(),
                createdBy: Type.String(),
            });`);
        // reply.code + reply.status mix
        writeFileSync(join(dir, 'src', 'mixed-reply.ts'),
            `export function h(reply) {
                if (x) reply.code(400).send({});
                if (y) reply.status(500).send({});
            }`);
    });
    afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    const walk = () => ({ root: dir, include: ['src'], extensions: ['.ts'] });

    it('flags mixed casing in Type.Object', async () => {
        const r = await runSchema({ root: dir, walk: walk() });
        const f = r.findings.find((x) => x.kind === 'schema-mixed-casing');
        expect(f).toBeDefined();
        expect(f.meta.camel.length).toBeGreaterThan(0);
        expect(f.meta.snake.length).toBeGreaterThan(0);
    });

    it('flags reply.code/status mix', async () => {
        const r = await runSchema({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'schema-reply-style-mix')).toBe(true);
    });
});
