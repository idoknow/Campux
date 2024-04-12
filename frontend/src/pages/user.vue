<template>

    <BottomNavBar v-model="value" @input="go" />
    
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
        value: 1
      }
    },
  
    mounted() {
    },
  
    methods: {
      toast(text, color = 'error') {
        this.snackbar.text = text
        this.snackbar.color = color
      }
    }
  }
  </script>
  