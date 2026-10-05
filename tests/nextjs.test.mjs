import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runNextjs } from '../lib/analyzers/nextjs.mjs';

describe('nextjs analyzer', () => {
    let dir;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'nx-'));
        mkdirSync(join(dir, 'src'), { recursive: true });
        // raw <img>
        writeFileSync(join(dir, 'src', 'raw-img.tsx'),
            `export const Pic = () => <div><img src="/x.png" alt="x" /></div>;`);
        // raw <a href="/...">
        writeFileSync(join(dir, 'src', 'raw-anchor.tsx'),
            `export const Nav = () => <a href="/home">Home</a>;`);
        // 'use client' overuse
        writeFileSync(join(dir, 'src', 'overused-client.tsx'),
            `'use client'\nexport const Plain = () => <div>plain</div>;`);
        // Hooks without 'use client'
        writeFileSync(join(dir, 'src', 'missing-client.tsx'),
            `import { useState } from 'react'\nexport const X = () => { const [s, setS] = useState(0); return <div>{s}</div>; }`);
        // Pages Router head
        writeFileSync(join(dir, 'src', 'old-head.tsx'),
            `import Head from 'next/head'\nexport default function P() { return <Head><title>x</title></Head>; }`);
        // Google Fonts <link>
        writeFileSync(join(dir, 'src', 'gfonts.tsx'),
            `export const G = () => <link href="https://fonts.googleapis.com/css?family=Inter" rel="stylesheet" />;`);
    });
    afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    const walk = () => ({ root: dir, include: ['src'], extensions: ['.ts', '.tsx'] });

    it('flags raw <img>', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-raw-img')).toBe(true);
    });
    it('flags raw <a href="/">', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-raw-anchor')).toBe(true);
    });
    it('flags use client overuse', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-use-client-overuse')).toBe(true);
    });
    it('flags hooks without use client', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-missing-use-client')).toBe(true);
    });
    it('flags Pages Router next/head usage', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-pages-router-head')).toBe(true);
    });
    it('flags Google Fonts <link>', async () => {
        const r = await runNextjs({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'nextjs-google-fonts-link')).toBe(true);
    });
});
