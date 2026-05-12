
/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createWebHashHistory, createRouter } from 'vue-router'

import auth from '@/pages/auth.vue'
import post from '../pages/post.vue'
import world from '../pages/world.vue'
import service from '../pages/service.vue'
import admin from '../pages/admin.vue'
import init from '../pages/init.vue'

const routes = [
  { path: '/', component: post },
  { path: '/auth', component: auth},
  { path: '/world', component: world },
  { path: '/service', component: service },
  { path: '/admin', component: admin },
  { path: '/init', component: init },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
