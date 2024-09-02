import { createStore } from 'vuex'
import router from '@/router'
import axios from 'axios'

export default createStore({
    state: {
        base_url: "",
        metadata: {
            "banner": "",
            "popup_announcement": "",
            "post_rules": "",
            "brand": "",
            "beianhao": "",
        },
        version: "Campux",
        statusMap: {
            "pending_approval": "待审核",
            "approved": "已通过",
            "rejected": "已拒绝",
            "cancelled": "已取消",
            "in_queue": "队列中",
            "published": "已发布",
            "failed": "失败",
            "any": "全部",
            "pending_recall": "待撤回",
            "recalled": "已撤回"
        },
        account: {
            "uin": 0,
            "avatarUrl": '',
            "userGroup": 'user',
            "access": {
                "is_banned": false
            }
        },
        authMode: "login",
    },
    mutations: {
        initMetadata(state, key) {
            console.log(key)
            if (this.state.metadata[key] === "") {
                axios.get(this.state.base_url + '/v1/misc/get-metadata?key=' + key)
                    .then(res => {
                        if (res.data.code === 0) {
                            if (key == "post_rules") {
                                this.state.metadata[key] = JSON.parse(res.data.data.value)
                            } else {
                                this.state.metadata[key] = res.data.data.value
                            }

                            let last_an_ts = localStorage.getItem("popup_announcement_ts")
                            if (key == "popup_announcement" && (last_an_ts == null || new Date().getTime() - last_an_ts > 86400000)) {
                                this.showPopupAN = true
                                localStorage.setItem("popup_announcement_ts", new Date().getTime())
                            }
                        }
                    })
                    .catch(err => {
                        console.error(err)
                    })
            }
        },
        getVersion(state) {
            axios.get(this.state.base_url + '/v1/misc/get-version')
                .then(res => {
                    if (res.data.code === 0) {
                        state.version = res.data.data.version
                    }
                })
        },
        setBaseURL(state, url) {
            state.base_url = url
        },
        tokenCheck(state, bus) {
            // 先检查系统是否已经初始化，没有则跳/init
            axios.get(
                this.state.base_url + '/v1/admin/init',
            )
                .then(res => {
                    if (res.data.code === 0) {
                        if (res.data.data.initialized === false) {
                            router.push('/init')
                        } else {

                            axios.get(this.state.base_url + '/v1/account/token-check', { withCredentials: true })
                                .then(res => {
                                    console.log(res)
                                    if (res.data.code === 0) {
                                        this.state.account.uin = res.data.data.uin
                                        this.state.account.avatarUrl = "http://q1.qlogo.cn/g?b=qq&nk=" + res.data.data.uin + "&s=100"
                                        this.state.account.userGroup = res.data.data.user_group
                                        this.state.account.access = res.data.data.access

                                        console.log(this.state.account.access)
                                        // 如果 access.end_time 存在
                                        if (this.state.account.access.end_time) {
                                            let date = new Date(this.state.account.access.end_time)
                                            this.state.account.access.end_time = date.toLocaleString()
                                        }

                                        bus.emit('tokenCheckSuccess')
                                    }
                                })
                                .catch(err => {
                                    if (err.response.data.code === -1) {
                                        router.push('/auth?hint=请先登录嗷')
                                        return
                                    }
                                    console.error(err)
                                })
                        }
                    }
                })

        }
    },
})