// Preprocessor registry: extension → (code, filepath) → analyzable script.
//
// A preprocessor strips a wrapper format (Vue SFC, Svelte component, Astro
// frontmatter, MDX) down to the JS/TS the rest of the pipeline can read.
// Files whose extension isn't registered pass through unchanged.
//
// To support a new framework, add a module under lib/preprocessors/ and
// register it here OR pass a custom registry into extractExports/analyzeFile:
//
//   import { defaultPreprocessors } from './preprocessors/index.mjs';
//   import sveltePreprocessor from './preprocessors/svelte.mjs';
//   const preprocessors = { ...defaultPreprocessors, '.svelte': sveltePreprocessor };

import vuePreprocessor from './vue.mjs';
import sveltePreprocessor from './svelte.mjs';
import astroPreprocessor from './astro.mjs';
import mdxPreprocessor from './mdx.mjs';

export const defaultPreprocessors = {
    '.vue': vuePreprocessor,
    '.svelte': sveltePreprocessor,
    '.astro': astroPreprocessor,
    '.mdx': mdxPreprocessor,
};

export const identityPreprocessor = (code) => code;

// Apply registry → returns analyzable script. .ts/.tsx/.js/.jsx pass through.
export function preprocess(code, filepath, registry = defaultPreprocessors) {
    const dot = filepath.lastIndexOf('.');
    if (dot === -1) return code;
    const ext = filepath.slice(dot);
    const fn = registry[ext];
    return fn ? fn(code, filepath) : code;
}
