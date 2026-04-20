<template>
    <v-card class="mx-auto appcard" max-width="400"
        style="border-radius: 10px; color: #fff">
        <p id="app-emoji">{{ oauthApp.emoji }}</p>
        <div id="app-attrs">
            <p id="app-name">
                {{ oauthApp.name }}
            </p>
            <div id="app-keys">
                <p><strong>Client ID: </strong>{{ oauthApp.client_id }}</p>
                <p><strong>Client Secret: </strong>{{ oauthApp.client_secret }}</p>
            </div>
            <div id="app-redirects" style="margin-top:8px">
                <p><strong>Redirect URIs:</strong></p>
                <ul>
                    <li v-for="(r, idx) in oauthApp.redirect_uris" :key="idx" style="font-size:0.8rem">{{ r }}</li>
                </ul>
            </div>

        </div>

        <div id="app-op-btns">


        <v-btn color="red" text @click="deletingDialog = true">删除</v-btn>
        <v-btn color="primary" text @click="openEdit">编辑回调</v-btn>
        </div>
        
    </v-card>

    <v-dialog v-model="deletingDialog" max-width="400">
        <v-card>
            <v-card-title>删除应用</v-card-title>
            <v-card-text>
                <p>确定要删除应用 <strong>{{ oauthApp.name }}</strong> 吗？Client ID 和 Client Secret 将永久失效！</p>
            </v-card-text>
            <v-card-actions>
                <v-btn text @click="deletingDialog = false">取消</v-btn>
                <v-btn color="red" text @click="deleteApp">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

    <v-dialog v-model="editingDialog" max-width="600">
        <v-card>
            <v-card-title>编辑回调地址</v-card-title>
            <v-card-text>
                <v-textarea v-model="editRedirectsText" label="回调地址（每行一个）" rows="6"></v-textarea>
            </v-card-text>
            <v-card-actions>
                <v-btn text @click="editingDialog = false">取消</v-btn>
                <v-btn color="primary" text @click="saveEdit">保存</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script>
export default {
    name: 'OAuthAppCard',
    props: ['oauthApp'],
    data() {
        return {
            deletingDialog: false,
            editingDialog: false,
            editRedirectsText: '',
        }
    },
    mounted() {

    },
    methods: {
        toast(msg, color = 'error') {
            this.$emit('toast', msg, color)
        },
        deleteApp() {
            this.$emit('deleteApp', this.oauthApp.client_id)
        },
        openEdit() {
            this.editRedirectsText = (this.oauthApp.redirect_uris || []).join('\n')
            this.editingDialog = true
        },
        saveEdit() {
            const payload = {
                client_id: this.oauthApp.client_id,
                redirect_uris: this.editRedirectsText.split('\n').map(s => s.trim()).filter(s => s.length > 0)
            }

            this.$axios.put('/v1/admin/update-oauth2-app', payload)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('更新成功', 'success')
                        this.$emit('refresh')
                        this.editingDialog = false
                    } else {
                        this.toast('更新失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('更新失败：' + err)
                })
        }
    }
}
</script>

<style>
.appcard {
    margin-bottom: 16px;
    box-shadow: 0px 10px 15px -3px rgba(0, 0, 0, 0.1);
    background-color: rgb(38, 139, 255);
    display: flex;
    flex-direction: row;
    align-items: center;
}

#app-emoji {
    font-size: 3.4rem;
    text-align: center;
    margin: 1rem;
}

#app-attrs {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    margin-block: 0.6rem;
    margin-inline: 0.5rem;
}

#app-name {
    font-size: 1.3rem;
    text-align: center;
    font-weight: 700;
}

#app-keys {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    font-size: 0.8rem;
}

strong {
    user-select: none;
}

#app-op-btns {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin-inline-end: 1rem;
}
</style>