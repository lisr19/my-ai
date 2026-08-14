// 端到端测试：用 index.html 里的真实函数解析+统计+导出，并验证原始列被填充
const fs = require('fs');
const vm = require('vm');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const html = fs.readFileSync('/Volumes/D盘/my-ai/excel-processor/index.html', 'utf8');
// 抽取最后一个无 src 的内联 <script>
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appScript = scripts[scripts.length - 1];

// ---- 浏览器 API shim ----
let capturedBuffer = null;
const fakeEl = () => ({ innerHTML: '', disabled: false, classList: { add(){}, remove(){}, contains(){return false} }, appendChild(){}, removeChild(){}, setAttribute(){}, addEventListener(){}, click(){}, style:{}, download:'', href:'' });
const documentStub = {
  getElementById: () => fakeEl(),
  createElement: () => fakeEl(),
  body: { appendChild(){}, removeChild(){} },
};
class BlobStub { constructor(parts){ capturedBuffer = parts[0]; } }
const URLStub = { createObjectURL: () => 'blob:fake', revokeObjectURL(){} };

// ---- 读取真实 Excel ----
const buf = fs.readFileSync('/Users/lisongrsn/Downloads/初二2班学生积分实时更新表(2026.5.17).xlsx');
const wb = XLSX.read(buf, { type: 'array' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// ---- 驱动脚本 ----
const driver = `
  ;(async () => {
    // 1. parse
    rawData = parseExcelData(rows, ws);
    // 保存原始行/合并/表名供导出
    rawData._originalRows = rows;
    rawData._originalMerges = (ws['!merges'] || []);
    rawData._originalSheetName = '${wb.SheetNames[0]}';
    // 2. compute
    statsResult = computeStatistics(rawData);
    // 3. export (会写入原始 AA/AE 列)
    await exportExcel();
    // 暴露结果给外部验证
    globalThis.__exp = {
      top3: [...statsResult.top3Groups],
      p4: statsResult.personalTop4.map(s => ({name: s.name, group: s.group, rank: s.personalTopRank})),
      rawMergeCount: (ws['!merges'] || []).length
    };
    return true;
  })();
`;

const ctx = {
  XLSX, window: { ExcelJS }, document: documentStub, Blob: BlobStub, URL: URLStub,
  console, setTimeout, setInterval, alert: (m)=>console.log('[alert]', m),
  rows, ws, wb,
};
ctx.globalThis = ctx;
vm.createContext(ctx);

// 合并应用脚本 + 驱动，一次性执行（共享词法作用域）
const combined = appScript + '\n' + driver;

(async () => {
  try {
    const p = vm.runInContext(combined, ctx);
    await p;
    if (!capturedBuffer) throw new Error('未捕获到导出 buffer');
    const outPath = '/Volumes/D盘/my-ai/excel-processor/output/__test_export.xlsx';
    fs.writeFileSync(outPath, Buffer.from(capturedBuffer));
    console.log('✅ 导出 buffer 已写入:', outPath);

    // ---- 验证：读回导出的文件，检查原始列 ----
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(capturedBuffer);
    const s2 = wb2.getWorksheet(wb.SheetNames[0]);
    // 找到关键列 (1-based) —— 用 cell.column 真实列号
    let nameCol = -1, totalCol = -1, groupCol = -1, headerRow = -1;
    s2.eachRow((row, rn) => {
      row.eachCell((cell, colNumber) => {
        const c = colNumber;
        const v = cell.value;
        if (v == '组别') { groupCol = c; }
        if (v == '姓名') { nameCol = c; }
        if (v == '个总') { totalCol = c; headerRow = rn; }
      });
    });
    console.log('headerRow=', headerRow, 'nameCol=', nameCol, 'groupCol=', groupCol, '个总col=', totalCol);
    const cIndiv = totalCol, cGroupTotal = totalCol + 1, cAvg = totalCol + 2, cGRank = totalCol + 3, cClass = totalCol + 4;
    console.log('列映射: 个总=%d 组总=%d 人均=%d 组排=%d 排名=%d', cIndiv, cGroupTotal, cAvg, cGRank, cClass);

    // 收集学生行（用底层真实值：合并单元格只有主格非空）
    const studs = [];
    s2.eachRow((row, rn) => {
      if (rn <= headerRow) return;
      const name = row.getCell(nameCol).value;
      if (!name) return;
      studs.push({
        row: rn, name,
        indiv: row.getCell(cIndiv).value,
        groupTotal: row.getCell(cGroupTotal).value,
        avg: row.getCell(cAvg).value,
        grank: row.getCell(cGRank).value,
        crank: row.getCell(cClass).value,
      });
    });
    console.log('学生行数:', studs.length);
    // 检查全班排名是否每人都有值且为 1..N
    const cranks = studs.map(s => s.crank).filter(v => v !== null && v !== undefined);
    const unique = new Set(cranks);
    console.log('全班排名非空数:', cranks.length, '/ 学生数:', studs.length);
    console.log('全班排名唯一值数:', unique.size, '(应为', studs.length, ')');
    console.log('全班排名范围:', Math.min(...cranks), '~', Math.max(...cranks));
    // 检查个总有值
    const indivMissing = studs.filter(s => s.indiv === null || s.indiv === undefined).length;
    console.log('个总缺失:', indivMissing);
    console.log('前5个学生:', studs.slice(0,5).map(s=>({name:s.name,indiv:s.indiv,groupTotal:s.groupTotal,avg:s.avg,grank:s.grank,crank:s.crank})));
    // 统计合并单元格数（model.merges 为字符串数组，如 "AB3:AB6"）
    const allMerges = s2.model.merges || [];
    console.log('合并块总数:', allMerges.length);
    const grpStatMerges = allMerges.filter(m => {
      const mt = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!mt) return false;
      const col = mt[1];
      return ['AB','AC','AD'].includes(col); // 组总/人均/组排
    });
    console.log('组总/人均/组排 合并块数:', grpStatMerges.length, '(应=3×小组数=36)');

    // ---- 验证：居中对齐 ----
    let centerOK = 0, centerBad = 0;
    s2.eachRow(row => {
      row.eachCell(cell => {
        const a = cell.alignment;
        if (a && a.horizontal === 'center' && a.vertical === 'middle') centerOK++;
        else if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') centerBad++;
      });
    });
    console.log('居中对齐 满足数:', centerOK, ' 非空未居中数:', centerBad);

    // ---- 验证：配色（小组前3组排 + 个人前4排名，读主格真实样式）----
    const exp = ctx.__exp;
    const top3 = exp.top3;
    console.log('小组前3名(按平均分):', top3);
    // 组排列(30=AD)：取该列每个合并块的主格(首行)检查填充，避免 getter 解析干扰
    const grpRankMerges = allMerges.filter(m => { const mt = m.match(/^AD(\d+):AD(\d+)$/); return mt && Number(mt[1]) < Number(mt[2]); });
    let grankMasters = 0, grankColored = 0;
    for (const m of grpRankMerges) {
      const mt = m.match(/^AD(\d+):AD(\d+)$/);
      const masterCell = s2.getRow(Number(mt[1])).getCell(cGRank);
      grankMasters++;
      if (masterCell.fill && masterCell.fill.fgColor) grankColored++;
    }
    console.log('组排列 主格数:', grankMasters, ' 带填充色:', grankColored, '(应=12, 3)');

    // 个人前4：排名列(31) 带填充色的单元格（每人独立，无合并）
    let p4Colored = 0, p4Names = [];
    s2.eachRow(row => {
      const cell = row.getCell(cClass);
      if (cell.fill && cell.fill.fgColor) { p4Colored++; p4Names.push(row.getCell(nameCol).value); }
    });
    console.log('排名列 带填充色单元格数:', p4Colored, ' 对应学生:', p4Names);
    console.log('预期个人前4:', exp.p4.map(s => s.name + '(' + s.group + ') 第' + s.rank + '名'));

    // ---- 用 SheetJS 读真实底层值，交叉验证 组总=成员个总之和 ----
    const wbX = XLSX.read(capturedBuffer, { type: 'array' });
    const wsX = wbX.Sheets[wbX.SheetNames[0]];
    const rowsX = XLSX.utils.sheet_to_json(wsX, { header: 1, defval: null });
    // 0-based: 组别=0, 姓名=1, 个总=26, 组总=27, 人均=28, 组排=29, 排名=30
    const dataRowsX = rowsX.slice(2).filter(r => r[1] !== null && r[1] !== undefined);
    console.log('SheetJS 读出数据行数:', dataRowsX.length);
    // 按组别(合并首行非空)分组
    const grpMap = {};
    for (const r of dataRowsX) {
      const g = (r[0] !== null && r[0] !== undefined) ? String(r[0]).trim() : (Object.keys(grpMap).length ? Object.keys(grpMap)[Object.keys(grpMap).length-1] : '?');
      if (!grpMap[g]) grpMap[g] = { members: [], gt: null, ga: null, gr: null };
      grpMap[g].members.push(Number(r[26]) || 0);
      if (r[27] !== null && r[27] !== undefined) grpMap[g].gt = Number(r[27]);
      if (r[28] !== null && r[28] !== undefined) grpMap[g].ga = Number(r[28]);
      if (r[29] !== null && r[29] !== undefined) grpMap[g].gr = Number(r[29]);
    }
    let grpCheckOK = 0, grpCheckBad = 0;
    for (const g in grpMap) {
      const sum = grpMap[g].members.reduce((a,b)=>a+b,0);
      if (grpMap[g].gt === sum) grpCheckOK++; else { grpCheckBad++; console.log('  ✗ 小组', g, '组总', grpMap[g].gt, '≠ 成员个总之和', sum); }
    }
    console.log('组总=成员个总之和 校验: 通过', grpCheckOK, ' 失败', grpCheckBad, '(应全通过)');

    console.log('\\n=== 验证完成 ===');
  } catch (e) {
    console.error('❌ 测试失败:', e);
  }
})();
