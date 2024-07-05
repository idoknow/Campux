<template>

    <BottomNavBar id="bnb" v-model="value" @input="go" />

    <div>
        <h2 id="mt" style="padding: 8px 16px; font-family: Lilita One; display: inline-block">Campux</h2>
        <span>{{ $store.state.metadata.brand }}</span>
    </div>
    <v-tabs id="tabs" v-model="tab" align-tabs="center" color="deep-purple-accent-4" show-arrows>
        <v-tab value="1">🪪 账号</v-tab>
        <v-tab value="2">🚫 封禁记录</v-tab>
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

                        <v-btn @click="getAccounts" color="primary" style="margin-top: 8px; " size="large">查找</v-btn>
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
                        <v-btn @click="getBanList" color="primary" style="margin-top: 8px; " size="large">查找</v-btn>
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

</template>

<script>
import BottomNavBar from '@/components/BottomNavBar.vue';
import AccountCard from '@/components/AccountCard.vue';
import BanRecordCard from '@/components/BanRecordCard.vue';

export default {
    components: {
        BottomNavBar
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
            avatarUrl: '',
            uin: '',
            userGroup: 'user',
            tab: null,
            accounts: [],
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
            banRecords: [],
            banPages: 1
        }
    },

    watch: {
        tab() {
            if (this.tab === '1') {
                this.getAccounts()
            } else if (this.tab === '2') {
                this.getBanList()
            }
        }
    },

    mounted() {
        this.tokenLogin()
    },

    methods: {

        tokenLogin() {
            this.$axios.get('/v1/account/token-check')
                .then(res => {
                    if (res.data.code === 0) {
                        this.uin = res.data.data.uin
                        this.avatarUrl = "http://q1.qlogo.cn/g?b=qq&nk=" + res.data.data.uin + "&s=100"
                        this.userGroup = res.data.data.user_group
                    } else {
                        this.toast('登录失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    if (err.response.data.code === -1) {
                        this.$router.push('/auth?hint=请先登录嗷')
                        return
                    }
                    this.toast('登录失败：' + err.response.data.msg)
                    console.error(err)
                })
        },
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