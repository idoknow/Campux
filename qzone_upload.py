#!/usr/bin/env python3
"""
QQ 空间视频上传 + 说说发布工具
用法:
  # 只上传视频
  python3 qzone_upload.py upload GOPR1545.MP4
  
  # 上传并发布纯文本说说
  python3 qzone_upload.py upload GOPR1545.MP4 --mood "GoPro 测试"
  
  # 更新 cookies (从环境变量或脚本中配置)
  export QZONE_COOKIES="RK=xxx; uin=o1692138502; skey=xxx; p_skey=xxx; ..."
"""

import hashlib, base64, json, subprocess, sys, os, math, time, argparse

# ---------- 配置 ----------
UIN = "1692138502"

# 从环境变量读取 cookies，否则用默认值
COOKIES = os.environ.get("QZONE_COOKIES", 
    "RK=y47X8a+RSp; pgv_pvid=3170068196; "
    "uin=o1692138502; skey=@86Tq58gVu; p_uin=o1692138502; "
    "p_skey=LTSd8qLYcnWKhMZuQuPoGzA1kDjy5YOhrbRSG7Z-mmI_; "
    "QZ_FE_WEBP_SUPPORT=1; domainid=5")

SLICE_SIZE = 16384

def g_tk():
    """从 p_skey 计算 CSRF token"""
    skey = ""
    for part in COOKIES.replace(" ","").split(";"):
        if part.startswith("p_skey="):
            skey = part.split("=",1)[1]
            break
    h = 5381
    for c in skey:
        h += (h << 5) + ord(c)
    return h & 0x7fffffff

def curl(method, url, data=None, ct="application/json"):
    cmd = ["curl", "-s", "-X", method, url, "-b", COOKIES]
    if data is not None:
        cmd += ["-H", f"Content-Type: {ct}", "--data-raw", data]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return result.stdout.strip()

def md5(filepath):
    h = hashlib.md5()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def b64chunk(filepath, offset, size):
    with open(filepath, 'rb') as f:
        f.seek(offset)
        return base64.b64encode(f.read(size)).decode()

def upload_video(filepath):
    """上传视频到 QQ 空间，返回 sVid"""
    filesize = os.path.getsize(filepath)
    filename = os.path.basename(filepath)
    checksum = md5(filepath)
    tk = g_tk()
    
    print(f"[上传] {filename} ({filesize/1024/1024:.1f}MB) MD5={checksum}")
    
    # Step 1: 创建上传会话
    print("[1/2] 创建上传会话...")
    control = json.dumps({"control_req": [{
        "uin": UIN, "token": {"type": 4, "data": 
            next(p.split("=",1)[1] for p in COOKIES.replace(" ","").split(";") if p.startswith("p_skey=")),
            "appid": 5},
        "appid": "video_qzone", "checksum": checksum, "check_type": 1, "file_len": filesize,
        "env": {"refer": "qzone", "deviceInfo": "h5"}, "model": 0,
        "biz_req": {
            "sPicTitle": filename, "sTitle": os.path.splitext(filename)[0],
            "sDesc": "", "iUploadType": 3, "iUploadTime": int(time.time() * 1000),
            "iPlayTime": 5000, "iIsNew": 2002, "isFormatF20": True,
            "extend_info": {"video_type": "3", "domainid": "5"}
        },
        "session": "", "asy_upload": 0, "cmd": "FileUploadVideo"
    }]})
    
    resp = json.loads(curl("POST", 
        f"https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/{checksum}?g_tk={tk}",
        control))
    
    session = resp.get("data", {}).get("session", "")
    if not session:
        raise Exception(f"无法创建上传会话: {resp}")
    print(f"  会话: {session}")
    
    # Step 2: 分片上传
    total = math.ceil(filesize / SLICE_SIZE)
    print(f"[2/2] 分片上传 ({total} 片)...")
    
    last = ""
    for seq in range(total):
        off = seq * SLICE_SIZE
        end = min(off + SLICE_SIZE, filesize)
        data = b64chunk(filepath, off, end - off)
        
        body = json.dumps({"uin": UIN, "appid": "video_qzone", "session": session,
            "offset": off, "data": data, "checksum": "", "check_type": 1,
            "retry": 0, "seq": seq, "end": end, "cmd": "FileUploadVideo",
            "slice_size": SLICE_SIZE, "biz_req": {}})
        
        last = curl("POST",
            f"https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUploadVideo?seq={seq}&retry=0&offset={off}&end={end}&total={filesize}&type=json&g_tk={tk}",
            body)
        
        if seq % 200 == 0 or seq == total - 1:
            print(f"  {seq+1}/{total}", end="\r")
    
    print()
    resp = json.loads(last)
    sVid = resp.get("data", {}).get("biz", {}).get("sVid", "")
    print(f"✅ 上传完成! sVid={sVid}")
    return sVid

def publish_mood(text):
    """发布纯文本说说"""
    import urllib.parse
    tk = g_tk()
    con = urllib.parse.quote(text)
    
    resp = curl("POST",
        f"https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk={tk}",
        f"syn_tweet_verson=1&paramstr=1&pic_template=&richtype=&richval=&con={con}&hostuin={UIN}&code_version=1&format=json&qzreferrer=https%3A%2F%2Fuser.qzone.qq.com%2F{UIN}",
        "application/x-www-form-urlencoded")
    
    r = json.loads(resp)
    tid = r.get("t1_tid", "?")
    print(f"✅ 说说发布完成! tid={tid}")
    return tid

# ---------- CLI ----------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QQ 空间视频上传+发布")
    sub = parser.add_subparsers(dest="cmd")
    
    up = sub.add_parser("upload", help="上传视频")
    up.add_argument("file", help="视频文件路径")
    up.add_argument("--mood", "-m", help="上传后发布说说文字", default=None)
    
    mood = sub.add_parser("mood", help="发布纯文本说说")
    mood.add_argument("text", help="说说文字")
    
    cookies = sub.add_parser("cookies", help="显示当前 cookies 和 g_tk")
    
    args = parser.parse_args()
    
    if args.cmd == "upload":
        svid = upload_video(args.file)
        print(f"\n视频链接: https://h5.qzone.qq.com/ugc/share/{svid}")
        if args.mood:
            print()
            publish_mood(args.mood)
    elif args.cmd == "mood":
        publish_mood(args.text)
    elif args.cmd == "cookies":
        print(f"UIN: {UIN}")
        print(f"g_tk: {g_tk()}")
        print(f"Cookies: {COOKIES[:80]}...")
    else:
        parser.print_help()
