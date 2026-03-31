#!/bin/bash

# 积分赛跑系统 - 项目检查脚本

echo "🔍 开始检查项目完整性..."
echo ""

# 检查文件
echo "📁 检查项目文件..."
files=(
  "src/App.vue"
  "src/main.js"
  "index.html"
  "vite.config.js"
  "package.json"
  "README.md"
  "START_HERE.md"
  "QUICKSTART.md"
  "BUILD_GUIDE.md"
  "MIGRATION.md"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file (缺失)"
  fi
done

echo ""
echo "🖼️  检查图片资源..."
images=(
  "public/img/bg.png"
  "public/img/张卓琪.png"
  "public/img/李百川.png"
)

for img in "${images[@]}"; do
  if [ -f "$img" ]; then
    size=$(du -h "$img" | cut -f1)
    echo "✅ $img ($size)"
  else
    echo "❌ $img (缺失)"
  fi
done

echo ""
echo "📦 检查依赖配置..."
if grep -q "vue" package.json; then
  echo "✅ Vue 3 依赖已配置"
else
  echo "❌ Vue 3 依赖未配置"
fi

if grep -q "element-plus" package.json; then
  echo "✅ Element Plus 依赖已配置"
else
  echo "❌ Element Plus 依赖未配置"
fi

if grep -q "xlsx" package.json; then
  echo "✅ XLSX 依赖已配置"
else
  echo "❌ XLSX 依赖未配置"
fi

echo ""
echo "✨ 项目检查完成！"
echo ""
echo "📝 下一步："
echo "  1. npm install    - 安装依赖"
echo "  2. npm run build  - 打包项目"
echo "  3. 打开 dist/index.html - 开始使用"
