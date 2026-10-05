import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run as runReact } from '../lib/analyzers/react.mjs';

describe('react analyzer', () => {
    let dir;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'rx-'));
        mkdirSync(join(dir, 'src'), { recursive: true });
        // class component
        writeFileSync(join(dir, 'src', 'Klass.tsx'),
            `import React from 'react'\nexport class Klass extends React.Component { render() { return <div/> } }`);
        // forwardRef
        writeFileSync(join(dir, 'src', 'Fwd.tsx'),
            `import { forwardRef } from 'react'\nexport const Fwd = forwardRef((p, ref) => <div ref={ref} />);`);
        // useEffect derives state (empty deps + setState only)
        writeFileSync(join(dir, 'src', 'Derived.tsx'),
            `import { useEffect, useState } from 'react'
export function Derived({ x }) {
  const [y, setY] = useState(0);
  useEffect(() => { setY(x * 2) }, []);
  return <div>{y}</div>;
}`);
        // useEffect for fetching
        writeFileSync(join(dir, 'src', 'Fetcher.tsx'),
            `import { useEffect, useState } from 'react'
export function Fetcher() {
  const [d, setD] = useState(null);
  useEffect(() => { fetch('/api').then(r => r.json()).then(setD) }, []);
  return <pre>{JSON.stringify(d)}</pre>;
}`);
        // direct DOM
        writeFileSync(join(dir, 'src', 'DomDirect.tsx'),
            `export function DomDirect() { document.getElementById('x'); return <div/>; }`);
        // missing key
        writeFileSync(join(dir, 'src', 'MissingKey.tsx'),
            `export function L({ items }) { return <ul>{items.map(i => <li>{i}</li>)}</ul>; }`);
    });
    afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

    const walk = () => ({ root: dir, include: ['src'], extensions: ['.tsx'] });

    it('flags class components', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-class-component')).toBe(true);
    });
    it('flags forwardRef', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-forward-ref')).toBe(true);
    });
    it('flags derived-state useEffect', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-effect-derives-state')).toBe(true);
    });
    it('flags useEffect for fetching', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-effect-fetches')).toBe(true);
    });
    it('flags direct DOM access', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-direct-dom')).toBe(true);
    });
    it('flags missing key in .map', async () => {
        const r = await runReact({ root: dir, walk: walk() });
        expect(r.findings.some((f) => f.kind === 'react-missing-key')).toBe(true);
    });
});
