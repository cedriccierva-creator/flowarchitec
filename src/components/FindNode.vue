<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'

const props = defineProps<{ nodes: readonly { id: string; label: string }[]; autofocus: boolean }>()
const emit = defineEmits<{ focus: [id: string]; close: [] }>()
const search = ref<HTMLInputElement>()
const options = ref<HTMLUListElement>()
const query = ref('')
const activeIndex = ref(0)

const matches = computed(() => {
  const term = query.value.trim().toLowerCase()
  const entries = props.nodes.filter(({ label }) => label.toLowerCase().includes(term))
  const totals = new Map<string, number>()
  for (const { label } of entries) {
    const key = label.toLowerCase()
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return entries.map(({ id, label }) => {
    const key = label.toLowerCase()
    const total = totals.get(key) ?? 1
    const index = (seen.get(key) ?? 0) + 1
    seen.set(key, index)
    return { id, label, duplicate: total > 1 ? `${index} of ${total}` : undefined }
  })
})
const active = computed(() => matches.value[activeIndex.value])
const optionId = (index: number) => `find-node-result-${index}`

watch(matches, () => {
  activeIndex.value = 0
  if (options.value) options.value.scrollTop = 0
})
onMounted(() => {
  if (props.autofocus) search.value?.focus({ preventScroll: true })
})

async function onSearchKey(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  if (event.key === 'Enter') {
    event.preventDefault()
    if (active.value && !event.repeat) emit('focus', active.value.id)
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
  <section id="find-node" class="editor-popover find-node" role="dialog" aria-label="Find node">
    <header class="editor-heading">
      <h2>Find node</h2>
      <button class="editor-close" type="button" aria-label="Close find" @click="emit('close')">
        <X :size="15" aria-hidden="true" />
      </button>
    </header>
    <div class="node-search">
      <Search :size="15" aria-hidden="true" />
      <input
        ref="search" v-model="query" type="search" role="combobox" aria-label="Search existing nodes"
        aria-controls="find-node-results" aria-autocomplete="list" :aria-expanded="matches.length > 0"
        :aria-activedescendant="active ? optionId(activeIndex) : undefined"
        autocomplete="off" placeholder="Search by label…" @keydown="onSearchKey"
      />
    </div>
    <ul v-show="matches.length" id="find-node-results" ref="options" class="node-options" role="listbox" aria-label="Matching nodes">
      <li
        v-for="({ id, label, duplicate }, index) in matches" :id="optionId(index)" :key="id" role="option"
        :aria-selected="index === activeIndex" @click="emit('focus', id)"
      >
        <span>{{ label }}<small v-if="duplicate">{{ duplicate }}</small></span>
      </li>
    </ul>
    <p v-if="!matches.length" class="editor-hint" role="status">{{ nodes.length ? 'No matching nodes.' : 'This workflow has no nodes.' }}</p>
  </section>
</template>
