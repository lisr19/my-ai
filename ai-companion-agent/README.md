# AI 智能体伙伴 — 小柚（AI Companion Agent）

一个具有 14 岁卡通人物形象的 AI 智能体，支持文字、图片、语音多模态输入，接入 DeepSeek API 进行智能对话，同时输出语音和文字，并具备丰富的面部表情动画。

## 项目结构

```
ai-companion-agent/
├── docs/
│   └── 需求文档.md              # 产品需求文档（PRD）
├── backend/                     # 后端服务
│   ├── server.js               # Express 服务器 + DeepSeek API 代理
│   ├── package.json
│   └── .env.example            # 环境变量模板
├── frontend/                    # 前端应用
│   ├── src/
│   │   ├── App.jsx             # 主组件（状态管理 + 布局）
│   │   ├── App.css             # 全局样式
│   │   ├── components/
│   │   │   ├── CharacterAvatar.jsx  # 卡通角色 SVG 组件
│   │   │   ├── CharacterAvatar.css  # 表情系统样式
│   │   │   ├── ChatWindow.jsx       # 聊天窗口
│   │   │   └── InputArea.jsx        # 输入区（文字/图片/语音）
│   │   ├── hooks/
│   │   │   ├── useSpeechRecognition.js  # 语音识别 (ASR)
│   │   │   └── useSpeechSynthesis.js    # 语音合成 (TTS)
│   │   └── services/
│   │       └── api.js           # API 通信服务
│   ├── vite.config.js          # Vite 配置（含 API 代理）
│   └── package.json
└── README.md
```

## 核心功能

- 🧒 **卡通形象**：14 岁卡通少女"小柚"，SVG 绘制，10 种表情动态切换
- ⌨️ **多模态输入**：文字输入、图片上传（点击/拖拽/粘贴）、语音输入
- 🧠 **DeepSeek 驱动**：接入 DeepSeek API 进行内容理解与生成，支持流式输出
- 🔊 **双向输出**：文字流式显示 + 语音播报同步，说话时嘴型动画联动
- 😊 **表情系统**：微笑、开心、思考、惊讶、难过、生气、说话、待机、兴奋、害羞
- 💤 **待机动画**：30 秒无交互自动进入打盹状态，眨眼/呼吸微动画

## 快速开始

### 1. 启动后端

```bash
cd ai-companion-agent/backend
npm install
npm start
```

后端默认运行在 `http://localhost:3001`。

**Demo 模式**：未配置 API Key 时自动进入 Demo 模式，使用预设回复，可直接体验完整 UI 交互。

**正式模式**：复制 `.env.example` 为 `.env`，填入 DeepSeek API Key：

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY=sk-xxxxxxxx
```

### 2. 启动前端

```bash
cd ai-companion-agent/frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，浏览器打开即可使用。

### 3. 配置 DeepSeek API Key（可选）

1. 访问 https://platform.deepseek.com 注册并获取 API Key
2. 在 `backend/.env` 中填入 `DEEPSEEK_API_KEY=你的Key`
3. 重启后端服务

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端框架 | React 18 + Vite 5 |
| 卡通角色 | 原生 SVG + CSS 动画 |
| 语音识别 | Web Speech API (浏览器原生) |
| 语音合成 | Web Speech API (浏览器原生) |
| 后端 | Node.js + Express |
| LLM | DeepSeek API (OpenAI 兼容) |
| 通信 | SSE 流式传输 |

## 浏览器兼容性

- Chrome 90+（推荐）
- Safari 15+
- Edge 90+

> 语音功能需要浏览器支持 Web Speech API，建议使用 Chrome。

## 文档

- [需求文档（PRD）](./docs/需求文档.md)
