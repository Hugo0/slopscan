// Default chunk filter for embedding pipelines.
// Drops obvious non-signal: type-only exports, trivial bodies, JSX render
// blocks (noisy, share boilerplate that creates false-positive clusters).
//
// For a smarter React/JSX filter that keeps hooks while dropping components,
// use lib/filters/jsx-aware.mjs instead.

export function defaultChunkFilter(chunk) {
    const b = chunk.body;
    if (b.startsWith('export type') || b.startsWith('export interface')) return false;
    if (chunk.bodyLen < 80) return false;
    // JSX-ish render: `return (` followed by `<Capital`. Conservative drop.
    if (/return\s*\(/.test(b) && /<[A-Z]\w/.test(b)) return false;
    return true;
}
