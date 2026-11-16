<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { nodeCatalog, nodeIcons } from '../data/nodeCatalog'
import type { NodeKind } from '../data/nodeCatalog'

const emit = defineEmits<{ add: [kind: NodeKind]; close: [] }>()
const query = ref('')
const search = ref<HTMLInputElement>()
const kinds = Object.keys(nodeCatalog) as NodeKind[]
const matches = computed(() => {
  const term = query.value.trim().toLowerCase()
  return kinds.filter((kind) => {
    const { label, caption } = nodeCatalog[kind]
    return `${label} ${caption}`.toLowerCase().includes(term)
  })
})

onMounted(() => search.value?.focus())

function addFirst() {
  const kind = matches.value[0]
  if (kind) emit('add', kind)
}
</script>

<template>
  <section id="node-picker" class="editor-popover node-picker nokey" role="dialog" aria-label="Add Node">
    <header class="editor-heading">
      <h2>Add Node</h2>
      <button class="editor-close" type="button" aria-label="Close node picker" @click="emit('close')">
        <X :size="15" aria-hidden="true" />
      </button>
    </header>
    <form class="node-search" @submit.prevent="addFirst">
      <Search :size="15" aria-hidden="true" />
      <input ref="search" v-model="query" type="search" aria-label="Search node types" placeholder="Search nodes…" />
    </form>
    <ul v-if="matches.length" class="node-options">
      <li v-for="kind in matches" :key="kind">
        <button type="button" @click="emit('add', kind)">
          <component :is="nodeIcons[kind].icon" :size="17" aria-hidden="true" />
          <span>{{ nodeCatalog[kind].label }}<small>{{ nodeCatalog[kind].caption }}</small></span>
        </button>
      </li>
    </ul>
    <p v-else class="editor-hint" role="status">No matching nodes.</p>
  </section>
</template>
