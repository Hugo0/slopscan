import { describe, it, expect } from 'vitest';
import { extractAst } from '../lib/extract-ast.mjs';

describe('extractAst', () => {
    it('extracts exported function', () => {
        const code = `export function foo(a, b) {
            const x = a + b;
            const y = x * 2;
            return y + 1;
        }`;
        const chunks = extractAst(code, 'foo.ts');
        const fn = chunks.find((c) => c.name === 'foo');
        expect(fn).toBeDefined();
        expect(fn.kind).toBe('function');
    });
    it('extracts class methods with parent name', () => {
        const code = `export class Foo {
            method1() {
                const a = 1; const b = 2; const c = 3;
                const d = 4; const e = 5; return a + b + c + d + e;
            }
            method2() {
                const a = 1; const b = 2; const c = 3;
                const d = 4; const e = 5; return a * b * c * d * e;
            }
        }`;
        const chunks = extractAst(code, 'foo.ts');
        const m1 = chunks.find((c) => c.name === 'Foo.method1');
        expect(m1).toBeDefined();
        expect(m1.kind).toBe('method');
    });
    it('classifies useXxx as composable', () => {
        const code = `export function useFoo() {
            const x = 1; const y = 2; const z = 3; return x + y + z;
        }`;
        const chunks = extractAst(code, 'useFoo.ts');
        const c = chunks.find((c) => c.name === 'useFoo');
        expect(c.kind).toBe('composable');
    });
    it('classifies PascalCase + JSX return as jsx-component', () => {
        const code = `export function MyBox() {
            const a = 1; const b = 2;
            return (<div className="x">{a + b}</div>);
        }`;
        const chunks = extractAst(code, 'MyBox.tsx');
        const c = chunks.find((c) => c.name === 'MyBox');
        expect(c?.kind).toBe('jsx-component');
    });
    it('handles Vue SFC via preprocessor', () => {
        const code = `<template><div /></template>
<script setup lang="ts">
function helper() {
  const x = 1; const y = 2; const z = 3;
  return x + y + z;
}
</script>`;
        const chunks = extractAst(code, 'Foo.vue');
        const fn = chunks.find((c) => c.name === 'helper');
        expect(fn).toBeDefined();
    });
});
