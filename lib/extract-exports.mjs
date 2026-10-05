// Regex-based extraction of named, exported declarations + their bodies.
// Framework wrappers (e.g. Vue SFC) are stripped via the preprocessor registry
// before pattern matching, so the same code path handles .ts/.tsx/.js/.jsx/.vue.
//
// Returns chunks: { name, kind, line, body, bodyLen, normalized }
//
// Kinds: function | const | class | composable | function-local | const-local
//   "composable" = function/const whose name starts with "use" (React hook
//   convention also matches; harmless for filtering downstream).

import { preprocess, defaultPreprocessors } from './preprocessors/index.mjs';

const PATTERNS = [
    { rx: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
    { rx: /^export\s+const\s+(\w+)\s*[:=]/gm, kind: 'const' },
    { rx: /^export\s+class\s+(\w+)/gm, kind: 'class' },
    // Top-level fn/const inside Vue <script setup> aren't exported but are
    // still chunks worth embedding. React JSX components hit these too —
    // the filter step is what decides which ones to drop.
    { rx: /^(?:async\s+)?function\s+(\w+)\s*\(/gm, kind: 'function-local' },
    { rx: /^const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm, kind: 'const-local' },
];

export function extractExports(code, filepath, opts = {}) {
    const {
        minBodyLen = 60,
        maxBodyChars = 4000,
        maxBodyLines = 80,
        preprocessors = defaultPreprocessors,
    } = opts;

    const src = preprocess(code, filepath, preprocessors);
    if (!src.trim()) return [];

    const positions = [];
    for (const { rx, kind } of PATTERNS) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(src)) !== null) {
            positions.push({ name: m[1], pos: m.index, kind });
        }
    }
    positions.sort((a, b) => a.pos - b.pos);

    const seen = new Set();
    const items = [];
    for (const p of positions) {
        const key = `${p.name}:${p.pos}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const lineStart = src.slice(0, p.pos).split('\n').length;
        const endPos = findBlockEnd(src, p.pos, maxBodyLines);
        const body = src.slice(p.pos, endPos).slice(0, maxBodyChars);
        if (body.length < minBodyLen) continue;

        const isComposable =
            (p.kind === 'function' || p.kind === 'const' || p.kind === 'function-local') &&
            /^use[A-Z]/.test(p.name);

        items.push({
            name: p.name,
            kind: isComposable ? 'composable' : p.kind,
            line: lineStart,
            body,
            bodyLen: body.length,
            normalized: normalize(body),
        });
    }
    return items;
}

function findBlockEnd(code, start, maxLines) {
    let depth = 0;
    let seenBrace = false;
    const lineLimit = code.slice(0, start).split('\n').length + maxLines;
    for (let i = start; i < code.length; i++) {
        const line = code.slice(0, i).split('\n').length;
        if (line > lineLimit) return i;
        const ch = code[i];
        if (ch === '{') {
            depth++;
            seenBrace = true;
        } else if (ch === '}') {
            depth--;
            if (seenBrace && depth === 0) return i + 1;
        } else if (ch === '\n' && !seenBrace && depth === 0) {
            if (code[i - 1] !== ',' && code[i - 1] !== '\\') return i;
        }
    }
    return Math.min(start + 3000, code.length);
}

// Strip comments + collapse whitespace. Used as embedding cache key.
export function normalize(body) {
    return body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Re-export the default filter from its new home for backward compatibility.
export { defaultChunkFilter } from './filters/default.mjs';
