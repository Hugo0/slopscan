import { describe, it, expect } from 'vitest';
import {
    cosine, norm, precomputeNorms, pairwiseSimilarities,
    clusterByConnectedComponents,
} from '../lib/similarity.mjs';

describe('cosine', () => {
    it('returns 1 for identical vectors', () => {
        const v = [1, 2, 3];
        const n = norm(v);
        expect(cosine(v, v, n, n)).toBeCloseTo(1.0, 5);
    });
    it('returns 0 for orthogonal vectors', () => {
        const a = [1, 0, 0], b = [0, 1, 0];
        expect(cosine(a, b, norm(a), norm(b))).toBeCloseTo(0.0, 5);
    });
});

describe('pairwiseSimilarities', () => {
    it('only emits pairs above threshold', () => {
        const items = [{ file: 'a' }, { file: 'b' }, { file: 'c' }];
        const vectors = [[1, 0, 0], [1, 0, 0], [0, 1, 0]];
        const pairs = pairwiseSimilarities({ items, vectors, threshold: 0.9 });
        expect(pairs.length).toBe(1);
        expect(pairs[0].sim).toBeCloseTo(1.0, 4);
    });
    it('skips same-file pairs via sameKeyFn', () => {
        const items = [{ file: 'a' }, { file: 'a' }];
        const vectors = [[1, 0], [1, 0]];
        const pairs = pairwiseSimilarities({
            items, vectors, threshold: 0.5,
            sameKeyFn: (x, y) => x.file === y.file,
        });
        expect(pairs.length).toBe(0);
    });
});

describe('clusterByConnectedComponents', () => {
    it('joins transitively similar items', () => {
        // 0—1, 1—2, 3 alone → cluster {0,1,2}, {3} not in cluster (no pair)
        const pairs = [{ i: 0, j: 1, sim: 0.9 }, { i: 1, j: 2, sim: 0.85 }];
        const clusters = clusterByConnectedComponents({ pairs, itemCount: 4 });
        expect(clusters.length).toBe(1);
        expect(clusters[0].size).toBe(3);
    });
    it('flags oversized clusters', () => {
        const pairs = [
            { i: 0, j: 1, sim: 0.9 }, { i: 1, j: 2, sim: 0.9 },
            { i: 2, j: 3, sim: 0.9 }, { i: 3, j: 4, sim: 0.9 },
        ];
        const clusters = clusterByConnectedComponents({ pairs, itemCount: 5, maxClusterSize: 3 });
        expect(clusters[0].oversized).toBe(true);
    });
    it('does not flag if under maxClusterSize', () => {
        const pairs = [{ i: 0, j: 1, sim: 0.9 }];
        const clusters = clusterByConnectedComponents({ pairs, itemCount: 2, maxClusterSize: 5 });
        expect(clusters[0].oversized).toBe(false);
    });
});
