<template>
    <v-card class="mx-auto postcard" :color="this.banRecord.valid ? '#ff7063' : 'grey'" max-width="400"
        style="border-radius: 10px; color: #fff">
        <div style="width: 100%; padding: 8px 8px 0px 8px">
            <div style="display: flex;flex-direction: row;align-items: center;">
                <div style="display: flex;flex-direction: column;align-items: flex-start;">
                    <v-avatar color="grey-darken-3" :size="50"
                        :image="avatarBaseUrl + banRecord.uin + '&s=100'"></v-avatar>
                </div>
                <div style="margin-left: 8px;margin-bottom: 6px;display: flex;flex-direction: column;">
                    <h3>{{ banRecord.uin }}</h3>
                    <p><strong>原因: </strong>{{ banRecord.comment }}
                    </p>
                    <p><strong>操作者: </strong>{{ banRecord.op }}</p>
                    <p><strong>结束时间: </strong>{{ banRecord.end_time }}</p>

                </div>
                <div style="position: absolute;right: 5px;">
                    <v-btn @click="unban()" v-if="banRecord.valid" small color="#44D492" text
                        style="margin: 10px;left: 5px;color: #fff;">
                        解封
                    </v-btn>
                </div>
            </div>

        </div>

    </v-card>
</template>

<script>
export default {
    name: 'BanRecordCard',
    props: ['banRecord'],
    data() {
        return {
            dialog: false,
            groupDialog: false,
            reason: "",
            avatarBaseUrl: "http://q1.qlogo.cn/g?b=qq&nk=",
            date: null,
        }
    },
    mounted() {
    },
    methods: {
        toast(msg, color = 'error') {
            this.$emit('toast', msg, color)
        },
        unban() {
            this.$emit('unban', this.banRecord.uin)
        },
    },
}
</script>

<style>
.postcard {
    margin-bottom: 16px;
    box-shadow: 0px 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.logCard {
    margin-bottom: 16px;
    padding: 8px;
    border-radius: 10px;
    background-color: #f5f5f5;
}

.accountChips {
    margin-right: 8px;
}
</style>