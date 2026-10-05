// File walker. No deps. Returns absolute paths.
//
//   walkSourceFiles({
//     root: '/abs/path/to/repo',
//     include: ['app', 'server', 'utils'],   // dirs relative to root, or [] for whole root
//     rootFiles: ['app.vue', 'nuxt.config.ts'], // top-level files to include
//     exclude: ['node_modules', '.nuxt', ...],
//     extensions: ['.ts', '.tsx', '.vue'],
//     skipPatterns: [/\.test\./, /\.spec\./, /\.d\.ts$/],  // applied to each path
//   }) → string[] of absolute paths

import { readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const DEFAULT_EXCLUDE = [
    'node_modules',
    '.git',
    '.next',
    '.nuxt',
    '.output',
    'dist',
    'build',
    'coverage',
    '__pycache__',
];

const DEFAULT_SKIP_PATTERNS = [/\.test\./, /\.spec\./, /\.d\.ts$/];

export function walkSourceFiles({
    root,
    include = [],
    rootFiles = [],
    exclude = DEFAULT_EXCLUDE,
    extensions = ['.ts', '.tsx', '.js', '.jsx'],
    skipPatterns = DEFAULT_SKIP_PATTERNS,
} = {}) {
    if (!root) throw new Error('walkSourceFiles: root is required');
    const absRoot = resolve(root);
    const excludeSet = new Set(exclude);
    const extSet = new Set(extensions);

    const out = [];

    const roots = include.length
        ? include.map((d) => join(absRoot, d)).filter(existsSync)
        : [absRoot];

    for (const r of roots) walk(r, out, excludeSet, extSet, skipPatterns);

    for (const f of rootFiles) {
        const p = join(absRoot, f);
        if (existsSync(p) && statSync(p).isFile()) out.push(p);
    }

    return out;
}

function walk(dir, out, excludeSet, extSet, skipPatterns) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.startsWith('.') && entry !== '.') continue;
        if (excludeSet.has(entry)) continue;
        const full = join(dir, entry);
        let s;
        try {
            s = statSync(full);
        } catch {
            continue;
        }
        if (s.isDirectory()) {
            walk(full, out, excludeSet, extSet, skipPatterns);
            continue;
        }
        if (!s.isFile()) continue;
        const dot = entry.lastIndexOf('.');
        if (dot === -1) continue;
        const ext = entry.slice(dot);
        if (!extSet.has(ext)) continue;
        if (skipPatterns.some((rx) => rx.test(full))) continue;
        out.push(full);
    }
}
