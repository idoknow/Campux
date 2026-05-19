<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useData } from "vitepress";
import type { Mermaid } from "mermaid";

const props = defineProps<{
  code: string;
}>();

let nextId = 0;
let mermaid: Mermaid | undefined;

const { isDark } = useData();
const container = ref<HTMLElement>();
const error = ref<string>();
const source = computed(() => decodeURIComponent(props.code));
const diagramId = `campux-mermaid-${nextId++}`;

async function renderDiagram() {
  if (!container.value) return;

  try {
    mermaid ??= (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark.value ? "dark" : "default",
    });

    const { svg } = await mermaid.render(diagramId, source.value);
    container.value.innerHTML = svg;
    error.value = undefined;
  } catch (err) {
    container.value.innerHTML = "";
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(renderDiagram);
watch([source, isDark], async () => {
  await nextTick();
  await renderDiagram();
});
</script>

<template>
  <div class="campux-mermaid" :class="{ 'has-error': error }">
    <div ref="container" class="campux-mermaid__diagram" />
    <pre v-if="error" class="campux-mermaid__error"><code>{{ source }}</code></pre>
  </div>
</template>
