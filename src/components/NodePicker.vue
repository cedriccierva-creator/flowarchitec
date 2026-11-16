<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { nodeCatalog, nodeIcons } from '../data/nodeCatalog'
import type { NodeKind } from '../data/nodeCatalog'

const emit = defineEmits<{ add: [kind: NodeKind]; close: [] }>()
const query = ref('')
const search = ref<HTMLInputElement>()
const options = ref<HTMLUListElement>()
const activeIndex = ref(0)
const kinds = Object.keys(nodeCatalog) as NodeKind[]
const matches = computed(() => {
  const term = query.value.trim().toLowerCase()
  return kinds.filter((kind) => {
    const { label, caption } = nodeCatalog[kind]
    return `${label} ${caption}`.toLowerCase().includes(term)
  })
})
const activeKind = computed(() => matches.value[activeIndex.value])
const optionId = (kind: NodeKind) => `node-option-${kind}`

watch(query, () => {
  activeIndex.value = 0
  if (options.value) options.value.scrollTop = 0
})

function focusSearch() {
  search.value?.focus({ preventScroll: true })
}

onMounted(focusSearch)
defineExpose({ focusSearch })

async function onSearchKey(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  if (event.key === 'Enter') {
    event.preventDefault()
    if (activeKind.value && !event.repeat) emit('add', activeKind.value)
    return
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const count = matches.value.length
  if (!count) return
  const direction = event.key === 'ArrowDown' ? 1 : -1
  activeIndex.value = (activeIndex.value + direction + count) % count
  await nextTick()
  options.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
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
    <div class="node-search">
      <Search :size="15" aria-hidden="true" />
      <input
        ref="search" v-model="query" type="search" role="combobox" aria-label="Search node types"
        aria-controls="node-options" aria-autocomplete="list" :aria-expanded="matches.length > 0"
        :aria-activedescendant="activeKind ? optionId(activeKind) : undefined"
        autocomplete="off" placeholder="Search nodes…" @keydown="onSearchKey"
      />
    </div>
    <ul v-show="matches.length" id="node-options" ref="options" class="node-options" role="listbox" aria-label="Node types">
      <li
        v-for="kind in matches" :id="optionId(kind)" :key="kind" role="option"
        :aria-selected="kind === activeKind" @click="emit('add', kind)"
      >
        <component :is="nodeIcons[kind].icon" :size="17" aria-hidden="true" />
        <span>{{ nodeCatalog[kind].label }}<small>{{ nodeCatalog[kind].caption }}</small></span>
      </li>
    </ul>
    <p v-if="!matches.length" class="editor-hint" role="status">No matching nodes. Try a different name.</p>
  </section>
</template>
