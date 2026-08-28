/**
 * 生成实体示例 Excel 文件（数据来源：js/samples-g*.js，与应用内示例词库同源）
 * 运行：node tools/gen-sample.js
 * 产物：示例词库-人教版七年级上册.xlsx / 八年级上册.xlsx / 八年级下册.xlsx
 */
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));

const HEADER = ['单元', '单词', '音标', '词性', '中文释义', '例句', '例句翻译'];
const COLS = [
  { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 12 },
  { wch: 30 }, { wch: 42 }, { wch: 32 },
];

const books = [
  require(path.join(__dirname, '..', 'js', 'samples-g7a.js')),
  require(path.join(__dirname, '..', 'js', 'samples-g8a.js')),
  require(path.join(__dirname, '..', 'js', 'samples-g8b.js')),
];

for (const book of books) {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...book.words]);
  ws['!cols'] = COLS;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '词汇');
  const out = path.join(__dirname, '..', book.file);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(out, buf);
  const units = new Set(book.words.map((r) => r[0])).size;
  console.log(`已生成: ${book.file}（${book.words.length} 词，${units} 个单元）`);
}
