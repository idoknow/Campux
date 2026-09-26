// 与全站其他 QQ 头像一致：q1 子域 + no-referrer 防盗链，否则请求带 Referer 会被 qlogo CDN 拒绝。
export function qqAvatar(qqUin: string) {
  return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qqUin)}&s=100`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().slice(0, 1).toUpperCase();
}
