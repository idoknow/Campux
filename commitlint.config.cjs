/**
 * Commitlint 配置 —— Semantic / Conventional Commits 规范的单一规则源。
 *
 * 同时被以下两处使用，保证本地与 CI 规则一致：
 *   - .github/workflows/pr-lint.yml 的「commitlint」任务（校验 PR 内每条 commit）
 *   - 本地 git hook（可选，见文件末尾说明）
 *
 * 提交信息格式：  <type>(<scope>): <subject>
 *   type   必填，取值见下方 type-enum
 *   scope  选填（如 web / server / db / dash / docs / landing …）
 *   subject 必填，简述本次改动（中文/英文均可，结尾不加句号）
 *
 * 示例：
 *   feat(web): 登录页拆分为双视图
 *   fix(server): 修复凑批发布卡在「发布中」的问题
 *   docs(readme): 补充自托管部署说明
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 允许的 type 取值（Conventional Commits 标准集）
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新功能
        "fix", // 修复缺陷
        "docs", // 仅文档
        "style", // 不影响逻辑的格式化（空格、分号等）
        "refactor", // 重构（既非新增功能也非修复）
        "perf", // 性能优化
        "test", // 测试相关
        "build", // 构建系统或依赖变更
        "ci", // CI 配置与脚本
        "chore", // 杂项（不修改 src 或测试）
        "revert", // 回滚某次提交
      ],
    ],
    // 中文 subject 不强制大小写规则
    "subject-case": [0],
    // 标题（header）整体长度上限，放宽到 120 以容纳中文说明
    "header-max-length": [2, "always", 120],
  },
};
