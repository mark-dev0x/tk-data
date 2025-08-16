/**
 * Utility functions for dynamic imports with better error handling
 */

export interface LazyImportOptions {
  loadingDelay?: number
  retryAttempts?: number
  retryDelay?: number
}

import { defineAsyncComponent } from 'vue'

import type { Component } from 'vue'

/**
 * Creates a lazy-loaded component with retry logic
 */
export function createLazyComponent(
  importFn: () => Promise<{ default: Component }>,
  options: LazyImportOptions = {},
) {
  const { loadingDelay = 200, retryAttempts = 3, retryDelay = 1000 } = options

  return defineAsyncComponent({
    loader: importFn,
    delay: loadingDelay,
    timeout: 10000, // 10 second timeout
    onError(_error, retry, fail, attempts) {
      if (attempts <= retryAttempts) {
        // Retry after delay
        setTimeout(() => {
          retry()
        }, retryDelay)
      } else {
        // Max retries reached
        fail()
      }
    },
  })
}

/**
 * Preload a component for better performance
 */
export function preloadComponent(importFn: () => Promise<{ default: Component }>): void {
  // Start loading in the background
  importFn().catch(() => {
    // Silently fail preloading
  })
}

/**
 * Preload multiple components
 */
export function preloadComponents(importFns: (() => Promise<{ default: Component }>)[]): void {
  importFns.forEach(preloadComponent)
}

/**
 * Route-based preloading
 */
export const preloadRoutes = {
  login: () => import('../views/LoginPage.vue'),
  dashboard: () => import('../views/DashboardPage.vue'),
}

/**
 * Component-based preloading
 */
export const preloadComponentMap = {
  pieChart: () => import('../components/PieChart.vue'),
  barChart: () => import('../components/BarChart.vue'),
}

/**
 * Preload all routes when app starts
 */
export function preloadAllRoutes(): void {
  Object.values(preloadRoutes).forEach(preloadComponent)
}

/**
 * Preload all components when app starts
 */
export function preloadAllComponents(): void {
  Object.values(preloadComponentMap).forEach(preloadComponent)
}
