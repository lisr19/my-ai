# 打包和部署指南

## 📦 打包步骤

### 1. 安装依赖（首次运行）

```bash
cd vue-race-system
npm install
```

这会安装以下依赖：
- vue@3.4.0 - Vue 框架
- element-plus@2.6.0 - UI 组件库
- xlsx@0.18.5 - Excel 解析库
- vite@5.0.0 - 构建工具

### 2. 打包项目

```bash
npm run build
```

打包过程：
- 编译 Vue 组件
- 优化和压缩代码
- 生成静态文件
- 输出到 `dist` 文件夹

### 3. 验证打包结果

打包完成后，`dist` 文件夹结构如下：

```
dist/
├── index.html                    # 主页面（直接打开这个文件）
├── assets/
│   ├── index-[hash].js          # 应用代码
│   ├── index-[hash].css         # 样式文件
│   └── ...其他资源
└── ...
```

## 🌐 本地使用

### 方式一：直接打开（推荐）

1. 打包项目：`npm run build`
2. 打开文件：在浏览器中打开 `dist/index.html`
3. 开始使用：导入 Excel 数据，开始竞赛

### 方式二：本地服务器

如果直接打开有问题，可以使用本地服务器：

```bash
# 使用 Python 3
cd dist
python -m http.server 8000

# 或使用 Python 2
python -m SimpleHTTPServer 8000

# 或使用 Node.js http-server
npx http-server dist
```

然后在浏览器打开 `http://localhost:8000`

## 📤 部署到服务器

### 部署到 Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    root /var/www/race-system/dist;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 部署到 Apache

```apache
<Directory /var/www/race-system/dist>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</Directory>
```

### 部署到 GitHub Pages

```bash
# 1. 创建 GitHub 仓库
# 2. 修改 vite.config.js 中的 base 为你的仓库名
# 3. 打包
npm run build

# 4. 部署
git add dist
git commit -m "Deploy"
git push origin main
```

## 🔍 文件大小

打包后的文件大小（参考）：

| 文件 | 大小 |
|------|------|
| index.html | ~5KB |
| index-xxx.js | ~200KB |
| index-xxx.css | ~50KB |
| 总计（gzip） | ~80KB |

## ✅ 检查清单

打包前检查：
- [ ] Node.js 版本 >= 14
- [ ] 所有依赖已安装（npm install）
- [ ] 没有 TypeScript 错误
- [ ] 图片资源在 `public/img/` 中

打包后检查：
- [ ] `dist/index.html` 存在
- [ ] `dist/assets/` 文件夹存在
- [ ] 可以在浏览器打开 `dist/index.html`
- [ ] 所有功能正常工作

## 🐛 常见问题

### 打包失败

**问题**：`npm run build` 报错

**解决**：
```bash
# 清除缓存
rm -rf node_modules package-lock.json
npm install
npm run build
```

### 打开后页面空白

**问题**：打开 `dist/index.html` 后页面空白

**解决**：
1. 检查浏览器控制台是否有错误
2. 尝试使用本地服务器而不是直接打开
3. 清除浏览器缓存

### 图片无法加载

**问题**：背景图片或头像无法显示

**解决**：
1. 确保图片在 `public/img/` 文件夹中
2. 检查文件名是否正确
3. 重新打包：`npm run build`

### 样式错乱

**问题**：打开后样式显示不正确

**解决**：
1. 清除浏览器缓存
2. 使用 Ctrl+Shift+R 强制刷新
3. 尝试其他浏览器

## 📊 性能优化

### 已应用的优化

- ✅ 代码分割
- ✅ 文件压缩
- ✅ CSS 优化
- ✅ 图片优化
- ✅ 缓存策略

### 进一步优化

如需进一步优化，可以：

1. 使用 CDN 加速
2. 启用 Gzip 压缩
3. 添加 Service Worker
4. 使用图片懒加载

## 🔐 安全建议

- 所有数据在本地处理，无服务器依赖
- 不上传任何用户数据
- 支持离线使用
- 可以在内网部署

## 📝 版本管理

### 更新依赖

```bash
npm update
npm run build
```

### 锁定版本

```bash
npm ci  # 使用 package-lock.json 中的版本
```

## 🚀 自动化部署

### 使用 GitHub Actions

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## 📞 支持

如有问题，请检查：
1. Node.js 版本
2. npm 版本
3. 依赖是否完整
4. 浏览器是否最新

---

**祝打包顺利！** 🎉
