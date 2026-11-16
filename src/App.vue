<script setup lang="ts">
import { Workflow } from 'lucide-vue-next'
import WorkflowCanvas from './components/WorkflowCanvas.vue'
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark"><Workflow :size="20" aria-hidden="true" /></span>
        <span>FlowArchitect</span>
        <span class="phase-badge">CANVAS LAB</span>
      </div>
      <span class="local-status"><span aria-hidden="true"></span>Local workspace</span>
    </header>
    <WorkflowCanvas />
  </main>
</template>
