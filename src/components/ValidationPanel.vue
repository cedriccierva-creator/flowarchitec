<script setup lang="ts">
import { computed } from 'vue'
import type { ArchitectureFinding } from '../data/architectureValidation'
const props = defineProps<{ findings: readonly ArchitectureFinding[]; blocked: boolean; empty: boolean }>()
const emit = defineEmits<{ focus: [finding: ArchitectureFinding]; close: [] }>()
const warnings = computed(() => props.findings.filter(({ severity }) => severity === 'warning').length)
</script>

<template>
  <section id="architecture-validation" class="validation-panel" aria-label="Architecture validation">
    <header class="editor-heading">
      <h2>Architecture validation</h2>
      <button class="reset-button" type="button" aria-label="Close validation" @click="emit('close')">Close</button>
    </header>
    <p role="status">{{ warnings }} warnings · {{ findings.length - warnings }} documentation suggestions</p>
    <p>Offline checks of committed graph and notes. These advisory findings do not verify runtime behavior or interpret documentation.</p>
    <p v-if="empty">This workflow has no nodes. Add nodes to validate its architecture.</p>
    <p v-else-if="!findings.length">No findings from the available checks.</p>
    <ul v-if="findings.length" class="validation-findings">
      <li v-for="finding in findings" :key="finding.id" :data-rule="finding.rule" :data-target="finding.target.id">
        <button type="button" :disabled="blocked" @click="emit('focus', finding)">
          <strong>{{ finding.severity === 'warning' ? 'Warning' : 'Info' }}: {{ finding.title }}</strong>
          <span>{{ finding.evidence }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
