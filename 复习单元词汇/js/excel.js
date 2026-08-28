/**
 * Excel 导入导出 + 示例词库（SheetJS）
 * 表头支持中英文别名，顺序灵活；例句/翻译可选。
 * 示例词库数据见 js/samples*.js，经 window.VocabSamples 注册表访问。
 */
(function () {
  const HEADER_ALIASES = {
    unit: ['单元', 'unit', '课次', '章节', 'unitname'],
    word: ['单词', 'word', '英文', '词汇', 'english', 'term'],
    phonetic: ['音标', 'phonetic', '读音', '发音', '音标(美)', '音标(英)'],
    pos: ['词性', 'pos', 'part of speech', '词类'],
    meaning: ['中文释义', '释义', '中文', '意思', 'meaning', 'chinese', '翻译', '词义'],
    example: ['例句', 'example', 'sentence', '英文例句'],
    exampleTrans: ['例句翻译', '翻译例句', '例句中文', '中文例句', 'example trans', 'sentence trans'],
  };

  function normalizeHeader(h) {
    const s = String(h || '').trim().toLowerCase();
    for (const key in HEADER_ALIASES) {
      if (HEADER_ALIASES[key].some((a) => a.toLowerCase() === s)) return key;
    }
    return null;
  }

  /** 解析 Excel 文件 → { words, units, errors } */
  function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (!rows.length) return reject(new Error('文件为空'));

          // 找到表头行（包含"单词/word"列的那一行）
          const headerIdx = rows.findIndex((r) => r.some((c) => normalizeHeader(c) === 'word'));
          if (headerIdx === -1) {
            return reject(new Error('未找到"单词"列，请检查表头（需包含：单元、单词、音标、词性、中文释义、例句、例句翻译）'));
          }

          const headerRow = rows[headerIdx].map(normalizeHeader);
          const colOf = (key) => headerRow.indexOf(key);
          const cWord = colOf('word');
          const cMeaning = colOf('meaning');
          const cUnit = colOf('unit');
          const cPhon = colOf('phonetic');
          const cPos = colOf('pos');
          const cEx = colOf('example');
          const cExTr = colOf('exampleTrans');
          if (cWord === -1) return reject(new Error('缺少"单词"列'));
          if (cMeaning === -1) return reject(new Error('缺少"中文释义"列'));

          const words = [];
          const errors = [];
          const unitSet = new Set();
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            const word = String(r[cWord] || '').trim();
            if (!word) continue;
            const unit = cUnit > -1 ? String(r[cUnit] || '').trim() : '';
            if (unit) unitSet.add(unit);
            if (cMeaning > -1 && !String(r[cMeaning] || '').trim()) {
              errors.push(`第 ${i + 1} 行「${word}」缺少中文释义，已跳过`);
              continue;
            }
            words.push({
              unit,
              word,
              phonetic: cPhon > -1 ? String(r[cPhon] || '').trim() : '',
              pos: cPos > -1 ? String(r[cPos] || '').trim() : '',
              meaning: String(r[cMeaning] || '').trim(),
              example: cEx > -1 ? String(r[cEx] || '').trim() : '',
              exampleTrans: cExTr > -1 ? String(r[cExTr] || '').trim() : '',
            });
          }
          if (!words.length) return reject(new Error('没有解析到有效单词'));
          resolve({ words, units: [...unitSet], errors });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  const COLS = [{ wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 42 }, { wch: 32 }];

  function aoaToSheet(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COLS;
    return ws;
  }

  /** 下载导入模板 */
  function downloadTemplate() {
    const aoa = [
      ['单元', '单词', '音标', '词性', '中文释义', '例句', '例句翻译'],
      ['Unit 1', 'hello', '/həˈləʊ/', 'interj.', '你好', 'Hello, everyone!', '大家好！'],
      ['Unit 1', 'goodbye', '/ˌɡʊdˈbaɪ/', 'interj.', '再见', 'Goodbye and good luck!', '再见，祝你好运！'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), '词汇');
    XLSX.writeFile(wb, '词汇导入模板.xlsx');
  }

  /* ---------------- 示例词库（注册表见 js/samples*.js） ---------------- */
  function sampleBooks() {
    return window.VocabSamples ? window.VocabSamples.list() : [];
  }

  /** 下载示例 Excel；不传 key 时默认第一册 */
  function downloadSample(key) {
    const books = sampleBooks();
    const book = (key && window.VocabSamples.get(key)) || books[0];
    if (!book) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaToSheet(window.VocabSamples.toAOA(book)), '词汇');
    XLSX.writeFile(wb, book.file);
  }

  /** 载入示例词库单词；不传 key 时默认第一册 */
  function sampleWords(key) {
    const books = sampleBooks();
    const book = (key && window.VocabSamples.get(key)) || books[0];
    if (!book) return [];
    return window.VocabSamples.toWords(book);
  }

  window.VocabExcel = {
    parseExcelFile,
    exportWordsToExcel,
    downloadTemplate,
    downloadSample,
    sampleBooks,
    sampleWords,
  };

  /** 导出当前词库为 Excel */
  function exportWordsToExcel(lib, words) {
    const aoa = [['单元', '单词', '音标', '词性', '中文释义', '例句', '例句翻译']];
    [...words]
      .sort((a, b) => (a.unit || '').localeCompare(b.unit || '', 'zh'))
      .forEach((w) => {
        aoa.push([w.unit || '', w.word, w.phonetic || '', w.pos || '', w.meaning, w.example || '', w.exampleTrans || '']);
      });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), '词汇');
    const fname = `${(lib.name || '词库').replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fname);
  }
})();
