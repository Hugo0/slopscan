import { describe, it, expect } from 'vitest';
import sveltePre from '../lib/preprocessors/svelte.mjs';
import astroPre from '../lib/preprocessors/astro.mjs';
import mdxPre from '../lib/preprocessors/mdx.mjs';
import vuePre from '../lib/preprocessors/vue.mjs';
import { preprocess } from '../lib/preprocessors/index.mjs';

describe('svelte preprocessor', () => {
    it('extracts <script lang="ts">', () => {
        const code = `<script lang="ts">
export const x = 1;
</script>
<button>hi</button>
<style>div { color: red; }</style>`;
        const out = sveltePre(code);
        expect(out).toContain('export const x = 1');
        expect(out).not.toContain('color: red');
    });
});

describe('astro preprocessor', () => {
    it('extracts frontmatter + <script>', () => {
        const code = `---
const title = 'hello';
---
<h1>{title}</h1>
<script>
console.log('client');
</script>`;
        const out = astroPre(code);
        expect(out).toContain("const title = 'hello'");
        expect(out).toContain("console.log('client')");
    });
});

describe('mdx preprocessor', () => {
    it('extracts code fences and ESM lines', () => {
        const code = `# Hello

import { Foo } from 'foo';

\`\`\`tsx
export function Bar() { return null }
\`\`\`

prose here.`;
        const out = mdxPre(code);
        expect(out).toContain('export function Bar');
        expect(out).toContain("import { Foo }");
    });
});

describe('vue preprocessor still works', () => {
    it('extracts <script setup>', () => {
        const code = `<template><div /></template>
<script setup>
const x = 1;
</script>`;
        const out = vuePre(code);
        expect(out).toContain('const x = 1');
    });
});

describe('preprocess registry dispatch', () => {
    it('dispatches by extension', () => {
        const v = preprocess('<template></template><script>const a=1</script>', 'a.vue');
        expect(v).toContain('const a=1');
        const s = preprocess('<script lang="ts">const b=2</script>', 'a.svelte');
        expect(s).toContain('const b=2');
        const ts = preprocess('export const c = 3', 'a.ts');
        expect(ts).toBe('export const c = 3');
    });
});
