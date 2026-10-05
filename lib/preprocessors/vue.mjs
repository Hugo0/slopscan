// Vue SFC preprocessor. Pulls <script> blocks out for analysis; the rest of
// the SFC (template, style) is dropped — analyzers downstream only handle JS/TS.
//
// Regex-based ("good enough"), not a real Vue parser.

const SCRIPT_RX = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const TEMPLATE_RX = /<template\b[^>]*>([\s\S]*?)<\/template>/;

export function extractVueScript(code) {
    // Concatenates all <script> blocks (handles `<script setup>` + `<script>` pair).
    const parts = [];
    let m;
    SCRIPT_RX.lastIndex = 0;
    while ((m = SCRIPT_RX.exec(code)) !== null) parts.push(m[2]);
    return parts.join('\n\n');
}

export function extractVueTemplate(code) {
    const m = code.match(TEMPLATE_RX);
    return m ? m[1] : '';
}

export function splitVueSfc(code) {
    return {
        script: extractVueScript(code),
        template: extractVueTemplate(code),
    };
}

// Preprocessor registry contract: (code, filepath) → analyzable script string.
export default function vuePreprocessor(code /* , filepath */) {
    return extractVueScript(code);
}
