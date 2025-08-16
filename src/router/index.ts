import { createRouter, createWebHistory } from 'vue-router'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '../services/firebase'
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'login',
      component: Login,
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: Dashboard,
      meta: { requiresAuth: true },
    },
  ],
})

// Authentication guard
router.beforeEach((to, _from, next) => {
  const checkAuthAndNavigate = (user: User | null) => {
    if (to.meta.requiresAuth) {
      // Route requires authentication
      if (user) {
        // User is authenticated, allow access
        next()
      } else {
        // User is not authenticated, redirect to login
        next('/')
      }
    } else if (to.name === 'login' && user) {
      // User is authenticated but trying to access login page, redirect to dashboard
      next('/dashboard')
    } else {
      // Route doesn't require auth or user is not authenticated, allow access
      next()
    }
  }

  // Check current auth state
  const user = auth.currentUser

  if (user) {
    // User is already authenticated
    checkAuthAndNavigate(user)
  } else {
    // No current user, wait for auth state to be determined
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      unsubscribe() // Unsubscribe immediately to avoid memory leaks
      checkAuthAndNavigate(authUser)
    })
  }
})

export default router
