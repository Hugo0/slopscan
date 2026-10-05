// Svelte SFC preprocessor. Pulls <script> blocks (lang="ts" or default).
// Discards <style> and the markup body — analyzers downstream only handle JS/TS.

const SCRIPT_RX = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

export function extractSvelteScript(code) {
    const parts = [];
    SCRIPT_RX.lastIndex = 0;
    let m;
    while ((m = SCRIPT_RX.exec(code)) !== null) parts.push(m[2]);
    return parts.join('\n\n');
}

// Preprocessor registry contract: (code, filepath) → analyzable script string.
export default function sveltePreprocessor(code /* , filepath */) {
    return extractSvelteScript(code);
}
