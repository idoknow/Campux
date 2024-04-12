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
        value: 1,
        filter: {
          "uin": -1, // -1 means all,

        }
      }
    },
  
    mounted() {
      this.getPosts()
    },
  
    methods: {
      getPosts() {
        this.$axios.post('/v1/post/get-posts')
          .then((response) => {
            console.log(response.data)
          })
          .catch((error) => {
            console.log(error)
          })
      },
      toast(text, color = 'error') {
        this.snackbar.text = text
        this.snackbar.color = color
      }
    }
  }
  </script>
  