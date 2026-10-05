// LLM-review post-processor: for the top-N painscore files, ask Claude to
// review the file in light of its breakdown + top findings, and emit
// structured recommendations as new findings (kind=llm-review).
//
// Cached by sha256(content + breakdown + system-prompt-version). Reruns are
// free for unchanged files. Single API call per file (system prompt is
// prompt-cached so the marginal cost per file is just the user message).
//
// Gated: requires ANTHROPIC_API_KEY. Behind the --llm-review flag in bin/slopscan.mjs.
//
// Default model: claude-sonnet-4-6 (capable, fast, cheap). Override via
// ANTHROPIC_LLM_REVIEW_MODEL.

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createHash } from 'crypto';

const SYSTEM_PROMPT_VERSION = 'v1';
const SYSTEM_PROMPT = `You are a senior software engineer reviewing a single file flagged as a painscore hot-spot by static analysis. The painscore is a weighted blend of cyclomatic complexity, churn (git commits), maintainability index, type quality, dead code, duplication, and other signals.

You will be given:
- The file path
- The dominant signals contributing to its painscore + their weights
- The top critical/high findings on this file
- The file content (possibly truncated to first 200 lines)

Return ONLY a JSON object with this exact shape:

{
  "summary": "1-2 sentence diagnosis — what's actually wrong here",
  "recommendations": [
    {
      "action": "concrete refactor in <=20 words (e.g., 'split handleSubmit into 3 helpers', 'extract the filter loop into useFilteredItems hook')",
      "why": "<=20 words explaining the benefit; reference the dominant signal it addresses",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Rules:
- 1-4 recommendations max. Don't pad.
- Be CONCRETE. Cite line numbers, function names, identifiers — NOT generic advice like "add comments".
- "high" priority means: this fix unblocks the worst signal. "low" means: nice-to-have polish.
- If the file is genuinely fine and the painscore is misleading, say so in the summary and emit an empty recommendations array.
- No markdown, no preamble, no commentary outside the JSON.
- The first character of your response must be \`{\`. The last must be \`}\`.`;

export async function runLlmReview({
    scorecard,
    doc,
    root,
    topN = 10,
    cacheDir,
    apiKey,
    model = process.env.ANTHROPIC_LLM_REVIEW_MODEL || 'claude-sonnet-4-6',
    onProgress = () => {},
}) {
    if (!apiKey) throw new Error('runLlmReview: apiKey required');
    if (!cacheDir) throw new Error('runLlmReview: cacheDir required');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    const findingsByFile = new Map();
    for (const f of doc.findings || []) {
        if (!findingsByFile.has(f.file)) findingsByFile.set(f.file, []);
        findingsByFile.get(f.file).push(f);
    }

    const top = (scorecard.files || []).slice(0, topN);
    const findings = [];
    const stats = { reviewed: 0, fromCache: 0, errors: 0, costUsd: 0 };

    for (let i = 0; i < top.length; i++) {
        const file = top[i];
        onProgress({ done: i, total: top.length, message: file.file });
        const absPath = resolve(root, file.file);
        if (!existsSync(absPath)) {
            stats.errors++;
            continue;
        }
        let content;
        try {
            content = readFileSync(absPath, 'utf-8');
        } catch {
            stats.errors++;
            continue;
        }
        // Truncate to first 200 lines + keep a tail-snippet
        const lines = content.split('\n');
        const truncated = lines.length > 200
            ? lines.slice(0, 200).join('\n') + `\n\n... (file has ${lines.length} lines total; ${lines.length - 200} more truncated)`
            : content;

        const topFindings = (findingsByFile.get(file.file) || [])
            .filter((x) => x.severity === 'critical' || x.severity === 'high')
            .slice(0, 6);

        const cacheKey = sha256(truncated + JSON.stringify(file.breakdown || {}) + SYSTEM_PROMPT_VERSION + model);
        const cachePath = join(cacheDir, `${cacheKey}.json`);

        let review;
        if (existsSync(cachePath)) {
            try {
                review = JSON.parse(readFileSync(cachePath, 'utf-8'));
                stats.fromCache++;
            } catch {
                review = null;
            }
        }

        if (!review) {
            try {
                const result = await callClaude({ apiKey, model, file, breakdown: file.breakdown, topFindings, fileContent: truncated });
                review = result.review;
                stats.costUsd += result.costUsd;
                writeFileSync(cachePath, JSON.stringify(review, null, 2));
            } catch (err) {
                onProgress({ done: i + 1, total: top.length, message: `error: ${err.message}` });
                stats.errors++;
                continue;
            }
        }

        stats.reviewed++;

        // Emit one finding per recommendation
        for (const rec of review.recommendations || []) {
            const sev = rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low';
            findings.push({
                kind: 'llm-review',
                file: file.file,
                line: null,
                severity: sev,
                score: file.painscore,
                message: `${rec.action} — ${rec.why}`,
                refs: null,
                meta: { summary: review.summary, priority: rec.priority, model },
            });
        }
        // Also emit the summary as info-severity
        if (review.summary && (!review.recommendations || review.recommendations.length === 0)) {
            findings.push({
                kind: 'llm-review',
                file: file.file,
                line: null,
                severity: 'info',
                score: file.painscore,
                message: review.summary,
                refs: null,
                meta: { summary: review.summary, model },
            });
        }
    }
    onProgress({ done: top.length, total: top.length });

    return {
        findings,
        stats: {
            ...stats,
            costUsd: round4(stats.costUsd),
        },
    };
}

async function callClaude({ apiKey, model, file, breakdown, topFindings, fileContent }) {
    const breakdownLines = Object.entries(breakdown || {})
        .map(([k, v]) => ({ k, c: v.contribution || 0 }))
        .filter((e) => e.c > 0.5)
        .sort((a, b) => b.c - a.c)
        .map((e) => `- ${e.k}: contribution=${e.c.toFixed(2)}`)
        .join('\n');
    const findingsLines = topFindings
        .map((f) => `- ${f.severity} ${f.kind}${f.line ? ` (L${f.line})` : ''}: ${f.message}`)
        .join('\n');

    const userMessage = [
        `File: ${file.file}`,
        `Painscore: ${file.painscore.toFixed(2)}`,
        '',
        'Dominant signals:',
        breakdownLines || '(none significant)',
        '',
        'Top findings:',
        findingsLines || '(none above high severity)',
        '',
        '--- file content ---',
        fileContent,
    ].join('\n');

    const body = {
        model,
        max_tokens: 1024,
        system: [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: [{ type: 'text', text: userMessage }] }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Claude API ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json.content?.[0]?.text || '';
    let review;
    try {
        // Strip any accidental fences
        const cleaned = text.trim().replace(/^```json\n?|^```\n?|```$/g, '').trim();
        review = JSON.parse(cleaned);
    } catch (err) {
        throw new Error(`Claude returned non-JSON (${err.message}): ${text.slice(0, 200)}`);
    }

    // Cost estimate (sonnet 4.6 prices, approximate)
    const costUsd = estimateCost({ usage: json.usage, model });
    return { review, costUsd };
}

// Approximate. Sonnet 4.6: $3/MTok input, $15/MTok output, $0.30/MTok cache reads, $3.75/MTok cache writes.
function estimateCost({ usage, model }) {
    if (!usage) return 0;
    const isHaiku = /haiku/i.test(model);
    const isOpus = /opus/i.test(model);
    const inRate = isOpus ? 15 : isHaiku ? 1 : 3;
    const outRate = isOpus ? 75 : isHaiku ? 5 : 15;
    const cacheReadRate = inRate * 0.1;
    const cacheWriteRate = inRate * 1.25;
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const cacheReadTok = usage.cache_read_input_tokens || 0;
    const cacheWriteTok = usage.cache_creation_input_tokens || 0;
    return (
        (inTok * inRate + outTok * outRate + cacheReadTok * cacheReadRate + cacheWriteTok * cacheWriteRate) / 1e6
    );
}

function sha256(s) {
    return createHash('sha256').update(s).digest('hex').slice(0, 32);
}
function round4(n) {
    return Math.round(n * 10000) / 10000;
}
