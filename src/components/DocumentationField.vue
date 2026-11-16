<script setup lang="ts">
import { documentationLimit, readDocumentationText } from '../data/workflowDocument'

const props = defineProps<{ label: string; placeholder: string; value?: string }>()
const emit = defineEmits<{ commit: [value: string | undefined] }>()

function commit(event: FocusEvent) {
  const field = event.target as HTMLTextAreaElement
  // Match the limit even if the browser's input method bypasses maxlength.
  const value = readDocumentationText(field.value.slice(0, documentationLimit))
  if ((value ?? '') !== field.value) field.value = value ?? ''
  if (value !== props.value) emit('commit', value)
}

function cancel(event: KeyboardEvent) {
  if (event.isComposing) return
  const field = event.target as HTMLTextAreaElement
  field.value = props.value ?? ''
  event.preventDefault()
}
</script>

<template>
  <label class="editor-field editor-documentation-field">
    {{ label }}
    <textarea
      :value="value ?? ''" :placeholder="placeholder" :maxlength="documentationLimit" rows="3"
      @blur="commit" @keydown.esc="cancel"
    ></textarea>
  </label>
</template>
