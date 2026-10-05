// Semantic duplication analyzer plugin. Wraps existing extract+embed+cluster.
// Emits one Finding per cluster, attached to each member file.

import { readFileSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { extractExports } from '../extract-exports.mjs';
import { extractAst, setAstCacheDir } from '../extract-ast.mjs';
import { sliceBlocks } from '../slice-blocks.mjs';
import { extractTemplates } from '../extract-templates.mjs';
import { defaultChunkFilter } from '../filters/default.mjs';
import { jsxAwareFilter } from '../filters/jsx-aware.mjs';
import { vueAwareFilter } from '../filters/vue-aware.mjs';
import { embedTexts, resolveEmbeddingConfig } from '../embed-openai.mjs';
import {
    pairwiseSimilarities,
    clusterByConnectedComponents,
} from '../similarity.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'semantic-dup';

const FILTERS = {
    default: defaultChunkFilter,
    'jsx-aware': jsxAwareFilter,
    'vue-aware': vueAwareFilter,
};

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const {
        threshold = 0.82,
        minBodyLen = 80,
        sliceLarge = true,
        includeTemplates = true,
        templateSplitDepth = 0,
        filter = 'default',
        useAst = false,
        maxClusterSize = 50,
        cacheDir = null,
        envFiles = [],
    } = cfg;

    const filterFn = FILTERS[filter] || defaultChunkFilter;

    // AST cache lives next to the embeddings cache (different subdir)
    if (cacheDir && useAst) {
        const path = cacheDir.replace(/\/embeddings\/?$/, '') + '/ast';
        setAstCacheDir(path);
    }

    // Soft-skip when no embeddings key is configured — return zero findings +
    // a `skipped` stat the dashboard surfaces as a banner.
    const embed = cfg.disabled ? null : resolveEmbeddingConfig({ envFiles });
    if (!embed) {
        const reason = cfg.disabled
            ? 'semantic-dup disabled (--no-semantic).'
            : 'No OPENAI_API_KEY or OPENROUTER_API_KEY set — semantic-dup needs an embeddings key (~$0.02 per cold run, cached after).';
        onProgress({ message: 'skipped — ' + reason });
        return {
            findings: [],
            rawSignals: new Map(),
            stats: { chunks: 0, skipped: true, skippedReason: reason },
        };
    }
    const { apiKey, baseUrl, model } = embed;

    // 1. Walk + extract chunks
    const files = walkSourceFiles(walk);
    const chunks = [];
    let parsed = 0;
    for (const f of files) {
        parsed++;
        if (parsed % 50 === 0) onProgress({ message: `parsing ${parsed}/${files.length}` });
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const rel = relative(root, f);
        const exported = useAst
            ? extractAst(code, f).filter(filterFn)
            : extractExports(code, f).filter(filterFn);
        for (const c of exported) {
            const tagged = { file: rel, ...c };
            chunks.push(tagged);
            // AST already emits nested decls; only slice for regex extractor.
            if (sliceLarge && !useAst) {
                for (const s of sliceBlocks(tagged)) {
                    if (filterFn(s)) chunks.push(s);
                }
            }
        }
        if (includeTemplates) {
            for (const t of extractTemplates(code, f, { splitDepth: templateSplitDepth })) {
                chunks.push({ file: rel, ...t });
            }
        }
    }

    if (!chunks.length) return { findings: [], rawSignals: new Map(), stats: { chunks: 0 } };

    // Min-body filter
    const filtered = chunks.filter((c) => (c.bodyLen ?? 0) >= minBodyLen);

    // 2. Embed
    onProgress({ message: `embedding ${filtered.length} chunks` });
    const texts = filtered.map(
        (c) => `// ${c.file}\n// ${c.kind} ${c.name}\n${c.normalized}`,
    );
    const result = await embedTexts(texts, {
        apiKey, baseUrl, model, cacheDir,
        onProgress: ({ done, total, fromCache }) =>
            onProgress({ message: `embed ${done}/${total} (cache ${fromCache})` }),
    });

    // 3. Pairwise + cluster
    onProgress({ message: 'clustering' });
    const pairs = pairwiseSimilarities({
        items: filtered,
        vectors: result.vectors,
        threshold,
        sameKeyFn: (a, b) => a.file === b.file,
    });
    const clusters = clusterByConnectedComponents({
        pairs,
        itemCount: filtered.length,
        maxClusterSize,
    });

    // 4. Emit findings — skip oversized clusters (super-cluster pathology)
    const findings = [];
    const dupCount = new Map();
    let skippedOversized = 0;
    for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        if (c.oversized) {
            skippedOversized++;
            continue;
        }
        const members = c.members
            .map((i) => filtered[i])
            .sort((a, b) => (b.bodyLen ?? 0) - (a.bodyLen ?? 0));
        const refs = members.map((m) => ({ file: m.file, line: m.line, name: m.name }));
        const sev = sevByCluster(c);
        for (const m of members) {
            findings.push(
                makeFinding({
                    kind: 'semantic-dup',
                    file: m.file,
                    line: m.line,
                    message: `Cluster #${ci + 1} (${c.size} members, avg sim ${c.avgSim.toFixed(3)}): ${m.name}`,
                    severity: sev,
                    score: c.size,
                    refs,
                    meta: {
                        cluster_id: ci + 1,
                        cluster_size: c.size,
                        avg_sim: c.avgSim,
                        max_sim: c.maxSim,
                        chunk_kind: m.kind,
                        chunk_name: m.name,
                    },
                }),
            );
            dupCount.set(m.file, (dupCount.get(m.file) ?? 0) + 1);
        }
    }

    // Raw signals: per-file count of dup-cluster memberships
    const rawSignals = new Map();
    for (const [file, count] of dupCount) {
        rawSignals.set(file, { semantic_dup: count });
    }

    return {
        findings,
        rawSignals,
        stats: {
            chunks: filtered.length,
            pairs: pairs.length,
            clusters: clusters.length,
            skipped_oversized: skippedOversized,
            from_cache: result.fromCache,
            provider: embed.provider,
            model,
            est_cost_usd:
                /text-embedding-3-small$/.test(model)
                    ? `$${((result.estTokens / 1_000_000) * 0.02).toFixed(4)}`
                    : 'unknown',
        },
    };
}

function sevByCluster(c) {
    if (c.size >= 6 && c.avgSim >= 0.85) return 'high';
    if (c.size >= 4) return 'medium';
    if (c.avgSim >= 0.95) return 'high';
    return 'low';
}
