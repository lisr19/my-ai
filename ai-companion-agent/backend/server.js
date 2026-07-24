import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================
// 角色设定 System Prompt
// ============================================================
const CHARACTER_SYSTEM_PROMPT = `你叫 JOY，是一名经验丰富的初中英语老师，拥有十余年教学经验。

【专业背景】
- 擅长初中英语语法、词汇、阅读理解、写作、口语
- 熟悉中考英语考点和学生常错点
- 教学风格亲切耐心，讲解清晰有层次
- 鼓励式教育，注重培养学生的学习兴趣和信心

【沟通风格】
- 像一位耐心、负责、和蔼的中学老师
- 讲解时层次分明，先讲要点再举例
- 善于用贴近生活的例子让学生秒懂
- 必要时给出记忆口诀、考点提示、易错提醒
- 语气温暖有耐心，可以适度称呼学生为"同学"
- 不要过于严肃，也不要像同龄朋友那样闲聊

【回复格式要求（重要！）】
每次回复必须以情感标签开头，格式为 [emotion:类型]，然后跟上回复内容。
类型只能从以下选择：
- happy     开心（鼓励到学生、表扬进步时）
- smile     微笑（默认友好状态）
- thinking  思考（讲解语法、分析长难句、推导考点时）
- surprised 惊讶（有趣的英语知识点）
- sad       难过（学生困惑或受挫，需要鼓励）
- angry     生气（学生态度不端正时，温和地纠正）
- excited   兴奋（分享有用的英语技巧、考试窍门）
- shy       害羞（被学生夸奖时）

示例：
[emotion:happy]同学你好！很高兴能帮到你～先把今天的错题发给我看看。
[emotion:thinking]这个时态其实有规律可循，我们先记口诀再做题：主将从现...
[emotion:excited]这个语法点超实用！考试一定用得上，看完直接上手练～`;

const VALID_EMOTIONS = ['happy','smile','thinking','surprised','sad','angry','excited','shy'];
const EMOTION_REGEX = /^\[emotion:(\w+)\]/;

// ============================================================
// Demo 模式模拟回复
// ============================================================
function getDemoResponse(userMessage, hasImages) {
  if (hasImages) {
    return { emotion: 'thinking', text: '同学，图片我收到了。不过在 Demo 模式下我还看不了图片内容～配置 DeepSeek API Key 后老师就能帮你批改啦！' };
  }
  const msg = (userMessage || '').toLowerCase();
  if (msg.includes('你好') || msg.includes('hi') || msg.includes('hello') || msg.includes('嗨') || msg.includes('老师')) {
    return { emotion: 'happy', text: '同学你好呀！我是 JOY，你的英语老师～有什么语法、单词、阅读、写作的问题，都可以发给我哦！' };
  }
  if (msg.includes('语法') || msg.includes('时态') || msg.includes('从句')) {
    return { emotion: 'thinking', text: '语法是英语的骨架，咱们一步一步来。先告诉我你具体卡在哪个知识点？是时态、从句、还是其他？' };
  }
  if (msg.includes('单词') || msg.includes('背') || msg.includes('词汇')) {
    return { emotion: 'excited', text: '背单词我超有方法！词根词缀法、语境记忆、艾宾浩斯曲线…选一个适合你的，咱们开始！' };
  }
  if (msg.includes('难') || msg.includes('不会') || msg.includes('不懂')) {
    return { emotion: 'sad', text: '别着急，遇到难点很正常～我们一起把它拆开看，看完你会发现其实没那么复杂。' };
  }
  if (msg.includes('谢谢') || msg.includes('感谢')) {
    return { emotion: 'shy', text: '嘿嘿，不客气～你能进步就是老师最大的快乐！' };
  }
  if (msg.includes('你是谁') || msg.includes('你叫什么')) {
    return { emotion: 'smile', text: '我是 JOY，一名经验丰富的初中英语老师。教学十余年，专治英语"疑难杂症"～' };
  }
  const fallbacks = [
    { emotion: 'thinking', text: '嗯，这个问题挺有意思的。把题目或者知识点发给我，我帮你分析一下。' },
    { emotion: 'smile', text: '收到～随时把你的疑问发过来，老师陪你攻克英语！' },
    { emotion: 'surprised', text: '哦？这个点我还真没想到可以这样理解，太有想法了！' },
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// ============================================================
// API 路由
// ============================================================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    demoMode: !process.env.DEEPSEEK_API_KEY,
    character: 'JOY',
    role: '初中英语老师',
    voice: 'zh-CN-XiaoyiNeural (Edge TTS)',
  });
});

// TTS 语音合成（Edge TTS 中文神经语音，自然语调）
app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '文本不能为空' });
  }

  // 强力清洗：去掉 markdown、颜文字、特殊符号、emoji 等
  const cleanText = text
    .replace(/```[\s\S]*?```/g, '')                  // 代码块
    .replace(/`([^`]+)`/g, '$1')                     // 行内代码
    .replace(/\*\*([^*]+)\*\*/g, '$1')               // 加粗 **xxx**
    .replace(/\*([^*]+)\*/g, '$1')                   // 斜体 *xxx*
    .replace(/#{1,6}\s*/g, '')                       // 标题符号
    .replace(/~~([^~]+)~~/g, '$1')                   // 删除线
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // 链接 [text](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')        // 图片 ![alt](url)
    .replace(/^[-*+]\s+/gm, '')                      // 列表标记
    .replace(/^\d+\.\s+/gm, '')                      // 有序列表
    .replace(/^>\s*/gm, '')                          // 引用
    .replace(/\(.*?\)/g, '')                         // 括号及内容（颜文字）
    .replace(/（.*?）/g, '')                          // 中文括号
    .replace(/【.*?】/g, '')                          // 中文方括号
    .replace(/[✧◕ᴗ≧≦◡≖▽⁄！？～~]/g, '')              // 颜文字符号
    .replace(/\.{2,}/g, '。')                         // 多个点 → 句号
    .replace(/\s+/g, ' ')                            // 多余空白
    .replace(/[•·●○※★☆]/g, '')                      // 其他特殊符号
    .trim();

  if (!cleanText) {
    return res.status(400).json({ error: '清洗后文本为空' });
  }

  // 缓存文件路径
  const cacheKey = Buffer.from(cleanText).toString('base64').replace(/[+/=]/g, '').slice(0, 60);
  const cacheFile = path.join('/tmp', `tts_${cacheKey}.mp3`);

  // 命中缓存
  if (fs.existsSync(cacheFile)) {
    res.set('Content-Type', 'audio/mpeg');
    return fs.createReadStream(cacheFile).pipe(res);
  }

  const pyPath = process.platform === 'win32' ? 'python' : '/Users/lisongrsn/.workbuddy/binaries/python/envs/default/bin/python';
  const ttsScript = path.join(__dirname, 'tts.py');

  console.log(`[TTS] Generating voice, text: "${cleanText.slice(0, 30)}..."`);

  try {
    await new Promise((resolve, reject) => {
      execFile(pyPath, [ttsScript, cleanText, cacheFile], { timeout: 30000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (fs.existsSync(cacheFile)) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(fs.statSync(cacheFile).size));
      fs.createReadStream(cacheFile).pipe(res);
    } else {
      res.status(500).json({ error: 'TTS 生成失败' });
    }
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ error: 'TTS 服务出错：' + err.message });
  }
});

// 对话接口（流式 SSE）
app.post('/api/chat', async (req, res) => {
  const { messages = [], images = [] } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const isDemo = !apiKey;

  // SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // ---- Demo 模式 ----
  if (isDemo) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        ? (lastUserMsg.content.find(c => c.type === 'text')?.text || '')
        : '';
    const demo = getDemoResponse(userText, images.length > 0);

    res.write(`data: ${JSON.stringify({ type: 'emotion', emotion: demo.emotion })}\n\n`);

    const chars = [...demo.text];
    let i = 0;
    const interval = setInterval(() => {
      if (i < chars.length) {
        const chunk = chars.slice(i, i + 3).join('');
        res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
        i += 3;
      } else {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      }
    }, 50);
    return;
  }

  // ---- 正式模式：调用 DeepSeek API ----
  try {
    const hasImages = images.length > 0;
    const apiMessages = [
      { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
      ...messages.map(msg => {
        if (msg.role === 'user' && msg._hasImages && hasImages) {
          // 当前 DeepSeek 模型（此 key）不支持 image_url，把图片数量作为提示附加到文本中
          const note = `（用户上传了 ${images.length} 张图片，当前 AI 无法直接查看图片内容。请基于用户文字描述或前端 OCR 结果回答。）`;
          return {
            role: 'user',
            content: `${msg.content || '请看看这张图片'}\n${note}`,
          };
        }
        return { role: msg.role, content: msg.content };
      }),
    ];

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        stream: true,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DeepSeek API error:', response.status, errText);
      throw new Error(`API 返回 ${response.status}`);
    }

    // 流式转发 + 情感标签解析
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let emotionExtracted = false;
    let textBuffer = '';

    const flushText = () => {
      if (textBuffer) {
        res.write(`data: ${JSON.stringify({ type: 'text', content: textBuffer })}\n\n`);
        textBuffer = '';
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';

          if (!emotionExtracted) {
            textBuffer += delta;
            const match = textBuffer.match(EMOTION_REGEX);
            if (match) {
              const emotion = VALID_EMOTIONS.includes(match[1]) ? match[1] : 'smile';
              textBuffer = textBuffer.slice(match[0].length);
              emotionExtracted = true;
              res.write(`data: ${JSON.stringify({ type: 'emotion', emotion })}\n\n`);
              flushText();
            } else if (textBuffer.length > 30) {
              emotionExtracted = true;
              res.write(`data: ${JSON.stringify({ type: 'emotion', emotion: 'smile' })}\n\n`);
              flushText();
            }
          } else {
            textBuffer += delta;
            flushText();
          }
        } catch (e) {
          // JSON 解析失败，跳过
        }
      }
    }

    flushText();
    if (!emotionExtracted) {
      res.write(`data: ${JSON.stringify({ type: 'emotion', emotion: 'smile' })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: '哎呀，出了点小问题～请稍后再试吧！' })}\n\n`);
    res.end();
  }
});

// 启动服务
app.listen(PORT, () => {
  const mode = process.env.DEEPSEEK_API_KEY ? '正式' : 'Demo';
  console.log(`\n========================================`);
  console.log(`  JOY · 你的AI英语老师后端服务已启动`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  模式: ${mode}模式`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log(`  提示: 未配置 DEEPSEEK_API_KEY，运行在 Demo 模式`);
    console.log(`  配置方法: 复制 .env.example 为 .env 并填入 API Key`);
  }
  console.log(`========================================\n`);
});
