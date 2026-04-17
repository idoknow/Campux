import { createStore } from 'vuex'
import router from '@/router'
import axios from 'axios'

export default createStore({
    state: {
        base_url: "http://localhost:8081",
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
        publicObject: {
            "announcement": {
                "admin": []
            }
        },
        bus: null,
    },
    mutations: {
        initMetadata(state, key) {
            console.log(key)
            if (state.metadata[key] === "") {
                axios.get(state.base_url + '/v1/misc/get-metadata?key=' + key)
                    .then(res => {
                        if (res.data.code === 0) {
                            if (key == "post_rules") {
                                state.metadata[key] = JSON.parse(res.data.data.value)
                            } else {
                                state.metadata[key] = res.data.data.value
                            }

                            if (key == "popup_announcement") {
                                state.bus.emit('popupAnnouncementFetched')
                            }
                        }
                    })
                    .catch(err => {
                        console.error(err)
                    })
            }
        },
        fetchPublicObject(state, bus) {
            axios.get(
                "https://campux.idoknow.top/object.json",
                {withCredentials: false}
            ).then(res => {
                if (res.status == 200) {
                    state.publicObject = res.data
                    console.log(state.publicObject)
                    bus.emit('publicObjectFetched')
                }
            })
        },
        uploadMetrics() {
            // this method is used to upload metrics to our server to analyze the product usage,
            // so that we can improve the product in the future.
            fetch("https://tickstats.idoknow.top/api/metric/c91cd32d", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  metrics_data: {
                    "os_name": window.navigator.platform,
                    "browser": window.navigator.userAgent,
                    "host": window.location.host,
                    "tick": 1,
                  }
                }),
            });
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
                                        this.state.account.avatarUrl = "http://q1.qlogo.cn/g?b=qq&nk=" + res.data.data.uin + "&s=320"
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