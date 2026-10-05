// AST-based chunk extractor using ts-morph (TypeScript Compiler API).
//
// Compared to extract-exports.mjs (regex-based):
//  - Real method names everywhere (no more `<anon method-7>`)
//  - Handles arrow functions assigned to const, methods inside classes, methods
//    inside object literals, computed property names, generator/async fns.
//  - Accurate body slicing — sub-chunks are sub-trees, not brace-counted.
//  - Knows imports (used by import-graph analyzer).
//
// Vue: callers strip <script> blocks via preprocessors/vue.mjs first, then pass
// the resulting TS to extractAst.
//
// Returns chunks: { name, kind, line, body, bodyLen, normalized, parent? }
// Kinds: function | const | class | method | arrow | composable | jsx-component

import { createRequire } from 'module';
import { normalize } from './extract-exports.mjs';
import { preprocess, defaultPreprocessors } from './preprocessors/index.mjs';
import { createCache, sha256 } from './core/cache.mjs';

const require = createRequire(import.meta.url);
const { Project, ScriptKind, SyntaxKind } = require('ts-morph');

const projectCache = new Map();

// Disk cache for extraction results. Key is sha256(filepath ext + raw source).
// Hit: skip ts-morph entirely, just return the chunk array.
let astDiskCache = null;
export function setAstCacheDir(dir) {
    astDiskCache = dir ? createCache(dir) : null;
}

function getProject(extension) {
    if (projectCache.has(extension)) return projectCache.get(extension);
    const p = new Project({
        useInMemoryFileSystem: true,
        skipFileDependencyResolution: true,
        compilerOptions: { allowJs: true, jsx: 4 /* React */ },
    });
    projectCache.set(extension, p);
    return p;
}

function scriptKindFor(filepath) {
    if (filepath.endsWith('.tsx')) return ScriptKind.TSX;
    if (filepath.endsWith('.jsx')) return ScriptKind.JSX;
    if (filepath.endsWith('.js')) return ScriptKind.JS;
    return ScriptKind.TS;
}

// Main entry. opts.preprocessors lets you override the registry; defaults
// strip Vue SFC wrappers.
export function extractAst(code, filepath, opts = {}) {
    const {
        preprocessors = defaultPreprocessors,
        minBodyLen = 60,
        maxBodyChars = 4000,
    } = opts;

    // Disk cache lookup: skip ts-morph entirely if we've extracted this
    // exact file content + same parse parameters before.
    const cacheKey = astDiskCache
        ? sha256('extract-ast-v1', extOf(filepath), String(minBodyLen), String(maxBodyChars), code)
        : null;
    if (astDiskCache && cacheKey) {
        const cached = astDiskCache.get(cacheKey);
        if (cached) return cached;
    }

    const src = preprocess(code, filepath, preprocessors);
    if (!src.trim()) {
        if (astDiskCache && cacheKey) astDiskCache.set(cacheKey, []);
        return [];
    }

    const project = getProject(scriptKindFor(filepath));
    const fakePath = `/_in_/${Date.now()}_${Math.random()}.${extOf(filepath)}`;
    let sourceFile;
    try {
        sourceFile = project.createSourceFile(fakePath, src, {
            overwrite: true,
            scriptKind: scriptKindFor(filepath),
        });
    } catch {
        return [];
    }

    const items = [];

    // Top-level declarations
    for (const stmt of sourceFile.getStatements()) {
        collectFromNode(stmt, items, { src, minBodyLen, maxBodyChars });
    }

    // Always remove the source file when done so the in-memory project doesn't bloat
    project.removeSourceFile(sourceFile);

    if (astDiskCache && cacheKey) astDiskCache.set(cacheKey, items);
    return items;
}

function extOf(filepath) {
    const dot = filepath.lastIndexOf('.');
    if (dot === -1) return 'ts';
    const e = filepath.slice(dot + 1);
    return e === 'vue' ? 'ts' : e;
}

function collectFromNode(node, out, ctx, parentName = null) {
    const kind = node.getKind();

    // Variable statements: export const X = ... | const X = ...
    if (kind === SyntaxKind.VariableStatement) {
        const isExported = nodeIsExported(node);
        for (const decl of node.getDeclarationList().getDeclarations()) {
            const name = decl.getName?.();
            if (!name) continue;
            const init = decl.getInitializer?.();
            const declKind = arrowOrClassExpr(init)
                ? init.getKind() === SyntaxKind.ArrowFunction
                    ? 'arrow'
                    : init.getKind() === SyntaxKind.FunctionExpression
                        ? 'function'
                        : 'class'
                : 'const';
            pushChunk(out, ctx, {
                name,
                kind: classifyName(name, declKind, isExported, init),
                node: decl,
                parent: parentName,
            });
            // Recurse into init for nested arrow/function (e.g. memoized handlers)
            if (init) recurseInto(init, out, ctx, name);
        }
        return;
    }

    if (kind === SyntaxKind.FunctionDeclaration) {
        const name = node.getName?.() || null;
        if (name) {
            const isExported = nodeIsExported(node);
            pushChunk(out, ctx, {
                name,
                kind: classifyName(name, 'function', isExported, node),
                node,
                parent: parentName,
            });
            recurseInto(node, out, ctx, name);
        }
        return;
    }

    if (kind === SyntaxKind.ClassDeclaration) {
        const name = node.getName?.() || '<anon-class>';
        pushChunk(out, ctx, { name, kind: 'class', node, parent: parentName });
        for (const method of node.getMethods?.() || []) {
            const mname = method.getName();
            const fullName = `${name}.${mname}`;
            pushChunk(out, ctx, {
                name: fullName,
                kind: 'method',
                node: method,
                parent: name,
            });
            recurseInto(method, out, ctx, fullName);
        }
        return;
    }

    // Export assignment / re-export — skip
    if (kind === SyntaxKind.ExportDeclaration || kind === SyntaxKind.ImportDeclaration) {
        return;
    }
}

function recurseInto(node, out, ctx, parentName) {
    // Walk descendants for nested fn/arrow/method declarations.
    node.forEachDescendant((child) => {
        const k = child.getKind();
        if (k === SyntaxKind.FunctionDeclaration) {
            const name = child.getName?.();
            if (name) pushChunk(out, ctx, { name: `${parentName}>${name}`, kind: 'function', node: child, parent: parentName });
        } else if (k === SyntaxKind.ArrowFunction || k === SyntaxKind.FunctionExpression) {
            // only emit if assigned to a name (var decl or property assignment)
            const parent = child.getParent?.();
            if (!parent) return;
            const pk = parent.getKind();
            let name = null;
            if (pk === SyntaxKind.VariableDeclaration) name = parent.getName?.();
            else if (pk === SyntaxKind.PropertyAssignment) name = parent.getName?.();
            if (name && name !== parentName) {
                pushChunk(out, ctx, {
                    name: `${parentName}>${name}`,
                    kind: 'arrow',
                    node: child,
                    parent: parentName,
                });
            }
        }
    });
}

function pushChunk(out, ctx, { name, kind, node, parent }) {
    const text = node.getText?.();
    if (!text) return;
    const sliced = text.slice(0, ctx.maxBodyChars);
    if (sliced.length < ctx.minBodyLen) return;
    const line = node.getStartLineNumber?.() ?? 1;
    out.push({
        name,
        kind,
        line,
        body: sliced,
        bodyLen: sliced.length,
        normalized: normalize(sliced),
        parent: parent || null,
    });
}

function classifyName(name, baseKind, isExported, valueNode) {
    if (/^use[A-Z]/.test(name)) return 'composable';
    if (isExported && baseKind === 'function' && /^[A-Z]/.test(name) && returnsJsx(valueNode))
        return 'jsx-component';
    if (isExported && baseKind === 'arrow' && /^[A-Z]/.test(name) && returnsJsx(valueNode))
        return 'jsx-component';
    if (isExported && baseKind === 'function') return 'function';
    if (isExported && baseKind === 'arrow') return 'arrow';
    if (isExported && baseKind === 'class') return 'class';
    if (baseKind === 'function') return 'function-local';
    if (baseKind === 'arrow') return 'arrow-local';
    return baseKind;
}

function arrowOrClassExpr(node) {
    if (!node) return false;
    const k = node.getKind?.();
    return (
        k === SyntaxKind.ArrowFunction ||
        k === SyntaxKind.FunctionExpression ||
        k === SyntaxKind.ClassExpression
    );
}

function nodeIsExported(node) {
    try {
        return !!node.getModifiers?.()?.some?.((m) => m.getText() === 'export');
    } catch {
        return false;
    }
}

function returnsJsx(node) {
    if (!node) return false;
    let found = false;
    try {
        node.forEachDescendant((d) => {
            if (found) return;
            const k = d.getKind();
            if (k === SyntaxKind.JsxElement || k === SyntaxKind.JsxSelfClosingElement || k === SyntaxKind.JsxFragment) {
                found = true;
            }
        });
    } catch {}
    return found;
}

// Backward-compat: filter that drops jsx-component kind.
export function defaultAstFilter(chunk) {
    if (chunk.bodyLen < 80) return false;
    if (chunk.kind === 'jsx-component') return false;
    return true;
}

export function jsxAwareAstFilter(chunk) {
    if (chunk.bodyLen < 80) return false;
    if (chunk.kind === 'jsx-component') return false;
    return true;
}
