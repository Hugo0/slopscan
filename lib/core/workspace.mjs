// Monorepo workspace discovery. Auto-detects pnpm / npm / yarn workspaces.
//
// Returns array of { name, root, label } — one per package — that the
// orchestrator can iterate over.

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, basename } from 'path';

export function discoverWorkspaces(root) {
    if (existsSync(join(root, 'pnpm-workspace.yaml'))) return discoverPnpm(root);
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) return discoverNpm(root, pkg.workspaces);
    }
    return null;
}

function discoverPnpm(root) {
    const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf-8');
    const patterns = parsePnpmYamlPackages(yaml);
    return resolvePackagePatterns(root, patterns);
}

function discoverNpm(root, workspaces) {
    const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages || [];
    return resolvePackagePatterns(root, patterns);
}

function parsePnpmYamlPackages(yaml) {
    // Naive: looks for `packages:` block with `- '<glob>'` entries.
    const lines = yaml.split('\n');
    const out = [];
    let inPackages = false;
    for (const line of lines) {
        if (/^packages:/.test(line)) {
            inPackages = true;
            continue;
        }
        if (inPackages) {
            const m = line.match(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/);
            if (m) out.push(m[1].trim());
            else if (/^\S/.test(line)) inPackages = false;
        }
    }
    return out;
}

function resolvePackagePatterns(root, patterns) {
    const out = [];
    const seen = new Set();
    for (const pat of patterns) {
        // Naive glob: only handles `dir/*`, `dir/**`, and literal paths.
        const cleaned = pat.replace(/\/\*\*?$/, '');
        const base = join(root, cleaned);
        // Single-package literal
        if (existsSync(join(base, 'package.json')) && !pat.includes('*')) {
            addPkg(out, seen, base);
            continue;
        }
        // Glob: enumerate immediate children
        if (existsSync(base) && statSync(base).isDirectory()) {
            for (const entry of readdirSync(base)) {
                const p = join(base, entry);
                if (statSync(p).isDirectory() && existsSync(join(p, 'package.json'))) {
                    addPkg(out, seen, p);
                }
            }
        }
    }
    return out;
}

function addPkg(out, seen, dir) {
    if (seen.has(dir)) return;
    seen.add(dir);
    let name = basename(dir);
    try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        if (pkg.name) name = pkg.name;
    } catch {}
    out.push({ name, root: dir, label: name });
}
