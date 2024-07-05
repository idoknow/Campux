
/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createWebHashHistory, createRouter } from 'vue-router'

import post from '../pages/post.vue'
import world from '../pages/world.vue'
import service from '../pages/service.vue'
import admin from '../pages/admin.vue'

const routes = [
  { path: '/', component: post},
  { path: '/world', component: world},
  { path: '/service', component: service},
  { path: '/admin', component: admin},
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})


export default router
