import { createStore } from 'vuex'
import axios from 'axios'

export default createStore({
    state: {
        base_url: "https://dev.campux.idoknow.top",
        metadata: {
            "banner": "",
            "popup_announcement": "",
            "post_rules": "",
            "brand": "",
            "beianhao": "",
        },
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
        }
    },
})