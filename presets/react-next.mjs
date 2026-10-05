// Preset: React / Next.js (TSX/JSX).

import { COMMON_EXCLUDE, COMMON_DEPRECATED, COMMON_SEMANTIC } from './_common.mjs';

export default {
    label: 'react-next',
    include: [],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    exclude: COMMON_EXCLUDE,
    filter: 'jsx-aware',
    analyzers: [
        'complexity', 'cognitive', 'structural-dup', 'semantic-dup', 'dead-code',
        'import-graph', 'churn', 'type-errors', 'ts-quality', 'react', 'nextjs',
        'bundle-size', 'supply-chain',
    ],
    ...COMMON_SEMANTIC,
    deprecatedDeps: [...COMMON_DEPRECATED, 'enzyme', 'react-scripts'],
    // React / Next.js anti-patterns weigh a bit more in UI code.
    weights: {
        nextjs_violations: 0.05,
        react_antipatterns: 0.06,
        bundle_size: 0.04,
    },
};
