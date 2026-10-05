// Shared defaults for the bundled presets. Presets only set defaults —
// every field can be overridden from the CLI.

export const COMMON_EXCLUDE = [
    'node_modules', '.git', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.cache',
    'dist', 'build', 'out', 'coverage', '__tests__', '__mocks__', '__pycache__',
    'public', 'static', 'vendor', 'generated', 'fixtures', 'examples',
];

// Packages that are widely considered deprecated or superseded.
export const COMMON_DEPRECATED = [
    'request', 'node-sass', 'tslint', 'moment', 'aws-sdk', 'core-js', 'rimraf', 'mkdirp',
];

export const COMMON_SEMANTIC = {
    threshold: 0.82,
    minBodyLen: 80,
    maxClusterSize: 50,
    useAst: true,
};
