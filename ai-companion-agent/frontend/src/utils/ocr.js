import Tesseract from 'tesseract.js';

/**
 * 对图片进行 OCR 文字识别
 * @param {string} dataUrl - 图片的 data URL
 * @returns {Promise<string>} 识别出的文字
 */
export async function recognizeText(dataUrl) {
  const result = await Tesseract.recognize(dataUrl, 'chi_sim+eng', {
    logger: () => {}, // 静默日志
  });
  return result.data.text.trim();
}

/**
 * 批量识别多张图片
 * @param {Array<{dataUrl:string, name:string}>} images
 * @returns {Promise<Array<{name:string, text:string}>>}
 */
export async function recognizeImages(images) {
  const results = [];
  for (const img of images) {
    try {
      const text = await recognizeText(img.dataUrl);
      results.push({ name: img.name || '图片', text });
    } catch (e) {
      results.push({ name: img.name || '图片', text: '' });
    }
  }
  return results;
}
