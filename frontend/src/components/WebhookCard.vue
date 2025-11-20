<template>
    <v-card class="mx-auto webhookcard" max-width="600"
        style="border-radius: 10px; color: #fff">
        <div id="webhook-attrs">
            <p id="webhook-url">
                {{ webhook.url }}
            </p>
            <p id="webhook-created">创建于: {{ formatDate(webhook.created_at) }}</p>
        </div>

        <div id="webhook-op-btns">
            <v-btn color="red" text @click="deletingDialog = true">删除</v-btn>
        </div>
    </v-card>

    <v-dialog v-model="deletingDialog" max-width="400">
        <v-card>
            <v-card-title>删除 Webhook</v-card-title>
            <v-card-text>
                <p>确定要删除 Webhook <strong>{{ webhook.url }}</strong> 吗？</p>
            </v-card-text>
            <v-card-actions>
                <v-btn text @click="deletingDialog = false">取消</v-btn>
                <v-btn color="red" text @click="deleteWebhook">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script>
export default {
    name: 'WebhookCard',
    props: ['webhook'],
    data() {
        return {
            deletingDialog: false,
        }
    },
    mounted() {

    },
    methods: {
        toast(msg, color = 'error') {
            this.$emit('toast', msg, color)
        },
        deleteWebhook() {
            this.$emit('deleteWebhook', this.webhook.id)
        },
        formatDate(dateStr) {
            if (!dateStr) return ''
            const date = new Date(dateStr)
            return date.toLocaleString()
        }
    }
}
</script>

<style scoped>
.webhookcard {
    margin-bottom: 16px;
    box-shadow: 0px 10px 15px -3px rgba(0, 0, 0, 0.1);
    background-color: rgb(76, 175, 80);
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 1rem;
}

#webhook-attrs {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    flex-grow: 1;
    margin-inline: 0.5rem;
}

#webhook-url {
    font-size: 1.1rem;
    font-weight: 600;
    word-break: break-all;
    margin-bottom: 0.5rem;
}

#webhook-created {
    font-size: 0.85rem;
    opacity: 0.9;
}

#webhook-op-btns {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin-inline-end: 1rem;
}
</style>
