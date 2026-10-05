// Vue <template> block extraction as separate chunks.
//
// Top-level child elements of <template> become chunks — typical SFC has a
// single root, so usually we get one big chunk per file. That's still useful:
// "two mode pages with similar endgame layouts" surfaces as two ~80%-similar
// template chunks. To get finer signal, opts.splitDepth slices children too.

import { extractVueTemplate } from './preprocessors/vue.mjs';
import { normalize } from './extract-exports.mjs';

const DEFAULT_OPTS = {
    minBodyLen: 200,
    maxBodyChars: 4000,
    splitDepth: 0, // 0 = whole template; 1 = top-level children of root; 2 = grandchildren
};

export function extractTemplates(code, filepath, opts = {}) {
    if (!filepath.endsWith('.vue')) return [];
    const { minBodyLen, maxBodyChars, splitDepth } = { ...DEFAULT_OPTS, ...opts };

    const template = extractVueTemplate(code);
    if (!template || template.length < minBodyLen) return [];

    const chunks = [];

    if (splitDepth === 0) {
        const body = template.slice(0, maxBodyChars);
        chunks.push(makeChunk('template', body, 1));
        return chunks;
    }

    const children = topLevelChildren(template);
    let lineCursor = 1;
    for (const c of children) {
        const lineStart = lineCursor + countNewlines(template.slice(0, c.start));
        if (c.text.length < minBodyLen) {
            lineCursor = lineStart + countNewlines(c.text);
            continue;
        }
        const body = c.text.slice(0, maxBodyChars);
        chunks.push(makeChunk(`template>${c.tag}`, body, lineStart));
        lineCursor = lineStart + countNewlines(c.text);
    }
    return chunks;
}

function makeChunk(name, body, line) {
    return {
        name,
        kind: 'template',
        line,
        body,
        bodyLen: body.length,
        normalized: normalizeTemplate(body),
    };
}

// Template-specific normalization: strip vue interpolation `{{ ... }}` content
// + collapse attribute whitespace. Identifiers stay (they're the dimension we
// want to compare on).
function normalizeTemplate(body) {
    return body
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, '{{}}')
        .replace(/\s+/g, ' ')
        .trim();
}

function countNewlines(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}

// Pull top-level child elements of the root template. Naive but fine for SFCs:
// find each `<Tag …>` whose closing tag is balanced at the same depth.
function topLevelChildren(template) {
    const out = [];
    const re = /<([A-Za-z][\w-]*)(\s[^>]*)?>/g;
    let m;
    let cursor = 0;
    // Skip whitespace at root
    while (cursor < template.length && /\s/.test(template[cursor])) cursor++;
    re.lastIndex = cursor;
    while ((m = re.exec(template)) !== null) {
        const tag = m[1];
        const start = m.index;
        const end = findClosingTag(template, tag, re.lastIndex);
        if (end === -1) {
            // self-closing or unbalanced — skip
            re.lastIndex = m.index + m[0].length;
            continue;
        }
        out.push({ tag, start, end, text: template.slice(start, end) });
        re.lastIndex = end;
    }
    return out;
}

function findClosingTag(template, tag, fromPos) {
    const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
    const close = new RegExp(`</${tag}\\s*>`, 'g');
    open.lastIndex = fromPos;
    close.lastIndex = fromPos;
    let depth = 1;
    while (depth > 0) {
        const o = open.exec(template);
        const c = close.exec(template);
        if (!c) return -1;
        if (o && o.index < c.index) {
            depth++;
            close.lastIndex = o.index + 1;
        } else {
            depth--;
            if (depth === 0) return c.index + c[0].length;
            open.lastIndex = c.index + 1;
        }
    }
    return -1;
}
