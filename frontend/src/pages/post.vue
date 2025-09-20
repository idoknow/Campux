<template>
    <div v-if="$store.state.account.uin != 0 && $store.state.authMode === 'login'" class="post-page-container">
        <!-- 页面头部 -->
        <div class="page-header">
            <div class="brand-section">
                <h1 class="brand-title">Campux</h1>
                <span class="brand-subtitle">{{ $store.state.metadata.brand }}</span>
            </div>
        </div>
        <div class="modern-admin-announcement" v-if="adminAnnouncement.show">
            <div class="announcement-wrapper">
                <div class="announcement-icon">
                    <v-icon color="white" size="20">mdi-bullhorn</v-icon>
                </div>
                <div class="announcement-content">
                    <div class="announcement-text">{{ adminAnnouncement.content }}</div>
                    <v-btn v-if="adminAnnouncement.link.url !== ''"
                           :href="adminAnnouncement.link.url"
                           class="announcement-link-btn"
                           variant="outlined"
                           size="small"
                           target="_blank">
                        {{ adminAnnouncement.link.text }}
                    </v-btn>
                </div>
                <v-btn
                    class="announcement-close-btn"
                    @click="dismissAdminAnnouncement"
                    icon="mdi-close"
                    variant="text"
                    size="small">
                </v-btn>
            </div>
        </div>
        <div class="modern-banner" v-if="$store.state.metadata.banner !== ''">
            <div class="banner-content">
                <v-icon class="banner-icon" color="white" size="18">mdi-information</v-icon>
                <span class="banner-text">{{ $store.state.metadata.banner }}</span>
            </div>
        </div>

        <!-- 待审核提示 -->
        <div class="pending-alert" v-if="isPending">
            <div class="alert-content">
                <v-icon color="#f59e0b" size="20">mdi-clock-outline</v-icon>
                <div class="alert-text">
                    <div class="alert-title">稿件待审核</div>
                    <div class="alert-message">你当前有一条待审核的投稿，请等待审核后再来投稿。</div>
                </div>
            </div>
        </div>

        <!-- 主要内容区域 -->
        <div class="main-content">
            <!-- 投稿编辑区 -->
            <div class="post-editor-section">
                <div class="editor-header">
                    <v-dialog max-width="500">
                        <template v-slot:activator="{ props: activatorProps }">
                            <div v-bind="activatorProps" class="user-avatar">
                                <img :src="$store.state.account.avatarUrl" alt="用户头像">
                                <div class="avatar-overlay">
                                    <v-icon color="white" size="16">mdi-logout</v-icon>
                                </div>
                            </div>
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
                    <div class="editor-input-wrapper">
                        <textarea
                            :readonly="isPending"
                            v-model="post.text"
                            placeholder="有什么新鲜事？！"
                            class="modern-post-textarea">
                        </textarea>
                    </div>
                </div>
            </div>

            <!-- 图片上传区 -->
            <div class="image-upload-section">
                <div class="uploaded-images">
                    <div v-for="(image, index) in postImageBlobs"
                         :key="index"
                         class="image-preview"
                         @click="selectedIndex = index; showDeleteImageDialog = true">
                        <img :src="image" alt="上传的图片">
                        <div class="image-overlay">
                            <v-icon color="white" size="16">mdi-close</v-icon>
                        </div>
                    </div>
                    <div class="add-image-btn" @click="selectImage">
                        <v-icon color="#6b7280" size="24">mdi-plus</v-icon>
                        <span class="add-image-text">添加图片</span>
                    </div>
                </div>
            </div>

            <!-- 标签选择区 -->
            <div class="tags-section">
                <div class="section-header">
                    <v-icon color="#ec4899" size="18">mdi-tag</v-icon>
                    <span class="section-title">选择标签</span>
                </div>
                <div class="tags-container">
                    <div v-for="(tag, index) in tags"
                         :key="index"
                         class="tag-item"
                         :class="{ 'tag-selected': tag.selected }"
                         @click="selectTag(index)">
                        {{ tag.name }}
                    </div>
                </div>
                <div class="tag-hint">
                    <v-icon color="#6b7280" size="14">mdi-lightbulb-outline</v-icon>
                    <span>添加标签可更快过审，不要选择不完全符合内容的标签</span>
                </div>
            </div>

            <!-- 投稿选项区 -->
            <div class="post-options-section">
                <!-- 匿名投稿 -->
                <div class="option-card">
                    <div class="option-content">
                        <div class="option-info">
                            <v-icon color="#10b981" size="20">mdi-incognito</v-icon>
                            <div class="option-text">
                                <div class="option-title">匿名投稿</div>
                                <div class="option-desc">隐藏你的身份信息</div>
                            </div>
                        </div>
                        <v-switch
                            v-model="post.anon"
                            color="#10b981"
                            hide-details
                            density="compact">
                        </v-switch>
                    </div>
                </div>

                <!-- 投稿规则 -->
                <v-dialog max-width="500">
                    <template v-slot:activator="{ props: activatorProps }">
                        <div v-bind="activatorProps" class="option-card clickable">
                            <div class="option-content">
                                <div class="option-info">
                                    <v-icon color="#f59e0b" size="20">mdi-clipboard-text</v-icon>
                                    <div class="option-text">
                                        <div class="option-title">投稿规则</div>
                                        <div class="option-desc">请务必遵守社区规范</div>
                                    </div>
                                </div>
                                <v-icon color="#6b7280" size="16">mdi-chevron-right</v-icon>
                            </div>
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
            </div>

            <!-- 投稿按钮区 -->
            <div class="submit-section-no-card">
                <button v-if="!isPending && $store.state.account.uin !== 0"
                        @click="letsPost"
                        class="submit-btn"
                        :disabled="loading">
                    <v-icon v-if="!loading" size="18">mdi-send</v-icon>
                    <v-progress-circular v-if="loading" :size="18" color="white" indeterminate></v-progress-circular>
                    <span>{{ loading ? '发布中...' : '发布投稿' }}</span>
                </button>
            </div>
        </div>

        <!-- 页面底部信息 -->
        <div class="page-footer">
            <div class="footer-info">
                <span class="icp-info">{{ $store.state.metadata.beianhao }}</span>
            </div>
        </div>

        <!-- 对话框 -->
        <v-dialog v-model="showDeleteImageDialog" width="auto">
            <v-card text="要删除吗？" title="提示">
                <template v-slot:actions>
                    <v-btn class="ms-auto" text="不是" @click="showDeleteImageDialog = false"></v-btn>
                    <v-btn class="ms-auto" text="是的"
                        @click="showDeleteImageDialog = false; removeImage(selectedIndex)"></v-btn>
                </template>
            </v-card>
        </v-dialog>

        <v-dialog v-model="popupAnnouncement.show" max-width="400" width="90%">
            <div class="modern-welcome-dialog-wrapper">
                <div class="modern-welcome-dialog">
                    <div class="welcome-header">
                        <div class="welcome-icon">
                            <span class="welcome-emoji">🎉</span>
                        </div>
                        <h3 class="welcome-title">欢迎使用 Campux</h3>
                    </div>

                    <div class="welcome-body">
                        <p class="welcome-message">{{ popupAnnouncement.content }}</p>

                        <div class="welcome-features">
                            <div class="feature-item">
                                <v-icon class="feature-icon" color="#10b981">mdi-pencil</v-icon>
                                <span>发布校园动态</span>
                            </div>
                            <div class="feature-item">
                                <v-icon class="feature-icon" color="#3b82f6">mdi-heart</v-icon>
                                <span>互动交流</span>
                            </div>
                            <div class="feature-item">
                                <v-icon class="feature-icon" color="#f59e0b">mdi-star</v-icon>
                                <span>发现精彩</span>
                            </div>
                        </div>
                    </div>

                    <div class="welcome-footer">
                        <v-btn
                            class="welcome-btn"
                            @click="closePopupAnnouncement"
                            variant="flat"
                        >
                            <v-icon class="mr-1" size="16">mdi-check</v-icon>
                            开始使用
                        </v-btn>
                        <p class="reminder-text">1 天内不再提醒</p>
                    </div>
                </div>
            </div>
        </v-dialog>

        <!-- 通知栏 -->
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

/* 现代化欢迎弹窗样式 */
.modern-welcome-dialog-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
}

.modern-welcome-dialog {
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(20px);
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow:
        0 25px 50px rgba(0, 0, 0, 0.15),
        0 0 0 1px rgba(255, 255, 255, 0.1) inset;
    overflow: hidden;
    width: 100%;
    min-width: 320px;
    max-width: 420px;
    margin: 20px;
}

.welcome-header {
    background: linear-gradient(135deg, #f8fafc, #e2e8f0);
    padding: 2rem 2rem 1.5rem;
    text-align: center;
    border-bottom: 1px solid rgba(226, 232, 240, 0.5);
}

.welcome-icon {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #fef3c7, #fbbf24);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1rem;
    box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3);
}

.welcome-emoji {
    font-size: 2rem;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.welcome-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1f2937;
    margin: 0;
    letter-spacing: -0.01em;
}

.welcome-body {
    padding: 2rem;
}

.welcome-message {
    color: #4b5563;
    font-size: 1rem;
    line-height: 1.6;
    margin: 0 0 2rem 0;
    text-align: center;
}

.welcome-features {
    display: flex;
    justify-content: space-around;
    gap: 1rem;
    margin-bottom: 1rem;
}

.feature-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    padding: 1rem 0.5rem;
    background: rgba(248, 250, 252, 0.8);
    border-radius: 12px;
    border: 1px solid rgba(226, 232, 240, 0.5);
}

.feature-icon {
    font-size: 1.5rem;
}

.feature-item span {
    font-size: 0.85rem;
    font-weight: 500;
    color: #6b7280;
    text-align: center;
}

.welcome-footer {
    background: rgba(248, 250, 252, 0.8);
    padding: 1.5rem 2rem;
    text-align: center;
    border-top: 1px solid rgba(226, 232, 240, 0.5);
}

.welcome-btn {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: white;
    border-radius: 12px;
    padding: 12px 32px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0.025em;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    border: none;
    margin-bottom: 0.5rem;
}

.reminder-text {
    font-size: 0.8rem;
    color: #9ca3af;
    margin: 0;
    font-weight: 400;
}

/* 欢迎弹窗移动端适配 */
@media (max-width: 768px) {
    .modern-welcome-dialog {
        min-width: 300px;
        max-width: 360px;
        margin: 12px;
        border-radius: 18px;
    }

    .welcome-header {
        padding: 1.25rem 1.25rem 1rem;
    }

    .welcome-icon {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        margin-bottom: 0.75rem;
    }

    .welcome-emoji {
        font-size: 1.6rem;
    }

    .welcome-title {
        font-size: 1.2rem;
    }

    .welcome-body {
        padding: 1.25rem;
    }

    .welcome-message {
        font-size: 0.9rem;
        margin-bottom: 1.25rem;
    }

    .welcome-features {
        gap: 0.75rem;
        margin-bottom: 1rem;
    }

    .feature-item {
        padding: 0.75rem 0.5rem;
        border-radius: 10px;
    }

    .feature-icon {
        font-size: 1.2rem;
    }

    .feature-item span {
        font-size: 0.75rem;
    }

    .welcome-footer {
        padding: 1.25rem;
    }

    .welcome-btn {
        padding: 10px 24px;
        font-size: 0.9rem;
        border-radius: 10px;
    }

    .reminder-text {
        font-size: 0.75rem;
    }
}

/* 投稿页面整体布局 */
.post-page-container {
    min-height: 100vh;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
    display: flex;
    flex-direction: column;
}

/* 页面头部 */
.page-header {
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    padding: 16px 20px;
    position: sticky;
    top: 0;
    z-index: 10;
}

.brand-section {
    display: flex;
    align-items: baseline;
    gap: 12px;
}

.brand-title {
    font-family: 'Lilita One', cursive;
    font-size: 28px;
    font-weight: 400;
    color: #1e293b;
    margin: 0;
}

.brand-subtitle {
    color: #64748b;
    font-size: 14px;
    font-weight: 500;
}

/* 待审核提示 */
.pending-alert {
    background: linear-gradient(135deg, #fef3c7, #fde68a);
    border-left: 4px solid #f59e0b;
    margin: 20px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.15);
}

.alert-content {
    display: flex;
    align-items: flex-start;
    padding: 16px;
    gap: 12px;
}

.alert-text {
    flex: 1;
}

.alert-title {
    font-weight: 600;
    color: #92400e;
    font-size: 15px;
    margin-bottom: 4px;
}

.alert-message {
    color: #a16207;
    font-size: 14px;
    line-height: 1.5;
}

/* 主要内容区域 */
.main-content {
    flex: 1;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
    padding: 20px;
}

/* 投稿编辑区 */
.post-editor-section {
    background: white;
    border-radius: 16px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    margin-bottom: 20px;
    overflow: hidden;
}

.editor-header {
    display: flex;
    padding: 20px;
    gap: 16px;
    align-items: flex-start;
}

.user-avatar {
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
}

.user-avatar img {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
}

.avatar-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.user-avatar:hover .avatar-overlay {
    opacity: 1;
}

.editor-input-wrapper {
    flex: 1;
}

.modern-post-textarea {
    width: 100%;
    min-height: 120px;
    border: none;
    outline: none;
    resize: vertical;
    font-size: 16px;
    line-height: 1.6;
    color: #1e293b;
    background: transparent;
    font-family: inherit;
}

.modern-post-textarea::placeholder {
    color: #94a3b8;
}

/* 图片上传区 */
.image-upload-section {
    padding: 0 20px 20px;
}

.uploaded-images {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.image-preview {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
}

.image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.image-overlay {
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.image-preview:hover .image-overlay {
    opacity: 1;
}

.add-image-btn {
    width: 80px;
    height: 80px;
    border: 2px dashed #cbd5e1;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    gap: 4px;
}

.add-image-btn:hover {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
}

.add-image-text {
    font-size: 11px;
    color: #6b7280;
    text-align: center;
}

/* 现代化管理员公告样式 */
.modern-admin-announcement {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    margin: 0;
    padding: 0;
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.2);
}

.announcement-wrapper {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    gap: 12px;
}

.announcement-icon {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.announcement-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.announcement-text {
    color: white;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
}

.announcement-link-btn {
    align-self: flex-start;
    border-color: rgba(255, 255, 255, 0.3) !important;
    color: white !important;
    font-size: 12px !important;
    height: 28px !important;
}

.announcement-close-btn {
    color: rgba(255, 255, 255, 0.8) !important;
    flex-shrink: 0;
}

/* 现代化横幅样式 */
.modern-banner {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    padding: 12px 16px;
    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
}

.banner-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.banner-icon {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 4px;
}

.banner-text {
    color: white;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
}

/* 现代化匿名选项样式 */
.modern-anonymous-option {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 12px;
    margin: 12px 0;
    padding: 16px;
}

.anonymous-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.anonymous-info {
    display: flex;
    align-items: center;
    gap: 8px;
}

.anonymous-text {
    color: #065f46;
    font-weight: 500;
    font-size: 15px;
}

.anonymous-switch {
    flex-shrink: 0;
}

/* 现代化规则卡片样式 */
.modern-rules-card {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 12px;
    margin: 12px 0;
    padding: 16px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.rules-content {
    display: flex;
    align-items: center;
    gap: 10px;
}

.rules-text {
    flex: 1;
    color: #92400e;
    font-size: 15px;
    font-weight: 500;
}

.rules-arrow {
    flex-shrink: 0;
}

/* 标签选择区 */
.tags-section {
    background: white;
    border-radius: 16px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    padding: 20px;
    margin-bottom: 20px;
}

.section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
}

.section-title {
    font-weight: 600;
    color: #1e293b;
    font-size: 16px;
}

.tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
}

.tag-item {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    padding: 6px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
}

.tag-item:hover {
    background: #e2e8f0;
    border-color: #cbd5e1;
}

.tag-selected {
    background: #3b82f6 !important;
    color: white !important;
    border-color: #3b82f6 !important;
}

.tag-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #6b7280;
}

/* 投稿选项区 */
.post-options-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
}

.option-card {
    background: white;
    border-radius: 16px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    padding: 20px;
    transition: all 0.2s ease;
}

.option-card.clickable {
    cursor: pointer;
}

.option-card.clickable:hover {
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1);
}

.option-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.option-info {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
}

.option-text {
    flex: 1;
}

.option-title {
    font-weight: 600;
    color: #1e293b;
    font-size: 15px;
    margin-bottom: 2px;
}

.option-desc {
    color: #64748b;
    font-size: 13px;
}

/* 投稿按钮区 */
.submit-section-no-card {
    text-align: center;
    margin-bottom: 20px;
    padding: 0;
}

.submit-btn {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: white;
    border: none;
    border-radius: 12px;
    padding: 14px 32px;
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    transition: all 0.2s ease;
    min-width: 140px;
    justify-content: center;
}

.submit-btn:disabled {
    opacity: 0.8;
    cursor: not-allowed;
}

/* 页面底部 */
.page-footer {
    background: white;
    border-top: 1px solid #e2e8f0;
    padding: 16px 20px;
    text-align: center;
    margin-top: auto;
}

.footer-info {
    max-width: 600px;
    margin: 0 auto;
}

.icp-info {
    font-size: 12px;
    color: #94a3b8;
}

@media (max-width: 480px) {
    .modern-welcome-dialog {
        min-width: 280px;
        max-width: 340px;
        margin: 10px;
        border-radius: 16px;
    }

    .welcome-header {
        padding: 1rem 1rem 0.75rem;
    }

    .welcome-icon {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        margin-bottom: 0.5rem;
    }

    .welcome-emoji {
        font-size: 1.4rem;
    }

    .welcome-title {
        font-size: 1.1rem;
    }

    .welcome-body {
        padding: 1rem;
    }

    .welcome-message {
        font-size: 0.85rem;
        margin-bottom: 1rem;
        line-height: 1.5;
    }

    .welcome-features {
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }

    .feature-item {
        flex-direction: row;
        justify-content: flex-start;
        padding: 0.625rem 0.75rem;
        border-radius: 8px;
        gap: 0.5rem;
    }

    .feature-icon {
        font-size: 1rem;
        flex-shrink: 0;
    }

    .feature-item span {
        font-size: 0.75rem;
        text-align: left;
        line-height: 1.3;
    }

    .welcome-footer {
        padding: 1rem;
    }

    .welcome-btn {
        padding: 8px 20px;
        font-size: 0.85rem;
        border-radius: 8px;
        margin-bottom: 0.5rem;
    }

    .reminder-text {
        font-size: 0.7rem;
    }
}

/* 投稿页面移动端适配 */
@media (max-width: 768px) {
    .page-header {
        padding: 12px 16px;
    }

    .brand-title {
        font-size: 24px;
    }

    .brand-subtitle {
        font-size: 13px;
    }

    .main-content {
        padding: 16px;
    }

    .pending-alert {
        margin: 16px;
        border-radius: 10px;
    }

    .alert-content {
        padding: 14px;
        gap: 10px;
    }

    .post-editor-section {
        border-radius: 12px;
        margin-bottom: 16px;
    }

    .editor-header {
        padding: 16px;
        gap: 12px;
    }

    .user-avatar img {
        width: 44px;
        height: 44px;
    }

    .modern-post-textarea {
        font-size: 15px;
        min-height: 100px;
    }

    .image-upload-section {
        padding: 0 16px 16px;
    }

    .image-preview, .add-image-btn {
        width: 70px;
        height: 70px;
        border-radius: 10px;
    }

    .tags-section {
        padding: 16px;
        margin-bottom: 16px;
        border-radius: 12px;
    }

    .section-title {
        font-size: 15px;
    }

    .tag-item {
        padding: 5px 12px;
        font-size: 13px;
        border-radius: 16px;
    }

    .tag-hint {
        font-size: 12px;
    }

    .post-options-section {
        gap: 10px;
        margin-bottom: 16px;
    }

    .option-card {
        padding: 16px;
        border-radius: 12px;
    }

    .option-content {
        gap: 12px;
    }

    .option-info {
        gap: 10px;
    }

    .option-title {
        font-size: 14px;
    }

    .option-desc {
        font-size: 12px;
    }

    .submit-section-no-card {
        margin-bottom: 16px;
    }

    .submit-btn {
        padding: 12px 28px;
        font-size: 15px;
        border-radius: 10px;
        min-width: 120px;
    }

    .page-footer {
        padding: 12px 16px;
    }
}

@media (max-width: 480px) {
    .page-header {
        padding: 10px 12px;
    }

    .brand-title {
        font-size: 22px;
    }

    .brand-subtitle {
        font-size: 12px;
    }

    .main-content {
        padding: 12px;
    }

    .pending-alert {
        margin: 12px;
        border-radius: 8px;
    }

    .alert-content {
        padding: 12px;
        gap: 8px;
    }

    .alert-title {
        font-size: 14px;
    }

    .alert-message {
        font-size: 13px;
    }

    .post-editor-section {
        border-radius: 10px;
        margin-bottom: 12px;
    }

    .editor-header {
        padding: 14px;
        gap: 10px;
    }

    .user-avatar img {
        width: 40px;
        height: 40px;
    }

    .modern-post-textarea {
        font-size: 14px;
        min-height: 90px;
    }

    .image-upload-section {
        padding: 0 14px 14px;
    }

    .uploaded-images {
        gap: 8px;
    }

    .image-preview, .add-image-btn {
        width: 60px;
        height: 60px;
        border-radius: 8px;
    }

    .add-image-text {
        font-size: 10px;
    }

    .tags-section {
        padding: 14px;
        margin-bottom: 12px;
        border-radius: 10px;
    }

    .section-title {
        font-size: 14px;
    }

    .tags-container {
        gap: 6px;
    }

    .tag-item {
        padding: 4px 10px;
        font-size: 12px;
        border-radius: 14px;
    }

    .tag-hint {
        font-size: 11px;
        gap: 4px;
    }

    .post-options-section {
        gap: 8px;
        margin-bottom: 12px;
    }

    .option-card {
        padding: 14px;
        border-radius: 10px;
    }

    .option-content {
        gap: 10px;
    }

    .option-info {
        gap: 8px;
    }

    .option-title {
        font-size: 13px;
    }

    .option-desc {
        font-size: 11px;
    }

    .submit-section-no-card {
        margin-bottom: 12px;
    }

    .submit-btn {
        padding: 10px 24px;
        font-size: 14px;
        border-radius: 8px;
        min-width: 100px;
    }

    .page-footer {
        padding: 10px 12px;
    }

    .icp-info {
        font-size: 11px;
    }
}
</style>