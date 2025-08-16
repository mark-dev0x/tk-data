import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { preloadAllRoutes, preloadAllComponents } from './utils/lazyImports'

const app = createApp(App)

app.use(router)

// Preload critical components and routes for better performance
if (import.meta.env.PROD) {
  // Only preload in production to avoid development overhead
  preloadAllRoutes()
  preloadAllComponents()
}

app.mount('#app')
