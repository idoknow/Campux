<template style="">
    <div
        style="display: flex; align-items: center; justify-content: center; height: 100%; background-color: #fff;flex-direction: column">
        <div class="auth-card">
            <h2 style="margin-bottom: 18px;">{{ authTitle }}</h2>
            <v-form style="margin-top: 30px;" v-if="!showOAuth2">
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
                                    <p>请给墙号发送</p>
                                    <p><strong>#注册账号</strong></p>
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
                    <v-dialog max-width="500">
                        <template v-slot:activator="{ props: activatorProps }">
                            <small v-bind="activatorProps" class="cursor">忘记密码</small>
                        </template>

                        <template v-slot:default="{ isActive }">
                            <v-card title="提示">

                                <v-card-text>
                                    <p>请给墙号发送</p>
                                    <p><strong>#重置密码</strong></p>
                                    <p>以重置密码为随机密码</p>
                                </v-card-text>

                                <v-card-actions>
                                    <v-spacer></v-spacer>

                                    <v-btn text="好的👌" @click="isActive.value = false"></v-btn>
                                </v-card-actions>
                            </v-card>
                        </template>
                    </v-dialog>
                </div>


                <v-btn color="primary" text style="margin-top: 16px; width: 100%;" @click="login">
                    登录
                </v-btn>
            </v-form>

            <v-form v-else>
                <p>允许此应用访问您 Campux 账号中的以下信息？</p>
                <div id="oauth-scopes">
                    <v-chip v-for="scope in currentSupportedScopes" :key="scope" color="primary" class="mr-2">
                        {{ scope }}
                    </v-chip>
                </div>
                <v-btn color="primary" text style="margin-top: 16px; width: 100%;" @click="doAuthorize">
                    授权
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
            },
            showOAuth2: false,
            authorizingAppInfo: {
                name: '',
                emoji: '🥰',
            },

            currentSupportedScopes: [
                '读取 UIN',
                '读取 注册时间',
                '读取 用户组',
            ]
        }
    },

    mounted() {

        // get param
        if (this.$route.query.hint) {
            this.toast(this.$route.query.hint)
        }
        this.$bus.on(
            'tokenCheckSuccess',
            () => {
                console.log('token check success')
                // oauth2 authorizing
                if (this.$route.query.client_id && this.$route.query.redirect_uri) {
                    this.$store.state.authMode = "oauth2"
                    // 获取app信息
                    this.$axios.get('/v1/oauth2/get-app-info?client_id=' + this.$route.query.client_id)
                        .then(res => {
                            if (res.data.code === 0) {
                                console.log(res.data.data)
                                this.authorizingAppInfo = res.data.data
                                this.authTitle = '🔒 授权 ' + this.authorizingAppInfo.name
                                this.showOAuth2 = true
                            } else {
                                this.toast('获取应用信息失败：' + res.data.msg)
                            }
                        })
                        .catch(err => {
                            this.toast('获取应用信息失败：' + err.response.data.msg)
                        })
                } else {
                    this.$router.push('/')
                }
            }
        )
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
                        this.$store.commit('tokenCheck', this.$bus)
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
        },
        doAuthorize() {
            this.$axios.get('/v1/oauth2/authorize', {
                    params: {
                        client_id: this.$route.query.client_id,
                    }
                })
                .then(res => {
                    if (res.data.code === 0) {
                        
                        let targetUri = this.$route.query.redirect_uri + '?code=' + res.data.data.code
                        if (this.$route.query.state) {
                            targetUri += '&state=' + this.$route.query.state
                        }

                        this.toast('授权成功，即将跳转到应用', 'success')
                        
                        //等待2秒
                        setTimeout(() => {
                            window.location.href = targetUri
                        }, 2000)

                    } else {
                        this.toast('授权失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('授权失败：' + err.response.data.msg)
                })
        }
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