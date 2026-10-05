// Sliced sub-chunk extraction for large bodies.
//
// Top-level export extraction misses duplication that lives *inside* big
// functions/composables. e.g. a 600-line file whose body contains a 40-line
// helper that paraphrases a 40-line helper in another file — the outer
// declarations embed as one big chunk each, similarity dilutes, and the
// inner duplication is invisible.
//
// This module rescans large bodies for nested declarations and emits them as
// additional chunks. The relaxed regex drops the line-anchor (^) and accepts
// position 0 OR a preceding newline+indent, so it catches function/const decls
// at any indentation level.

import { normalize } from './extract-exports.mjs';

const NESTED_PATTERNS = [
    {
        rx: /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)\s*\(/g,
        kind: 'nested-function',
    },
    {
        rx: /(?:^|\n)\s*const\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
        kind: 'nested-const',
    },
];

const DEFAULT_OPTS = {
    minParentLen: 1200,    // only slice chunks at least this big
    minChildLen: 120,      // skip trivial nested decls
    maxChildLen: 4000,
    maxChildLines: 80,
};

export function sliceBlocks(parentChunk, opts = {}) {
    const { minParentLen, minChildLen, maxChildLen, maxChildLines } = { ...DEFAULT_OPTS, ...opts };
    if ((parentChunk.bodyLen ?? parentChunk.body.length) < minParentLen) return [];

    const body = parentChunk.body;
    const positions = [];
    for (const { rx, kind } of NESTED_PATTERNS) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(body)) !== null) {
            // Skip the very first match if it's the parent declaration itself.
            if (m.index === 0) continue;
            // Find the actual decl start (skip the leading newline+ws).
            const declStart = body.indexOf(m[0].trim(), m.index);
            positions.push({ name: m[1], pos: declStart >= 0 ? declStart : m.index, kind });
        }
    }
    positions.sort((a, b) => a.pos - b.pos);

    const seen = new Set();
    const out = [];
    for (const p of positions) {
        const key = `${p.name}:${p.pos}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const endPos = findBlockEnd(body, p.pos, maxChildLines);
        const childBody = body.slice(p.pos, endPos).slice(0, maxChildLen);
        if (childBody.length < minChildLen) continue;

        // Compute line in the original file: parent.line + lines before pos in body.
        const linesBefore = body.slice(0, p.pos).split('\n').length - 1;
        out.push({
            file: parentChunk.file,
            label: parentChunk.label,
            name: `${parentChunk.name}>${p.name}`,
            kind: p.kind,
            line: (parentChunk.line ?? 0) + linesBefore,
            body: childBody,
            bodyLen: childBody.length,
            normalized: normalize(childBody),
            parent: parentChunk.name,
        });
    }
    return out;
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
