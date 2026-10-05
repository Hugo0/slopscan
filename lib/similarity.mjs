// Cosine similarity + clustering primitives for embedding vectors.

export function norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
}

export function cosine(a, b, na, nb) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s / (na * nb);
}

export function precomputeNorms(vectors) {
    return vectors.map(norm);
}

// Pairwise: O(N²). Returns pairs above threshold, sorted desc.
//   items: [{ ...meta }]
//   vectors: aligned vectors
//   threshold: cosine cutoff
//   sameKeyFn(a, b): if returns true, skip the pair (e.g. same file)
export function pairwiseSimilarities({
    items,
    vectors,
    threshold = 0.8,
    sameKeyFn = null,
    onProgress = () => {},
}) {
    const norms = precomputeNorms(vectors);
    const pairs = [];
    const N = items.length;
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            if (sameKeyFn && sameKeyFn(items[i], items[j])) continue;
            const sim = cosine(vectors[i], vectors[j], norms[i], norms[j]);
            if (sim >= threshold) pairs.push({ i, j, sim });
        }
        if (i % 100 === 0) onProgress({ done: i, total: N });
    }
    pairs.sort((a, b) => b.sim - a.sim);
    return pairs;
}

// Cross-set: O(N*M). For comparing two disjoint sets (e.g. UI ↔ API).
export function crossSimilarities({ aItems, aVectors, bItems, bVectors, threshold = 0.7 }) {
    const aN = precomputeNorms(aVectors);
    const bN = precomputeNorms(bVectors);
    const pairs = [];
    for (let i = 0; i < aItems.length; i++) {
        for (let j = 0; j < bItems.length; j++) {
            const sim = cosine(aVectors[i], bVectors[j], aN[i], bN[j]);
            if (sim >= threshold) pairs.push({ i, j, sim });
        }
    }
    pairs.sort((a, b) => b.sim - a.sim);
    return pairs;
}

// Connected-components clustering on the pair graph.
// Items in the same cluster are transitively similar above the pair threshold.
// Returns clusters: [{ members: [itemIdx...], avgSim, maxSim, size }]
//
// opts.maxClusterSize: cap. Clusters that exceed it are flagged with
//   { oversized: true } so the caller can de-emphasize / split them. The
//   pathology this guards: low thresholds + dense graphs let one giant blob
//   form via transitive edges, drowning real signal.
export function clusterByConnectedComponents({ pairs, itemCount, maxClusterSize = null }) {
    const parent = Array.from({ length: itemCount }, (_, i) => i);
    const rank = new Array(itemCount).fill(0);

    const find = (x) => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (a, b) => {
        const ra = find(a),
            rb = find(b);
        if (ra === rb) return;
        if (rank[ra] < rank[rb]) parent[ra] = rb;
        else if (rank[ra] > rank[rb]) parent[rb] = ra;
        else {
            parent[rb] = ra;
            rank[ra]++;
        }
    };

    for (const { i, j } of pairs) union(i, j);

    const groups = new Map(); // root → { members, sims }
    for (const { i, j, sim } of pairs) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, { members: new Set(), sims: [] });
        const g = groups.get(r);
        g.members.add(i);
        g.members.add(j);
        g.sims.push(sim);
    }

    const clusters = [];
    for (const [, g] of groups) {
        const sims = g.sims;
        const avgSim = sims.reduce((s, x) => s + x, 0) / sims.length;
        const maxSim = Math.max(...sims);
        const size = g.members.size;
        clusters.push({
            members: [...g.members],
            avgSim,
            maxSim,
            size,
            pairCount: sims.length,
            oversized: maxClusterSize !== null && size > maxClusterSize,
        });
    }
    clusters.sort((a, b) => b.size - a.size || b.avgSim - a.avgSim);
    return clusters;
}
