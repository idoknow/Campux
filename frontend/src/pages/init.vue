<template style="">
<div
        style="display: flex; align-items: center; justify-content: center; height: 100%; background-color: #fff;flex-direction: column">
        <div class="auth-card">
            <h2 style="margin-bottom: 18px;">{{ authTitle }}</h2>
            <v-form style="margin-top: 30px;">
                <v-text-field label="初始管理员 QQ 号" v-model="credientials.admin_uin" variant="outlined"></v-text-field>
                <v-text-field label="初始管理员密码" v-model="credientials.admin_passwd" variant="outlined"
                    type="password"></v-text-field>


                <v-btn color="primary" text style="margin-top: 16px; width: 100%;" @click="doInitialize">
                    注册
                </v-btn>
            </v-form>

        </div>

        <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
            {{ snackbar.text }}
        </v-snackbar>

    </div>

</template>

<script>


export default {
    data() {
        return {
            credientials: {
                admin_uin: '',
                admin_passwd: ''
            },
            authTitle: '😎 初始化管理员账户',
            snackbar: {
                show: false,
                text: '',
                color: ''
            },
        }
    },

    mounted() {

        // get param
        if (this.$route.query.hint) {
            this.toast(this.$route.query.hint)
        }
    },

    methods: {

        doInitialize() {
            
            if (!this.credientials.admin_uin || !this.credientials.admin_passwd) {
                this.toast('请输入QQ号和密码')
                return
            }
            let testuin = parseInt(this.credientials.admin_uin)
            if (isNaN(testuin)) {
                this.toast('QQ号必须是数字')
                return
            }
            this.credientials.admin_uin = testuin

            this.$axios.post('/v1/admin/init', this.credientials)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('初始化成功', 'success')
                        // this.$store.commit('tokenCheck', this.$bus)
                        this.$router.push('/auth?hint=初始化成功，请登录。')
                    } else {
                        this.toast('初始化失败：' + res.data.msg)
                    }
                    console.log(res)
                })
                .catch(err => {
                    this.toast('初始化失败：' + err.response.data.msg)
                    console.error(err)
                })
        },

        toast(text, color = 'error') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        },
    }
}
</script>

<style>


.auth-card {
    width: 95%;
    top: 40%;
    max-width: 400px;
    padding: 20px;
    border-radius: 9px;
    background-color: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.cursor {
    cursor: pointer;
    transition: color 0.2s;
}

.cursor:hover {
    color: #3f51b5;
}

#oauth-scopes {
    display: flex;
    flex-wrap: wrap;
    margin-top: 0.8rem;
    margin-bottom: 0.8rem;
}
</style>