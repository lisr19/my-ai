/**
 * 积分赛跑系统 · 使用演示录屏脚本（playwright-cli run-code --filename 执行）
 * 原理：CDP Page.startScreencast 采集页面帧（jpeg），
 *      全部帧传输到接收页用 <canvas> + MediaRecorder 合成 WebM，
 *      再通过 Playwright download 保存到项目目录。无需 ffmpeg。
 */
async (page) => {
  const result = { steps: [], frames: 0 };
  const ctx = page.context();
  const DEMO_URL = 'http://localhost:5180/';
  const OUT = '/Volumes/D盘/my-ai/积分比赛/积分赛跑系统使用演示.webm';
  const XLSX = '/Volumes/D盘/my-ai/积分比赛/public/成绩导入模板.xlsx';

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(DEMO_URL);
  await page.waitForTimeout(1800);

  /* ---------- 1. CDP 采帧（约 10fps：延迟 ack 节流） ---------- */
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
  const step = (s) => result.steps.push(s);

  /* ---------- 2. 驱动演示流程 ---------- */
  await page.waitForTimeout(2500); step('页面概览');

  // 导入 Excel
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('button:has-text("📂 导入Excel")').first().click(),
  ]);
  await chooser.setFiles(XLSX);
  await page.waitForTimeout(2200); step('导入Excel成功');

  // 竞赛配置弹窗
  await page.locator('button:has-text("⚙️ 竞赛配置")').first().click();
  await page.waitForTimeout(2200); step('打开竞赛配置');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900); step('关闭配置');

  // 开始竞赛（动画约 18s）
  await page.locator('button:has-text("开始竞赛")').first().click();
  step('开始竞赛动画');
  await page.waitForTimeout(21000); step('竞赛结束');

  // 查看排名（el-drawer）
  await page.locator('button:has-text("查看排名")').first().click();
  await page.waitForTimeout(2600); step('查看排名');
  await page.locator('.el-drawer .rank-item').first().click();
  await page.waitForTimeout(2200); step('学生详情');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  recording = false;
  await cdp.send('Page.stopScreencast').catch(() => {});
  result.frames = frames.length;
  step('采集完成 ' + frames.length + ' 帧');
  if (!frames.length) { result.error = '未采集到帧'; return result; }

  /* ---------- 3. 接收页：canvas + MediaRecorder 合成 WebM ---------- */
  const recv = await ctx.newPage();
  await recv.goto('about:blank');
  await recv.evaluate(() => {
    window.__frames = [];
    // 合成器：逐帧画到 canvas，MediaRecorder 录制，结束自动触发下载
    window.recordAndDownload = async (fps) => {
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'demo.webm';
      document.body.appendChild(a);
      a.click();
      window.__blobSize = blob.size;
    };
  });

  // 分批传输帧（base64 jpeg）
  const BATCH = 12;
  for (let i = 0; i < frames.length; i += BATCH) {
    await recv.evaluate((arr) => { window.__frames.push(...arr); }, frames.slice(i, i + BATCH));
  }
  step('帧传输完成');

  // 合成并保存
  const dlPromise = recv.waitForEvent('download', { timeout: 180000 });
  await recv.evaluate((fps) => window.recordAndDownload(fps), 20);
  const dl = await dlPromise;
  await dl.saveAs(OUT);
  result.blobSize = await recv.evaluate(() => window.__blobSize || 0);
  step('视频已保存: ' + OUT);
  await recv.close();
  return result;
}
