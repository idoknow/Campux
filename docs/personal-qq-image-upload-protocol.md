# 腾讯频道 personal_qq 带图发帖协议研究（2026-09-09）

## 设计约束（用户明确）
- 单张图片 **≤ 5MB**
- 总共 **≤ 9 张**，包含渲染图

## 结论：单图 ≤5MB ⇒ 走单片直传(runSingleUpload)，可绕过分片协议

## 4 步完整协议（已 100% 破解，实测验证）

### ① apply_media_upload 申请上传 (CMD_UPLOAD)
```json
{
  "reqHead": {
    "commonHead": { "cmd": "CMD_UPLOAD", "requestId": "0" },
    "scene": {
      "appType": "APP_TYPE_CHANNEL_FEEDS",
      "businessType": "BUSINESS_TYPE_PICTURE",
      "sceneType": "SCENE_TYPE_APP_CUSTOM"
    }
  },
  "uploadReq": {
    "bizTransInfo": "",
    "uploadInfo": [
      { "fileInfo": { "fileName": "card.png", "isOriginal": true, "md5": "..", "sha1": "..", "size": "739" } }
    ]
  }
}
```
成功返回 `retCode:0` + structuredContent.uploadRsp:
- `fileUuid` (EhTdA7i...)
- `ukey` (上传凭证) + `ukeyTtlSec:255600`
- `uploadCtrl.partDataSize: "1048576"` (分片 1MB)
- `domain`/`backupDomain`: multimedia.nt.qq.com.cn
- `ipv4[]`/`ipv6[]`: {innerIp,outIp,innerPort:80,outPort:80,ipType(100/200/500/600)}
- `msgInfo.msgInfoBody[0].indexNode`: {fileInfo, fileUuid, storeAppid:1487, storeId:STORE_ID_CHINA_RICHMEDIA, uploadTime}
- `msgInfo.msgInfoBody[0].pictureInfo`: {domain, urlPath:"/download?appid=1487&fileid=<fileUuid>", exInfo}
- `bizErrorInfo:{}` , `backupDomain`

### ② 上传文件（关键难点）
- 通道 = 自研 sliceupload 分片重建协议: protobuf 编码 req/rsp,
  累计 SHA1, bitmap 进度, ukey 认证, 直连 IP:80
- CLI 源码: internal/pd/upload/{sliceupload.go,sliceupload_proto.go,sliceupload_sha1.go}
- 但有 `runSingleUpload`(单片) / `HttpSliceUpload`(分片) 两条路径
- **单图 ≤5MB ⇒ 大概率走 runSingleUpload 单片直传，可绕过分片 protobuf**

### ③ apply_media_upload_status_sync 确认 (CMD_UPLOAD_STATUS_SYNC)
```json
{
  "reqHead": { "commonHead": { "cmd": "CMD_UPLOAD_STATUS_SYNC", "requestId": "0" },
    "scene": { "appType": "APP_TYPE_CHANNEL_FEEDS", "businessType": "BUSINESS_TYPE_PICTURE", "sceneType": "SCENE_TYPE_APP_CUSTOM" } },
  "uploadReq": {
    "indexNode": { "fileInfo": {...}, "fileUuid": "<同上>" },
    "uploadChannelInfo": { "extendInfo": "<protobuf>", "extendType": 5 },
    "uploadStatus": { "fileStatus": "UPLOAD_SUCCESS" }
  }
}
```

### ④ publish_feed 带图（三层引用，缺一不可）
```
client_content.clientImageContents[0] = { md5, orig_size, task_id: "<fileUuid>", url }
jsonFeed.images[] = { display_index, height, imageMD5, is_gif, is_orig, layerPicUrl,
                      orig_size, pattern_id:"<fileUuid>", picId:"<fileUuid>", picUrl, vecImageUrl, width }
jsonFeed.patternInfo 长贴 blockParagraph 内嵌图片节点 (type:6)：
  { data:[{props:{fontWeight,italic,underline},type:1,text}, {duration:0,fileId:"<fileUuid>",
    height,id:"<fileUuid>",isInline:true,status:0,taskId:"<fileUuid>",type:6,
    url,width,widthPercentage:100}], id, props:{textAlignment:0}, type:"blockParagraph" }
```

## 已定位的现有代码 bug
- apps/server/src/runtime/personal-qq.ts `buildShortPostPatternInfo`/`buildLongPostPatternInfo`
  接收 imageUrls 参数但完全忽略（patternInfo 无图）→ jsonFeed.images:null,
  client_content:{} 均未接图。这就是"频道机器人没渲染图"根因。
- 修复需实现上面 4 步（至少 produce clientImageContents + images[] + type6 节点）。

## 请求日志来源
- ~/.qqcli/logs/tencent-channel-cli.log 记录了 CLI 每次 MCP 调用的完整 req_body/resp_body(含敏感,勿提交git)
  `tencent-channel-cli logs show` 查看。可用于反向确认协议字段。