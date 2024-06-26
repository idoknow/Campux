<template>
  <v-card class="mx-auto postcard" :color="backgrouldColor" max-width="400" style="border-radius: 10px; color: #fff">
    <div style="width: 100%; padding: 8px 8px 0px 8px">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex;flex-direction: row;align-items: center;">
          <v-avatar color="grey-darken-3" :size="60" :image="avatarBaseUrl + account.uin + '&s=100'"></v-avatar>
          <div style="margin-left: 8px;display: flex;flex-direction: column;">
            <h3 style="margin-left: 8px;margin: 6px">{{ account.uin }}</h3>
            <!--创建时间-->
            <div style="display: flex;flex-direction: row;">
              <v-chip class="accountChips" variant="elevated" size="small" label
                :color="userGroupColor[account.user_group]" @click="showGroupDialog()">{{ userGroup[account.user_group]
                }}</v-chip>
              <v-chip class="accountChips" variant="elevated" size="small" label color="white">{{ account.created_at
                }}</v-chip>

            </div>
          </div>
        </div>
        <!-- 取消投稿 -->
      </div>

    </div>
    <!--右对齐-->
    <v-card-options class="d-flex justify-end">
      <!--红色封禁-->
      <v-btn @click="showBanningDialog()" small color="red" text style="margin: 10px;">
        封禁
      </v-btn>
    </v-card-options>

  </v-card>

  <v-dialog v-model="groupDialog" variant="outlined" persistent>
    <v-card title="修改用户组">
      <v-card-text>
        <v-select v-model="newGroup" :items="userGroups" label="用户组" outlined></v-select>
      </v-card-text>
      <template v-slot:actions>
        <v-btn text="取消" @click="groupDialog = false"></v-btn>
        <v-btn class="ms-auto" text="OK" @click="groupDialog = false; emitChangeGroup()"></v-btn>
      </template>
    </v-card>
  </v-dialog>

  <v-dialog v-model="dialog" variant="outlined" persistent>
    <v-card title="封禁用户">
      <v-card-text>
        <v-text-field v-model="reason" label="封禁原因" outlined></v-text-field>
        <!--封禁结束时间-->
        <v-date-picker v-model="date" show-adjacent-months title="封禁结束时间"></v-date-picker>
      </v-card-text>
      <template v-slot:actions>
        <v-btn text="取消" @click="dialog = false"></v-btn>
        <v-btn class="ms-auto" text="OK" @click="emitBanAccount()"></v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'AccountCard',
  props: ['account'],
  data() {
    return {
      dialog: false,
      groupDialog: false,
      reason: "",
      userGroup: {
        'user': '普通用户',
        'member': '成员',
        'admin': '管理员',
      },
      userGroups: [
        'user',
        'member',
        'admin',
      ],
      userGroupColor: {
        'user': '#fff',
        'member': '#66BB6A',
        'admin': '#ee7023',
      },
      backgrouldColor: "",
      avatarBaseUrl: "http://q1.qlogo.cn/g?b=qq&nk=",
      newGroup: "",
      date: null,
    }
  },
  mounted() {
    this.backgrouldColor = '#42A5F5'
    this.newGroup = this.account.user_group
  },
  methods: {
    showGroupDialog() {
      this.groupDialog = true
    },
    showBanningDialog() {
      this.dialog = true
    },
    emitChangeGroup() {
      this.$emit('changeGroup', this.account, this.newGroup)
    },
    emitBanAccount() {
      if (this.reason === "") {
        this.toast('请填写封禁原因')
        return
      }

      if (this.date === null) {
        this.toast('请选择封禁结束时间')
        return
      } else if (this.date < new Date()) {
        this.toast('封禁结束时间不能早于当前时间')
        return
      }

      this.$emit('banAccount', this.account, this.reason, this.date)
      this.dialog = false
    },

    toast(msg, color = 'error') {
      this.$emit('toast', msg, color)
    }
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