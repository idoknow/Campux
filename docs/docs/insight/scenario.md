# 认识 & 场景

适应的场景是常见的 QQ 收取稿件（用户文字消息+图片）、人工发表到 QQ 空间的 校园墙。

传统的运营模式都是由人来审核稿件、手动截图、发表到QQ空间。

<img src="/assets/insight_scenario_01.jpg" alt="用户投稿" width="40%" height="40%">

<img src="/assets/insight_scenario_02.jpg" alt="人工发表" width="40%" height="40%">

## 为什么选择 Campux ？

上述的全人工操作的校园墙运营，步骤繁多，容易出错，且效率低下，影响运营人员积极性。  
使用 Campux 实现全过程自动化，运营人员一次部署，之后只需要点击按钮即可自动完成发表，以往需要团队完成的工作，现在只需要一个人即可胜任，可以将更多精力放在高质量内容和舆论管理上。

## 革新

解决了 QQ 空间接口、QQ 消息处理等问题，辅以投稿用的前端，即可在其基础上实现自动化。

### 用户注册

用户向机器人发送任意消息，获取说明（可自定义）。

<img src="/assets/insight_scenario_03.jpg" alt="打招呼" width="40%" height="40%">

用户发送 #注册账号 命令即可注册账号。

<img src="/assets/insight_scenario_04.jpg" alt="注册账号" width="40%" height="40%">

### 投稿

用户登录到前端投稿页面，填写内容、图片、是否匿名，提交即可。

<img src="/assets/insight_scenario_05.jpg" alt="投稿" width="40%" height="40%">

### 审核

#### Web 端审核

<img src="/assets/insight_scenario_07.jpg" alt="Web端审核" width="40%" height="40%">

#### 群内审核

Bot 端配置了群内审核后，管理员可以直接在群内审核。

<img src="/assets/deploy_maintain_02.png" alt="群内审核" width="40%" height="40%">

### 自动发表到空间说说

管理员需要定期（约48小时）扫码登录 QQ 空间。

<img src="/assets/insight_scenario_08.jpg" alt="扫码登录" width="40%" height="40%">

Cookies 有效时，审核通过的稿件，将由后端推入队列，由 Bot 渲染成图后自动发表到空间说说。

<img src="/assets/insight_scenario_09.jpg" alt="自动发表" width="40%" height="40%">

<img src="/assets/insight_scenario_10.jpg" alt="自动发表" width="40%" height="40%">