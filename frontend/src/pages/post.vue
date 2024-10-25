<template>
    <div v-if="$store.state.account.uin != 0 && $store.state.authMode === 'login'">
        <div>
            <h2 id="mt" style="padding: 8px 16px; font-family: Lilita One; display: inline-block">Campux</h2>
            <span>{{ $store.state.metadata.brand }}</span>
        </div>
        <div id="admin-announcement" v-if="adminAnnouncement.show"
            :style="{ background: adminAnnouncement.color.background, color: adminAnnouncement.color.text, fontSize: '14px', textAlign: 'center' }"
            lines="one">
            <div id="announcement-content">
                <div style="margin-right: 5px;">{{ adminAnnouncement.content }}</div>
                <!-- <a v-if="adminAnnouncement.link.url !== ''" :href="adminAnnouncement.link.url"
                style="color: blue; font-weight: bold;"
                    target="_blank">{{ adminAnnouncement.link.text }}</a> -->
                <v-btn v-if="adminAnnouncement.link.url !== ''" :href="adminAnnouncement.link.url"
                    style="padding-inline: 8px;font-size: 0.8rem;" color="primary" variant="flat"
                    density="compact" target="_blank">{{ adminAnnouncement.link.text }}</v-btn>
            </div>
            <v-btn id="clear-announcement" text="清除" @click="dismissAdminAnnouncement" prepend-icon="mdi-check" variant="text"></v-btn>
        </div>
        <v-banner v-if="$store.state.metadata.banner !== ''"
            style="background: #f8b94c; color: #fff; font-size: 14px; text-align: center;" color="warning" lines="one"
            :text="$store.state.metadata.banner" :stacked="false">
        </v-banner>

        <v-alert style="margin: 16px;" v-if="isPending" density="compact" text="你当前有一条待审核的投稿，请等待审核后再来投稿。" title="稿件待审核"
            type="warning"></v-alert>

        <div style="display: flex; padding: 16px">
            <v-dialog max-width="500">
                <template v-slot:activator="{ props: activatorProps }">
                    <img v-bind="activatorProps" :src="$store.state.account.avatarUrl" width="50" height="50"
                        style="border-radius: 50%;">
                </template>

                <template v-slot:default="{ isActive }">
                    <v-card title="😉 提示">

                        <v-card-text>
                            真的要退出吗
                        </v-card-text>

                        <v-card-actions>
                            <v-spacer></v-spacer>
                            <v-btn text="取消" @click="isActive.value = false"></v-btn>
                            <v-btn text="是的" @click="isActive.value = false; logout()"></v-btn>
                        </v-card-actions>
                    </v-card>
                </template>
            </v-dialog>
            <textarea :readonly="isPending" style="" name="textarea" v-model="post.text" placeholder="有什么新鲜事？！"
                class="post"></textarea>
        </div>

        <div style="margin-left: 16px; display: flex; flex-wrap: wrap;">
            <img v-for="(image, index) in postImageBlobs" :src="image" :key="index" width="70" height="70"
                style="margin-right: 8px; margin-top:4px; border-radius: 10px;"
                @click="selectedIndex = index; showDeleteImageDialog = true">
            <svg style="margin-top: 8px" @click="selectImage" t="1712897639010" class="icon" viewBox="0 0 1024 1024"
                version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1448" width="70" height="70">
                <path
                    d="M85.312 85.312v853.376h853.376V85.312H85.312zM0 0h1024v1024H0V0z m554.624 213.312v256h256v85.376h-256v256H469.312v-256h-256V469.376h256v-256h85.312z"
                    fill="#262626" p-id="1449"></path>
            </svg>
        </div>

        <div style="margin-left: 8px;">
            <!-- 标签 -->
            <div style="display: flex; align-items: center">
                <v-chip class="ma-2" color="pink" size="small" label>
                    <v-icon icon="mdi-label" start></v-icon>
                    标签
                </v-chip>
                <v-chip @click="selectTag(index)" :ripple="true" style="margin-right: 4px;" v-for="(tag, index) in tags"
                    :key="index" size="x-small" :variant="tag.selected ? 'primary' : 'outlined'"
                    :color="tag.selected ? 'primary' : 'pink'" label>
                    {{ tag.name }}
                </v-chip>
            </div>
            <small class="taghint">🤔 添加标签可更快过审，不要选择不完全符合内容的标签。</small>

            <div class="rect" style="background-color: #8BC34A;">
                <p style="display: inline-block;">🫥 匿名投稿</p>
                <input type="checkbox" v-model="post.anon" style="margin-left: 16px; display: inline-block;">
            </div>

            <v-dialog max-width="500">
                <template v-slot:activator="{ props: activatorProps }">
                    <div v-bind="activatorProps" class="rect" style="background-color: #FF8A65; font-size: 16px;">
                        <p style="display: inline-block;">🪧 请务必遵守 <strong>投稿规则</strong></p>
                    </div>
                </template>

                <template v-slot:default="{ isActive }">
                    <v-card title="😉 投稿规则">

                        <v-card-text>
                            <p v-for="(rule, index) in $store.state.metadata.post_rules" :key="index">{{ index + 1 }}.
                                {{
                                    rule }}</p>
                        </v-card-text>

                        <v-card-actions>
                            <v-spacer></v-spacer>

                            <v-btn text="好的👌" @click="isActive.value = false"></v-btn>
                        </v-card-actions>
                    </v-card>
                </template>
            </v-dialog>

            <div style="display: flex; align-items: center;">
                <button v-if="!isPending && $store.state.account.uin !== 0" @click="letsPost" class="postbtn"
                    style="margin: 8px; margin-top: 16px">
                    <span> 投稿
                    </span>
                </button>
                <v-progress-circular v-if="loading" :size="25" color="primary" indeterminate></v-progress-circular>
            </div>

            <div>
                <span style="font-size: 12px; color: #c3c3c3; margin-left: 8px">{{ $store.state.metadata.beianhao
                    }}</span>
            </div>

            <v-dialog v-model="showDeleteImageDialog" width="auto">
                <v-card text="要删除吗？" title="提示">
                    <template v-slot:actions>
                        <v-btn class="ms-auto" text="不是" @click="showDeleteImageDialog = false"></v-btn>
                        <v-btn class="ms-auto" text="是的"
                            @click="showDeleteImageDialog = false; removeImage(selectedIndex)"></v-btn>
                    </template>
                </v-card>
            </v-dialog>

            <v-dialog v-model="popupAnnouncement.show" width="auto">
                <v-card :text="popupAnnouncement.content" title="提示">
                    <template v-slot:actions>
                        <v-btn class="ms-auto" text="1 天内不再提醒" @click="closePopupAnnouncement"></v-btn>
                    </template>
                </v-card>
            </v-dialog>

        </div>
        <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout"
            style="margin-bottom: 64px">
            {{ snackbar.text }}
        </v-snackbar>
    </div>

    <div id="loading-tips" v-else>
        Loading...
    </div>

</template>

<script>
import Cookies from "js-cookie";

export default {
    data() {
        return {
            snackbar: {
                show: false,
                text: '',
                color: ''
            },
            value: 0,
            post: {
                uuid: '',
                text: '',
                anon: false,
                images: [],
            },
            postImageBlobs: [],
            tags: [
                {
                    name: '寻物/招领',
                    selected: false
                },
                {
                    name: '教学升学内容相关问答',
                    selected: false
                },
                {
                    name: '食堂品质',
                    selected: false
                }
            ],
            loading: false,
            showDeleteImageDialog: false,
            selectedIndex: -1,
            isPending: false,
            popupAnnouncement: {
                show: false,
                content: '',
            },
            adminAnnouncement: {
                show: false,
                content: '',
                link: {
                    url: '',
                    text: ''
                },
                color: {
                    text: '',
                    background: ''
                }
            },
            dismissedAdminAnnouncements: []
        }
    },

    mounted() {
        this.getPosts()

        if (this.$store.state.publicObject.announcement.admin.length > 0) {
            this.showAdminAnnouncement()
        } else {
            this.$bus.on('publicObjectFetched', () => {
                this.showAdminAnnouncement()
            })
        }

        if (this.$store.state.metadata.popup_announcement !== '') {
            console.log("show popup_announcement")
            this.showPopupAnnouncement()
        } else {
            console.log("waiting for popupAnnouncementFetched")
            this.$bus.on('popupAnnouncementFetched', () => {
                console.log("popupAnnouncementFetched")
                this.showPopupAnnouncement()
            })
        }
    },

    methods: {
        getPosts() {
            let filter = {
                "status": "pending_approval",
                "time_order": 1,
                "page": 1,
                "page_size": 1
            }
            this.$axios.post('/v1/post/get-self-posts', filter)
                .then((response) => {
                    if (response.data.code === 0) {
                        let p = response.data.data.total
                        if (p !== 0) {
                            this.isPending = true
                        }
                    } else {
                        this.toast(response.data.msg)
                    }
                })
                .catch((error) => {
                    console.log(error)
                })
        },

        removeImage(index) {
            if (index === -1) {
                return
            }
            this.post.images.splice(index, 1)
            this.postImageBlobs.splice(index, 1)
        },
        generateUUID4() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0,
                    v = c == 'x' ? r : (r & 0x3 | 0x8)
                return v.toString(16)
            })
        },
        letsPost() {
            if (this.post.text === '') {
                this.toast('内容不能为空')
                return
            }
            // random generate uuid4
            this.loading = true
            this.post.uuid = this.generateUUID4()

            // 将images中的baseurl去掉
            this.post.images = this.post.images.map(image => {
                return image.replace(this.$store.state.base_url + "/v1/post/download-image/", '')
                    .replace("?preview=1", "")

            })

            this.$axios.post('/v1/post/post-new', this.post)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('🥰 投稿成功', 'success')
                        this.post.text = ''
                        this.post.images = []
                        this.postImageBlobs = []
                        this.tags.forEach(tag => {
                            tag.selected = false
                        })
                        this.loading = false
                        this.getPosts()
                    } else {
                        this.toast('投稿失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('投稿失败：' + err.response.data.msg)
                    console.error(err)
                    this.loading = false
                })

        },
        selectImage() {
            // file select
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.onchange = (e) => {
                this.loading = true
                const file = e.target.files[0]
                this.$axios.post('/v1/post/upload-image', {
                    image: file,
                    suffix: file.type.split('/')[1]
                },
                    {
                        headers: {
                            'Content-Type': 'multipart/form-data'
                        }
                    })
                    .then(res => {
                        if (res.data.code === 0) {
                            let url = this.$store.state.base_url + '/v1/post/download-image/' + res.data.data.key + "?preview=1"
                            console.log(url)
                            this.post.images.push(url)
                            this.fetchLatestImageToImageBlobs(url)
                            this.loading = false
                        } else {
                            this.toast('上传失败：' + res.data.msg)
                            this.loading = false
                        }
                    })
                    .catch(err => {
                        this.toast('上传失败：' + err.response.data.msg)
                        console.error(err)
                        this.loading = false
                    })
            }
            input.click()
        },
        fetchLatestImageToImageBlobs(url) {
            this.$axios.get(url, {
                responseType: 'blob'
            })
                .then(res => {
                    this.postImageBlobs.push(URL.createObjectURL(res.data))
                })
                .catch(err => {
                    console.error(err)
                })
        },
        selectTag(index) {
            this.toast("标签功能暂时关闭", "warning")
            this.tags[index].selected = !this.tags[index].selected
        },
        showPopupAnnouncement() {
            console.log("show popup_announcement" + this.$store.state.metadata.popup_announcement)
            if (this.$store.state.metadata.popup_announcement === '') {
                return
            }
            let dont_show_announcement_before = localStorage.getItem("dont_show_announcement_before")
            if (dont_show_announcement_before == null || new Date().getTime() > dont_show_announcement_before) {
                this.popupAnnouncement.show = true
                console.log(this.$store.state.metadata.popup_announcement)
                this.popupAnnouncement.content = this.$store.state.metadata.popup_announcement
            }
        },
        closePopupAnnouncement() {
            this.popupAnnouncement.show = false
            localStorage.setItem("dont_show_announcement_before", new Date().getTime() + 86400000)
        },
        showAdminAnnouncement() {
            if (this.$store.state.account.userGroup !== 'admin') {
                return
            }

            if (this.$store.state.publicObject == {}) {
                return
            }

            if (this.$store.state.publicObject.announcement.admin.length === 0) {
                return
            }

            // 进入这个页面或dismiss了一个公告时，选择一个公告显示
            this.dismissedAdminAnnouncements = JSON.parse(localStorage.getItem("dismissed_admin_announcements") || "[]")

            this.adminAnnouncement.show = false

            for (let i = 0; i < this.$store.state.publicObject.announcement.admin.length; i++) {
                if (!this.dismissedAdminAnnouncements.includes(this.$store.state.publicObject.announcement.admin[i].id) && this.$store.state.publicObject.announcement.admin[i].versions.includes(this.$store.state.version)) {
                    this.adminAnnouncement = this.$store.state.publicObject.announcement.admin[i]
                    this.adminAnnouncement.show = true
                    break
                }
            }
        },
        dismissAdminAnnouncement() {
            this.dismissedAdminAnnouncements.push(this.adminAnnouncement.id)
            localStorage.setItem("dismissed_admin_announcements", JSON.stringify(this.dismissedAdminAnnouncements))
            this.adminAnnouncement.show = false
            this.showAdminAnnouncement()
        },
        toast(text, color = 'error') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        },
        logout() {
            Cookies.remove("access-token");
            // reload
            window.location.reload()
        },

    }
}
</script>

<style>
.post {
    width: 100%;
    height: 160px;
    padding: 16px;
    font-size: 16px;
    border: none;
    resize: none;
}

.post:focus {
    outline: none;
}


#admin-announcement {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    height: 2.6rem;
    /* padding-top: 4px; */
    padding-inline: 16px;
}

#announcement-content {
    display: flex;
    align-items: center;
}

#clear-announcement {
    justify-self: flex-end;
}

.taghint {
    font-size: 12px;
    color: #666;
    margin-left: 8px;
}

.rect {
    padding: 4px;
    font-size: 18px;
    margin-left: 8px;
    border-radius: 5px;
    color: #fff;
    margin-top: 8px;
    width: fit-content;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

button {
    border: none;
    border-radius: 20px;
    background: linear-gradient(32deg, #03a9f4, #f441a5, #ffeb3b, #03a9f4);
    transition: all 1.5s ease;
    font-family: 'Ropa Sans', sans-serif;
    font-weight: bold;
    letter-spacing: 0.05rem;
    padding: 0;
}

.postbtn span {
    display: inline-block;
    padding: 10px 50px;
    font-size: 17px;
    border-radius: 10px;
    background: #ffffff10;
    backdrop-filter: blur(20px);
    transition: 0.4s ease-in-out;
    transition-property: color;
    height: 100%;
    width: 100%;
    color: #fff
}

.postbtn span:hover {
    backdrop-filter: blur(10px);
    color: #ffffff;
}

#loading-tips {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    font-size: 24px;
}


/* 适配pc端 */
@media (min-width: 600px) {

    #mt {
        display: none;
    }

    #bnb {
        display: none;
    }

    #pctabs {
        height: 100%;
        display: block;
        min-width: 200px;
    }

    #container-wrap {
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    #container {
        margin-left: 16px;
        height: 100%;
        width: 60%;
    }

    #pctab-btn {
        padding: 12px 28px;
        margin-top: 16px;
        text-align: center;
        font-size: 18px;
        border-radius: 24px;
        cursor: pointer;
    }

    #pctab-btn:hover {
        background-color: #f5f5f5;
    }

    #vdivider {
        display: block;
    }
}

/* 适配移动端 */
@media (max-width: 600px) {
    #tabs {
        display: block;
    }

    #pctabs {
        display: none;
    }

    #vdivider {
        display: none;
    }

}
</style>