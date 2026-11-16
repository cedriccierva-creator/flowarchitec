<script setup lang="ts">
import { ref } from 'vue'
import { Workflow } from 'lucide-vue-next'
import WorkflowCanvas from './components/WorkflowCanvas.vue'

const presenting = ref(false)
</script>

<template>
  <main class="app-shell">
    <header v-if="!presenting" class="app-header">
      <div class="brand">
        <span class="brand-mark"><Workflow :size="20" aria-hidden="true" /></span>
        <span>FlowArchitect</span>
        <span class="phase-badge">CANVAS LAB</span>
      </div>
      <span class="local-status"><span aria-hidden="true"></span>Local workspace</span>
    </header>
    <WorkflowCanvas v-model:presenting="presenting" />
  </main>
</template>
