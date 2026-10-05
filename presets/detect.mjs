// Pick a bundled preset from the target's package.json dependencies.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const PRESETS = ['react-next', 'node-ts', 'vue-nuxt'];

export function detectPreset(root) {
    const pkgPath = join(root, 'package.json');
    if (!existsSync(pkgPath)) return 'node-ts';
    let pkg = {};
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
        return 'node-ts';
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
    if (has('nuxt') || has('vue') || has('nuxt3')) return 'vue-nuxt';
    if (has('next') || has('react') || has('react-dom') || has('preact')) return 'react-next';
    return 'node-ts';
}
