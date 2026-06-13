#!/usr/bin/env bash
#
# 安装本仓库的 git hooks 到本地 .git/hooks/。
# 用法：在仓库根目录执行  bash scripts/git-hooks/install.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
hook_src="$repo_root/scripts/git-hooks/commit-msg"
git_dir="$(git rev-parse --git-dir)"
hook_dst="$git_dir/hooks/commit-msg"

cp "$hook_src" "$hook_dst"
chmod +x "$hook_dst"
echo "✓ 已安装 commit-msg hook -> $hook_dst"
echo "  之后每次 git commit 都会本地校验 Conventional Commits 规范。"
