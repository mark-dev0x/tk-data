<template>
  <div>
    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center p-8">
      <div class="flex items-center space-x-2">
        <svg class="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <span class="text-gray-600">{{ loadingText }}</span>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center p-8">
      <div class="text-center">
        <svg
          class="w-12 h-12 mx-auto text-red-500 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to Load Component</h3>
        <p class="text-gray-600 mb-4">
          {{ error.message || 'An error occurred while loading the component.' }}
        </p>
        <button
          @click="retry"
          class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors duration-200"
        >
          Try Again
        </button>
      </div>
    </div>

    <!-- Component Content -->
    <component v-else :is="resolvedComponent" v-bind="$attrs" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { Component } from 'vue'

interface Props {
  component: () => Promise<{ default: Component }>
  loadingText?: string
}

const props = withDefaults(defineProps<Props>(), {
  loadingText: 'Loading...',
})

const loading = ref(true)
const error = ref<Error | null>(null)
const resolvedComponent = ref<Component | null>(null)

const loadComponent = async () => {
  try {
    loading.value = true
    error.value = null
    const module = await props.component()
    resolvedComponent.value = module.default || module
  } catch (err) {
    error.value = err as Error
    console.error('Failed to load component:', err)
  } finally {
    loading.value = false
  }
}

const retry = () => {
  loadComponent()
}

onMounted(() => {
  loadComponent()
})

// Watch for component changes
watch(
  () => props.component,
  () => {
    loadComponent()
  },
)
</script>
