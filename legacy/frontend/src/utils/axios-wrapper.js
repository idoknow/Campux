import axios from 'axios';
import store from '@/store/index.js'

axios.interceptors.request.use(function (config) {
    // add Authorization header before request is sent
    const token = localStorage.getItem('access-token');
    if (token) {
      config.headers
        .Authorization = `Bearer ${token}`;
    }
    return config;
  }, function (error) {
    return Promise.reject(error);
  });

axios.defaults.withCredentials = true;
axios.defaults.baseURL = store.state.base_url;

export default axios;