<script setup lang="ts">
import { documentationLimit, readDocumentationText } from '../data/workflowDocument'

const props = withDefaults(defineProps<{
  label: string
  placeholder: string
  value?: string
  limit?: number
  normalize?: (value: string) => string | undefined
  singleLine?: boolean
}>(), { limit: documentationLimit, normalize: readDocumentationText })
const emit = defineEmits<{ commit: [value: string | undefined] }>()

function commit(event: FocusEvent) {
  const field = event.target as HTMLInputElement | HTMLTextAreaElement
  // Match the limit even if the browser's input method bypasses maxlength.
  const value = props.normalize(field.value.slice(0, props.limit))
  if ((value ?? '') !== field.value) field.value = value ?? ''
  if (value !== props.value) emit('commit', value)
}

function cancel(event: KeyboardEvent) {
  if (event.isComposing) return
  const field = event.target as HTMLInputElement | HTMLTextAreaElement
  field.value = props.value ?? ''
  event.preventDefault()
}

function enter(event: KeyboardEvent) {
  if (props.singleLine && !event.isComposing) (event.target as HTMLInputElement).blur()
}
</script>

<template>
  <label class="editor-field editor-documentation-field">
    {{ label }}
    <component
      :is="singleLine ? 'input' : 'textarea'"
      :value="value ?? ''" :placeholder="placeholder" :maxlength="limit" :rows="singleLine ? undefined : 3"
      @blur="commit" @keydown.esc="cancel" @keydown.enter="enter"
    />
  </label>
</template>
