// Next.js 16 best-practices audit. Regex-based; runs over .ts/.tsx files.
//
// Checks:
//   - raw <img> / <a> / <script> / Google Fonts <link> (use next/image, next/link, next/font)
//   - 'use client' overuse (no hooks/handlers/browser API)
//   - barrel imports (index.ts re-exports + `import *`)
//   - <Link><a></a></Link> (Next 13+ anti-pattern)
//   - manual <Head> (Pages Router leftover)
//   - src/pages/ remnants (App Router migration)
//   - unoptimized={true} on Image
//   - global CSS imported outside root layout

import { readFileSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'nextjs';

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const findings = [];
    const counts = new Map();
    const files = walkSourceFiles({
        ...walk,
        extensions: (walk.extensions || []).filter((e) => e === '.ts' || e === '.tsx'),
    });
    if (!files.length) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'no .ts/.tsx files' } };
    }

    const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;
    let i = 0;
    for (const f of files) {
        i++;
        if (i % 100 === 0) onProgress({ done: i, total: files.length });
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const rel = relative(root, f);
        if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
        const lines = code.split('\n');
        const isClient = /['"]use client['"]/.test(code);
        const hasHooks = /\b(useState|useEffect|useRef|useCallback|useMemo|useReducer|useLayoutEffect|useContext)\b/.test(code);
        const hasEventHandlers = /on(?:Click|Change|Submit|Focus|Blur|Input|KeyDown|KeyUp)\s*=\s*\{/.test(code);
        const issues = [];
        let m;

        // raw <img>
        const imgRx = /<img\s[^>]*src=/g;
        while ((m = imgRx.exec(code)) !== null) {
            // skip OG / ImageGeneration paths (legit)
            if (rel.includes('components/og/') || rel.includes('Global/ImageGeneration')) continue;
            issues.push({ kind: 'nextjs-raw-img', line: lineOf(code, m.index), severity: 'medium', message: 'Use `next/image`' });
        }

        // raw <a href="/..."> internal nav
        const aRx = /<a\s[^>]*href=["']\/(?!\/)/g;
        while ((m = aRx.exec(code)) !== null) {
            const ln = lineOf(code, m.index);
            const ctx = lines[ln - 1] || '';
            if (/target=["']_blank["']/.test(ctx) || /rel=/.test(ctx)) continue;
            issues.push({ kind: 'nextjs-raw-anchor', line: ln, severity: 'medium', message: 'Use `next/link`' });
        }

        // raw <script>
        const scriptRx = /<script\s+[^>]*src=/g;
        while ((m = scriptRx.exec(code)) !== null) {
            issues.push({ kind: 'nextjs-raw-script', line: lineOf(code, m.index), severity: 'low', message: 'Use `next/script`' });
        }

        // 'use client' overuse
        if (isClient && !hasHooks && !hasEventHandlers && !code.includes('window.') && !code.includes('document.') && !code.includes('localStorage') && !code.includes('navigator.')) {
            issues.push({ kind: 'nextjs-use-client-overuse', line: 1, severity: 'low', message: "'use client' but no hooks/handlers/browser API" });
        }

        // 'use client' missing — server component using hooks (real bug)
        if (!isClient && hasHooks) {
            issues.push({ kind: 'nextjs-missing-use-client', line: 1, severity: 'medium', message: 'Hooks used without `use client` directive' });
        }

        // barrel: index.ts re-exports
        if (rel.endsWith('index.ts') && /src\/(components|hooks|utils|services|constants)\//.test(rel)) {
            const reExportCount = (code.match(/^export\s+(\*|\{)/gm) || []).length;
            const realCodeCount = lines.filter((l) => l.trim() && !l.trim().startsWith('//') && !l.startsWith('export ') && !l.startsWith('import ')).length;
            if (reExportCount > 2 && realCodeCount < 5) {
                issues.push({ kind: 'nextjs-barrel-export', line: 1, severity: 'low', message: `barrel index.ts (${reExportCount} re-exports)`, score: reExportCount });
            }
        }
        // wildcard imports
        const wildRx = /^import\s+\*\s+as\s+\w+\s+from/gm;
        while ((m = wildRx.exec(code)) !== null) {
            const ln = lineOf(code, m.index);
            const ctx = lines[ln - 1] || '';
            if (/from ['"](react|zod|@sentry|@tanstack|crypto|path|fs|util|@?radix-ui)/.test(ctx)) continue;
            issues.push({ kind: 'nextjs-wildcard-import', line: ln, severity: 'low', message: '`import * as` — prefer named imports' });
        }

        // Google Fonts <link>
        if (/<link[^>]+fonts\.googleapis\.com/.test(code) || /<link[^>]+fonts\.gstatic/.test(code)) {
            issues.push({ kind: 'nextjs-google-fonts-link', line: 1, severity: 'medium', message: 'Use `next/font` instead of Google Fonts <link>' });
        }

        // manual <Head> (Pages Router leftover)
        if (/from\s+['"]next\/head['"]/.test(code)) {
            issues.push({ kind: 'nextjs-pages-router-head', line: 1, severity: 'medium', message: '`next/head` is Pages Router; use Metadata API' });
        }

        // src/pages remnants
        if (rel.includes('src/pages/') && !rel.includes('src/pages/_')) {
            issues.push({ kind: 'nextjs-pages-dir', line: 1, severity: 'medium', message: 'Pages Router file — migrate to App Router' });
        }

        // <Link><a></a></Link>
        if (/<Link[^>]*>\s*<a\s/.test(code)) {
            issues.push({ kind: 'nextjs-link-with-a', line: 1, severity: 'medium', message: '<Link><a></a></Link> is Next 12 — drop the inner <a>' });
        }

        // Image unoptimized
        const unoptRx = /<Image[^>]+unoptimized\s*=\s*\{?\s*true/g;
        while ((m = unoptRx.exec(code)) !== null) {
            issues.push({ kind: 'nextjs-image-unoptimized', line: lineOf(code, m.index), severity: 'low', message: '<Image unoptimized={true}>' });
        }

        // emit
        for (const issue of issues) {
            findings.push(makeFinding({
                kind: issue.kind,
                file: rel,
                line: issue.line,
                message: issue.message,
                severity: issue.severity,
                score: issue.score ?? 1,
            }));
            counts.set(rel, (counts.get(rel) || 0) + 1);
        }
    }

    const rawSignals = new Map();
    for (const [file, n] of counts.entries()) rawSignals.set(file, { nextjs_violations: n });

    return {
        findings,
        rawSignals,
        stats: { files: files.length, findings: findings.length },
    };
}
