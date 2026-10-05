// Preset: Node.js / TypeScript backend or library.

import { COMMON_EXCLUDE, COMMON_DEPRECATED, COMMON_SEMANTIC } from './_common.mjs';

export default {
    label: 'node-ts',
    include: [],
    extensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
    exclude: COMMON_EXCLUDE,
    filter: 'default',
    analyzers: [
        'complexity', 'cognitive', 'structural-dup', 'semantic-dup', 'dead-code',
        'import-graph', 'churn', 'type-errors', 'ts-quality', 'schema-casing',
        'supply-chain',
    ],
    ...COMMON_SEMANTIC,
    deprecatedDeps: [...COMMON_DEPRECATED, 'lodash'],
    // Backends: import cycles and dead exports matter more.
    weights: {
        cycle: 0.07,
        unused_export: 0.05,
        schema_mixed_casing: 0.04,
    },
};
