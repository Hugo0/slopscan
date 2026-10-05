// Resolve a CLI shipped as one of slopscan's own dependencies, so analyzers
// never depend on (or download into) the scanned repo's node_modules.

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const require = createRequire(import.meta.url);

export function bundledBin(pkgName, binName = pkgName) {
    try {
        // Walk the node resolution paths by hand: some packages' `exports`
        // hide package.json from require.resolve.
        const pkgJson = (require.resolve.paths(pkgName) || [])
            .map((d) => join(d, pkgName, 'package.json'))
            .find((p) => existsSync(p));
        if (!pkgJson) throw new Error('not found');
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
        const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
        if (rel) return `${JSON.stringify(process.execPath)} ${JSON.stringify(join(dirname(pkgJson), rel))}`;
    } catch {}
    return `npx --yes ${pkgName}`;
}
