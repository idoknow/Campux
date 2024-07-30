# CampuxBot

## 登录 QQ 空间

Bot 发表说说都是逆向工程，模拟 Web QQ 空间的请求。需要定期（约48小时）扫码登录。

Bot 管理员，向 Bot 发送命令 #更新cookies ，Bot 会返回一个二维码，管理员手机上登录 **墙号 QQ**，扫码授权即可自动登录。

<img src="/assets/insight_scenario_08.jpg" alt="扫码登录" width="40%">

没有 有效Cookies 时，Bot 会一直等待登录后再发表说说。

## 群内审核

Bot 端配置了群内审核后，新稿件到来时会推送到管理员群，管理员可以直接在群内审核。

<img src="/assets/insight_scenario_06.jpg" alt="群内审核" width="40%">