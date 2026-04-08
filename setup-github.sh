#!/bin/bash
set -e

REPO_NAME="topomind"
DESCRIPTION="TopoMind — 可漫游拓扑知识大脑 | AI Knowledge Graph"

echo "========================================="
echo "  TopoMind GitHub 部署脚本"
echo "========================================="
echo ""

# 1. 检查 gh 登录状态
echo "▶ 检查 GitHub CLI 登录状态..."
if ! gh auth status &>/dev/null; then
  echo "  未登录，正在打开浏览器进行登录..."
  gh auth login --hostname github.com --git-protocol https --web
fi
echo "  ✅ 已登录 GitHub"

# 获取用户名
GH_USER=$(gh api user -q .login)
echo "  👤 用户: $GH_USER"
echo ""

# 2. 初始化 Git 仓库
echo "▶ 初始化 Git 仓库..."
if [ ! -d ".git" ]; then
  git init
  git branch -M main
  echo "  ✅ Git 仓库已初始化"
else
  echo "  ⏭  Git 仓库已存在"
fi
echo ""

# 3. 创建远程仓库
echo "▶ 创建 GitHub 远程仓库: $REPO_NAME ..."
if gh repo view "$GH_USER/$REPO_NAME" &>/dev/null; then
  echo "  ⏭  仓库已存在: https://github.com/$GH_USER/$REPO_NAME"
else
  gh repo create "$REPO_NAME" --public --description "$DESCRIPTION"
  echo "  ✅ 仓库已创建: https://github.com/$GH_USER/$REPO_NAME"
fi
echo ""

# 4. 设置远程地址
echo "▶ 配置远程仓库..."
if git remote get-url origin &>/dev/null; then
  git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
else
  git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"
fi
echo "  ✅ 远程地址: https://github.com/$GH_USER/$REPO_NAME.git"
echo ""

# 5. 提交并推送
echo "▶ 提交代码..."
git add -A
git commit -m "feat: TopoMind 可漫游拓扑知识大脑 — 初始版本

- 8 大 AI 领域拓扑图谱 + LLM 8 个子节点
- Cytoscape.js + ELK 分层拓扑布局
- 缩放分层显示、聚焦视图 Drill-down
- Markdown 知识文档渲染
- 节点/边 CRUD、文档编辑
- 导入导出 JSON 数据
- GitHub Pages 自动部署" || echo "  (无新变更)"

echo ""
echo "▶ 推送到 GitHub..."
git push -u origin main
echo "  ✅ 代码已推送"
echo ""

# 6. 启用 GitHub Pages
echo "▶ 启用 GitHub Pages (GitHub Actions 方式)..."
gh api -X PUT "repos/$GH_USER/$REPO_NAME/pages" \
  --input - <<EOF 2>/dev/null || \
gh api -X POST "repos/$GH_USER/$REPO_NAME/pages" \
  --input - <<EOF2
{
  "build_type": "workflow"
}
EOF
{
  "build_type": "workflow"
}
EOF2
echo "  ✅ GitHub Pages 已启用"
echo ""

# 7. 输出结果
echo "========================================="
echo "  🎉 部署完成！"
echo "========================================="
echo ""
echo "  📦 仓库地址: https://github.com/$GH_USER/$REPO_NAME"
echo "  🌐 页面地址: https://$GH_USER.github.io/$REPO_NAME/"
echo ""
echo "  ⏳ 首次部署需要 1-2 分钟，GitHub Actions 正在构建..."
echo "  📋 查看构建状态: https://github.com/$GH_USER/$REPO_NAME/actions"
echo ""
