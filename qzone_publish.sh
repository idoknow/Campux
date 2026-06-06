#!/bin/bash
# ============================================================
# QQ 空间视频上传 + 说说发布脚本
# 用法: bash qzone_publish.sh <视频文件> [说说文字]
# ============================================================
set -euo pipefail

VIDEO_FILE="${1:-}"
MOOD_TEXT="${2:-视频分享}"

if [ -z "$VIDEO_FILE" ] || [ ! -f "$VIDEO_FILE" ]; then
  echo "用法: bash qzone_publish.sh <视频文件> [说说文字]"
  echo "示例: bash qzone_publish.sh GOPR1545.MP4 \"GoPro 测试\""
  exit 1
fi

echo "=============================================="
echo "  QQ 空间视频上传 + 说说发布"
echo "=============================================="
echo "视频: $(basename "$VIDEO_FILE")"
echo "说说: $MOOD_TEXT"
echo ""

# ============================================================
# 配置: 从浏览器获取 cookie
# ============================================================
echo ">>> 从浏览器获取 cookies..."
# 尝试从 VS Code 浏览器获取
BROWSER_COOKIE=""
if curl -s --max-time 3 http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "  检测到 Chrome 远程调试, 尝试提取 cookies..."
  BROWSER_COOKIE=$(curl -s http://localhost:9222/json 2>/dev/null | python3 -c "
import sys,json
pages=json.load(sys.stdin)
for p in pages:
    if 'qzone' in p.get('url',''):
        print(p['webSocketDebuggerUrl'])
        break
" 2>/dev/null)
fi

# 默认: 使用预设 cookies (需定期刷新)
COOKIES="${QZONE_COOKIES:-}"
if [ -z "$COOKIES" ]; then
  echo "  提示: 设置环境变量 QZONE_COOKIES 或在脚本中配置"
  echo "  获取方法: 在 QZone 页面 F12 -> console 中执行:"
  echo "  document.cookie"
  echo ""
  # 先尝试用预设值
  COOKIES="RK=y47X8a+RSp; pgv_pvid=3170068196; uin=o1692138502; skey=@86Tq58gVu; p_uin=o1692138502; p_skey=LTSd8qLYcnWKhMZuQuPoGzA1kDjy5YOhrbRSG7Z-mmI_; QZ_FE_WEBP_SUPPORT=1; domainid=5"
fi

# ============================================================
# 计算 g_tk
# ============================================================
P_SKEY=$(echo "$COOKIES" | grep -oP 'p_skey=\K[^;]+' || echo "LTSd8qLYcnWKhMZuQuPoGzA1kDjy5YOhrbRSG7Z-mmI_")

G_TK=$(python3 -c "
skey='$P_SKEY'
h=5381
for c in skey:
    h += (h << 5) + ord(c)
print(h & 0x7fffffff)
")

UIN="1692138502"
echo "UIN: $UIN  g_tk: $G_TK"

# ============================================================
# 视频信息
# ============================================================
FILESIZE=$(stat -c%s "$VIDEO_FILE")
CHECKSUM=$(python3 -c "
import hashlib
h=hashlib.md5()
with open('$VIDEO_FILE','rb') as f:
    while True:
        c=f.read(8192)
        if not c: break
        h.update(c)
print(h.hexdigest())
")

FILENAME=$(basename "$VIDEO_FILE")
echo "大小: $FILESIZE bytes  MD5: $CHECKSUM"

# ============================================================
# Step 1: FileBatchControl (创建上传会话)
# ============================================================
echo ""
echo ">>> Step 1: 创建上传会话..."

CONTROL_RESP=$(curl -s -b "$COOKIES" \
  -H "Content-Type: application/json" \
  "https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/${CHECKSUM}?g_tk=${G_TK}" \
  --data-raw "$(python3 -c "
import json, time
print(json.dumps({'control_req':[{
    'uin':'$UIN','token':{'type':4,'data':'$P_SKEY','appid':5},
    'appid':'video_qzone','checksum':'$CHECKSUM','check_type':1,'file_len':$FILESIZE,
    'env':{'refer':'qzone','deviceInfo':'h5'},'model':0,
    'biz_req':{
        'sPicTitle':'$FILENAME','sTitle':'${FILENAME%.*}','sDesc':'',
        'iUploadType':3,'iUploadTime':int(time.time()*1000),'iPlayTime':5000,
        'iIsNew':2002,'isFormatF20':True,
        'extend_info':{'video_type':'3','domainid':'5'}
    },
    'session':'','asy_upload':0,'cmd':'FileUploadVideo'
}]}))
")") 2>&1

SESSION=$(python3 -c "import json,sys; d=json.loads('$CONTROL_RESP' if '$CONTROL_RESP'[0]!='{' else sys.stdin.read()); print(d.get('data',{}).get('session',''))" <<< "$CONTROL_RESP" 2>/dev/null || echo "")

if [ -z "$SESSION" ]; then
  echo "  错误: 无法获取上传会话"
  echo "  响应: $CONTROL_RESP"
  exit 1
fi
echo "  会话: $SESSION"

# ============================================================
# Step 2: 分片上传
# ============================================================
SLICE_SIZE=16384
TOTAL_SLICES=$(( (FILESIZE + SLICE_SIZE - 1) / SLICE_SIZE ))
echo ""
echo ">>> Step 2: 分片上传 ($TOTAL_SLICES 片, $FILESIZE bytes)..."

LAST_RESP=""
for ((seq=0; seq<TOTAL_SLICES; seq++)); do
  OFFSET=$((seq * SLICE_SIZE))
  END=$((OFFSET + SLICE_SIZE > FILESIZE ? FILESIZE : OFFSET + SLICE_SIZE))
  
  DATA_B64=$(python3 -c "
import base64
with open('$VIDEO_FILE','rb') as f:
    f.seek($OFFSET)
    print(base64.b64encode(f.read($((END-OFFSET)))).decode())
")
  
  SLICE_RESP=$(curl -s -b "$COOKIES" \
    -H "Content-Type: application/json" \
    "https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUploadVideo?seq=${seq}&retry=0&offset=${OFFSET}&end=${END}&total=${FILESIZE}&type=json&g_tk=${G_TK}" \
    --data-raw "$(python3 -c "
import json
print(json.dumps({'uin':'$UIN','appid':'video_qzone','session':'$SESSION','offset':$OFFSET,'data':'$DATA_B64','checksum':'','check_type':1,'retry':0,'seq':$seq,'end':$END,'cmd':'FileUploadVideo','slice_size':$SLICE_SIZE,'biz_req':{}}))
")") 2>&1
  
  LAST_RESP="$SLICE_RESP"
  
  if [ $((seq % 200)) -eq 0 ] || [ $seq -eq $((TOTAL_SLICES-1)) ]; then
    printf "  进度: %d/%d\r" $((seq+1)) $TOTAL_SLICES
  fi
done

echo ""
SVID=$(python3 -c "import json; d=json.loads('$LAST_RESP'); print(d.get('data',{}).get('biz',{}).get('sVid','?'))" 2>/dev/null)
echo "  上传完成! sVid: $SVID"

# ============================================================
# Step 3: 发布纯文本说说
# ============================================================
echo ""
echo ">>> Step 3: 发布说说..."

CON_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MOOD_TEXT'))")

PUBLISH_RESP=$(curl -s -b "$COOKIES" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${G_TK}" \
  -d "syn_tweet_verson=1&paramstr=1&pic_template=&richtype=&richval=&con=${CON_ENCODED}&hostuin=${UIN}&code_version=1&format=json&qzreferrer=https%3A%2F%2Fuser.qzone.qq.com%2F${UIN}" 2>&1)

TID=$(python3 -c "import json; d=json.loads('$PUBLISH_RESP'); print(d.get('t1_tid','?'))" 2>/dev/null)
echo "  发布完成! tid: $TID"

# ============================================================
echo ""
echo "=============================================="
echo "  完成!"
echo "  sVid: $SVID"
echo "  tid:  $TID"
echo "  视频链接: https://h5.qzone.qq.com/ugc/share/$SVID"
echo "=============================================="
