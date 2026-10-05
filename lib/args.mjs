// Minimal --key value / --flag CLI parser. No deps.
// parseArgs(argv) → { _: [...positional], key: "value", flag: true }

export function parseArgs(argv = process.argv.slice(2)) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            out._.push(a);
            continue;
        }
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[key] = true;
        } else {
            out[key] = next;
            i++;
        }
    }
    return out;
}

export function requireArg(args, name, hint = '') {
    if (args[name] === undefined || args[name] === true) {
        console.error(`Missing required --${name}${hint ? ` (${hint})` : ''}`);
        process.exit(1);
    }
    return args[name];
}

export function csv(value, fallback = []) {
    if (!value || value === true) return fallback;
    return String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
