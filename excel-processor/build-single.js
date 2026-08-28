// 构建脚本：把 vendor 下的两个 JS 库内联进 index.html，生成离线单文件
const fs = require('fs');
const path = require('path');
const dir = __dirname;

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const xlsx = fs.readFileSync(path.join(dir, 'vendor/xlsx.full.min.js'), 'utf8');
const exceljs = fs.readFileSync(path.join(dir, 'vendor/exceljs.min.js'), 'utf8');

// 防止 JS 代码中的 </script> 提前闭合 <script> 标签
const safe = s => s.replace(/<\/script>/gi, '<\\/script>');

const ref1 = '<script src="vendor/xlsx.full.min.js"></script>';
const ref2 = '<script src="vendor/exceljs.min.js"></script>';
if (!html.includes(ref1) || !html.includes(ref2)) {
  console.error('未找到引用标签，请检查 index.html');
  process.exit(1);
}

// 用 split/join 做纯字符串替换，避免库代码中的 $&、$1 等被 replace 当作特殊模式解析
html = html.split(ref1).join('<script>\n' + safe(xlsx) + '\n</script>');
html = html.split(ref2).join('<script>\n' + safe(exceljs) + '\n</script>');

if (html.includes('vendor/') || html.includes('cdn.jsdelivr')) {
  console.error('仍有外部引用!');
  process.exit(1);
}

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist/Excel积分统计工具.html');
fs.writeFileSync(out, html);
console.log('单文件生成 OK ->', out);
console.log('大小:', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2), 'MB');
