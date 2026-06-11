---
layout: page
title: Campux 文档
aside: false
sidebar: false
footer: false
head:
  - - meta
    - http-equiv: refresh
      content: 0; url=/intro
---

<script setup>
import { onMounted } from "vue";
import { useRouter } from "vitepress";

const router = useRouter();
onMounted(() => {
  router.go("/intro");
});
</script>

<div style="display:flex;align-items:center;justify-content:center;min-height:50vh;flex-direction:column;gap:12px;color:var(--vp-c-text-2)">
  <p>正在前往项目介绍…</p>
  <p><a href="/intro">如果没有自动跳转，请点击这里</a></p>
</div>
