// Preset: Vue 3 / Nuxt (SFCs).
//
// SFCs are handled by lib/preprocessors/vue.mjs (<script> extraction) and
// lib/extract-templates.mjs (<template> chunks for semantic-dup).
//
// Deliberately OFF by default:
//   - dead-code:   Nuxt auto-imports components, composables and utils without
//                  an import statement, so a static import graph (knip) reports
//                  many live files/exports as unused. Opt in with
//                  `--analyzers +dead-code` if your project uses explicit imports
//                  or a tuned knip config.
//   - type-errors: plain `tsc` cannot type-check .vue files or Nuxt's generated
//                  auto-import types; run `vue-tsc` / `nuxi typecheck` instead.
//   - react / nextjs / bundle-size: React/Next-specific.

import { COMMON_EXCLUDE, COMMON_DEPRECATED, COMMON_SEMANTIC } from './_common.mjs';

export default {
    label: 'vue-nuxt',
    include: [],
    extensions: ['.ts', '.js', '.vue'],
    exclude: COMMON_EXCLUDE,
    filter: 'vue-aware',
    analyzers: [
        'complexity', 'cognitive', 'structural-dup', 'semantic-dup',
        'import-graph', 'churn', 'ts-quality', 'supply-chain',
    ],
    ...COMMON_SEMANTIC,
    deprecatedDeps: [...COMMON_DEPRECATED, 'vuex', '@vue/composition-api'],
};
