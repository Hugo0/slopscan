import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverWorkspaces } from '../lib/core/workspace.mjs';

describe('discoverWorkspaces', () => {
    let dir;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'ws-test-'));
    });
    afterAll(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    it('returns null when no workspace config', () => {
        const sub = mkdtempSync(join(tmpdir(), 'no-ws-'));
        writeFileSync(join(sub, 'package.json'), JSON.stringify({ name: 'lonely' }));
        expect(discoverWorkspaces(sub)).toBeNull();
        rmSync(sub, { recursive: true, force: true });
    });

    it('discovers npm workspaces (array form)', () => {
        const root = mkdtempSync(join(tmpdir(), 'npm-ws-'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        for (const name of ['a', 'b']) {
            mkdirSync(join(root, 'packages', name), { recursive: true });
            writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ name: `@x/${name}` }));
        }
        const ws = discoverWorkspaces(root);
        expect(ws.length).toBe(2);
        expect(ws.map((w) => w.name).sort()).toEqual(['@x/a', '@x/b']);
        rmSync(root, { recursive: true, force: true });
    });

    it('discovers pnpm workspaces', () => {
        const root = mkdtempSync(join(tmpdir(), 'pnpm-ws-'));
        writeFileSync(join(root, 'pnpm-workspace.yaml'), `packages:\n  - 'apps/*'\n  - 'libs/*'\n`);
        for (const [type, name] of [['apps', 'web'], ['libs', 'core']]) {
            mkdirSync(join(root, type, name), { recursive: true });
            writeFileSync(join(root, type, name, 'package.json'), JSON.stringify({ name }));
        }
        const ws = discoverWorkspaces(root);
        expect(ws.length).toBe(2);
        rmSync(root, { recursive: true, force: true });
    });
});
