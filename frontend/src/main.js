/**
 * main.js
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'

import axios from 'axios'


const app = createApp(App)

axios.defaults.baseURL = 'https://dev.campux.idoknow.top'
app.config.globalProperties.$axios = axios


registerPlugins(app)

app.mount('#app')
