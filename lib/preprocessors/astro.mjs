// Astro file preprocessor. Pulls the frontmatter (between leading `---`
// fences) and any `<script>` blocks. Astro's frontmatter is plain TypeScript.

const FRONTMATTER_RX = /^---\n([\s\S]*?)\n---/;
const SCRIPT_RX = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

export function extractAstroScript(code) {
    const parts = [];
    const fm = code.match(FRONTMATTER_RX);
    if (fm) parts.push(fm[1]);
    SCRIPT_RX.lastIndex = 0;
    let m;
    while ((m = SCRIPT_RX.exec(code)) !== null) parts.push(m[2]);
    return parts.join('\n\n');
}

export default function astroPreprocessor(code /* , filepath */) {
    return extractAstroScript(code);
}
