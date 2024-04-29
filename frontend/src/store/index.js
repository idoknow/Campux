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