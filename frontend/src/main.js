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
import store from './store/index.js'
import { ref } from 'vue'
import { useStore } from "vuex"

const app = createApp(App)
app.use(store)

const axiosInstance = axios.create({
    withCredentials: true,
    baseURL: 'https://dev.campux.idoknow.top'
})
app.config.globalProperties.$baseurl = ref('https://dev.campux.idoknow.top')
app.config.globalProperties.$axios = { ...axiosInstance }

registerPlugins(app)

app.mount('#app')

