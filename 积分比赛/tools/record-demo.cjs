/**
 * 积分赛跑系统 · 使用演示录屏（独立 Node 脚本，无会话超时限制）
 * 用法：node tools/record-demo-node.js
 * 原理：CDP Page.startScreencast 采帧 → 接收页 canvas+MediaRecorder 合成 WebM → Node 写盘。
 */
const path = require('path');
const fs = require('fs');

// 复用 playwright-cli 全局包内的 playwright-core
const PW = '/Users/lisongrsn/.nvm/versions/node/v20.19.6/lib/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);

const OUT = path.join(__dirname, '..', '积分赛跑系统使用演示.webm');
const DEMO_URL = process.env.DEMO_URL || 'http://localhost:5180/';
const XLSX = path.join(__dirname, '..', 'public', '演示数据_打乱.xlsx');

(async () => {
  console.log('[1/6] 启动浏览器…');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(DEMO_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  console.log('[2/6] 开始采帧 + 驱动演示流程…');
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let recording = true;
  cdp.on('Page.screencastFrame', (f) => {
    if (recording) frames.push(f.data);
    setTimeout(() => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    }, 90);
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 55, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1,
  });

  const step = (s) => console.log('   • ' + s);

  await page.waitForTimeout(2500); step('页面概览');

  // 导入 Excel
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('button:has-text("📂 导入Excel")').first().click(),
  ]);
  await chooser.setFiles(XLSX);
  await page.waitForTimeout(2200); step('导入Excel成功');

  // 竞赛配置
  await page.locator('button:has-text("⚙️ 竞赛配置")').first().click();
  await page.waitForTimeout(2200); step('打开竞赛配置');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900); step('关闭配置');

  // 开始竞赛
  await page.locator('button:has-text("开始竞赛")').first().click();
  step('开始竞赛动画（约 20s）');
  await page.waitForTimeout(21000); step('竞赛结束，自动弹出排名');

  // 竞赛结束后排名抽屉（el-drawer）已自动打开，等待动画完成
  await page.waitForSelector('.el-drawer .rank-item', { timeout: 15000 });
  await page.waitForTimeout(2600); step('查看排名');
  await page.locator('.el-drawer .rank-item').first().click();
  await page.waitForTimeout(2200); step('学生详情');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  recording = false;
  await cdp.send('Page.stopScreencast').catch(() => {});
  console.log(`[3/6] 采集完成：${frames.length} 帧`);
  if (!frames.length) { console.error('未采集到帧，退出'); await browser.close(); process.exit(1); }

  console.log('[4/6] 接收页合成 WebM（canvas + MediaRecorder）…');
  const recv = await ctx.newPage();
  await recv.goto('about:blank');
  await recv.evaluate(() => {
    window.__frames = [];
    window.recordFrames = async (fps) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 800;
      document.body.appendChild(canvas);
      const ctx2d = canvas.getContext('2d');
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(fps);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3000000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      rec.start(250);
      const load = (b64) => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = 'data:image/jpeg;base64,' + b64;
      });
      const gap = 1000 / fps;
      for (const b64 of window.__frames) {
        try {
          const img = await load(b64);
          ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch (e) { /* 跳过坏帧 */ }
        await new Promise((r) => setTimeout(r, gap));
      }
      await new Promise((r) => setTimeout(r, 600));
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime });
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      window.__b64 = btoa(bin);
      return blob.size;
    };
  });

  // 分批传输帧
  const BATCH = 12;
  for (let i = 0; i < frames.length; i += BATCH) {
    await recv.evaluate((arr) => { window.__frames.push(...arr); }, frames.slice(i, i + BATCH));
    if ((i / BATCH) % 10 === 0) process.stdout.write(`   传输 ${Math.min(i + BATCH, frames.length)}/${frames.length}\r\n`);
  }

  console.log('[5/6] 录制合成中…');
  const size = await recv.evaluate((fps) => window.recordFrames(fps), 20);
  const b64 = await recv.evaluate(() => window.__b64);
  console.log(`   合成完成：${(size / 1024 / 1024).toFixed(2)} MB`);

  console.log('[6/6] 写盘：' + OUT);
  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log('✅ 完成！视频大小: ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB');

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('❌ 失败:', e.message); process.exit(1); });
