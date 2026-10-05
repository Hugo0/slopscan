// Vue-aware chunk filter.
//
// Drops top-level Vue `definePageMeta` / `defineProps` / `defineEmits` blocks
// (compile-time macros, not real logic) and the trivial wrappers that show up
// inside `<script setup>`. Otherwise behaves like the default filter.

const VUE_MACROS = ['definePageMeta', 'defineProps', 'defineEmits', 'defineModel', 'defineSlots', 'defineExpose'];

export function vueAwareFilter(chunk) {
    const b = chunk.body;
    if (b.startsWith('export type') || b.startsWith('export interface')) return false;
    if (chunk.bodyLen < 80) return false;

    if (VUE_MACROS.includes(chunk.name)) return false;
    // const x = defineProps(...) — chunk name is `x`, body opens with the macro
    if (VUE_MACROS.some((m) => new RegExp(`=\\s*${m}\\s*[<(]`).test(b))) return false;

    if (/return\s*\(/.test(b) && /<[A-Z]\w/.test(b)) return false;

    return true;
}
