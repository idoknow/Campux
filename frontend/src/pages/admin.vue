<template>

    <div>
        <h2 id="mt" style="padding: 8px 16px; font-family: Lilita One; display: inline-block">Campux</h2>
        <span>{{ $store.state.metadata.brand }}</span>
    </div>
    <v-tabs id="tabs" v-model="tab" align-tabs="center" color="deep-purple-accent-4" show-arrows>
        <v-tab value="1">🪪 账号</v-tab>
        <v-tab value="2">🚫 封禁记录</v-tab>
        <v-tab value="3" v-if="$store.state.account.userGroup === 'admin' || $store.state.account.userGroup === 'member'">🧩 元数据</v-tab>
        <v-tab value="4" v-if="$store.state.account.userGroup === 'admin'">🔑 OAuth 2 应用</v-tab>
        <v-tab value="5" v-if="$store.state.account.userGroup === 'admin'">🔗 Webhook</v-tab>
    </v-tabs>

    <v-divider id="hdivider"></v-divider>

    <v-window v-model="tab" disabled>
        <v-window-item value="1">
            <div style="padding: 16px;">
                <!--UIN搜索框-->
                <div id="accountFilter">
                    <div style="display: flex;flex-direction: row;">

                        <v-text-field v-model="filter.uin" label="输入UIN搜索" variant="solo"
                            style="margin-bottom: 0px"></v-text-field>
                        <v-select v-model="filter.user_group" label="按用户组筛选" style="margin-inline: 10px;width: 30px"
                            :items="['any', 'user', 'member', 'admin']" variant="solo"></v-select>

                        <v-btn @click="getAccounts" color="primary" style="margin-top: 8px; " size="large" :loading="accountRefreshing">查找</v-btn>
                    </div>
                </div>
                <v-pagination :length="accountPages" v-model="filter.page" style="margin-top: -10px"
                    @update:model-value="getAccounts"></v-pagination>
                <div
                    style="overflow-y: scroll; max-height: calc(100vh - 260px); min-height: calc(100vh - 360px);margin-top: 10px">
                    <!-- <PostCard v-for="p in posts" :key="p.id" :post="p" typ="self" style="margin-top: 16px"
                                @recall="recallPost" /> -->

                    <AccountCard v-for="a in accounts" :key="a.id" :account="a" style="margin-top: 16px"
                        @changeGroup="changeGroup" @banAccount="banAccount" @toast="toast" />
                </div>
            </div>
        </v-window-item>
        <v-window-item value="2">
            <div style="padding: 16px;">
                <!--UIN搜索框-->
                <div id="accountFilter">
                    <div style="display: flex;flex-direction: row;">

                        <v-text-field v-model="filter.uin" label="输入UIN搜索" variant="solo"></v-text-field>

                        <v-checkbox v-model="banListFilter.only_valid" label="仅生效中的" style="margin-inline: 10px;"
                            @change="getBanList"></v-checkbox>
                        <v-btn @click="getBanList" color="primary" style="margin-top: 8px; " size="large" :loading="banlistRefreshing">查找</v-btn>
                    </div>
                </div>

                <v-pagination :length="banPages" v-model="banListFilter.page" style="margin-top: -10px"
                    @update:model-value="getBanList"></v-pagination>
                <div
                    style="overflow-y: scroll; max-height: calc(100vh - 260px); min-height: calc(100vh - 360px);margin-top: 10px">
                    <BanRecordCard v-for="b in banRecords" :key="b.id" :banRecord="b" style="margin-top: 16px"
                        @unban="unban" @toast="toast" />
                </div>
            </div>
        </v-window-item>
        <v-window-item value="3">
            <div style="padding: 16px;">
                <v-btn color="primary" @click="getMetadataList" :loading="metadataListRefreshing">刷新</v-btn>
                <v-btn color="primary" style="margin-inline: 0.8rem;" @click="saveMetadata" :loading="metadataListRefreshing">保存所有</v-btn>
                <div
                    style="overflow-y: scroll; max-height: calc(100vh - 260px); min-height: calc(100vh - 360px);margin-top: 2rem;">
                    <div v-for="m in metadataList" :key="m.key" style="margin-top: 0px; display: flex; align-items: center;margin-inline: 10px;">
                        <v-text-field v-model="m.value" :label="m.key" variant="solo" style="flex-grow: 1;"></v-text-field>
                    </div>
                </div>
            </div>
        </v-window-item>
        <v-window-item value="4">
            <div style="padding: 16px;">
                <!--操作按钮-->
                <div id="oauthOps">
                    <v-btn color="primary" @click="showOAuthAppCreateDialog = true">新建 OAuth2 应用</v-btn>
                    <v-btn color="primary" style="margin-inline: 0.8rem;" @click="getOAuthApps" :loading="oauthRefreshing">刷新</v-btn>
                </div>

                <div
                    style="overflow-y: scroll; max-height: calc(100vh - 260px); min-height: calc(100vh - 360px);margin-top: 2rem">
                    <OAuthAppCard v-for="o in oauthApps" :key="o.name" :oauthApp="o" style="margin-top: 16px"
                        @toast="toast" @deleteApp="deleteOAuthApp" />

                </div>
            </div>
        </v-window-item>
    </v-window>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout" style="margin-bottom: 64px">
        {{ snackbar.text }}
    </v-snackbar>

    <v-dialog v-model="showServiceHint" width="auto">
        <v-card :text="services[selectedService].toast" title="提示">
            <template v-slot:actions>
                <v-btn text="取消" @click="showServiceHint = false;"></v-btn>
                <v-btn class="ms-auto" text="确定"
                    @click="showServiceHint = false; go(services[selectedService].link)"></v-btn>
            </template>
        </v-card>
    </v-dialog>

    <v-dialog v-model="showOAuthAppCreateDialog" width="auto">
        <v-card>
            <v-card-title>新建 OAuth2 应用</v-card-title>
            <v-card-text>
                <v-text-field v-model="newOAuthApp.name" label="应用名称" variant="solo"></v-text-field>
                <div id="emoji-picking">
                    <p id="oauth-emoji">{{ newOAuthApp.emoji }}</p>
                    <EmojiPicker id="oauth-emoji-picker" :native="true" @select="onEmojiSelect" />
                </div>
            </v-card-text>
            <v-card-actions>
                <v-btn text @click="showOAuthAppCreateDialog = false">取消</v-btn>
                <v-btn color="primary" @click="createOAuthApp">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

    <v-window v-model="tab" disabled>
        <v-window-item value="5">
            <div style="padding: 16px;">
                <v-btn color="primary" @click="getWebhookConfig" :loading="webhookRefreshing">刷新</v-btn>
                
                <div style="margin-top: 2rem;">
                    <v-row>
                        <v-col cols="4">
                            <v-text-field 
                                v-model="newWebhookName" 
                                label="Webhook 名称" 
                                variant="solo"
                                placeholder="例如：通知服务"
                                @keyup.enter="addWebhook"
                            ></v-text-field>
                        </v-col>
                        <v-col cols="6">
                            <v-text-field 
                                v-model="newWebhookUrl" 
                                label="Webhook URL" 
                                variant="solo"
                                placeholder="https://your-webhook-endpoint.com/webhook"
                                hint="当新稿件创建时，系统将向此 URL 发送 POST 请求"
                                persistent-hint
                                @keyup.enter="addWebhook"
                            ></v-text-field>
                        </v-col>
                        <v-col cols="2">
                            <v-btn 
                                color="primary" 
                                @click="addWebhook" 
                                :disabled="!newWebhookUrl.trim() || !newWebhookName.trim()"
                                style="height: 56px;"
                            >
                                添加
                            </v-btn>
                        </v-col>
                    </v-row>
                    
                    <v-list v-if="webhookConfig.webhooks.length > 0" style="margin-top: 1rem;">
                        <v-list-item 
                            v-for="webhook in webhookConfig.webhooks" 
                            :key="webhook.id"
                            style="border: 1px solid #e0e0e0; margin-bottom: 8px; border-radius: 4px;"
                        >
                            <v-list-item-content>
                                <v-list-item-title>{{ webhook.name }}</v-list-item-title>
                                <v-list-item-subtitle>{{ webhook.url }}</v-list-item-subtitle>
                            </v-list-item-content>
                            <v-list-item-action>
                                <v-chip 
                                    :color="webhook.enabled ? 'success' : 'error'" 
                                    size="small" 
                                    style="margin-right: 8px;"
                                >
                                    {{ webhook.enabled ? '启用' : '禁用' }}
                                </v-chip>
                                <v-btn 
                                    color="error" 
                                    variant="text" 
                                    size="small"
                                    @click="deleteWebhook(webhook.id)"
                                >
                                    删除
                                </v-btn>
                            </v-list-item-action>
                        </v-list-item>
                    </v-list>
                    
                    <v-alert 
                        v-if="webhookConfig.webhooks.length === 0" 
                        type="info" 
                        variant="outlined"
                        style="margin-top: 1rem;"
                    >
                        暂无配置的 Webhook
                    </v-alert>
                    
                    <v-card style="margin-top: 1rem;" variant="outlined">
                        <v-card-title>Webhook 事件格式</v-card-title>
                        <v-card-text>
                            <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto;">{{
                                JSON.stringify({
                                    event: "post.created",
                                    timestamp: 1640995200,
                                    data: {
                                        post_id: 123,
                                        uuid: "550e8400-e29b-41d4-a716-446655440000",
                                        uin: 123456789,
                                        text: "稿件内容",
                                        images: ["image1.jpg", "image2.jpg"],
                                        anon: false,
                                        created_at: 1640995200
                                    }
                                }, null, 2)
                            }}</pre>
                        </v-card-text>
                    </v-card>
                </div>
            </div>
        </v-window-item>
    </v-window>

</template>

<script>
import AccountCard from '@/components/AccountCard.vue';
import BanRecordCard from '@/components/BanRecordCard.vue';
import OAuthAppCard from '@/components/OAuthAppCard.vue';

import EmojiPicker from 'vue3-emoji-picker'
import 'vue3-emoji-picker/css'

export default {
    components: {
        AccountCard,
        BanRecordCard,
        OAuthAppCard,
        EmojiPicker
    },
    data() {
        return {
            showServiceHint: false,
            selectedService: -1,
            services: [],
            password: "",
            snackbar: {
                show: false,
                text: '',
                color: ''
            },
            value: 2,
            displayInnerWindow: '',
            tab: null,
            accounts: [],
            accountRefreshing: false,
            filter: {
                uin: '',
                user_group: 'any',
                time_order: 1,
                page: 1,
                page_size: 10
            },
            accountPages: 1,
            banListFilter: {
                uin: -1,
                only_valid: true,
                page: 1,
                page_size: 10,
                time_order: -1
            },
            banlistRefreshing: false,
            banRecords: [],
            banPages: 1,
            oauthApps: [],
            oauthRefreshing: false,
            showOAuthAppCreateDialog: false,
            newOAuthApp: {
                name: '',
                emoji: '🥰',
            },
            metadataList: [],
            metadataListRefreshing: false,
            saveMetadataLoading: false,
            webhookConfig: {
                webhooks: []
            },
            newWebhookName: '',
            newWebhookUrl: '',
            webhookRefreshing: false,
            webhookSaving: false,
        }
    },

    watch: {
        tab() {
            if (this.tab === '1') {
                this.getAccounts()
            } else if (this.tab === '2') {
                this.getBanList()
            } else if (this.tab === '4') {
                this.getOAuthApps()
            } else if (this.tab === '3') {
                this.getMetadataList()
            } else if (this.tab === '5') {
                this.getWebhookConfig()
            }
        }
    },

    mounted() {
    },

    methods: {

        randomColor() {
            let colors = ["#FFC107", "#42A5F5", "#9CCC65", "#F06292", "#76FF03", "#9E9E9E", "#8D6E63"]
            return colors[Math.floor(Math.random() * 100) % colors.length]
        },
        getMetadata_(key) {
            this.$axios.get('/v1/misc/get-metadata?key=' + key)
                .then(res => {
                    if (res.data.code === 0) {
                        this.services = JSON.parse(res.data.data.value)
                        console.log(this.services)
                        for (let i = 0; i < this.services.length; i++) {
                            if (!this.services[i].toast) {
                                this.services[i].toast = '点击确定跳转到 ' + this.services[i].link
                            }
                            this.services[i].color = "background-color: " + this.randomColor() + ";"
                        }
                    } else {
                        this.toast('获取服务失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取失败：' + err)
                    console.error(err)
                })
        },
        toast(text, color = 'error') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        },

        go(url) {
            // this.displayInnerWindow = url
            window.open(url, '_blank')
        },

        getAccounts() {
            if (this.filter.uin === '') {
                this.filter.uin = -1
            } else {
                this.filter.uin = parseInt(this.filter.uin)
            }

            this.accountRefreshing = true

            this.$axios.post('/v1/account/get-accounts', this.filter)
                .then(res => {
                    if (res.data.code === 0) {
                        this.accounts = res.data.data.list

                        for (let i = 0; this.accounts != null && i < this.accounts.length; i++) {
                            let date = new Date(this.accounts[i].created_at)

                            this.accounts[i].created_at = date.toLocaleString()
                        }
                        this.accountPages = Math.ceil(res.data.data.total / this.filter.page_size)
                    } else {
                        this.toast('获取账号失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取账号失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.accountRefreshing = false
                })
        },

        changeGroup(account, newGroup) {
            this.$axios.put('/v1/account/change-group', {
                uin: account.uin,
                new_group: newGroup
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('修改成功', 'success')
                        account.user_group = newGroup
                    } else {
                        this.toast('修改失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('修改失败：' + err)
                    console.error(err)
                })
        },


        banAccount(account, reason, date) {
            this.$axios.post('/v1/account/ban-account', {
                uin: account.uin,
                comment: reason,
                end_time: date.getTime() / 1000
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('封禁成功', 'success')
                    } else {
                        this.toast('封禁失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('封禁失败：' + err)
                    console.error(err)
                })
        },


        getBanList() {

            if (this.banListFilter.uin === '') {
                this.banListFilter.uin = -1
            } else {
                this.banListFilter.uin = parseInt(this.banListFilter.uin)
            }
            this.banlistRefreshing = true
            this.$axios.post('/v1/account/get-ban-list', this.banListFilter)
                .then(res => {
                    if (res.data.code === 0) {
                        this.banRecords = res.data.data.list

                        let now = new Date()

                        for (let i = 0; this.banRecords != null && i < this.banRecords.length; i++) {
                            let startDateTime = new Date(this.banRecords[i].start_time)
                            let endDateTime = new Date(this.banRecords[i].end_time)

                            this.banRecords[i].start_time = startDateTime.toLocaleString()
                            this.banRecords[i].end_time = endDateTime.toLocaleString()
                            this.banRecords[i].valid = endDateTime > now
                        }

                        this.banPages = Math.ceil(res.data.data.total / this.banListFilter.page_size)
                    } else {
                        this.toast('获取封禁列表失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取封禁列表失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.banlistRefreshing = false
                })
        },

        unban(uin) {
            this.$axios.put('/v1/account/unban-account', {
                uin: uin
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('解封成功', 'success')
                        this.getBanList()
                    } else {
                        this.toast('解封失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('解封失败：' + err)
                    console.error(err)
                })
        },

        getOAuthApps() {
            this.oauthRefreshing = true

            this.$axios.get('/v1/admin/get-oauth2-apps')
                .then(res => {
                    if (res.data.code === 0) {
                        this.oauthApps = res.data.data.list
                        console.log(this.oauthApps)
                    } else {
                        this.toast('获取OAuth应用失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取OAuth应用失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.oauthRefreshing = false
                })
        },
        onEmojiSelect(emoji) {
            this.newOAuthApp.emoji = emoji.i
        },
        createOAuthApp() {

            if (this.newOAuthApp.name === '') {
                this.toast('应用名称不能为空')
                return
            }

            this.$axios.post('/v1/admin/add-oauth2-app', this.newOAuthApp)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('创建成功', 'success')
                        this.getOAuthApps()
                        this.showOAuthAppCreateDialog = false
                        this.newOAuthApp.name = ''
                        this.newOAuthApp.emoji = '🥰'
                    } else {
                        this.toast('创建失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('创建失败：' + err)
                    console.error(err)
                })
        },
        deleteOAuthApp(appID) {
            this.$axios.delete('/v1/admin/del-oauth2-app/'+appID)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('删除成功', 'success')
                        this.getOAuthApps()
                    } else {
                        this.toast('删除失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('删除失败：' + err)
                    console.error(err)
                })
        },
        getMetadataList() {
            this.metadataListRefreshing = true
            this.$axios.get('/v1/misc/get-metadata-list')
                .then(res => {
                    if (res.data.code === 0) {
                        this.metadataList = res.data.data.list
                    } else {
                        this.toast('获取元数据失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取元数据失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.metadataListRefreshing = false
                })
        },
        saveMetadata() {
            this.saveMetadataLoading = true
            this.$axios.put('/v1/misc/save-metadatas', {
                list: this.metadataList
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('保存成功', 'success')
                    } else {
                        this.toast('保存失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('保存失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.saveMetadataLoading = false
                })
        },

        getWebhookConfig() {
            this.webhookRefreshing = true
            this.$axios.get('/v1/admin/get-webhook-config')
                .then(res => {
                    if (res.data.code === 0) {
                        this.webhookConfig.webhooks = res.data.data.webhooks || []
                    } else {
                        this.toast('获取 Webhook 配置失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取 Webhook 配置失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.webhookRefreshing = false
                })
        },
        
        addWebhook() {
            const name = this.newWebhookName.trim()
            const url = this.newWebhookUrl.trim()
            if (!name || !url) return
            
            this.webhookSaving = true
            this.$axios.post('/v1/admin/add-webhook', {
                name: name,
                url: url
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('添加 Webhook 成功', 'success')
                        this.newWebhookName = ''
                        this.newWebhookUrl = ''
                        this.getWebhookConfig()
                    } else {
                        this.toast('添加 Webhook 失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('添加 Webhook 失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.webhookSaving = false
                })
        },
        
        deleteWebhook(id) {
            this.webhookSaving = true
            this.$axios.delete(`/v1/admin/delete-webhook/${id}`)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('删除 Webhook 成功', 'success')
                        this.getWebhookConfig()
                    } else {
                        this.toast('删除 Webhook 失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('删除 Webhook 失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.webhookSaving = false
                })
        }
    }
}

</script>

<style>
.rect1 {
    cursor: pointer;
    padding: 16px;
    font-size: 18px;
    border-radius: 7px;
    color: #fff;
    margin-top: 8px;
    width: 95%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.11);
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: box-shadow 0.2s;
}

.rect1:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

#container-wrap {
    min-height: 74vh;
}

#emoji-picking {
    display: flex;
    flex-direction: row;
}

#oauth-emoji {
    font-size: 48px;
    text-align: center;
    margin-right: 1rem;
}

#oauth-emoji-picker {
    width: 15rem;
    height: 17rem;
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
        height: 100%;
        margin-left: 16px;
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
