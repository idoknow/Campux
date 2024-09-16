import axios from 'axios';

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

export default axios;