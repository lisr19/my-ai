/**
 * 自测：用 Node 模拟 excel.js 的解析逻辑，验证示例文件和异常数据处理
 */
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));

const FIELD_ALIASES = {
  unit: ['单元', 'unit', '课', '章节'],
  word: ['单词', '英文', 'word', '词汇', '英语'],
  phonetic: ['音标', 'phonetic', '读音'],
  pos: ['词性', 'pos', '词类'],
  meaning: ['中文释义', '中文', '释义', '意思', 'meaning', '汉语', '翻译'],
  example: ['例句', 'example', '句子', '英文例句'],
  exampleTrans: ['例句翻译', '例句译文', '句子翻译', '中文例句', '例句中文'],
};
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s*（）()【】\[\]]/g, '');
}
function matchField(header) {
  const h = norm(header);
  if (!h) return null;
  const keys = Object.keys(FIELD_ALIASES);
  for (const key of keys) {
    if (FIELD_ALIASES[key].some((a) => h === norm(a))) return key;
  }
  for (const key of keys) {
    for (const alias of FIELD_ALIASES[key]) {
      const a = norm(alias);
      if (!/^[a-z]+$/.test(a) && h.includes(a)) return key;
    }
  }
  return null;
}
function parseRows(rows) {
  const errors = [];
  const words = [];
  const seen = new Set();
  let headerIdx = -1;
  let colMap = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map = {};
    (rows[i] || []).forEach((cell, ci) => {
      const f = matchField(cell);
      if (f) map[f] = ci;
    });
    if (map.word !== undefined && map.meaning !== undefined) {
      headerIdx = i; colMap = map; break;
    }
  }
  if (headerIdx === -1) return { words: [], units: [], errors: ['未找到表头'] };
  const get = (row, f) => {
    const ci = colMap[f];
    return ci === undefined ? '' : String(row[ci] == null ? '' : row[ci]).trim();
  };
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c == null ? '' : c).trim() === '')) continue;
    const lineNo = i + 1;
    const unit = get(row, 'unit') || '未分组';
    const word = get(row, 'word');
    const meaning = get(row, 'meaning');
    if (!word || !meaning) { errors.push(`第 ${lineNo} 行：缺少单词或中文释义，已跳过`); continue; }
    const key = word.toLowerCase();
    if (seen.has(key)) { errors.push(`第 ${lineNo} 行：单词 “${word}” 重复，已跳过`); continue; }
    seen.add(key);
    words.push({ unit, word, phonetic: get(row, 'phonetic'), pos: get(row, 'pos'), meaning, example: get(row, 'example'), exampleTrans: get(row, 'exampleTrans') });
  }
  return { words, units: [...new Set(words.map((w) => w.unit))], errors };
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅', msg); }
  else { fail++; console.log('  ❌', msg); }
}

// 测试1：解析示例文件
console.log('\n[测试1] 解析示例 Excel');
const buf = fs.readFileSync(path.join(__dirname, '..', '示例词库-人教版七年级上册.xlsx'));
const wb = XLSX.read(buf, { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const r1 = parseRows(rows);
assert(r1.words.length === 138, `解析出 138 个单词（实际 ${r1.words.length}）`);
assert(r1.units.length === 7, `解析出 7 个单元（实际 ${r1.units.length}：${r1.units.join(', ')}）`);
assert(r1.errors.length === 0, `无错误行（实际 ${r1.errors.length}）`);
assert(r1.words[0].word === 'good' && r1.words[0].meaning === '好的', '首行数据正确：good/好的');
assert(r1.words[0].phonetic === '/ɡʊd/' && r1.words[0].pos === 'adj.', '音标/词性列映射正确');
assert(r1.words[0].example === 'Good morning!' && r1.words[0].exampleTrans === '早上好！', '例句/例句翻译列映射正确');

// 测试2：别名表头 + 异常数据
console.log('\n[测试2] 别名表头、缺字段、重复单词');
const rows2 = [
  ['Unit', '英文', '读音', '词类', '释义', '英文例句', '中文例句'],
  ['U1', 'apple', '/ˈæpl/', 'n.', '苹果', 'I like apples.', '我喜欢苹果。'],
  ['U1', '', '', '', '空单词行', '', ''],
  ['U1', 'banana', '', '', '', '', ''],
  ['U1', 'apple', '', '', '苹果重复', '', ''],
  ['U2', 'cat', '/kæt/', 'n.', '猫', '', ''],
];
const r2 = parseRows(rows2);
assert(r2.words.length === 2, `有效单词 2 个（实际 ${r2.words.length}）`);
assert(r2.words[0].word === 'apple' && r2.words[0].unit === 'U1', '别名表头映射正确（Unit/英文/释义…）');
assert(r2.errors.length === 3, `3 条错误提示（实际 ${r2.errors.length}：${r2.errors.join(' | ')}）`);
assert(r2.units.length === 2 && r2.units.includes('U2'), '单元分组正确');

// 测试3：无表头
console.log('\n[测试3] 缺少有效表头');
const r3 = parseRows([['foo', 'bar'], ['a', 'b']]);
assert(r3.words.length === 0 && r3.errors.length === 1, '正确报“未找到表头”');

// 测试4：空单元归入“未分组”
console.log('\n[测试4] 单元留空归入未分组');
const r4 = parseRows([
  ['单元', '单词', '中文释义'],
  ['', 'dog', '狗'],
]);
assert(r4.words[0].unit === '未分组', '空单元 → 未分组');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
