// OpenAI-compatible embeddings client with disk cache.
// Works with OpenAI, OpenRouter, or any endpoint that implements
// POST {baseUrl}/embeddings. Cache is sha256(model + '\0' + text) → vector
// JSON, one file per chunk, so re-runs against unchanged code are free.
//
// Configuration (process env wins over env files):
//   OPENAI_API_KEY            → https://api.openai.com/v1, text-embedding-3-small
//   OPENROUTER_API_KEY        → https://openrouter.ai/api/v1, openai/text-embedding-3-small
//   SLOPSCAN_EMBED_BASE_URL   override the endpoint
//   SLOPSCAN_EMBED_MODEL      override the model
// Env files: any passed via --env-file, then ~/.config/slopscan/.env.

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_BATCH = 50;
const KEYS = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'SLOPSCAN_EMBED_BASE_URL', 'SLOPSCAN_EMBED_MODEL'];

export function defaultEnvFiles() {
    const home = homedir();
    return home ? [join(home, '.config', 'slopscan', '.env')] : [];
}

// Read only the keys slopscan cares about from dotenv-style files.
function readEnvFiles(files) {
    const out = {};
    for (const f of files) {
        if (!f || !existsSync(f)) continue;
        let text;
        try {
            text = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        for (const line of text.split('\n')) {
            const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!m || !KEYS.includes(m[1]) || out[m[1]]) continue;
            const v = m[2].replace(/^["']|["']$/g, '').trim();
            if (v) out[m[1]] = v;
        }
    }
    return out;
}

// Resolve { apiKey, baseUrl, model, provider } or null when no key is configured.
// Never logs the key.
export function resolveEmbeddingConfig({ envFiles = [], env = process.env } = {}) {
    const fromFiles = readEnvFiles([...envFiles, ...defaultEnvFiles()]);
    const get = (k) => (env[k] && String(env[k]).trim()) || fromFiles[k] || null;
    const openaiKey = get('OPENAI_API_KEY');
    const openrouterKey = get('OPENROUTER_API_KEY');
    const baseOverride = get('SLOPSCAN_EMBED_BASE_URL');
    const modelOverride = get('SLOPSCAN_EMBED_MODEL');

    let apiKey, baseUrl, model, provider;
    const wantsOpenRouter = baseOverride ? /openrouter\.ai/.test(baseOverride) : !openaiKey;
    if (wantsOpenRouter && openrouterKey) {
        apiKey = openrouterKey;
        baseUrl = baseOverride || OPENROUTER_BASE;
        model = modelOverride || 'openai/text-embedding-3-small';
        provider = 'openrouter';
    } else if (openaiKey) {
        apiKey = openaiKey;
        baseUrl = baseOverride || OPENAI_BASE;
        model = modelOverride || 'text-embedding-3-small';
        provider = baseOverride ? 'custom' : 'openai';
    } else if (openrouterKey) {
        apiKey = openrouterKey;
        baseUrl = baseOverride || OPENROUTER_BASE;
        model = modelOverride || 'openai/text-embedding-3-small';
        provider = 'openrouter';
    } else {
        return null;
    }
    return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model, provider };
}

function cacheKey(model, text) {
    return createHash('sha256').update(model).update('\0').update(text).digest('hex');
}

function readCache(cacheDir, key) {
    if (!cacheDir) return null;
    const f = join(cacheDir, `${key}.json`);
    if (!existsSync(f)) return null;
    try {
        return JSON.parse(readFileSync(f, 'utf-8'));
    } catch {
        return null;
    }
}

function writeCache(cacheDir, key, vector) {
    if (!cacheDir) return;
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${key}.json`), JSON.stringify(vector));
}

async function callEmbeddings(baseUrl, apiKey, model, inputs) {
    const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: inputs }),
    });
    if (!res.ok) {
        const text = (await res.text()).slice(0, 500);
        throw new Error(`embeddings ${res.status} from ${baseUrl}: ${text}`);
    }
    const data = await res.json();
    if (!Array.isArray(data?.data)) throw new Error(`embeddings: unexpected response from ${baseUrl}`);
    return [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
}

// Embed a list of texts. Returns array of vectors aligned with input.
// Uses cache for unchanged inputs; only sends new ones to the API.
//
// onProgress({ done, total, fromCache, cost }) called per batch.
export async function embedTexts(
    texts,
    {
        apiKey,
        baseUrl = OPENAI_BASE,
        model = 'text-embedding-3-small',
        batchSize = DEFAULT_BATCH,
        cacheDir = null,
        onProgress = () => {},
    } = {},
) {
    if (!apiKey) throw new Error('embedTexts: apiKey required');
    const out = new Array(texts.length);
    const todo = []; // indices needing API call

    // 1. Cache lookup
    let fromCache = 0;
    for (let i = 0; i < texts.length; i++) {
        const k = cacheKey(model, texts[i]);
        const v = readCache(cacheDir, k);
        if (v) {
            out[i] = v;
            fromCache++;
        } else {
            todo.push(i);
        }
    }

    // 2. Batch the misses
    let done = fromCache;
    let estTokens = 0;
    onProgress({ done, total: texts.length, fromCache });

    for (let b = 0; b < todo.length; b += batchSize) {
        const slice = todo.slice(b, b + batchSize);
        const batchTexts = slice.map((i) => texts[i]);
        const vectors = await callEmbeddings(baseUrl, apiKey, model, batchTexts);
        for (let j = 0; j < slice.length; j++) {
            const i = slice[j];
            out[i] = vectors[j];
            const k = cacheKey(model, texts[i]);
            writeCache(cacheDir, k, vectors[j]);
        }
        estTokens += batchTexts.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
        done += slice.length;
        onProgress({ done, total: texts.length, fromCache, estTokens });
    }

    return { vectors: out, fromCache, estTokens, model };
}
