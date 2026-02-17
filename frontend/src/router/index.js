import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/app'
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/AuthView.vue'),
    },
    {
      path: '/app',
      name: 'app',
      component: () => import('../views/AppView.vue'),
      meta: { requiresAuth: true }
    },
  ],
})

// Guard: redirige a /login si la ruta requiere auth y no hay sesión activa
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth) {
    try {
      await getCurrentUser()   // lanza error si no hay sesión
    } catch {
      return '/login'
    }
  }
})

export default router