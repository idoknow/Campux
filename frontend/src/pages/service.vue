<template>

  <BottomNavBar v-model="value" @input="go" />

  <div style="padding: 16px;">

    <h1 style="margin-bottom: 16px">🎲 服务</h1>
    <div class="rect1" style="background-color: #2196F3;">
      <div>
        <p style="font-weight: bold; font-size: 16px">🗺️ 桂林中学毕业生去向分布图</p>
        <small style="color: #fff; font-size: 13px">https://stumap.idoknow.top</small>
      </div>
      <a style="font-size: 16px; cursor:pointer; font-weight: bold;" @click="go('https://stumap.idoknow.top/')">点击查看</a>
    </div>

    <p style="text-align: center; margin-top: 16px; color: #c3c3c3">更多服务正在开发...</p>
  </div>


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
      // this.displayInnerWindow = url
      window.open(url, '_blank')
    }
  }
}

</script>

<style>
.rect1 {
  padding: 16px;
  font-size: 18px;
  border-radius: 7px;
  color: #fff;
  margin-top: 8px;
  width: 95%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.11);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>