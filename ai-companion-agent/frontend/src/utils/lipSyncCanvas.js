/**
 * Sonic-Style Talking Portrait Lip Sync Engine
 *
 * 实时在 Canvas 上绘制人像 + 动态口型，
 * 使用 Web Audio 分析的实时幅度驱动嘴部动画。
 *
 * 相比 Sonic/Wav2Lip 的简化方案：
 * - 不需要 ML 模型，纯 Canvas 2D
 * - 嘴部位置可以通过 face landmarks 或手动校准
 * - 适合作为 Sonic 的 fallback 方案（在浏览器里即时生效）
 */

export class LipSyncCanvas {
  constructor(canvas, imageOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.image = null;
    this.imageReady = false;

    // 嘴部区域参数（基于选定肖像手动校准）
    // 图像原始分辨率 800 x 533
    // 眼睛 ≈ (340, 230), (470, 230)
    // 鼻尖 ≈ (405, 280)
    // 嘴部中心 ≈ (405, 320)，是闭唇的小细线
    this.mouthRegions = imageOptions.mouthRegions || {
      closed: {
        // 闭嘴状态（实际显示的嘴唇）
        x: 375,
        y: 314,
        width: 60,
        height: 5,
      },
      // 张嘴时口腔内部的位置
      openBase: {
        x: 388,
        y: 318,
        width: 50,
        height: 2,
      },
    };

    this.currentAmp = 0;
    this.targetAmp = 0;
    this.smoothFactor = 0.35;
    this.lastDrawTime = 0;
    this.drawInterval = 1000 / 30; // 30fps 足够流畅
  }

  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.image = img;
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.imageReady = true;
        this.draw(0);
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  setAmplitude(amp) {
    this.targetAmp = Math.min(1, amp * 1.2);
  }

  setEmotion(emotion) {
    this.emotion = emotion;
  }

  draw(forceAmp) {
    if (!this.imageReady) return;
    const amp = forceAmp !== undefined ? forceAmp : this.currentAmp;

    const { ctx, canvas, image } = this;
    const w = canvas.width;
    const h = canvas.height;

    // 平滑过渡
    if (forceAmp === undefined) {
      this.currentAmp += (this.targetAmp - this.currentAmp) * this.smoothFactor;
    } else {
      this.currentAmp = forceAmp;
    }

    ctx.clearRect(0, 0, w, h);

    // 1. 绘制完整肖像
    ctx.drawImage(image, 0, 0, w, h);

    // 2. 如果在说话，在嘴部位置绘制动画
    if (amp > 0.01) {
      this.drawOpenMouth(ctx, w, h, amp);
    }
  }

  /**
   * 绘制张开的嘴巴
   * - 用深色椭圆作为内部口腔
   * - 椭圆垂直拉伸随 amplitude 增加
   * - 显示牙齿和舌头
   */
  drawOpenMouth(ctx, w, h, amp) {
    const mouth = this.mouthRegions.closed;
    const openBase = this.mouthRegions.openBase;

    // 嘴部中心（基于图像坐标系）
    const cx = openBase.x + openBase.width / 2;
    const cy = openBase.y + openBase.height / 2;

    // 张开高度（夸张动画，便于看清）
    const openH = 8 + amp * 40;

    // 嘴角到中点的距离
    const lipHalfW = openBase.width / 2;

    ctx.save();

    // 2.1 上下唇（皮肤色阴影版，让嘴巴外沿更明显）
    const lipTopY = cy - openH * 0.5 - 2;
    const lipBottomY = cy + openH * 0.5 + 2;

    // 上唇（柔和阴影）
    ctx.fillStyle = '#A07060';
    ctx.beginPath();
    ctx.ellipse(cx, lipTopY, lipHalfW * 1.1, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 下唇
    ctx.fillStyle = '#B0806E';
    ctx.beginPath();
    ctx.ellipse(cx, lipBottomY, lipHalfW * 1.1, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2.2 嘴部内部（深红色）
    ctx.fillStyle = '#2A0810';
    ctx.beginPath();
    ctx.ellipse(cx, cy, lipHalfW * 0.85, openH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2.3 上排牙齿（仅当张开到一定程度）
    if (amp > 0.06) {
      const teethH = Math.min(1, amp * 5) * openH * 0.45;
      ctx.fillStyle = '#FAF0DC';
      ctx.beginPath();
      ctx.ellipse(cx, cy - openH * 0.18, lipHalfW * 0.78, teethH, 0, 0, Math.PI);
      ctx.fill();
    }

    // 2.4 下排牙齿
    if (amp > 0.08) {
      const teethH = Math.min(1, amp * 4) * openH * 0.4;
      ctx.fillStyle = '#EFE5D2';
      ctx.beginPath();
      ctx.ellipse(cx, cy + openH * 0.2, lipHalfW * 0.72, teethH, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    // 2.5 舌头（仅大幅张开时）
    if (amp > 0.2) {
      ctx.fillStyle = '#C26F78';
      ctx.beginPath();
      ctx.ellipse(cx, cy + openH * 0.55, lipHalfW * 0.5, openH * 0.4, 0, 0, Math.PI);
      ctx.fill();

      // 舌头中线
      ctx.strokeStyle = '#9F5560';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy + openH * 0.3);
      ctx.lineTo(cx, cy + openH * 0.7);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制"微笑"表情（通过在嘴角添加曲线）
   */
  drawSmile(ctx, w, h) {
    if (this.emotion !== 'smile' && this.emotion !== 'happy' && this.emotion !== 'excited') return;
    // 微笑加重（轻度变化）
    const mouth = this.mouthRegions.closed;

    ctx.save();
    ctx.strokeStyle = 'rgba(180, 60, 70, 0.5)';
    ctx.lineWidth = 1.5;

    const cx = mouth.x + mouth.width / 2;
    const cy = mouth.y + mouth.height / 2;
    const extend = this.emotion === 'excited' ? 1.6 : 1.2;

    // 嘴角上扬
    ctx.beginPath();
    ctx.moveTo(mouth.x - 5, cy + 3);
    ctx.quadraticCurveTo(mouth.x - 8, cy - 4, mouth.x + 5, cy - 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mouth.x + mouth.width + 5, cy + 3);
    ctx.quadraticCurveTo(mouth.x + mouth.width + 8, cy - 4, mouth.x + mouth.width - 5, cy - 2);
    ctx.stroke();
    ctx.restore();
  }

  shouldRedraw(now) {
    if (now - this.lastDrawTime < this.drawInterval) return false;
    this.lastDrawTime = now;
    return true;
  }
}

/**
 * 自动检测图像中嘴部位置的工具
 * 用简单的肤色/亮度分析找出可能的嘴部区域。
 * 这是一个简化版的 face landmark 检测。
 */
export function estimateMouthRegion(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 扫描脸部下半部分（约下方 50%-85% 区域）
  // 嘴部通常比肤色稍暗（红色调）
  let minR = 255, maxR = 0;
  let minG = 255, maxG = 0;
  let minB = 255, maxB = 0;

  const startY = Math.floor(h * 0.5);
  const endY = Math.floor(h * 0.85);

  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // 嘴部特征：红色分量明显高于其他
      if (r > g + 25 && r > b + 25 && r > 80) {
        minR = Math.min(minR, x);
        maxR = Math.max(maxR, x);
        minG = Math.min(minG, y);
        maxG = Math.max(maxG, y);
      }
    }
  }

  if (maxR > minR && maxG > minG) {
    return {
      x: minR,
      y: minG,
      width: maxR - minR,
      height: (maxR - minR) * 0.15, // 估计高度为宽度的 15%
    };
  }

  // 默认 fallback
  return {
    x: w * 0.4,
    y: h * 0.55,
    width: w * 0.2,
    height: h * 0.02,
  };
}
