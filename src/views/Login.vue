<template>
  <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full">
      <!-- Login Card -->
      <div class="shadow rounded-lg overflow-hidden bg-[#d14124]">
        <div class="px-4 py-8 sm:px-10">
          <div class="text-center mb-8">
            <img class="mx-auto h-16 w-auto" src="/imgs/tk-white.webp" alt="Tapa King Logo" />
            <h2 class="mt-6 text-2xl font-bold text-white">Sign in to your account</h2>
            <p class="mt-2 text-sm text-gray-200">Admin Dashboard</p>
          </div>

          <form class="space-y-8" @submit.prevent="handleLogin">
            <div
              v-if="error"
              class="bg-red-900 bg-opacity-50 border border-red-400 text-red-100 px-4 py-3 rounded-lg mb-4"
            >
              {{ error }}
            </div>

            <div class="space-y-6">
              <div class="relative">
                <input
                  id="email"
                  v-model="email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  class="peer w-full px-4 py-4 text-gray-900 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 placeholder-transparent transition-all duration-300 shadow-sm"
                  placeholder="Email address"
                />
                <label
                  for="email"
                  class="absolute left-4 -top-2.5 text-sm text-orange-800 bg-white px-2 transition-all duration-300 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-500 peer-placeholder-shown:top-4 peer-placeholder-shown:bg-transparent peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-orange-800 peer-focus:bg-white"
                >
                  Email address
                </label>
              </div>

              <div class="relative">
                <input
                  id="password"
                  v-model="password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                  class="peer w-full px-4 py-4 text-gray-900 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 placeholder-transparent transition-all duration-300 shadow-sm"
                  placeholder="Password"
                />
                <label
                  for="password"
                  class="absolute left-4 -top-2.5 text-sm text-orange-800 bg-white px-2 transition-all duration-300 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-500 peer-placeholder-shown:top-4 peer-placeholder-shown:bg-transparent peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-orange-800 peer-focus:bg-white"
                >
                  Password
                </label>
              </div>
            </div>

            <div>
              <button
                type="submit"
                :disabled="isLoading"
                class="w-full flex justify-center items-center px-6 py-4 text-sm font-semibold rounded-xl text-white focus:outline-none focus:ring-4 focus:ring-white focus:ring-opacity-30 disabled:opacity-50 disabled:cursor-not-allowed transform transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95 bg-[#8a2a2b]"
              >
                <span v-if="isLoading" class="mr-3">
                  <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                </span>
                {{ isLoading ? 'Signing in...' : 'Sign in' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../services/firebase'

const router = useRouter()
const email = ref('')
const password = ref('')
const isLoading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!email.value || !password.value) {
    error.value = 'Please enter both email and password'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    await signInWithEmailAndPassword(auth, email.value, password.value)
    // Redirect to dashboard on successful login
    router.push('/dashboard')
  } catch (err: any) {
    console.error('Login failed:', err)

    // Handle specific Firebase auth errors
    switch (err.code) {
      case 'auth/user-not-found':
        error.value = 'No account found with this email address'
        break
      case 'auth/wrong-password':
        error.value = 'Incorrect password'
        break
      case 'auth/invalid-email':
        error.value = 'Invalid email address'
        break
      case 'auth/user-disabled':
        error.value = 'This account has been disabled'
        break
      case 'auth/too-many-requests':
        error.value = 'Too many failed attempts. Please try again later'
        break
      default:
        error.value = 'Login failed. Please check your credentials and try again'
    }
  } finally {
    isLoading.value = false
  }
}
</script>
