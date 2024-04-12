<template>
    <v-bottom-navigation v-bind:value="value" v-on:input="$emit('input', $event)" grow>
    <v-btn @click="go('/')">
        <v-icon>mdi-email-edit</v-icon>
        投稿
    </v-btn>

    <v-btn @click="go('/user')">
        <v-icon>mdi-account</v-icon>

        我的
    </v-btn>

    <v-btn @click="go('/service')">
        <v-icon>mdi-apple-safari</v-icon>

        服务
    </v-btn>
</v-bottom-navigation>
</template>

<script>
export default {
    props: {
        value: {
            type: Number,
            default: 0
        }
    },
    data() {
        return {
        }
    },
    methods: {
        go(path) {
            this.$router.push(path);
        }
    }
}
</script>