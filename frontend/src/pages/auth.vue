<template style="">
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; background-color: #f8f8f8;">
        <div class="auth-card">
            <h2 style="margin-bottom: 32px;">{{ authTitle }}</h2>
            <v-form v-if="!authMode">
                <v-text-field label="QQ 号" v-model="credientials.uin" variant="outlined"></v-text-field>
                <v-text-field label="密码" v-model="credientials.passwd" variant="outlined"
                    type="password"></v-text-field>

                <div>

                    <v-dialog max-width="500">
                        <template v-slot:activator="{ props: activatorProps }">
                            <small v-bind="activatorProps" class="cursor">没有账号</small>
                        </template>

                        <template v-slot:default="{ isActive }">
                            <v-card title="提示">

                                <v-card-text>
                                    <p>请给墙号(QQ: 2297454588)发送</p>
                                    <p><strong>#注册</strong></p>
                                    <p>来获得初始密码。</p>
                                </v-card-text>

                                <v-card-actions>
                                    <v-spacer></v-spacer>

                                    <v-btn text="好的👌" @click="isActive.value = false"></v-btn>
                                </v-card-actions>
                            </v-card>
                        </template>
                    </v-dialog>
                    /
                    <small class="cursor" @click="resetPassword">重置密码</small>
                </div>


                <v-btn color="primary" text style="margin-top: 16px; width: 100%;" @click="login">
                    登录
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
                uin: '',
                passwd: ''
            },
            authTitle: '👋 登录到 Campux',
            snackbar: {
                show: false,
                text: '',
                color: ''
            }
        }
    },

    mounted() {
    },

    methods: {
        resetPassword() {
            console.log('reset password')
        },

        login() {
            if (!this.credientials.uin || !this.credientials.passwd) {
                this.toast('请输入QQ号和密码')
                return
            }
            let testuin = parseInt(this.credientials.uin)
            if (isNaN(testuin)) {
                this.toast('QQ号必须是数字')
                return
            }
            this.credientials.uin = testuin

            this.$axios.post('/v1/account/login', this.credientials)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('登录成功', 'success')
                        this.$router.push('/')
                    } else {
                        this.toast('登录失败：' + res.data.msg)
                    }
                    console.log(res)
                })
                .catch(err => {
                    this.toast('登录失败：' + err.response.data.msg)
                    console.error(err)
                })
        },

        toast(text, color = 'error') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        }
    }
}

</script>

<style>
.auth-card {
    width: 95%;
    max-width: 400px;
    padding: 20px;
    border-radius: 9px;
    background-color: #fff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.cursor {
    cursor: pointer;
    transition: color 0.2s;
}

.cursor:hover {
    color: #3f51b5;
}
</style>