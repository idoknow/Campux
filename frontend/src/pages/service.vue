<template>

    <BottomNavBar v-model="value" @input="go" />

    <div class="rect1" style="background-color: #2196F3;">
      <p style="font-weight: bold;">🗺️ 桂林中学毕业生去向分布图</p>
      <a style="font-size: 16px;" @click="go('https://stumap.idoknow.top/')">点击查看</a>
    </div>

    <iframe style="width: 100%; height: 80%;" v-if="displayInnerWindow !== ''" :src="displayInnerWindow" frameborder="0"></iframe>
    
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
      {{ snackbar.text }}
    </v-snackbar>
  </template>
  
  <script>
  import BottomNavBar from '@/components/BottomNavBar.vue'
  export default {
    components: {
      BottomNavBar
    },
    data() {
      return {
        snackbar: {
          show: false,
          text: '',
          color: ''
        },
        value: 2,
        displayInnerWindow: '',
      }
    },
  
    mounted() {
    },
  
    methods: {
      toast(text, color = 'error') {
        this.snackbar.text = text
        this.snackbar.color = color
      },

      go(url) {
        this.displayInnerWindow = url
      }
    }
  }
  
  </script>
  
<style>

.rect1 {
  padding: 16px;
  font-size: 18px;
  margin-left: 8px;
  border-radius: 5px;
  color: #fff;
  margin-top: 8px;
  width: 95%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
}

</style>