// MDX preprocessor. Pulls fenced code blocks marked tsx/ts/jsx/js + ESM
// import/export lines from the document body. Markdown prose is dropped.

const FENCE_RX = /```(?:ts|tsx|js|jsx)\b[^\n]*\n([\s\S]*?)```/g;
const ESM_RX = /^(?:import\s.+|export\s(?:default|const|function|class|interface|type|enum|let|var)\s.+)/gm;

export function extractMdxScript(code) {
    const parts = [];
    FENCE_RX.lastIndex = 0;
    let m;
    while ((m = FENCE_RX.exec(code)) !== null) parts.push(m[1]);
    ESM_RX.lastIndex = 0;
    while ((m = ESM_RX.exec(code)) !== null) parts.push(m[0]);
    return parts.join('\n');
}

export default function mdxPreprocessor(code /* , filepath */) {
    return extractMdxScript(code);
}
