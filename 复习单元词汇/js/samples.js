/**
 * 示例词库注册表
 * 数据文件 samples-g7a.js / samples-g8a.js / samples-g8b.js 在本文件之后加载，
 * 各自把一册词库注册到 window.VocabSampleBooks。
 * Node 环境下由 tools/gen-samples.js 直接 require 各数据文件生成 xlsx。
 */
(function () {
  const HEADER = ['单元', '单词', '音标', '词性', '中文释义', '例句', '例句翻译'];

  function books() {
    return (typeof window !== 'undefined' && window.VocabSampleBooks) || [];
  }
  function list() { return books().slice(); }
  function get(key) { return books().find((b) => b.key === key) || null; }
  function toWords(book) {
    return book.words.map((r) => ({
      unit: r[0], word: r[1], phonetic: r[2], pos: r[3],
      meaning: r[4], example: r[5], exampleTrans: r[6],
    }));
  }
  function toAOA(book) { return [HEADER].concat(book.words); }

  window.VocabSamples = { HEADER, list, get, toWords, toAOA };
})();
