# 提交规范 (Commit & PR Convention)

Campux 强制使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。
CI 会在每个 Pull Request 上校验，不符合规范无法合并。

## 格式

```
<type>(<scope>): <subject>
```

- **type**（必填）：本次改动的类别，取值见下表。
- **scope**（选填）：影响范围，如 `web` / `server` / `db` / `dash` / `docs` / `landing`。
- **subject**（必填）：简述改动内容，中英文均可，结尾不加句号。

### 允许的 type

| type | 含义 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `docs` | 仅文档变更 |
| `style` | 不影响逻辑的格式化（空格、分号等） |
| `refactor` | 重构（既非新增功能也非修复缺陷） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建系统或依赖变更 |
| `ci` | CI 配置与脚本 |
| `chore` | 杂项（不改 src 或测试） |
| `revert` | 回滚某次提交 |

### 示例

```
feat(web): 登录页拆分为双视图
fix(server): 修复凑批发布卡在「发布中」的问题
docs(readme): 补充自托管部署说明
chore: 升级依赖
```

## CI 校验内容

`.github/workflows/pr-lint.yml` 会做两件事：

1. **PR 标题校验** —— 因为采用 squash 合并时 PR 标题会成为最终 commit message，标题必须符合规范。
2. **PR 内每条 commit 校验** —— 用 [commitlint](https://commitlint.js.org/) 按 `commitlint.config.cjs` 逐条检查本次 PR 引入的所有 commit。

规则的单一来源是仓库根目录的 `commitlint.config.cjs`。

## 本地预检（可选）

提交前想先在本地验证，可临时安装 commitlint：

```bash
npx --yes -p @commitlint/cli -p @commitlint/config-conventional \
  commitlint --config commitlint.config.cjs --edit
```

或写入历史区间批量检查：

```bash
npx --yes -p @commitlint/cli -p @commitlint/config-conventional \
  commitlint --config commitlint.config.cjs --from origin/main --to HEAD --verbose
```
