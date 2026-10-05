// JSX-aware chunk filter for React/Preact/Solid repos.
//
// Keeps custom hooks (useXxx) and plain utilities even when defined inside
// .jsx/.tsx files. Drops only PascalCase-named chunks that return JSX —
// i.e. real components, whose bodies are mostly markup boilerplate that
// pollutes embedding clusters.

export function jsxAwareFilter(chunk) {
    const b = chunk.body;
    if (b.startsWith('export type') || b.startsWith('export interface')) return false;
    if (chunk.bodyLen < 80) return false;

    const looksLikeJsxReturn = /return\s*\(/.test(b) && /<[A-Z]\w/.test(b);
    const isPascalCase = /^[A-Z]/.test(chunk.name);
    if (looksLikeJsxReturn && isPascalCase) return false; // drop components

    return true;
}
