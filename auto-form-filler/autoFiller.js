// autoFiller.js - v10 AI智能版 v3.9.2
// 核心：串行按序填充 + 强健的下拉选择 + 同源iframe表单自动填写 + DeepSeek AI智能数据生成
// ============================================================

console.log('[AutoFiller] 加载中... v3.8.7-DEBUG', new Date().toISOString());

// 填充控制器：模式 + 暂停/停止状态，被 _fillAll 主循环检查
var _AFCtrl = {
  paused: false,
  stopped: false,
  running: false,
  mode: 'fast',       // 默认一次性。'sequential' 模式仍保留代码路径，可通过 _AF.setMode 切回
  aiEnabled: false,   // AI 智能模式
  apiKey: ''          // DeepSeek API Key
};

// ★ 进度回调（content.js 遮罩层实时显示当前字段）
var _onProgressCallback = null;

// 抽屉/弹窗防护：填充期间拦截遮罩层 click 事件，防止 el-drawer/el-dialog 被误关闭
var _drawerGuards = [];

// ★ document 级 keydown 拦截器（不再单独存储，全部存 _drawerGuards 数组）
// ★ window 级别的 keydown 拦截器（部分 Element Plus 版本在 window 上注册 keydown）
var _docKeyGuard_window = null;

// ★★★ 加载 banner：确认 content script 真的加载了 ★★★
console.log('[AutoFiller] ============================================');
console.log('[AutoFiller] v3.8.7-DEBUG 已加载!');
console.log('[AutoFiller] window._AF 即将定义，可用方法: fill, detect, clear');
console.log('[AutoFiller] 当前页面:', location.href);
console.log('[AutoFiller] ============================================');

window._AF = {
  fill: function(data) { return _fillAll(data); },
  detect: function() { return _detectAll(); },
  clear: function() { _clearAll(); },
  pause: function(){ _AFCtrl.paused = true; },
  resume: function(){ _AFCtrl.paused = false; },
  stop: function(){ _AFCtrl.stopped = true; _AFCtrl.paused = false; },
  setMode: function(m){ if(m==='fast'||m==='sequential'){ _AFCtrl.mode = m; return true; } return false; },
  getStatus: function(){
    return { running: _AFCtrl.running, paused: _AFCtrl.paused, stopped: _AFCtrl.stopped, mode: _AFCtrl.mode, aiEnabled: _AFCtrl.aiEnabled };
  },
  // ★ AI 模式
  setApiKey: function(key){ _AFCtrl.apiKey = key; try{ chrome.storage.local.set({af_api_key:key}); }catch(e){} },
  getApiKey: function(){ return _AFCtrl.apiKey; },
  enableAI: function(enabled){ _AFCtrl.aiEnabled = !!enabled; try{ chrome.storage.local.set({af_ai_enabled:!!enabled}); }catch(e){} },
  isAIEnabled: function(){ return _AFCtrl.aiEnabled && !!_AFCtrl.apiKey; },
  // ★ 进度回调（供 content.js 遮罩层实时显示当前字段）
  setProgressCallback: function(fn){ _onProgressCallback = fn; }
};
window.autoFillForm = window._AF.fill;
window.detectFormFields = window._AF.detect;
window.clearAllFields = window._AF.clear;

// 按当前模式取延时
// 弹层视觉被 CSS 隐藏（body.af-filling），所以等待时间主要给 Vue 反应；
// 不再需要等 popper 动画进出
function _afDelay(kind){
  var fast = _AFCtrl.mode === 'fast';
  switch(kind){
    case 'text':          return fast ? 0   : 80;
    case 'select-after':  return fast ? 180 : 280;   // 仅给 Vue 处理时间，无动画等待
    case 'radio-after':   return fast ? 0   : 50;
    case 'cascaded':      return fast ? 0   : 20;
    case 'cascaded-sel':  return fast ? 0   : 60;
    case 'disabled-skip': return fast ? 0   : 10;
    case 'between-rounds':return fast ? 100 : 200;
    default: return 50;
  }
}

// ============================================================
//  工具：获取所有可访问的文档对象（含同源iframe）
// ============================================================

function getAllDocuments() {
  var docs = [document];
  try {
    // ★ 如果当前在 iframe 中，先加入 top document
    if(window.top && window.top !== window){
      try {
        var topDoc = window.top.document;
        if(topDoc && topDoc !== document && docs.indexOf(topDoc) === -1){
          docs.push(topDoc);
        }
      } catch(e) {}
    }
    // 加入所有同源 iframe 的 document
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument;
        if (doc && doc !== document && docs.indexOf(doc) === -1) {
          docs.push(doc);
        }
      } catch (err) {}
    }
    // ★ 同时搜索 top document 中的 iframe（如果当前在 iframe 中）
    if(window.top && window.top !== window){
      try {
        var topIframes = window.top.document.querySelectorAll('iframe');
        for (var j = 0; j < topIframes.length; j++) {
          try {
            var tDoc = topIframes[j].contentDocument;
            if(tDoc && tDoc !== document && docs.indexOf(tDoc) === -1){
              docs.push(tDoc);
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
  } catch(e) {}
  return docs;
}

function getOwnerDoc(el) {
  // 获取元素所属的 document 对象
  if (!el) return document;
  if (el.ownerDocument) return el.ownerDocument;
  return document;
}

// ============================================================
//  ★★★ DeepSeek AI 智能数据生成 ★★★
// ============================================================

/**
 * 调用 DeepSeek API，让 AI 理解表单语义并生成真实数据
 * @param {Array} fields - scanFields() 返回的字段数组
 * @returns {Promise<Object>} {字段label: 填充值} 映射表
 */
function callDeepSeekAI(fields) {
  return new Promise(function(resolve, reject) {
    if (!_AFCtrl.apiKey) {
      reject(new Error('请先在弹窗中配置 DeepSeek API Key'));
      return;
    }

    // 构建字段描述
    var fieldDescriptions = fields.map(function(f, i) {
      var parts = [];
      parts.push('[' + (i + 1) + ']');
      if (f.label) parts.push('标签: "' + f.label + '"');
      if (f.placeholder) parts.push('占位符: "' + f.placeholder + '"');
      parts.push('类型: ' + f.type);
      if (f.disabled) parts.push('(已禁用)');
      var currentVal = getFieldCurrentValue(f.element);
      if (currentVal && String(currentVal).trim() !== '') {
        parts.push('【当前已有值: "' + String(currentVal).trim().slice(0, 50) + '"】');
      }
      if (f.type === 'el-cascader' || f.type === 'ant-cascader') {
        parts.push('【级联器：返回"省/市/区"路径】');
      }
      return parts.join(' ');
    }).join('\n');

    var pageTitle = '';
    try { pageTitle = document.title || ''; } catch(e) {}
    var pageUrl = '';
    try { pageUrl = location.href || ''; } catch(e) {}

    // ========== 用 System Prompt + User Prompt 的两阶段推理 ==========
    var systemPrompt = [
      '你是一个专业的智能表单数据填充助手，精通设备管理、合同管理、应急管理、物业管理、客户管理、采购管理、工程项目、人力资源等各行业的表单填写。',
      '你的使命是：根据表单的业务场景，生成完全符合现实逻辑、行业规范且每次都不重复的真实数据。',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【角色身份与基本原则】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '你是一个在以下领域有 10 年从业经验的数据专员：',
      '  • 设备/资产管理 — 设备编号、规格型号、保养周期、巡检记录',
      '  • 合同/法务管理 — 合同编号、金额、日期链、甲乙双方信息',
      '  • 应急/安全管理 — 预案编号、风险等级、演练日期、责任人',
      '  • 物业/园区管理 — 楼栋房号、面积区间、租金、物业费',
      '  • 客户/供应商管理 — 企业名称、统一信用代码、联系人、地址',
      '  • 采购/供应链 — 物料编码、数量、单价、供应商、交付日期',
      '  • 工程项目管理 — 项目编号、施工周期、监理单位、验收日期',
      '  • 人力资源 — 姓名、身份证号、学历、入职日期、薪资区间',
      '',
      '核心原则：',
      '  1. 数据必须真实可信 —— 不能出现明显荒谬的值（如"张三"电话=12345678901）',
      '  2. 行业规范必须遵守 —— 不同行业有不同的编号规则和命名习惯',
      '  3. 数据不能重复 —— 每次填充必须生成不同的值，使用随机种子变化',
      '  4. 关联性必须自洽 —— 同一个人/公司的所有字段必须前后一致',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【第1步：全局理解 → 识别业务场景】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '仔细阅读整个表单的所有字段和【当前已有值】，判断这个表单属于哪个行业场景：',
      '  - 如果字段含"合同/签约/甲乙/金额/期限" → 合同管理场景',
      '  - 如果字段含"设备/资产/型号/序列号/巡检/保养" → 设备管理场景',
      '  - 如果字段含"应急预案/演练/风险/安全/疏散" → 应急管理场景',
      '  - 如果字段含"楼栋/房号/面积/租金/物业费/园区" → 物业管理场景',
      '  - 如果字段含"客户/供应商/信用代码/联系人" → 客户/供应商场景',
      '  - 如果字段含"采购/物料/询价/报价/订单" → 采购场景',
      '  - 如果字段含"项目/工程/施工/监理/验收" → 工程项目场景',
      '  - 如果字段含"员工/部门/岗位/薪资/入职" → 人力资源场景',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【第2步：提取主体画像】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '从【当前已有值】的字段中提取主体信息：',
      '  - 主体名称（公司/个人/项目名称）',
      '  - 地理区域（省/市/区）',
      '  - 行业属性（科技/金融/医疗/制造/物业等）',
      '  - 关键关联人（法定代表人/联系人等）',
      '这些信息是你生成其他字段值的"基准"，所有字段必须围绕同一主体。',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【第3步：按行业生成数据规则】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '【▶ 通用规则 — 适用于所有行业】',
      '',
      '★ 身份证号码（18位，必须严格符合国标GB 11643）：',
      '  格式：AAAAAA YYYYMMDD XXX Y',
      '  - AAAAAA：6位地区码（根据主体所在省市）',
      '    · 北京 → 110101(东城)/110105(朝阳)/110108(海淀)/110112(通州)/110114(昌平)/110115(大兴)',
      '    · 上海 → 310101(黄浦)/310105(长宁)/310109(虹口)/310115(浦东)/310112(闵行)/310114(嘉定)',
      '    · 广东广州 → 440103(荔湾)/440104(越秀)/440105(海珠)/440106(天河)/440111(白云)/440113(番禺)',
      '    · 广东深圳 → 440303(罗湖)/440304(福田)/440305(南山)/440306(宝安)/440307(龙岗)/440308(盐田)',
      '    · 广东其他 → 440402(珠海)/441900(东莞)/442000(中山)/440604(佛山禅城)/440605(佛山南海)',
      '    · 浙江杭州 → 330102(上城)/330103(下城)/330106(西湖)/330108(滨江)/330109(萧山)/330110(余杭)',
      '    · 江苏南京 → 320102(玄武)/320104(秦淮)/320105(建邺)/320106(鼓楼)/320111(浦口)/320115(江宁)',
      '    · 江苏苏州 → 320502(姑苏)/320505(虎丘)/320506(吴中)/320507(相城)/320508(园区)/320509(吴江)',
      '    · 四川成都 → 510104(锦江)/510105(青羊)/510106(金牛)/510107(武侯)/510108(成华)/510112(龙泉驿)',
      '    · 湖北武汉 → 420102(江岸)/420103(江汉)/420106(武昌)/420111(洪山)/420114(蔡甸)/420115(江夏)',
      '    · 其他省会 → 按对应行政区划代码',
      '  - YYYYMMDD：出生日期（1970-2005之间随机，避免未成年）',
      '  - XXX：3位顺序码，奇数=男，偶数=女',
      '  - Y：校验位，根据前17位按公式计算（0-9或X）',
      '  ⚠️ 必须生成有效校验位！计算公式：',
      '    加权因子 W=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]',
      '    校验码表 C=["1","0","X","9","8","7","6","5","4","3","2"]',
      '    S = Σ(每位×对应因子) mod 11，Y = C[S]',
      '  ⚠️ 示例（不要照抄，每次随机不同）：',
      '    北京：110105198506153279，上海：31011519920108452X',
      '    广州：440106197812099316，深圳：440305199011223741',
      '',
      '★ 手机号码（11位，必须符合真实号段）：',
      '  有效前3位号段：',
      '    中国移动：134-139, 147, 148, 150-152, 157-159, 165, 172, 178, 182-184, 187, 188, 195, 197, 198',
      '    中国联通：130-132, 145, 146, 155, 156, 166, 167, 171, 175, 176, 185, 186, 196',
      '    中国电信：133, 149, 153, 162, 173, 174, 177, 180, 181, 189, 190, 191, 193, 199',
      '  后8位：完全随机数字（10000000-99999999）',
      '  ⚠️ 每次必须生成不同的号码！',
      '',
      '★ 统一社会信用代码（18位）：',
      '  格式：91 + 登记机关代码(6位) + 组织机构代码(9位) + 校验位(1位)',
      '  示例（仅供参考，每次不同）：91440101MA5CJ8XQ3W',
      '  每次生成时随机变化后9位字母数字组合',
      '',
      '★ 银行账号：',
      '  - 借记卡：622202/622848/621700/621226/622262 开头 + 13位随机数字',
      '  - 对公账户：102/201/301/401 + 地区码4位 + 账号12位',
      '  ⚠️ 每次随机不同',
      '',
      '★ 邮箱格式：',
      '  - 姓名拼音小写@公司域名.com',
      '  - 如"张三"在"广东科技有限公司" → zhangsan@guangdongtech.com',
      '  ⚠️ 每次随机不同',
      '',
      '★ 车牌号（如有车辆管理字段）：',
      '  - 格式：省份简称(1汉字) + 城市字母 + 5位数字字母',
      '  - 如"粤A·12345"、"京A·8B6C2"、"沪B·D9521"',
      '',
      '【▶ 设备管理场景】',
      '  - 设备编号：如"EQ-2026-XXXXX"或"SB-DQ-XXXX"（按资产分类编码）',
      '  - 规格型号：真实工业格式如"380V/50Hz/500W"、"DN50/PN16"',
      '  - 巡检/保养周期：如"每月"、"每季度"、"每半年"',
      '  - 设备状态：正常/运行中/待检修/停用/报废',
      '  - 购置日期 < 投产日期 < 当前日期',
      '',
      '【▶ 合同管理场景】',
      '  - 合同编号：格式 HT-YYYY-8位数字，年份用当前年份，8位数字必须每次完全随机（首位1-9，禁止出现00000001/12345678等连号或顺序号，禁止使用"BYGJ-"等占位符）。例如 HT-'+new Date().getFullYear()+'-73920518',
      '  - 金额区间：采购合同 5-500万，服务合同 1-50万，租赁合同 0.5-30万/年',
      '  - 日期链：签约日 < 生效日 < 截止日，时间间隔合理（30天-3年）',
      '  - 甲乙方：真实企业名称（不要"测试公司"），配合信用代码',
      '',
      '【▶ 应急管理场景】',
      '  - 预案编号：如"YJYA-2026-XXXX"',
      '  - 风险等级：重大风险/较大风险/一般风险/低风险',
      '  - 演练类型：消防演练/地震疏散/化学品泄漏/防洪防汛',
      '  - 演练日期：过去的合理日期（30天内）',
      '',
      '【▶ 物业管理场景】',
      '  - 楼栋编号：如"A栋/B栋/1号楼/2号楼"',
      '  - 房号格式：如"101/201/301"或"A-101/B-202"',
      '  - 面积区间：住宅 30-200㎡，办公 50-500㎡，商铺 20-300㎡',
      '  - 租金：住宅 20-80元/㎡/月，办公 50-200元/㎡/月，商铺 80-500元/㎡/月',
      '  - 物业费：住宅 2-5元/㎡/月，办公 5-20元/㎡/月',
      '',
      '【▶ 客户/供应商管理场景】',
      '  - 企业全称：真实感名称（地域+行业+组织形式）',
      '    · 如"广州XX科技有限公司"、"上海XX贸易有限公司"、"深圳XX实业有限公司"',
      '    · ⚠️ 每次随机不同公司名',
      '  - 联系人姓名：常见姓名池随机（张伟/李娜/王芳/刘洋/陈静/杨帆/赵敏/黄磊/周洁/吴强…）',
      '  - 客户等级：VIP/重要/普通/潜在',
      '',
      '【▶ 采购管理场景】',
      '  - 物料编码：如"MAT-2026-XXXXXX"',
      '  - 数量单位：合理搭配（件/台/套/箱/吨/米）',
      '  - 单价范围：根据物料类型（电子元件 0.1-500元，原材料 10-5000元/吨，设备 1000-500000元/台）',
      '',
      '【▶ 人力资源场景】',
      '  - 姓名：使用常见姓名，姓+名（2-3字）',
      '  - 性别：男/女（随机但需与身份证号顺序码一致：奇数男偶数女）',
      '  - 学历：博士/硕士/本科/大专（按岗位匹配，技术岗=本科以上，普工=大专以下）',
      '  - 部门：技术部/市场部/财务部/人事部/运营部/研发部/行政部',
      '  - 岗位：与部门匹配（如技术部→软件工程师/测试工程师）',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【第4步：数据关联规则】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '▶ 地理一致性（最高优先级）：',
      '  - 从主体名称提取城市，所有地址必须在同一城市/省份',
      '  - 禁止"广州公司+北京地址"这种矛盾',
      '  - 级联器(cascader)返回格式：用"/"分隔，地址类3级"省/市/区"',
      '  - 详细地址(textarea)："XX省XX市XX区XX街道XX号"',
      '',
      '▶ 日期逻辑链：',
      '  - 出生日 < 入职日 < 当前日期',
      '  - 签约日 < 生效日 < 截止日',
      '  - 申请日 ≈ 创建日 ≈ 今天前后30天',
      '  - 截止日/到期日 = 未来时间（1-3年后）',
      '  - ⚠️ 每个日期字段必须不同！不能全部同一天！',
      '',
      '▶ 号码一致性：',
      '  - 同一人的姓名、身份证、手机号、邮箱必须匹配',
      '  - 同一公司的名称、信用代码、银行账号必须匹配',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【第5步：字段处理规则】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '  - 已有值的字段 → 返回""（保留原值）',
      '  - 禁用的字段 → 返回""',
      '  - 下拉框(el-select)：根据业务场景返回合理选项名（不是"请选择"），如不确定返回""让系统随机选',
      '  - 单选组(radio-group) → 返回""（系统自动选第一项）',
      '  - 级联器(el-cascader) → 用"/"分隔返回路径',
      '  - 其他字段 → 返回符合以上所有规则的真实数据',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '【输出格式】',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '只返回JSON对象，不要任何解释文字：',
      '{ "字段标签1": "值1", "字段标签2": "值2", ... }',
      'key必须与用户输入中的字段标签完全一致。',
      '⚠️ 每次调用都要生成不同的数据（使用不同随机种子）！',
    ].join('\n');

    var userPrompt = [
      '请为以下表单生成填充数据：',
      '',
      '页面标题: ' + (pageTitle || '(未知)'),
      '页面URL: ' + (pageUrl || '(未知)'),
      '',
      '字段列表:',
      fieldDescriptions,
      '',
      '请先判断表单所属行业场景，再按照系统指令中该行业的规则，为每个字段生成真实、合理、符合逻辑的数据。',
      '⚠️ 重要提醒：每次生成的身份证号、手机号、合同编号、企业名称等都必须不同，不能与上次相同！',
      '只返回JSON。',
    ].join('\n');

    console.log('[AI] 发送请求到 DeepSeek，共 ' + fields.length + ' 个字段...');

    fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + _AFCtrl.apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' }
      })
    })
    .then(function(response) {
      if (!response.ok) {
        return response.text().then(function(txt) {
          var errMsg = 'API请求失败: HTTP ' + response.status;
          try { var e = JSON.parse(txt); if (e.error) errMsg += ' - ' + e.error.message; } catch(x) {}
          throw new Error(errMsg);
        });
      }
      return response.json();
    })
    .then(function(data) {
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('AI返回数据格式异常');
      }
      var content = data.choices[0].message.content;
      console.log('[AI] DeepSeek 返回原始内容:', content);

      var result;
      try {
        content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        result = JSON.parse(content);
      } catch(e) {
        console.error('[AI] JSON解析失败:', e, '原始内容:', content);
        throw new Error('AI返回的JSON解析失败: ' + e.message);
      }

      var keyCount = Object.keys(result).length;
      console.log('[AI] 成功生成 ' + keyCount + ' 个字段的值');
      resolve(result);
    })
    .catch(function(err) {
      console.error('[AI] DeepSeek API 错误:', err);
      reject(err);
    });
  });
}

/**
 * 根据 AI 返回的映射表，为指定字段查找对应的值
 */
function lookupAIValue(field, aiValueMap) {
  if (!aiValueMap || !field) return null;
  var label = field.label || '';
  // 精确匹配
  if (aiValueMap[label] !== undefined && aiValueMap[label] !== '') return aiValueMap[label];
  // 模糊匹配（去掉末尾的冒号、空格等）
  var cleaned = label.replace(/[:：\s]+$/g, '');
  if (aiValueMap[cleaned] !== undefined && aiValueMap[cleaned] !== '') return aiValueMap[cleaned];
  // 包含匹配
  var keys = Object.keys(aiValueMap);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] && cleaned && (keys[i].indexOf(cleaned) >= 0 || cleaned.indexOf(keys[i]) >= 0)) {
      if (aiValueMap[keys[i]] !== '') return aiValueMap[keys[i]];
    }
  }
  return null;
}

/**
 * 后处理：修正 AI 生成的日期
 * 1) 多个日期相同时，按字段语义分散到不同时间
 * 2) 时间顺序不对时自动调整
 */
function postProcessDates(aiValueMap, aiFields){
  if(!aiValueMap || !aiFields) return;

  // 收集所有日期字段及对应的值
  var dateEntries = [];
  aiFields.forEach(function(f){
    if(f.type !== 'date-picker') return;
    var v = lookupAIValue(f, aiValueMap);
    if(!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())) return;
    var lbl = (f.label||'').replace(/[:：\s]+$/g,'');
    dateEntries.push({label:lbl, field:f, value:String(v).trim()});
  });

  if(dateEntries.length < 2) return; // 少于2个日期不需要处理

  console.log('[AI后处理] 检测到 '+dateEntries.length+' 个日期字段');

  // 检测是否有重复
  var hasDup = false;
  for(var i=0; i<dateEntries.length; i++){
    for(var j=i+1; j<dateEntries.length; j++){
      if(dateEntries[i].value === dateEntries[j].value){
        hasDup = true; break;
      }
    }
    if(hasDup) break;
  }

  if(!hasDup) {
    console.log('[AI后处理] 日期无重复，跳过');
    return;
  }

  console.log('[AI后处理] ⚠️ 发现重复日期，自动修正...');

  // 按字段语义确定"应该的时间段"
  function classifyDate(lbl){
    if(/(\u7b7e\u7ea6|\u7b7e\u8ba2|\u7b7e\u5408)/.test(lbl)) return 'sign';
    if(/(\u5408\u540c\u5f00\u59cb|\u5f00\u59cb\u65e5\u671f|\u751f\u6548|\u8d77\u59cb)/.test(lbl)) return 'start';
    if(/(\u5408\u540c\u7ed3\u675f|\u7ed3\u675f\u65e5\u671f|\u622a\u6b62|\u5230\u671f|\u8fc7\u671f|\u5c3e\u671f)/.test(lbl)) return 'end';
    if(/(\u51fa\u751f|\u751f\u65e5)/.test(lbl)) return 'birth';
    if(/(\u5165\u804c|\u5230\u5c97|\u52a0\u5165)/.test(lbl)) return 'entry';
    if(/(\u7533\u8bf7|\u63d0\u4ea4|\u521b\u5efa)/.test(lbl)) return 'apply';
    return 'default';
  }

  var now = new Date();
  function fmt(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function shift(d, days){ var n = new Date(d); n.setDate(n.getDate()+days); return n; }

  // 按语义生成新日期
  var newDates = {};
  dateEntries.forEach(function(entry){
    var kind = classifyDate(entry.label);
    var d;
    switch(kind){
      case 'sign':    d = shift(now, -30 - Math.floor(Math.random()*60)); break;     // 1-3个月前
      case 'start':   d = shift(now, -7 - Math.floor(Math.random()*30)); break;      // 7-37天前
      case 'end':     d = shift(now, 365 + Math.floor(Math.random()*730)); break;   // 1-3年后
      case 'birth':   var years = 25 + Math.floor(Math.random()*30); d = new Date(now); d.setFullYear(d.getFullYear()-years); d.setMonth(Math.floor(Math.random()*12)); d.setDate(1+Math.floor(Math.random()*28)); break;
      case 'entry':   d = shift(now, -365 - Math.floor(Math.random()*1825)); break;  // 1-6年前
      case 'apply':   d = shift(now, -Math.floor(Math.random()*30)); break;         // 0-30天前
      default:        d = shift(now, -Math.floor(Math.random()*90)); break;         // 0-90天前
    }
    newDates[entry.label] = fmt(d);
  });

  // ★ 保证：end > start > sign > apply（如果有 end 和 start）
  var hasStart = dateEntries.some(function(e){return classifyDate(e.label)==='start';});
  var hasEnd = dateEntries.some(function(e){return classifyDate(e.label)==='end';});
  if(hasStart && hasEnd){
    // 找 start 和 end 字段
    var startEntry = dateEntries.find(function(e){return classifyDate(e.label)==='start';});
    var endEntry = dateEntries.find(function(e){return classifyDate(e.label)==='end';});
    if(startEntry && endEntry){
      // start 设为 30 天前
      newDates[startEntry.label] = fmt(shift(now, -30));
      // end 设为 start + 2年
      newDates[endEntry.label] = fmt(shift(shift(now, -30), 365*2));
    }
  }

  // 写回 aiValueMap
  dateEntries.forEach(function(entry){
    var newVal = newDates[entry.label];
    if(newVal){
      // 找到 aiValueMap 里的 key
      var keys = Object.keys(aiValueMap);
      var matchedKey = keys.find(function(k){ return k === entry.label; })
                    || keys.find(function(k){ return k.replace(/[:：\s]+$/g,'') === entry.label; });
      if(matchedKey){
        console.log('  ['+entry.label+'] '+entry.value+' → '+newVal);
        aiValueMap[matchedKey] = newVal;
      }
    }
  });
}

/**
 * 后处理：强制合同编号按规则随机生成
 * AI 有时会反复输出同一个编号（如 HT-2026-00000001），这里直接覆盖，
 * 保证每次填充的合同编号都不同，且符合 HT-YYYY-8位数字 规则。
 * 同时兼容 预案编号(YJYA)、设备编号(EQ/SB) 等同类"编号"字段。
 */
function postProcessSerialNumbers(aiValueMap, aiFields){
  if(!aiValueMap || !aiFields) return;

  // 8 位随机数字（首位非0，避免出现 00000001 这种假编号）
  function rand8(){
    var s = String(1 + Math.floor(Math.random()*9)); // 首位 1-9
    for(var i=0;i<7;i++) s += String(Math.floor(Math.random()*10));
    return s;
  }
  var year = new Date().getFullYear();

  // 规则表：关键字 → 生成函数
  var rules = [
    { re: /合同编号|合同号|合同编码|contract\s*(no|num|code)/i,
      gen: function(){ return 'HT-' + year + '-' + rand8(); } },
    { re: /预案编号|预案号|预案编码/,
      gen: function(){ return 'YJYA-' + year + '-' + rand8().slice(0,4); } },
    { re: /设备编号|设备编码|资产编号|资产编码|设备序列号/,
      gen: function(){ return 'EQ-' + year + '-' + rand8().slice(0,5); } },
    { re: /项目编号|项目编码|工程编号/,
      gen: function(){ return 'XM-' + year + '-' + rand8(); } },
  ];

  var used = {}; // 本次已生成的编号，避免同一张表单内重复
  function unique(gen, prefix){
    var v;
    do { v = gen(); } while(used[prefix] && used[prefix] === v);
    used[prefix] = v;
    return v;
  }

  aiFields.forEach(function(f){
    var lbl = (f.label || '').replace(/[:：\s]+$/g,'');
    if(!lbl) return;
    for(var i=0;i<rules.length;i++){
      if(rules[i].re.test(lbl)){
        var newVal = unique(rules[i].gen, String(i));
        // 找到 aiValueMap 里对应的 key（精确/去冒号/包含）
        var keys = Object.keys(aiValueMap);
        var matchedKey = keys.filter(function(k){ return k === lbl; })[0]
                      || keys.filter(function(k){ return k.replace(/[:：\s]+$/g,'') === lbl; })[0];
        if(matchedKey){
          var oldVal = aiValueMap[matchedKey];
          aiValueMap[matchedKey] = newVal;
          console.log('[AI后处理] 编号字段 ['+lbl+'] "'+oldVal+'" → "'+newVal+'"（强制随机）');
        }
        break;
      }
    }
  });
}

// ============================================================
//  串行填充引擎（v10: AI智能数据生成）
// ============================================================

function _fillAll(data) {
  var aiEnabled = _AFCtrl.aiEnabled && !!_AFCtrl.apiKey;
  console.log('[AutoFiller v10] ========== 多轮填充开始' + (aiEnabled ? '（🤖 AI模式）' : '') + '==========');

  var configValues = [];
  if (data && typeof data === 'object') {
    Object.keys(data).forEach(function(k){if(data[k])configValues.push(data[k]);});
  }

  var SELECT_TYPES = ['el-select','el-cascader','ant-select','ant-cascader','select'];
  var globalStats = {filled:0, cascaded:0, failed:0};
  var globalResults = [];
  var seenList = [];
  var valueIdx = 0;
  var MAX_ROUNDS = 3;
  var round = 0;
  var aiValueMap = null; // AI 返回的字段-值映射

  function hasSeen(el){ return seenList.indexOf(el) >= 0; }
  function markSeen(el){ if(!hasSeen(el)) seenList.push(el); }

  // 标记开始
  _AFCtrl.running = true;
  _AFCtrl.paused = false;
  _AFCtrl.stopped = false;

  // 填充期间隐藏所有下拉弹层视觉效果（CSS 在 content.css 用 body.af-filling 控制）
  try{ document.body.classList.add('af-filling'); }catch(e){}

  // ★ 关键防护：安装抽屉/弹窗遮罩 click 拦截器
  // fireFullClick / closeDropdown 等操作产生的冒泡 click 会触发 el-drawer close-on-click-modal
  installDrawerGuards();

  return new Promise(function(resolveAll){
    function finish(reason){
      _AFCtrl.running = false;
      _AFCtrl.paused = false;
      try{ document.body.classList.remove('af-filling'); }catch(e){}
      
      uninstallDrawerGuards();
      
      var isAIError = reason && reason.indexOf('AI调用失败') >= 0;
      var aiStatus = aiValueMap ? ' AI数据:' + Object.keys(aiValueMap).length + '项' : '';
      console.log('[v10] '+(reason||'完成')+'（'+round+'轮） filled='+globalStats.filled+' cascaded='+globalStats.cascaded + aiStatus);
      resolveAll({
        success: !isAIError,
        error: isAIError ? reason : undefined,
        stopped: _AFCtrl.stopped,
        filledCount: globalStats.filled,
        cascadedCount: globalStats.cascaded,
        totalCount: globalResults.length,
        details: globalResults,
        iframeCount: globalResults.filter(function(r){return r.iframe;}).length,
        aiEnabled: !!aiValueMap
      });
      _AFCtrl.stopped = false;
    }

    // ★ AI 模式：先调用 DeepSeek API，再开始填充
    function startAfterAI(){
      if(aiEnabled){
        // 扫描字段传给 AI
        var allFields = scanFields();
        // ★ 把所有可填字段都发给 AI（级联器+下拉框+文本框）
        // AI 可以为空字符串（让前端随机选）或返回值（让 AI 决定）
        var aiFields = allFields.filter(function(f){
          // 排除 radio-group（系统会点第一项）和 disabled
          return f.type !== 'radio-group' && !f.disabled;
        });

        if(aiFields.length > 0){
          console.log('[AI] 准备发送 ' + aiFields.length + ' 个字段到 DeepSeek...');
          globalResults.push({label:'🤖 AI分析中...', action:'[AI]', value:'正在调用DeepSeek智能生成数据', iframe:false});

          callDeepSeekAI(aiFields).then(function(map){
            aiValueMap = map;
            console.log('[AI] DeepSeek 返回了 ' + Object.keys(map).length + ' 个字段的值');
            // ★ 详细打印每个字段的返回值
            console.log('[AI] ===== AI 返回明细 =====');
            Object.keys(map).forEach(function(k){
              console.log('  "' + k + '" => "' + (map[k]||'(空字符串)') + '"');
            });
            console.log('[AI] ======================');

            // ★ 后处理：检查并修正 AI 生成的日期（如果重复就强制分散）
            postProcessDates(aiValueMap, aiFields);

            // ★ 后处理：强制合同编号等"编号类"字段按规则随机（避免每次相同）
            postProcessSerialNumbers(aiValueMap, aiFields);

            globalResults.pop();
            runRound();
          }).catch(function(err){
            console.error('[AI] DeepSeek 调用失败:', err.message);
            globalResults.pop();
            // AI 失败 → 直接终止，不自动回退规则模式
            finish('AI调用失败: ' + (err.message || '未知错误'));
          });
        } else {
          console.log('[AI] 没有需要AI处理的文本字段，直接填充');
          runRound();
        }
      } else {
        runRound();
      }
    }

    function runRound(){
      if(_AFCtrl.stopped){ finish('已停止'); return; }
      round++;
      var fresh = scanFields();
      var todo = [];
      for(var i=0;i<fresh.length;i++){
        if(!hasSeen(fresh[i].element)) todo.push(fresh[i]);
      }

      if(todo.length === 0){ finish(); return; }
      if(round > MAX_ROUNDS){
        console.log('[v10] 达到最大轮数 '+MAX_ROUNDS+'，剩余 '+todo.length+' 字段未处理');
        finish();
        return;
      }

      console.log('[v10] === 第 '+round+' 轮：'+todo.length+' 个字段（模式：'+_AFCtrl.mode+'） ===');
      processRound(todo, function(){
        if(_AFCtrl.stopped){ finish('已停止'); return; }
        setTimeout(runRound, _afDelay('between-rounds'));
      });
    }

    // 处理一个【非 select/cascader】字段（同步），返回 false 表示需要"等下一轮"
    function handleNonSelectFieldSync(f, idx){
      var lbl = (f.label||f.placeholder||'#'+(idx+1)).slice(0,35);
      console.log('[handleNonSelectFieldSync] type="'+f.type+'" label="'+lbl+'" element.tagName='+f.element.tagName);
      if(SELECT_TYPES.indexOf(f.type) >= 0){
        console.log('[handleNonSelectFieldSync] ⚠️ el-select/级联被当作下拉，但应该走 handleSingleSelect');
        return true;  // 跳过突进，留给 handleSingleSelect
      }
      var inIframe = f.doc !== document;
      var isRadio = f.type === 'radio-group';

      // radio-group
      if(isRadio){
        if(isRadioGroupSelected(f.element)){
          var cv1 = getCheckedRadioLabel(f.element);
          globalStats.cascaded++;
          globalResults.push({label:lbl, action:'[已选]', value:cv1, iframe:inIframe});
          markSeen(f.element);
          console.log(' '+lbl+' <- 已选: "'+cv1+'"');
          return true;
        }
        if(f.disabled || f.element.classList.contains('is-disabled')){
          console.log(' '+lbl+' (radio-group disabled，等下一轮)');
          return false;  // 不 markSeen，下一轮再试
        }
        // fire-and-forget：点击事件派发是同步的，组件 reactivity 异步处理；不等返回
        doRadioFirst(f.element, lbl);
        globalStats.filled++;
        globalResults.push({label:lbl, action:'选中', value:'(第一项)', iframe:inIframe});
        markSeen(f.element);
        return true;
      }

      // 已联动
      var cv = getFieldCurrentValue(f.element);
      if(cv && String(cv).trim()!=='' && String(cv).trim()!==(f.placeholder||'')){
        globalStats.cascaded++;
        globalResults.push({label:lbl, action:'[联动]', value:String(cv).slice(0,40), iframe:inIframe});
        markSeen(f.element);
        console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- 联动: "'+cv.slice(0,25)+'"');
        return true;
      }

      // disabled 留到下一轮
      if(f.element.disabled){
        console.log(' '+lbl+' (disabled，等下一轮)');
        return false;
      }

      // date-picker: 通过 Vue emit 直接更新 modelValue，绕开 readonly input 和面板限制
      if(f.type === 'date-picker'){
        // ★ AI 模式优先：从 AI 返回值中取日期
        var dateVal = null;
        var dateSource = '[日期]';
        if(aiValueMap){
          var aiDate = lookupAIValue(f, aiValueMap);
          if(aiDate && String(aiDate).trim() !== ''){
            dateVal = String(aiDate).trim();
            dateSource = '[AI日期]';
            console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- 🤖AI日期: '+dateVal);
          }
        }
        // ★ 回退到规则生成
        if(!dateVal){
          dateVal = genDateValue(f.label || f.placeholder, f.element);
        }
        try{
          // 方式①：Vue emit 更新模型（主要方式）
          var emitted = syncDatePickerModel(f.element, dateVal);
          // 方式②：同时也试着设一下 input 值（视觉反馈，readonly 时无效但无害）
          try{ setInputValue(f.element, dateVal); }catch(e){}
          globalStats.filled++;
          globalResults.push({label:lbl, action:dateSource, value:dateVal, iframe:inIframe});
          markSeen(f.element);
          console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- '+dateVal+(emitted?' (model)':' (input)'));
        }catch(e){
          globalStats.failed++;
          globalResults.push({label:lbl, action:'[错]', value:'', iframe:inIframe});
          markSeen(f.element);
        }
        return true;
      }

      // text / number
      var isNumberInput = f.type === 'number' ||
        f.element.type === 'number' ||
        (f.element.closest && f.element.closest('.el-input-number,.ant-input-number,[class*="input-number"]'));

      var val;
      var sourceAction = '[填写]';

      // ★ AI 模式优先：从 AI 返回值中查找
      if (aiValueMap) {
        var aiVal = lookupAIValue(f, aiValueMap);
        if (aiVal !== null && aiVal !== undefined && String(aiVal).trim() !== '') {
          val = String(aiVal).trim();
          sourceAction = '[AI填写]';
          console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- 🤖AI: '+val);
        } else if (f.type === 'date-picker' || f.type === 'el-cascader' || f.type === 'ant-cascader') {
          // ★ 这些类型 AI 返回空必须跳过（级联器/日期需要 AI 给路径）
          val = null;
          sourceAction = '[AI跳过]';
        }
        // 其他类型（text/number/el-select）继续往下走，规则模式兜底
      }

      // 回退：规则/配置生成
      if (val === undefined) {
        val = isNumberInput
          ? String(numericInRange(f.element, f.label || f.placeholder))
          : (valueIdx < configValues.length ? configValues[valueIdx++] : genValue(f.label||f.placeholder, idx));
      }

      // ★ 仅对级联器/日期：AI 显式返回空才跳过
      if (val === null) {
        globalResults.push({label:lbl, action:sourceAction, value:'(跳过)', iframe:inIframe});
        markSeen(f.element);
        console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- 🤖AI跳过(保留现有值)');
        return true;
      }

      try{
        setInputValue(f.element, val);
        globalStats.filled++;
        globalResults.push({label:lbl, action:sourceAction, value:String(val).slice(0,40), iframe:inIframe});
        markSeen(f.element);
        console.log(' '+lbl+(inIframe?'[iframe]':'')+' <- '+val);
      }catch(e){
        globalStats.failed++;
        globalResults.push({label:lbl, action:'[错]', value:'', iframe:inIframe});
        markSeen(f.element);
      }
      return true;
    }

    function processRound(fields, doneCb){
      var idx = 0;
      var fast = _AFCtrl.mode === 'fast';

      // 一次性模式：先把所有【非下拉】字段同步突进填掉，select/cascader 留到下面串行
      if(fast){
        while(idx < fields.length){
          if(_AFCtrl.stopped) break;
          var fNow = fields[idx];
          if(SELECT_TYPES.indexOf(fNow.type) >= 0) break; // 遇到下拉就停止突进
          idx++;
          handleNonSelectFieldSync(fNow, idx-1);
        }
      }

      // 后面剩下的字段（fast 模式可能还有下拉；逐个模式是全部）走串行
      function next(){
        if(_AFCtrl.stopped){ doneCb(); return; }
        if(_AFCtrl.paused){ setTimeout(next, 200); return; }
        if(idx >= fields.length){ doneCb(); return; }

        var f = fields[idx++];
        var isSel = SELECT_TYPES.indexOf(f.type) >= 0;
        var lbl = (f.label||f.placeholder||'#'+idx).slice(0,35);

        // ★ 通知 content.js 更新遮罩层进度
        if(_onProgressCallback){
          try{ _onProgressCallback({ fieldLabel: lbl, index: idx, total: fields.length }); }catch(e){}
        }

        if(isSel){
          // 已联动？
          var cv = getFieldCurrentValue(f.element);
          if(cv && String(cv).trim()!=='' && String(cv).trim()!==(f.placeholder||'')){
            globalStats.cascaded++;
            globalResults.push({label:lbl, action:'[联动]', value:String(cv).slice(0,40), iframe:f.doc!==document});
            markSeen(f.element);
            console.log(' '+lbl+' <- 联动: "'+cv.slice(0,25)+'"');
            setTimeout(next, _afDelay('cascaded-sel'));
            return;
          }
          if(f.element.disabled){
            console.log(' '+lbl+' (disabled，等下一轮)');
            setTimeout(next, _afDelay('disabled-skip'));
            return;
          }
          handleSingleSelect(f.element, f.type, lbl, idx-1, f, aiValueMap).then(function(r){
            r.ok ? globalStats.filled++ : globalStats.failed++;
            globalResults.push({label:lbl, action:r.action, value:(r.value||'').slice(0,40), iframe:f.doc!==document});
            markSeen(f.element);
            setTimeout(next, _afDelay('select-after'));
          });
          return;
        }

        // 非 select（仅在逐个模式下会走到这里——fast 模式上面已经突进处理了）
        var ok = handleNonSelectFieldSync(f, idx-1);
        // disabled 没 markSeen，下轮再来；其他都已 markSeen
        var kind = ok ? 'text' : 'disabled-skip';
        setTimeout(next, _afDelay(kind));
      }

      next();
    }

    startAfterAI();
  });
}

function getFieldCurrentValue(el){
  if(!el)return '';
  if(el.tagName==='SELECT') return el.selectedIndex>=0?(el.options[el.selectedIndex].text||el.value):'';

  var wrap = el.closest && el.closest(
    '.el-select,.ant-select,.el-cascader,.ant-cascader,'+
    '.el-date-editor,.el-time-picker,.ant-picker'
  );

  // el-select / ant-select：值在 tag/selected-item/placeholder 中，不在 input.value
  if(wrap && (wrap.classList.contains('el-select') || /(?:^| )el-select(?: |$)/.test(wrap.className) ||
      wrap.classList.contains('ant-select') || /(?:^| )ant-select(?: |$)/.test(wrap.className))){
    var selItem = wrap.querySelector('.el-tag__content,.el-select__selected-item,.el-select__tags-text,.ant-select-selection-item');
    if(selItem && selItem.textContent.trim()) return selItem.textContent.trim();
    var ph = wrap.querySelector('.el-select__placeholder');
    if(ph && !ph.classList.contains('is-focus')){
      var t = (ph.textContent||'').trim();
      if(t && !/(\u8bf7\u9009\u62e9|\u9009\u62e9|select|placeholder)/i.test(t)) return t;
    }
  }

  // el-cascader / ant-cascader
  if(wrap && (wrap.classList.contains('el-cascader') || /(?:^| )el-cascader(?: |$)/.test(wrap.className) ||
      wrap.classList.contains('ant-cascader'))){
    // ★ 多选模式：值在 tag 中（如签约房间的多选级联器）
    var cascaderTags = wrap.querySelectorAll('.el-tag__content,.el-cascader__tags-text,.el-cascader .el-tag span');
    if(cascaderTags && cascaderTags.length > 0){
      var tagTexts = [];
      for(var ti=0; ti<cascaderTags.length; ti++){
        var tt = (cascaderTags[ti].textContent||'').trim();
        if(tt) tagTexts.push(tt);
      }
      if(tagTexts.length > 0) return tagTexts.join(', ');
    }
    // ★ 单选模式：值在 label 中
    var cl = wrap.querySelector('.el-cascader__label,.ant-cascader-picker-label');
    if(cl && cl.textContent.trim()){
      var labelText = cl.textContent.trim();
      // 排除 placeholder 文本
      if(!/^请选择|^选择|^select/i.test(labelText)) return labelText;
    }
  }

  // date-picker
  if(wrap && /el-date-editor|el-time-picker|ant-picker/.test(wrap.className||'')){
    var di = wrap.querySelector('input');
    if(di && di.value && di.value.trim()) return di.value.trim();
  }

  var inner=el.querySelector('input,.el-input__inner,.ant-select-selection-selected-value');
  return(inner&&inner.value)?inner.value:(el.value||'');
}

// ============================================================
//  ★★★ 下拉选择引擎（v9: 支持跨文档查找面板）★★★
// ============================================================

function handleSingleSelect(el,type,lbl,idx,field,aiValueMap){
  return new Promise(function(resolve){
    console.log('  >> ['+(idx+1)+'] '+lbl+' ('+type+') 选择中...');

    if(type==='el-cascader'||type==='ant-cascader'){
      var aiPath = null;
      if(aiValueMap && field){
        var aiVal = lookupAIValue(field, aiValueMap);
        if(aiVal && String(aiVal).trim() !== ''){
          aiPath = String(aiVal).trim().split(/[\/＞>＞\/]+/).map(function(s){return s.trim();}).filter(Boolean);
          console.log('  🤖 AI级联路径: ['+aiPath.join(' / ')+']');
        }
      }
      doCascaderSelect(el,lbl,aiPath).then(function(r){
        resolve({ok:!!r, action:r?'级联OK':'级联FAIL', value:r||''});
      });
    }else if(type==='el-select'||type==='ant-select'){
      // ★ AI 模式：从 aiValueMap 中查找期望值
      var aiWantValue = null;
      if(aiValueMap && field){
        var aiVal = lookupAIValue(field, aiValueMap);
        if(aiVal && String(aiVal).trim() !== ''){
          aiWantValue = String(aiVal).trim();
          console.log('  🤖 AI下拉期望: "'+aiWantValue+'"');
        }
      }
      doElSelectFirst(el,lbl,idx,aiWantValue).then(function(r){
        resolve({ok:!!r, action:r?'选中':'失败', value:r||''});
      });
    }else{ selectFirstNative(el); resolve({ok:true,action:'native',value:el.value||''});}
  });
}

// ---- el-select 选择项（多策略重试，支持跨文档）----
function doElSelectFirst(inputEl,lbl,idx,aiWantValue){
  return new Promise(function(resolve){
    var doc = getOwnerDoc(inputEl);
    var wrapper = inputEl.closest('.el-select')
               || inputEl.closest('.ant-select')
               || inputEl.closest('[class*="el-select"]')
               || inputEl;
    var trigger = wrapper.querySelector('.el-select__wrapper')
               || wrapper.querySelector('.el-input__wrapper')
               || wrapper.querySelector('.el-input__inner')
               || wrapper.querySelector('input,[class*="trigger"]')
               || inputEl;

    // ★ 检查 disabled 状态：禁用时不要 click，会污染 Element Plus 内部状态
    if(wrapper.classList.contains('is-disabled') ||
       (inputEl.disabled) ||
       wrapper.getAttribute('aria-disabled') === 'true'){
      console.log('    [skip] el-select 已禁用，等下一轮');
      resolve(''); // 返回空，让串行循环认为失败但不至于破坏状态
      return;
    }

    try{ trigger.focus && trigger.focus(); }catch(e){}
    fireFullClick(trigger);

    setTimeout(function(){
      trySelect(wrapper,trigger,0,function(text){
        if(text){
          setTimeout(function(){
            closeDropdown(doc);
            // 解除可能的锁定（保险起见）
            try{ unblockSelectAfterFill(wrapper); }catch(e){}
            resolve(text);
          }, 120);
        }else{
          keyboardFallback(trigger,resolve);
          try{ unblockSelectAfterFill(wrapper); }catch(e){}
        }
      }, doc, aiWantValue);
    },180);
  });
}

function trySelect(wrapper,trigger,attempt,cb,doc,aiWantValue){
  doc = doc || getOwnerDoc(trigger);
  var delays=[200,300,400,600];
  if(attempt>=delays.length){cb(null);return;}

  setTimeout(function(){
    var opt=null, dropdown=null;

    dropdown=findDropdownFor(wrapper, doc);
    if(!dropdown) dropdown=findAnyVisibleDrop();

    if(dropdown){
      var items=dropdown.querySelectorAll(
        '.el-select-dropdown__item:not(.is-disabled):not(.is-hidden),'+
        '.ant-select-dropdown-menu-item:not(.disabled)'
      );
      if(items.length>0){
        // ★ 优先按 AI 期望值匹配；否则随机选一项（不再固定第一项）
        opt = pickItem(items, aiWantValue);
      }
    }

    if(!opt){
      var allDocs = getAllDocuments();
      for(var d=0;d<allDocs.length;d++){
        var gi=allDocs[d].querySelectorAll('.el-select-dropdown__item:not(.is-disabled)');
        if(gi.length>0){
          opt = pickItem(gi, aiWantValue);
          dropdown=opt.closest('.el-select-dropdown');
          break;
        }
      }
    }

    if(opt){
      var txt=(opt.textContent||'').trim().slice(0,40);
      // 记录点击前的 input 值，便于事后判断是否真的写入了
      var realInput = (trigger && trigger.tagName==='INPUT') ? trigger
        : (wrapper && wrapper.querySelector ? wrapper.querySelector('input') : null);
      var beforeVal = realInput ? (realInput.value||'') : '';

      fireFullClick(opt);
      console.log('    OK: 点击 "'+txt+'"');

      // ★ EP 2.14+ + Element UI 1.x/2.x 兜底：直接通过 Vue API 设置值并关闭面板
      try {
        // Vue 3 路径
        var optVm2 = opt.__vueParentComponent;
        if(optVm2){
          var sel2 = (optVm2.setupState && optVm2.setupState.select)
                   || (optVm2.proxy && optVm2.proxy.select) || null;
          if(sel2 && typeof sel2.handleOptionSelect === 'function'){
            sel2.handleOptionSelect(optVm2.proxy || optVm2);
            console.log('    [Vue3 API] handleOptionSelect 调用成功');
            // ★ 选中后立即通过 Vue API 关闭面板（避免 Escape 被 guard 拦截）
            if(typeof sel2.handleClose === 'function'){
              try{ sel2.handleClose(); console.log('    [Vue3 API] handleClose 关闭面板'); }catch(e){}
            }else if(sel2.visible !== undefined){
              try{ sel2.visible = false; console.log('    [Vue3 API] visible=false'); }catch(e){}
            }
          }
        }
        // Vue 2 路径（旧版 Element UI）: opt.__vue__ 是 Option 实例
        if(opt.__vue__){
          try{
            var optVue2 = opt.__vue__;
            // 旧版 Element UI 的 el-select Option 有 select 引用指向父组件
            if(optVue2.select && typeof optVue2.select.handleOptionSelect === 'function'){
              optVue2.select.handleOptionSelect(optVue2);
              console.log('    [Vue2 API] handleOptionSelect 调用成功');
              // 关闭面板
              if(typeof optVue2.select.visible === 'boolean'){
                optVue2.select.visible = false;
                console.log('    [Vue2 API] visible=false');
              }
            }else if(optVue2.$parent && optVue2.$parent.$options && optVue2.$parent.$options.name === 'ElSelect'){
              // 兜底：直接修改 $parent.visible
              optVue2.$parent.visible = false;
              console.log('    [Vue2 API] $parent.visible=false');
            }
          }catch(e){ console.log('    [Vue2 API] 异常:', e.message); }
        }
      } catch(e){ console.log('    [Vue API] 异常:', e.message); }

      setTimeout(function(){
        var afterVal = realInput ? (realInput.value||'') : '';
        // ★ EP 2.14+：选中后值在 .el-select__placeholder 上，不在 input.value
        var ph = wrapper.querySelector('.el-select__placeholder');
        var phTxt = ph ? (ph.textContent||'').trim() : '';
        console.log('    [验证] ph="'+phTxt+'" input="'+afterVal+'"');
        var committed = (afterVal && afterVal !== beforeVal &&
                        afterVal !== (realInput && realInput.placeholder || ''))
                     || (phTxt && !/请选择|选择|select/i.test(phTxt));
        if(committed){
          cb(phTxt || afterVal || txt);
          return;
        }
        // 鼠标点击没提交，键盘兜底：ArrowDown + Enter
        console.log('    点击未提交（"'+afterVal+'"），切换键盘兜底...');
        var kbTarget = realInput || trigger;
        dispatchKey(kbTarget,'ArrowDown');
        setTimeout(function(){
          dispatchKey(kbTarget,'Enter');
          setTimeout(function(){ cb(txt+'(键盘)'); }, 180);
        }, 120);
      }, 240);
    }else{
      console.log('    尝试'+(attempt+1)+'/'+delays.length+' 未找到选项');
      // ★ 重试前先重新打开下拉（面板可能因焦点丢失被关了）
      if(attempt < delays.length - 1){
        try{ trigger.focus && trigger.focus(); }catch(e){}
        fireFullClick(trigger);
      }
      trySelect(wrapper,trigger,attempt+1,cb,doc,aiWantValue);
    }
  },delays[attempt]);
}

/** 从下拉项中选一项：AI 期望值优先 → 否则随机 */
function pickItem(items, aiWantValue){
  if(!items || items.length === 0) return null;

  // 1) AI 期望值匹配
  if(aiWantValue){
    for(var i=0; i<items.length; i++){
      var txt = (items[i].textContent||'').trim();
      if(txt === aiWantValue || txt.indexOf(aiWantValue) >= 0 || aiWantValue.indexOf(txt) >= 0){
        console.log('    🎯 AI匹配到项: "'+txt+'"');
        return items[i];
      }
    }
    console.log('    ⚠️ AI期望"'+aiWantValue+'"未匹配到，随机选');
  }

  // 2) 随机选（避免每次都选第一项导致数据雷同）
  var idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

function findDropdownFor(w, doc){
  doc = doc || getOwnerDoc(w);
  var id=w.getAttribute?('aria-controls')||(w.getAttribute&&w.getAttribute('data-popper?id')):'';
  if(id){var e=doc.getElementById(id);if(e&&vis(e))return e;}

  var dropSel = '.el-select-dropdown,.ant-select-dropdown,'+
                // Element Plus 2.4+：dropdown 外面套了一层 .el-popper.el-select__popper
                '.el-popper.el-select__popper[aria-hidden="false"],'+
                '.el-popper.el-select__popper:not([aria-hidden="true"])';

  // 在所有文档中搜索
  var allDocs = getAllDocuments();
  for(var d=0;d<allDocs.length;d++){
    var all=allDocs[d].querySelectorAll(dropSel);
    if(w.getBoundingClientRect){
      var rc=w.getBoundingClientRect(),best=null,minD=Infinity;
      for(var i=0;i<all.length;i++){
        if(!vis(all[i]))continue;var r=all[i].getBoundingClientRect(),d=Math.abs(r.left-rc.left)+Math.abs(r.top-rc.bottom);
        if(d<minD&&d<600){minD=d;best=all[i];}
      }if(best)return best;
    }
    for(var j=0;j<all.length;j++){ if(vis(all[j])) return all[j]; }
  }
  return null;
}

function findAnyVisibleDrop(){
  var sels=[
    '.el-select-dropdown',
    '.ant-select-dropdown',
    '.el-popper.el-select__popper',
    '[class*="select-dropdown"]'
  ];
  var allDocs = getAllDocuments();
  for(var d=0;d<allDocs.length;d++){
    for(var s=0;s<sels.length;s++){var ls=allDocs[d].querySelectorAll(sels[s]);for(var i=0;i<ls.length;i++)if(vis(ls[i]))return ls[i];}
  }
  return null;
}

function vis(e){try{var s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden';}catch(x){return!!(e&&(e.offsetWidth>0||e.offsetHeight>0));}}

function closeDropdown(doc){
  doc = doc || document;
  // ★ v3.8.8: 优先通过 Vue 实例关闭面板（避免 Escape 被 drawer-guard 拦截）
  // ★ v3.8.11: 同时兼容 Vue 2 (旧版 Element UI) 和 Vue 3 (Element Plus)
  var allDocs = getAllDocuments();
  var closedViaVue = false;
  
  // 1) 尝试关闭 el-select-dropdown（Vue 3 + Vue 2 双兼容）
  for(var d=0; d<allDocs.length; d++){
    var drops = allDocs[d].querySelectorAll('.el-select-dropdown:not([style*="display: none"]),.el-popper.el-select__popper[aria-hidden="false"]');
    for(var i=0; i<drops.length; i++){
      try{
        var dp = drops[i];
        // ★ Vue 2 旧版 Element UI: 整个 dropdown 本身是 Vue 实例（__vue__）
        if(dp.__vue__){
          try{
            // 旧版 Element UI 的 el-select 实例通过 dropdown 上的引用访问
            var sel2 = dp.__vue__;
            if(sel2 && typeof sel2.visible === 'boolean'){
              sel2.visible = false;
              closedViaVue = true;
              console.log('    [close] el-select (Vue2) visible=false');
            }else if(sel2 && sel2.$parent && typeof sel2.$parent.visible === 'boolean'){
              sel2.$parent.visible = false;
              closedViaVue = true;
              console.log('    [close] el-select (Vue2 parent) visible=false');
            }
          }catch(e){}
        }
        // ★ Vue 3 Element Plus: 通过 dropdown 内 item 找到 select 实例
        var item = dp.querySelector('.el-select-dropdown__item');
        if(item){
          // Vue 3 路径
          var itemVm = item.__vueParentComponent;
          if(itemVm){
            var sel = (itemVm.setupState && itemVm.setupState.select)
                    || (itemVm.proxy && itemVm.proxy.select) || null;
            if(sel && typeof sel.handleClose === 'function'){
              sel.handleClose();
              closedViaVue = true;
              console.log('    [close] el-select (Vue3) handleClose');
            }else if(sel && typeof sel.visible === 'boolean'){
              sel.visible = false;
              closedViaVue = true;
              console.log('    [close] el-select (Vue3) visible=false');
            }
          }
          // Vue 2 路径（el-select 1.x/2.x）: item 自身可能是 Vue 实例
          if(!closedViaVue && item.__vue__){
            try{
              var sel3 = item.__vue__;
              // 旧版 Element UI Option 实例：dispatch('select') 给父 select
              // 父 select 通过 $parent 访问
              if(sel3 && sel3.$parent && sel3.$parent.$options && sel3.$parent.$options.name === 'ElSelect'){
                sel3.$parent.visible = false;
                closedViaVue = true;
                console.log('    [close] el-select (Vue2 $parent) visible=false');
              }else if(sel3 && sel3.select && typeof sel3.select.visible === 'boolean'){
                sel3.select.visible = false;
                closedViaVue = true;
                console.log('    [close] el-select (Vue2 select) visible=false');
              }
            }catch(e){}
          }
        }
      }catch(e){}
    }
  }

  // 2) 尝试关闭 el-cascader-panel（Vue 3 + Vue 2）
  for(var d2=0; d2<allDocs.length; d2++){
    var panels = allDocs[d2].querySelectorAll('.el-cascader-panel:not([style*="display: none"])');
    for(var j=0; j<panels.length; j++){
      try{
        var pv = panels[j];
        // Vue 3
        var pv3 = pv.__vueParentComponent;
        if(pv3 && pv3.setupState && pv3.setupState.visible !== undefined){
          pv3.setupState.visible = false;
          closedViaVue = true;
          console.log('    [close] el-cascader (Vue3) visible=false');
        }
        // Vue 2
        if(!closedViaVue && pv.__vue__){
          var pv2 = pv.__vue__;
          if(pv2 && typeof pv2.visible === 'boolean'){
            pv2.visible = false;
            closedViaVue = true;
            console.log('    [close] el-cascader (Vue2) visible=false');
          }else if(pv2 && pv2.$parent && typeof pv2.$parent.visible === 'boolean'){
            pv2.$parent.visible = false;
            closedViaVue = true;
            console.log('    [close] el-cascader (Vue2 $parent) visible=false');
          }
        }
      }catch(e){}
    }
  }

  // 3) 兜底：派发 Escape（可能被 guard 拦截，但无害）
  if(!closedViaVue){
    var target = doc.activeElement || doc.body;
    var ev = new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
    target.dispatchEvent(ev);
  }
}

/** 关闭所有文档中已打开的下拉面板 */
function closeAllDropdowns(){
  // ★ v3.8.8: 逐个文档调用 closeDropdown（已改为 Vue API 优先）
  var allDocs = getAllDocuments();
  for(var d=0; d<allDocs.length; d++){
    closeDropdown(allDocs[d]);
  }
  // ★ 不要手动设 display:none，会锁死 Element Plus 内部状态导致下拉永远打不开
}

/** AI 模式填充完成后，解除 el-select 锁定状态，让用户可以手动切换 */
function unblockSelectAfterFill(wrapper){
  if(!wrapper) return;
  try{
    // 1) 移除可能被设置的 disabled / readonly / aria-disabled
    wrapper.removeAttribute('disabled');
    wrapper.removeAttribute('aria-disabled');
    wrapper.classList.remove('is-disabled','is-readonly');
    // 2) 让 click 事件能再次穿透
    wrapper.style.pointerEvents = '';
    wrapper.style.userSelect = '';
    // 3) 同步内部 input 状态
    var innerInput = wrapper.querySelector('input');
    if(innerInput){
      innerInput.removeAttribute('disabled');
      innerInput.removeAttribute('readonly');
      innerInput.style.pointerEvents = '';
    }
    // 4) ★ 强制把 el-select-dropdown 的 display 状态恢复（如果之前被锁过）
    var ownerDoc = getOwnerDoc(wrapper);
    var popperId = wrapper.getAttribute && wrapper.getAttribute('aria-controls');
    if(popperId){
      var popper = ownerDoc.getElementById(popperId);
      if(popper){
        // 不要强制设 display，让 Element Plus 自己控制
        popper.style.display = '';
        popper.style.visibility = '';
        popper.style.pointerEvents = '';
      }
    }
    // 5) 触发一次 blur 重新激活 Element Plus 的 focus 状态机
    if(innerInput){
      try{ innerInput.blur(); }catch(e){}
    }
  }catch(e){}
}

// ============================================================
//  ★★★ 抽屉/弹窗防护系统（防止填充期间误关弹窗）★★★

// ============================================================
//  ★★★ 抽屉/弹窗防护系统（防止填充期间误关弹窗）★★★
// ============================================================

var DRAWER_OVERLAY_SELECTORS = [
  '.el-overlay',              // Element Plus 遮罩（el-drawer / el-dialog 共用）
  '.el-drawer__wrapper',      // el-drawer 包装器
  '.el-dialog__wrapper',      // el-dialog 包装器
  '.ant-modal-wrap',          // Ant Design modal 遮罩
  '.ant-drawer-wrap'          // Ant Design drawer 遮罩
];

// 在所有 document（含同源 iframe）的遮罩层上安装 capture 阶段 click 拦截器
function installDrawerGuards(){
  uninstallDrawerGuards(); // 先清理旧的
  var allDocs = getAllDocuments();
  for(var d=0; d<allDocs.length; d++){
    var doc = allDocs[d];
    for(var s=0; s<DRAWER_OVERLAY_SELECTORS.length; s++){
      try{
        var nodes = doc.querySelectorAll(DRAWER_OVERLAY_SELECTORS[s]);
        for(var i=0; i<nodes.length; i++){
          var node = nodes[i];
          // capture 阶段拦截 click：fireFullClick 的 el.click() 冒泡时会经过 overlay → 在此拦截
          // ★ 临时禁用：测试是否是 guard 阻止了下拉选中
          var clickGuard = function(e){
            if(_AFCtrl.running){
              // ★ TEMP DISABLED: 不再拦截，让 click 正常冒泡
              // e.stopPropagation();
              // e.stopImmediatePropagation();
              // return false;
            }
          };
          node.addEventListener('click', clickGuard, true);
          _drawerGuards.push({ node: node, handler: clickGuard, type: 'click' });
        }
      }catch(err){
        console.warn('[drawer-guard] 安装失败:', err.message);
      }
    }
  }
  // ★ document + window 级 keydown Escape 拦截器（在所有 document 上安装）
  //     closeDropdown 直接 doc.dispatchEvent('Escape')，iframe 内的 Escape 不影响主 document，
  //     但 drawer 也可能在 iframe 内，所以需要每个 document 都安装
  // 在所有 document（含 iframe）上安装 keydown capture 拦截
  for(var di=0; di<allDocs.length; di++){
    try{
      var curDoc = allDocs[di];
      var docGuard = function(ev){ if(_AFCtrl.running && ev.key==='Escape'){ ev.stopPropagation(); ev.stopImmediatePropagation(); } };
      curDoc.addEventListener('keydown', docGuard, true);
      _drawerGuards.push({ type: 'doc-keydown', node: curDoc, handler: docGuard });
      
      // 同时在每个 document 的 window 上安装（部分 Element Plus 版在 window 上注册 keydown）
      var curWin = curDoc.defaultView;
      if(curWin && curWin !== window){
        var winGuard = function(ev){ if(_AFCtrl.running && ev.key==='Escape'){ ev.stopPropagation(); ev.stopImmediatePropagation(); } };
        curWin.addEventListener('keydown', winGuard, true);
        _drawerGuards.push({ type: 'win-keydown', node: curWin, handler: winGuard });
      }
    }catch(e){}
  }
  // 主 window 单独保存引用以便清理
  _docKeyGuard_window = function(e){
    if(_AFCtrl.running && e.key === 'Escape'){ e.stopPropagation(); e.stopImmediatePropagation(); }
  };
  try{ window.addEventListener('keydown', _docKeyGuard_window, true); }catch(e){}
  
  // ★ el-drawer 关闭劫持——在所有 document（含 iframe）中查找 drawer
  for(var di2=0; di2<allDocs.length; di2++){
    try{
      var allDrawers = allDocs[di2].querySelectorAll('.el-drawer__wrapper,.el-drawer');
      for(var di3=0; di3<allDrawers.length; di3++){
        var drawerComp = allDrawers[di3].__vueParentComponent;
        var dcDepth = 0;
        while(drawerComp && dcDepth < 20){
          dcDepth++;
          if(drawerComp.props && 'modelValue' in drawerComp.props && drawerComp.emit){
            var originalEmit = drawerComp.emit;
            drawerComp._af_originalEmit = originalEmit;
            drawerComp.emit = function(event, value){
              if(_AFCtrl.running && event === 'update:modelValue' && (value === false || value === undefined || value === null)){
                console.log('[drawer-guard] 阻止 el-drawer 关闭（填充中）');
                return;
              }
              return originalEmit.call(this, event, value);
            };
            _drawerGuards.push({ type: 'drawer-emit', drawer: drawerComp });
            break;
          }
          drawerComp = drawerComp.parent;
        }
      }
    }catch(e){}
  }
  
  if(_drawerGuards.length > 0 || _docKeyGuard_window){
    console.log('[drawer-guard] 已安装 '+_drawerGuards.length+' 个拦截器 (覆盖 '+allDocs.length+' 个 document)');
  }
}

// 清理所有防护器
function uninstallDrawerGuards(){
  for(var g=0; g<_drawerGuards.length; g++){
    try{
      var guard = _drawerGuards[g];
      if(guard.type === 'drawer-emit'){
        if(guard.drawer && guard.drawer._af_originalEmit){
          guard.drawer.emit = guard.drawer._af_originalEmit;
          delete guard.drawer._af_originalEmit;
        }
      }else if(guard.type === 'doc-keydown'){
        guard.node.removeEventListener('keydown', guard.handler, true);
      }else if(guard.type === 'win-keydown'){
        guard.node.removeEventListener('keydown', guard.handler, true);
      }else{
        guard.node.removeEventListener('click', guard.handler, true);
      }
    }catch(e){}
  }
  _drawerGuards = [];
  
  // 清理主 window 级 Escape 拦截
  if(_docKeyGuard_window){
    try{ window.removeEventListener('keydown', _docKeyGuard_window, true); }catch(e){}
    _docKeyGuard_window = null;
  }
  
  console.log('[drawer-guard] 已清理所有遮罩拦截器');
}

function keyboardFallback(tr,res){
  dispatchKey(tr,'ArrowDown');setTimeout(function(){dispatchKey(tr,'Enter');console.log('    键盘备选');res('(键盘)');},150);
}

function dispatchKey(el,key){
  var kc=key==='Enter'?13:40,code=key==='Enter'?'Enter':'ArrowDown';
  el.dispatchEvent(new KeyboardEvent('keydown',{key:key,code:code,kc:kc,bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keypress',{keyCode:kc,bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keyup',{key:key,bubbles:true}));
}

// 完整鼠标/指针事件序列：覆盖 Vue 可能监听的所有事件名
// 注意：序列里【不含 'click'】，最后只用 el.click() 触发一次，避免双击导致：
//   - trigger 输入框被 toggle 一开一关（dropdown 立刻消失）
//   - 选项被点 2 次造成反选/复位
function fireFullClick(el){
  if(!el) return;
  var doc = el.ownerDocument || document;
  var win = doc.defaultView || window;
  var seq = ['pointerover','pointerenter','mouseover','mouseenter',
             'pointerdown','mousedown','pointerup','mouseup'];
  for(var i=0;i<seq.length;i++){
    var name = seq[i];
    var isPtr = name.indexOf('pointer')===0;
    try{
      var ev;
      if(isPtr && win.PointerEvent){
        ev = new win.PointerEvent(name,{bubbles:true,cancelable:true,view:win,pointerType:'mouse',button:0});
      }else{
        ev = new win.MouseEvent(name,{bubbles:true,cancelable:true,view:win,button:0});
      }
      el.dispatchEvent(ev);
    }catch(e){
      try{ el.dispatchEvent(new win.MouseEvent(name,{bubbles:true,cancelable:true,view:win})); }catch(e2){}
    }
  }
  try{ el.click && el.click(); }catch(e){}
}

/**
 * 只派发 hover/mouseover 系列事件（不派发 click）
 * 用于 expandTrigger: 'hover' 模式的 el-cascader：
 *   hover 非叶子节点 → 展开下一级
 *   hover 叶子节点 → 仅高亮（不选中）
 * ★ 增强：带坐标 + mousemove（Element Plus menu.mjs 的 handleMouseMove 需要）
 */
function fireHover(el){
  if(!el) return;
  var doc = el.ownerDocument || document;
  var win = doc.defaultView || window;
  var rect = el.getBoundingClientRect();
  var cx = rect.left + rect.width/2;
  var cy = rect.top + rect.height/2;
  // mouseover（冒泡）
  try{ el.dispatchEvent(new win.MouseEvent('mouseover',{bubbles:true,cancelable:true,view:win,clientX:cx,clientY:cy,relatedTarget:null,button:0})); }catch(e){}
  // mouseenter（不冒泡）
  try{ el.dispatchEvent(new win.MouseEvent('mouseenter',{bubbles:false,cancelable:false,view:win,clientX:cx,clientY:cy,relatedTarget:null,button:0})); }catch(e){}
  // pointerover / pointerenter
  try{
    if(win.PointerEvent){
      el.dispatchEvent(new win.PointerEvent('pointerover',{bubbles:true,cancelable:true,view:win,pointerType:'mouse',clientX:cx,clientY:cy,button:0}));
      el.dispatchEvent(new win.PointerEvent('pointerenter',{bubbles:false,cancelable:false,view:win,pointerType:'mouse',clientX:cx,clientY:cy,button:0}));
    }
  }catch(e){}
  // mousemove（Element Plus menu.mjs 的 handleMouseMove 需要）
  try{ el.dispatchEvent(new win.MouseEvent('mousemove',{bubbles:true,cancelable:true,view:win,clientX:cx,clientY:cy,button:0})); }catch(e){}
}

// ---- el-cascader 级联器（跨文档支持）----
// 原始版本（规则模式）：自动选第一项
function doCascaderSelect(inpEl,lbl,aiPath){
  return new Promise(function(resolve){
    var doc = getOwnerDoc(inpEl);
    var wrapper=inpEl.closest('.el-cascader')||inpEl;
    var trigger=wrapper.querySelector('.el-input__inner,input')||inpEl;

    trigger.focus();
    trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));

    setTimeout(function(){
      trigger.click();
      setTimeout(function(){
        var panel=findCascadePanel(wrapper, doc);
        if(!panel) panel=findCascadePanelGlobal();
        if(!panel){console.log('    级联面板未找到!');resolve('');return;}
        
        // ★ 确认面板有菜单列（防止拿到空面板或已关闭的面板）
        var menuCount = panel.querySelectorAll(CASCADE_MENU_SEL).length;
        if(menuCount === 0){
          console.log('    级联面板为空(0列)，重试打开...');
          // 重试一次：先关闭可能残留的状态，再重新打开
          closeDropdown(doc);
          setTimeout(function(){
            trigger.focus();
            trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
            setTimeout(function(){
              trigger.click();
              setTimeout(function(){
                var panel2=findCascadePanel(wrapper, doc);
                if(!panel2){console.log('    重试后面板仍未找到!');resolve('');return;}
                startCascadeSelection(panel2, aiPath, resolve);
              },450);
            },120);
          },200);
          return;
        }

        startCascadeSelection(panel, aiPath, resolve);
      },450);
    },120)});
}

/**
 * 启动级联选择（统一入口，避免重复代码）
 */
function startCascadeSelection(panel, aiPath, resolve){
  if(aiPath && aiPath.length > 0){
    console.log('    🤖 按AI路径选择: ['+aiPath.join(' / ')+']');
    cascadeRecursiveByPath(panel, 0, aiPath, [], resolve);
  } else {
    console.log('    级联面板OK，开始递归...');
    cascadeRecursive(panel, 0, 10, [], resolve);
  }
}

function findCascadePanel(w, doc){
  doc = doc || getOwnerDoc(w);
  var id=w&&w.getAttribute?w.getAttribute('aria-controls'):'';
  if(id){var e=doc.getElementById(id);if(e&&vis(e))return e;}
  
  var ps=doc.querySelectorAll('.el-cascader-panel,.ant-cascader-panel');
  if(w&&w.getBoundingClientRect){
    var rc=w.getBoundingClientRect(),best=null,minD=Infinity;
    for(var i=0;i<ps.length;i++){if(!vis(ps[i]))continue;var r=ps[i].getBoundingClientRect();var d=Math.abs(r.left-rc.left)+Math.abs(r.top-rc.bottom);if(d<minD){minD=d;best=ps[i];}}
    return best;
  }
  return ps[0]||null;
}

function findCascadePanelGlobal(){
  var allDocs = getAllDocuments();
  for(var d=0;d<allDocs.length;d++){
    var p=allDocs[d].querySelector('.el-cascader-panel,.ant-cascader-panel');
    if(p&&vis(p))return p;
  }
  return null;
}

/** 递归选每一级第一个 */
var CASCADE_MENU_SEL = '.el-cascader-menu,.ant-cascader-menu,.ant-cascader-menu-column,.ant-cascader-menus .ant-cascader-menu';
var CASCADE_NODE_SEL = '.el-cascader-node:not(.is-disabled),.ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled):not(.disabled)';

function cascadeRecursive(panel,level,max,path,done){
  if(level>=max){closeDropdown(getOwnerDoc(panel));done(path.join(' > '));return;}

  var menus=panel.querySelectorAll(CASCADE_MENU_SEL);
  if(!menus||menus.length<=level){closeDropdown(getOwnerDoc(panel));done(path.join(' > ')||'(空)');return;}

  var menu=menus[level];
  var node=menu.querySelector(CASCADE_NODE_SEL);
  if(!node){closeDropdown(getOwnerDoc(panel));done(path.join(' > ')||'(无)');return;}

  // 文本：优先取 label
  var labelEl=node.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
  var txt=((labelEl?labelEl.textContent:node.textContent)||'').trim().slice(0,25);
  path.push(txt);

  // ★ 检测是否多选模式（有 checkbox）
  var isMultiple = !!panel.querySelector('.el-checkbox') || !!node.querySelector('.el-checkbox');
  // ★ 用 aria-haspopup 判断叶子/非叶子
  var isLeaf = node.getAttribute('aria-haspopup') !== 'true';
  if(!node.hasAttribute('aria-haspopup')){
    isLeaf = node.classList.contains('is-leaf') ||
             (!node.querySelector('.el-cascader-node__postfix,.arrow-right') &&
              !node.querySelector('[class*="expand-icon"]'));
  }

  setTimeout(function(){
    console.log('    [级联 L'+level+'] "'+txt+'" '+(isLeaf?'叶子':'非叶子')+(isMultiple?' [多选]':' [单选]')+' [列'+(menus?menus.length:0)+'/'+(level+1)+']');

    if(isMultiple){
      // ★★ 多选模式：需要勾选叶子节点的 checkbox ★★
      if(isLeaf){
        // 多选模式叶子：click checkbox（不是 click node）
        var checkbox = node.querySelector('.el-checkbox');
        if(checkbox){
          // click checkbox 的 input 或 .el-checkbox__inner
          var checkboxInput = checkbox.querySelector('input.el-checkbox__original,input[type=checkbox]') || checkbox;
          checkboxInput.click();
          console.log('    [级联 L'+level+'] "'+txt+'" 多选叶子 checkbox 已 click');

          // ★ 验证是否真的选中了
          setTimeout(function(){
            var isChecked = checkboxInput.checked ||
                           checkbox.classList.contains('is-checked') ||
                           !!checkbox.querySelector('.is-checked');
            if(!isChecked){
              console.log('    [级联 L'+level+'] "'+txt+'" checkbox 未选中，重试 fireFullClick');
              fireFullClick(checkboxInput);
            }
            setTimeout(function(){
              closeDropdown(getOwnerDoc(panel));
              done(path.join(' > '));
            }, 200);
          }, 150);
        } else {
          // 没找到 checkbox，直接 click node
          node.click();
          console.log('    [级联 L'+level+'] "'+txt+'" 多选叶子 node 已 click (fallback)');
          setTimeout(function(){
            closeDropdown(getOwnerDoc(panel));
            done(path.join(' > '));
          }, 300);
        }
      } else {
        // 多选模式非叶子：展开下一级（hover 或 click）
        expandAndRecurse(panel, level, node, max, path, done);
      }
    } else {
      // ★★ 单选模式 ★★
      if(isLeaf){
        // 单选叶子：直接 click node 选中
        node.click();
        console.log('    [级联 L'+level+'] "'+txt+'" 单选叶子已 click 选中');
        setTimeout(function(){
          closeDropdown(getOwnerDoc(panel));
          done(path.join(' > '));
        }, 300);
      } else {
        // 单选非叶子：展开下一级
        expandAndRecurse(panel, level, node, max, path, done);
      }
    }
  }, 120);
}

// 通用：展开非叶子节点并递归（兼容 hover 和 click 模式）
function expandAndRecurse(panel, level, node, max, path, done){
  // ★ 同时 hover + click（hover 模式下 mouseenter 生效，click 模式下 click 生效，互不干扰）
  fireHover(node);
  node.click();
  // 等 Vue nextTick + DOM 更新
  setTimeout(function(){
    if(getNextMenuNodeCount(panel, level) > 0){
      cascadeRecursive(panel, level+1, max, path, done);
    } else {
      // 没展开 → 可能是叶子（aria-haspopup 判断有误），兜底再 click 一次
      console.log('    [级联 L'+level+'] "'+node.textContent.trim().slice(0,20)+'" 未展开，兜底视为叶子');
      node.click();
      setTimeout(function(){
        closeDropdown(getOwnerDoc(panel));
        done(path.join(' > '));
      }, 300);
    }
  }, 300);
}

// 获取下一级 menu 的节点数
function getNextMenuNodeCount(panel, level){
  var menus = panel.querySelectorAll(CASCADE_MENU_SEL);
  if(menus.length <= level + 1) return 0;
  var nextMenu = menus[level + 1];
  if(!nextMenu) return 0;
  return nextMenu.querySelectorAll(CASCADE_NODE_SEL).length;
}

/** ★ 按 AI 给定路径选择（与 cascadeRecursive 相同的 aria-haspopup 策略） */
function cascadeRecursiveByPath(panel, level, aiPath, path, done){
  if(level >= aiPath.length){
    closeDropdown(getOwnerDoc(panel));
    done(path.join(' > '));
    return;
  }

  var wantText = aiPath[level];
  var menus = panel.querySelectorAll(CASCADE_MENU_SEL);
  if(!menus || menus.length <= level){
    console.log('    [AI级联 L'+level+'] 菜单列不足('+(menus?menus.length:0)+'列)');
    closeDropdown(getOwnerDoc(panel));
    done(path.join(' > ') || '(列不够)');
    return;
  }

  var menu = menus[level];
  var allNodes = menu.querySelectorAll(CASCADE_NODE_SEL);
  if(!allNodes || allNodes.length === 0){
    console.log('    [AI级联 L'+level+'] 列 '+level+' 无节点');
    closeDropdown(getOwnerDoc(panel));
    done(path.join(' > ') || '(无节点)');
    return;
  }

  // ★ 在列内找匹配节点
  var matchedNode = null;
  for(var i=0; i<allNodes.length; i++){
    var n = allNodes[i];
    var labelEl = n.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
    var txt = ((labelEl?labelEl.textContent:n.textContent)||'').trim();

    if(txt === wantText ||
       txt.indexOf(wantText) >= 0 ||
       wantText.indexOf(txt) >= 0 ||
       txt.replace(/[@#（(][^)）]*[)）]?/g,'').trim() === wantText ||
       wantText.replace(/[@#（(][^)）]*[)）]?/g,'').trim() === txt ||
       txt.replace(/[省市区县旗栋楼层单元室号]/g,'') === wantText.replace(/[省市区县旗栋楼层单元室号]/g,'')){
      matchedNode = n;
      break;
    }
  }

  // 找不到 → 兜底选第一个
  if(!matchedNode){
    console.log('    [AI级联 L'+level+'] 未匹配"'+wantText+'"，兜底选第一项');
    matchedNode = allNodes[0];
  }

  var labelEl = matchedNode.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
  var matchedTxt = ((labelEl?labelEl.textContent:matchedNode.textContent)||'').trim();
  path.push(matchedTxt);

  // ★ 检测是否多选模式
  var isMultiple = !!panel.querySelector('.el-checkbox') || !!matchedNode.querySelector('.el-checkbox');
  // ★ 用 aria-haspopup 判断叶子/非叶子
  var isLeaf = matchedNode.getAttribute('aria-haspopup') !== 'true';
  if(!matchedNode.hasAttribute('aria-haspopup')){
    isLeaf = matchedNode.classList.contains('is-leaf') ||
             (!matchedNode.querySelector('.el-cascader-node__postfix,.arrow-right') &&
              !matchedNode.querySelector('[class*="expand-icon"]'));
  }

  setTimeout(function(){
    console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" '+(isLeaf?'叶子':'非叶子')+(isMultiple?' [多选]':' [单选]')+' [列'+(menus?menus.length:0)+'/'+(level+1)+']');

    if(isMultiple){
      if(isLeaf){
        // 多选叶子：click checkbox（带验证和重试）
        var checkbox = matchedNode.querySelector('.el-checkbox');
        if(checkbox){
          var checkboxInput = checkbox.querySelector('input.el-checkbox__original,input[type=checkbox]') || checkbox;
          checkboxInput.click();
          console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" 多选叶子 checkbox 已 click');

          // ★ 验证是否真的选中了
          setTimeout(function(){
            var isChecked = checkboxInput.checked ||
                           checkbox.classList.contains('is-checked') ||
                           !!checkbox.querySelector('.is-checked');
            if(!isChecked){
              console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" checkbox 未选中，重试 fireFullClick');
              fireFullClick(checkboxInput);
            }
            setTimeout(function(){
              closeDropdown(getOwnerDoc(panel));
              done(path.join(' > '));
            }, 200);
          }, 150);
        } else {
          matchedNode.click();
          console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" 多选叶子 node click (fallback)');
          setTimeout(function(){
            closeDropdown(getOwnerDoc(panel));
            done(path.join(' > '));
          }, 300);
        }
      } else {
        // 多选非叶子：同时 hover + click 展开
        fireHover(matchedNode);
        matchedNode.click();
        setTimeout(function(){
          if(getNextMenuNodeCount(panel, level) > 0){
            cascadeRecursiveByPath(panel, level+1, aiPath, path, done);
          } else {
            matchedNode.click();
            setTimeout(function(){ closeDropdown(getOwnerDoc(panel)); done(path.join(' > ')); }, 300);
          }
        }, 300);
      }
    } else {
      // 单选模式
      if(isLeaf){
        matchedNode.click();
        console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" 单选叶子已 click 选中');
        setTimeout(function(){
          closeDropdown(getOwnerDoc(panel));
          done(path.join(' > '));
        }, 300);
      } else {
        // 单选非叶子：同时 hover + click 展开
        fireHover(matchedNode);
        matchedNode.click();
        setTimeout(function(){
          if(getNextMenuNodeCount(panel, level) > 0){
            cascadeRecursiveByPath(panel, level+1, aiPath, path, done);
          } else {
            console.log('    [AI级联 L'+level+'] "'+matchedTxt+'" 未展开，兜底视为叶子');
            matchedNode.click();
            setTimeout(function(){ closeDropdown(getOwnerDoc(panel)); done(path.join(' > ')); }, 300);
          }
        }, 300);
      }
    }
  }, 120);
}

/**
 * 等待下一级菜单出现真实节点 / 面板已关闭（"观察式"叶子判定）
 * 解决 Element Plus 在 5 级级联中"点中非叶子节点但被误判为叶子"的 bug
 *
 * @param {Element} panel - el-cascader-panel 元素
 * @param {number} level - 当前节点所在的级（0-based）
 * @param {Element} clickedNode - 刚刚点击的节点元素
 * @param {function} cb - 回调，参数: 'hasNext' | 'leaf' | 'timeout'
 *
 * 判定逻辑（轮询最多 ~5s）：
 *  1) panel 已不可见/已从 DOM 移除 → 面板关闭 → 'leaf'
 *  2) 当前节点变为激活状态(in-active-path / is-active) 且 面板还在 → 说明是叶子被选中 → 'leaf'
 *  3) 下一级 menu(>=level+1) 出现新节点(数量 > 0) → 'hasNext'
 *  4) 轮询超时 → 'timeout' (兜底视为叶子)
 */
function waitForCascadeColumnOrClose(panel, level, clickedNode, cb){
  var attempts = 0;
  var maxAttempts = 25;   // 25 * 200ms = 5s
  var interval = 200;
  (function check(){
    attempts++;
    // 1) 面板已关闭/移除 → 叶子
    if(!panel || !panel.isConnected || !vis(panel)){
      cb('leaf'); return;
    }
    // 2) 找到当前 level+1 列 menu
    var menus = panel.querySelectorAll(CASCADE_MENU_SEL);
    if(menus.length > level + 1){
      var nextMenu = menus[level + 1];
      if(nextMenu){
        var nodes = nextMenu.querySelectorAll(CASCADE_NODE_SEL);
        if(nodes && nodes.length > 0){
          // 下一级有真实可点击节点 → 确认是非叶子（递归）
          cb('hasNext'); return;
        }
      }
    }
    // 3) 检查当前节点是否已被标记为"激活"（叶子被选中时会有 in-active-path）
    if(clickedNode && (clickedNode.classList.contains('in-active-path') ||
                       clickedNode.classList.contains('is-active') ||
                       clickedNode.classList.contains('is-selected'))){
      cb('leaf'); return;
    }
    // 4) 轮询超时
    if(attempts >= maxAttempts){
      cb('timeout'); return;
    }
    setTimeout(check, interval);
  })();
}

// 保留旧的 waitForCascadeColumn 以防其他地方还在用（虽然现在没人调用了）
function waitForCascadeColumn(panel,expectedLevel,cb){
  var attempts=0, maxAttempts=12, interval=180;
  (function check(){
    var menus=panel.querySelectorAll(CASCADE_MENU_SEL);
    if(menus.length>expectedLevel){
      var newMenu=menus[expectedLevel];
      if(newMenu && newMenu.querySelector(CASCADE_NODE_SEL)){ cb(true); return; }
    }
    if(++attempts>=maxAttempts){ cb(false); return; }
    setTimeout(check,interval);
  })();
}

function selectFirstNative(el){
  if(el.options){for(var i=0;i<el.options.length;i++){if(el.options[i].value){el.selectedIndex=i;el.dispatchEvent(new Event('change',{bubbles:true}));return;}}if(el.options.length>0)el.selectedIndex=0;}
}

// 给 el-input-number / type=number 生成一个落在 min/max 区间内的随机数
// fieldLabel 可选，外部已经拿到的 label（含表格行号）直接传入，避免重复查找
function numericInRange(el, fieldLabel){
  function read(name){
    var v = el.getAttribute(name);
    if(v===null||v==='') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  var min = read('min'); if(min===null) min = read('aria-valuemin');
  var max = read('max'); if(max===null) max = read('aria-valuemax');
  if(min===null) min = 1;
  if(max===null) max = 99;
  if(max < min) max = min + 99;
  var step = read('step'); if(step===null) step = 1;

  // 拿 label：优先外部传入（包含表格列头+行号），否则尝试就近 form-item
  var lbl = fieldLabel || '';
  if(!lbl){
    var fi = el.closest && el.closest('.el-form-item,.ant-form-item');
    if(fi){
      var fl = fi.querySelector('.el-form-item__label,.ant-form-item-label');
      if(fl) lbl = fl.textContent || '';
    }
  }

  // 按 label 语义决定合理范围（防止业务校验把太小/无小数的值丢回空）
  var forceDecimal = false;
  if(/率|比例|percent|rate/i.test(lbl)){
    // 百分比：1-99 整数
    if(max > 99) max = 99;
    if(min < 1) min = 1;
  } else if(/面积|金额|价格|费用|总价|单价|量|amount|area|price|count|quantity/i.test(lbl)){
    // 面积/金额/数量类：大数 + 必带 2 位小数，过业务校验更稳
    if(max < 1000 || max > 99999) max = 9999;
    if(min < 100) min = 100;
    forceDecimal = true;
  }

  var n = Math.random() * (max - min) + min;
  if(forceDecimal || (step < 1 && step > 0)){
    return Number(n.toFixed(2));
  }
  return Math.floor(n);
}

// ---- Radio Group：选第一项 ----
var RADIO_ITEM_SEL = [
  '.el-radio:not(.is-disabled)',
  '.el-radio-button:not(.is-disabled)',
  '.ant-radio-wrapper:not(.ant-radio-wrapper-disabled)',
  '.ant-radio-button-wrapper:not(.ant-radio-button-wrapper-disabled)',
  'label[role="radio"]'
].join(',');

function isRadioGroupSelected(group){
  if(!group) return false;
  if(group.querySelector('.el-radio.is-checked,.el-radio-button.is-active,.is-checked')) return true;
  if(group.querySelector('.ant-radio-wrapper-checked,.ant-radio-button-wrapper-checked')) return true;
  var radios = group.querySelectorAll('input[type="radio"]');
  for(var i=0;i<radios.length;i++){ if(radios[i].checked) return true; }
  return false;
}

function getCheckedRadioLabel(group){
  var checked = group.querySelector(
    '.el-radio.is-checked,.el-radio-button.is-active,'+
    '.ant-radio-wrapper-checked,.ant-radio-button-wrapper-checked'
  );
  if(checked){
    var lbl = checked.querySelector('.el-radio__label,.ant-radio-wrapper>span:last-child,.ant-radio-button-wrapper>span:last-child');
    return ((lbl?lbl.textContent:checked.textContent)||'').trim().slice(0,30);
  }
  // 原生 radio
  var radios = group.querySelectorAll('input[type="radio"]');
  for(var i=0;i<radios.length;i++){
    if(radios[i].checked){
      var lab = radios[i].closest('label');
      return ((lab?lab.textContent:radios[i].value)||'').trim().slice(0,30);
    }
  }
  return '';
}

function doRadioFirst(group, lbl){
  return new Promise(function(resolve){
    var target = group.querySelector(RADIO_ITEM_SEL);
    if(!target){
      // 兜底：原生 radio
      var radios = group.querySelectorAll('input[type="radio"]:not(:disabled)');
      target = radios[0];
    }
    if(!target){
      console.log('  >> '+lbl+' (radio) 未找到可点选项');
      resolve('');
      return;
    }
    var labelEl = target.querySelector('.el-radio__label,.ant-radio-wrapper>span:last-child,.ant-radio-button-wrapper>span:last-child');
    var txt = ((labelEl?labelEl.textContent:target.textContent)||'').trim().slice(0,30);
    fireFullClick(target);
    console.log('  >> '+lbl+' (radio) -> "'+txt+'"');
    setTimeout(function(){ resolve(txt); }, 200);
  });
}

// ============================================================
//  ★★★ 日期选择器：通过 Vue emit 更新 modelValue ★★★
// ============================================================

/**
 * 通过 Vue 组件 emit('update:modelValue', val) 直接设置日期选择器的值。
 * 比面板交互更可靠：不需要碰 readonly input，不需要找面板样式类名，
 * 兼容所有 Element Plus / Ant Design 版本。
 * ★ v3.8.10: 同时触发 onChange 事件以保证表单验证、change 监听能感知到
 */
function syncDatePickerModel(el, val){
  var wrapper = el.closest('.el-date-editor,.el-date-picker,.el-time-picker,.ant-picker,[class*="el-date-editor"],[class*="ant-picker"]') || el;
  var comp = wrapper.__vueParentComponent;
  var depth = 0;
  while(comp && depth < 20){
    depth++;
    if(comp.props && ('modelValue' in comp.props || 'model-value' in comp.props)){
      try{
        if(typeof comp.emit === 'function'){
          // ★ daterange 必须是数组 [start, end]
          // ★ Element Plus 内部会立即响应数组 emit 到第一个 input
          //   第二个 input（结束时间）需要额外同步：直接修改 DOM + 派发 input 事件
          comp.emit('update:modelValue', val);
          
          // ★ 同时触发 onChange 事件（v-model 形式）
          if(typeof comp.emit === 'function'){
            try{ comp.emit('change', val); }catch(e){}
          }
          
          // ★ 同步两个 input 的 DOM 显示（Element Plus daterange 显示在两个 input 中）
          if(Array.isArray(val) && val.length === 2){
            try{
              var inputs = wrapper.querySelectorAll('input');
              // 第一个 input 写开始时间，第二个写结束时间
              if(inputs.length >= 2){
                var startInput = inputs[0];
                var endInput = inputs[inputs.length - 1];
                setInputValue(startInput, val[0]);
                setInputValue(endInput, val[1]);
                console.log('    [date-range] 同步 input DOM: '+val[0]+' ~ '+val[1]);
              }
            }catch(e){}
          }else if(typeof val === 'string'){
            // 单日期：同步单个 input
            try{
              var inp = wrapper.querySelector('input');
              if(inp) setInputValue(inp, val);
            }catch(e){}
          }
          
          return true;
        }
      }catch(e){}
      return false;
    }
    comp = comp.parent;
  }
  return false;
}

// ============================================================
//  字段扫描（v9: 遍历主文档 + 所有同源iframe）
// ============================================================

function scanFields(){
  var fields=[],seen={};
  var docs = getAllDocuments();

  for(var di=0;di<docs.length;di++){
    var currentDoc = docs[di];
    var isIframe = currentDoc !== document;

    try {
      var all=currentDoc.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select'
      );
      console.log('[scanFields] doc#'+di+' 找到 '+all.length+' 个 input/textarea/select');
      
      for(var i=0;i<all.length;i++){
        var el=all[i];
        if(!isVisible(el)) {
          try{
            var visInfo = '';
            try{ visInfo = 'display='+getComputedStyle(el).display+' vis='+getComputedStyle(el).visibility+' op='+getComputedStyle(el).opacity+' w='+el.offsetWidth+' h='+el.offsetHeight; }catch(e){}
            var lbl0 = getLabel(el);
            console.log('[scanFields] 跳过 不可见: type='+(el.type||el.tagName)+' label="'+lbl0+'" placeholder="'+el.placeholder+'" '+visInfo);
          }catch(e){}
          continue;
        }
        // 注意：
        // - readOnly 不过滤：el-select / el-cascader 非 filterable 模式下 input 是 readonly，它就是触发器
        // - disabled 也不过滤：有联动关系的字段，前面字段填完后会从 disabled 解除（如「审核流程」依赖「合同类型」）
        //   在多轮填充中，本轮 disabled 的会跳过本轮，下一轮自动重试
        if(isNonForm(el)) {
          // ★ DEBUG: 记录被过滤的字段和原因
          try{
            var lbl = getLabel(el);
            var t = getType(el);
            console.log('[scanFields] 跳过 非表单: type='+t+' label="'+lbl+'" placeholder="'+el.placeholder+'" path='+getPath(el));
          }catch(e){}
          continue;
        }

        var key='doc'+di+'_'+el.tagName+'_'+(el.name||el.id||el.placeholder||i)+'_'+getPath(el);
        if(seen[key]) continue;
        seen[key]=true;

        fields.push({
          element:el,
          label:getLabel(el),
          placeholder:el.placeholder||'',
          type:getType(el),
          disabled:!!el.disabled,
          doc:currentDoc,
          iframe:isIframe
        });
      }

      // 额外扫描 radio-group（input[type=radio] 在上面被排除了，这里按组识别）
      var radioGroups = currentDoc.querySelectorAll(
        '.el-radio-group,.ant-radio-group,[role="radiogroup"]'
      );
      for(var ri=0; ri<radioGroups.length; ri++){
        var rg = radioGroups[ri];
        if(!isVisible(rg)) continue;
        var rgKey = 'doc'+di+'_radiogroup_'+ri+'_'+getPath(rg);
        if(seen[rgKey]) continue;
        seen[rgKey] = true;
        fields.push({
          element: rg,
          label: getLabel(rg),
          placeholder: '',
          type: 'radio-group',
          disabled: rg.classList.contains('is-disabled') || rg.classList.contains('ant-radio-group-disabled'),
          doc: currentDoc,
          iframe: isIframe
        });
      }

      // 兜底扫描：常见 Element/Ant 表单容器本身
      // 用途：Element Plus 2.4+ 的 .el-select__input / 表格里的 .el-input-number 在某些版本/场景下
      //      因尺寸/visibility 等原因被 input 那一遍漏掉。容器永远在 DOM 里、有尺寸，作为字段元素兜底
      var wrapperFallback = currentDoc.querySelectorAll(
        '.el-select,.el-cascader,.ant-select,.ant-cascader,'+
        '.el-input-number,.ant-input-number,'+
        '.el-date-editor,.el-time-picker,.el-date-picker,.ant-picker,.ant-date-picker'
      );
      // ★ DEBUG: 输出找到的 wrapper 数
      console.log('[scanFields] wrapperFallback 找到', wrapperFallback.length, '个候选 wrapper');
      for(var wi=0; wi<wrapperFallback.length; wi++){
        var wrp = wrapperFallback[wi];
        // 排除 dropdown / panel / 内部嵌套（仅取根级触发器容器）
        var excludedBy = '';
        if(wrp.closest('.el-select-dropdown')) excludedBy = 'dropdown';
        else if(wrp.closest('.el-cascader-panel')) excludedBy = 'cascader-panel';
        else if(wrp.closest('.el-cascader-menu')) excludedBy = 'cascader-menu';
        else if(wrp.closest('.ant-select-dropdown')) excludedBy = 'ant-dropdown';
        else if(wrp.closest('.ant-cascader-menus')) excludedBy = 'ant-cascader-menus';
        else if(wrp.closest('.el-picker-panel')) excludedBy = 'picker-panel';
        else if(wrp.closest('.el-date-picker__time-header')) excludedBy = 'date-time-header';
        else if(wrp.closest('.ant-picker-dropdown')) excludedBy = 'ant-picker-dropdown';
        else if(wrp.closest('.el-popper')) excludedBy = 'el-popper';
        if(excludedBy){
          console.log('[scanFields] 跳过 wrapper 类名='+wrp.className.slice(0,40)+' 原因='+excludedBy);
          continue;
        }
        try{ if(!isVisible(wrp)) { console.log('[scanFields] 跳过 不可见: '+wrp.className.slice(0,40)); continue; } }catch(e){}
        if(isNonForm(wrp)) continue;
        // 如果该容器内已有 input 被识别成 field，跳过（避免重复）
        var already = false;
        for(var ai=0; ai<fields.length; ai++){
          if(wrp.contains(fields[ai].element)){ already = true; break; }
        }
        if(already) continue;

        var wKey = 'doc'+di+'_wrap_'+wi+'_'+getPath(wrp);
        if(seen[wKey]) continue;
        seen[wKey] = true;

        var wType;
        if(wrp.classList.contains('el-input-number') || wrp.classList.contains('ant-input-number')){
          wType = 'number';
        } else if(wrp.classList.contains('el-cascader') || wrp.classList.contains('ant-cascader')){
          wType = wrp.classList.contains('ant-cascader') ? 'ant-cascader' : 'el-cascader';
        } else if(wrp.classList.contains('el-date-editor') || wrp.classList.contains('el-date-picker') || wrp.classList.contains('el-time-picker') || wrp.classList.contains('ant-picker') || wrp.classList.contains('ant-date-picker')){
          wType = 'date-picker';
        } else {
          wType = wrp.classList.contains('ant-select') ? 'ant-select' : 'el-select';
        }

        // 在容器里找一个 input 当真正的填值目标
        var innerInput = wrp.querySelector('input');
        fields.push({
          element: innerInput || wrp,           // 优先 input 给后续 handler 用；都没有就用容器
          label: getLabel(innerInput || wrp),
          placeholder: (innerInput && innerInput.placeholder) || '',
          type: wType,
          disabled: wrp.classList.contains('is-disabled') || (innerInput && innerInput.disabled) || false,
          doc: currentDoc,
          iframe: isIframe
        });
      }
    } catch(err) {
      console.warn('[v9] 扫描文档 #' + di + ' 出错:', err.message);
    }
  }

  fields.sort(function(a,b){
    var ra=a.element.getBoundingClientRect(),rb=b.element.getBoundingClientRect();
    return Math.abs(ra.top-rb.top)<20?ra.left-rb.left:ra.top-rb.top;
  });

  if(docs.length > 1){
    console.log('[v9] 扫描完成: ' + docs.length + '个文档(主+' + (docs.length-1) + '个iframe), ' + fields.length + '个字段');
  }
  return fields;
}

function isVisible(el){
  // 自身 display/visibility 检查
  try{
    var s=getComputedStyle(el);
    if(s.display==='none'||s.visibility==='hidden')return false;
  }catch(e){}

  // Element Plus 2.4+ 关键修复：
  // .el-select__input / .el-cascader 内的 input 在非 filterable 模式下尺寸是 0×0
  // （值由 .el-select__placeholder 显示）—— 此时按 wrapper 的可见性判断
  var wrap = el.closest && el.closest(
    '.el-select,.el-cascader,.el-date-editor,.el-time-picker,'+
    '[class*="el-select"],[class*="el-cascader"]'
  );
  if(wrap && (el.offsetWidth===0 || el.offsetHeight===0)){
    if(wrap.offsetWidth===0 && wrap.offsetHeight===0) return false;
    try{
      var ws=getComputedStyle(wrap);
      if(ws.display==='none'||ws.visibility==='hidden'||ws.opacity==='0') return false;
      var pw=wrap.parentElement;
      for(var k=0;k<5&&pw;k++){
        var pws=getComputedStyle(pw);
        if(pws.display==='none'||pws.visibility==='hidden') return false;
        pw=pw.parentElement;
      }
    }catch(e){}
    return true;
  }

  // 普通 input/textarea：按自身尺寸+祖先链判断
  if((el.offsetWidth===0&&el.offsetHeight===0)&&(el.tagName!=='TEXTAREA'||(el.clientWidth===0&&el.clientHeight===0)))return false;
  try{
    var s2=getComputedStyle(el);
    if(s2.opacity==='0')return false;
    var p=el.parentElement;
    for(var j=0;j<3&&p;j++){
      var ps=getComputedStyle(p);
      if(ps.display==='none'||ps.visibility==='hidden'||ps.opacity==='0')return false;
      p=p.parentElement;
    }
  }catch(e){}
  return true;
}

function isNonForm(el){
  // ★ v3.9.1 重写：更精确的"非表单"判定
  // 目标：
  //   1) 顶部导航/页脚/搜索栏/筛选条永远排除
  //   2) 弹窗存在时：只填弹窗内的字段（避免污染外部列表/筛选区）
  //   3) 兼容 Element Plus / Element UI 1.x/2.x / Ant Design
  //   4) 兼容多种弹窗结构（Teleport 到 body 下也算）

  // (1) 顶部导航/页脚/搜索栏：直接排除（即使在弹窗内）
  var sa=el.closest('header,nav,footer,[role="search"],.search-bar,.navbar,.filter-bar,.query-bar,.toolbar');
  if(sa) {
    // ★ 例外：弹窗内的 header（如 dialog__header）应该被识别
    if(el.closest('.el-dialog,.el-dialog__wrapper,.el-drawer,.el-drawer__wrapper,.ant-modal,.ant-modal-wrap,[role="dialog"]')) {
      // 弹窗内的 header 不算非表单
    } else {
      return true;
    }
  }

  // (2) class 名含 search/filter/query：判定为筛选区（除非在弹窗内）
  var pc=el.closest('[class]');
  if(pc){
    var cn=String(pc.className||'');
    if(/search|query|filter|global|topbar|navbar|header-bar/.test(cn) && !pc.closest('.el-dialog,.el-drawer,.ant-modal,[role="dialog"],.ant-drawer')){
      return true;
    }
  }

  // (3) 弹窗存在判定
  var ownerDoc = getOwnerDoc(el);
  var hasDlg = !!ownerDoc.querySelector(
    '.el-dialog__wrapper:not([style*="display: none"]),' +
    '.el-dialog,.el-drawer,' +
    '.ant-modal-wrap:not(.ant-modal-wrap-hidden),' +
    '.ant-drawer-wrap,' +
    '[role="dialog"]:not([aria-hidden="true"])'
  );

  if(hasDlg){
    // 元素是否在弹窗容器内
    var inDlg = el.closest(
      '.el-dialog,.el-dialog__wrapper,.el-dialog__body,' +
      '.el-drawer,.el-drawer__wrapper,.el-drawer__body,' +
      '.ant-modal,.ant-modal-wrap,.ant-modal-content,.ant-modal-body,' +
      '.ant-drawer,.ant-drawer-wrap,.ant-drawer-content,.ant-drawer-body,' +
      '[role="dialog"]'
    );
    if(!inDlg) {
      // 兜底：检查 .el-overlay 容器（Element Plus 弹窗常用 wrapper）
      if(!el.closest('.el-overlay,.el-overlay-dialog')) {
        return true; // 弹窗外，过滤掉
      }
    }
  }
  return false;
}

function getPath(el){var p='';for(var i=0;i<3&&el;i++){p+='/'+(String(el.className||'').slice(0,20));el=el.parentElement;}return p;}

function getType(el){
  if(el.tagName==='SELECT')return'select';
  if(el.tagName==='TEXTAREA')return'textarea';
  // 标准类名
  if(el.closest('.el-cascader'))return'el-cascader';
  if(el.closest('.el-select'))return'el-select';
  if(el.closest('.ant-cascader'))return'ant-cascader';
  if(el.closest('.ant-select'))return'ant-select';
  // 日期/时间选择器
  if(el.closest('.el-date-editor')||el.closest('.el-time-picker')||el.closest('.el-date-picker'))return'date-picker';
  if(el.closest('.ant-date-picker')||el.closest('.ant-picker')||el.closest('.ant-range-picker'))return'date-picker';
  // Element Plus 2.4+ 命名空间变体：el-select__wrapper / el-cascader__dropdown 等
  // 只匹配 el- 前缀的命名，不会误伤普通带 select/cascader 字样的项目类
  if(el.closest('[class*="el-cascader"]'))return'el-cascader';
  if(el.closest('[class*="el-select"]'))return'el-select';
  if(el.closest('[class*="el-date-editor"]')||el.closest('[class*="el-date-picker"]')||el.closest('[class*="el-time-picker"]'))return'date-picker';
  return el.type||'text';
}

function getLabel(el){
  var fi=el.closest('.el-form-item');
  if(fi){var fl=fi.querySelector('.el-form-item__label');if(fl)return clean(fl.textContent);}
  var afi=el.closest('.ant-form-item');
  if(afi){var afl=afi.querySelector('.ant-form-item-label,.ant-form-item-required');if(afl)return clean(afl.textContent);}

  // 表格单元格：用「列头 + 行号」做 label，例如 "去化面积1" / "计划去化率2"
  var tableLabel = getTableCellLabel(el);
  if(tableLabel) return tableLabel;

  if(el.id){
    var ownerDoc = getOwnerDoc(el);
    var lb=ownerDoc.querySelector('label[for="'+el.id+'"]');
    if(lb)return clean(lb.textContent);
  }
  return el.placeholder||'';
}

function getTableCellLabel(el){
  // 输入框所在的 td（兼容真实 <td> + Element Plus 的 el-table 单元格 + el-table-v2 div 结构）
  var td = el.closest && el.closest('td,.el-table__cell,[role="cell"]');
  if(!td) return '';
  var tr = td.closest('tr,[role="row"]');
  if(!tr) return '';

  // 同 tr 里 td 的索引
  var siblings = Array.prototype.filter.call(tr.children, function(c){
    return c.tagName==='TD' || c.tagName==='TH' || (c.getAttribute && c.getAttribute('role')==='cell');
  });
  var colIdx = siblings.indexOf(td);
  if(colIdx < 0) return '';

  // 关键：Element Plus el-table 把 header 和 body 拆成两个独立的 <table>。
  // td.closest('table') 拿到的是 body 表，里面没有 thead → 取不到列头。
  // 必须从 .el-table 整体往上找，跨两张 table 定位 header
  var elTable = td.closest('.el-table,.el-table-v2');
  var bodyTable = td.closest('table');

  var header = '';

  // 1) Element Plus 标准 el-table（双 table 结构）
  if(elTable){
    var headerTable = elTable.querySelector('.el-table__header,.el-table__header-wrapper table,.el-table-v2__header');
    if(headerTable){
      var headerCells = headerTable.querySelectorAll('th,.el-table-v2__header-cell,[role="columnheader"]');
      if(headerCells[colIdx]){
        var c1 = headerCells[colIdx].querySelector('.cell,.el-table__column-header__label,span');
        header = clean((c1?c1.textContent:headerCells[colIdx].textContent)||'');
      }
    }
  }

  // 2) 兜底：普通 <table>，thead 和 tbody 在同一张表里
  if(!header && bodyTable){
    var thead = bodyTable.querySelector('thead');
    if(thead){
      var ths = thead.querySelectorAll('th');
      if(ths[colIdx]){
        var c2 = ths[colIdx].querySelector('.cell,span');
        header = clean((c2?c2.textContent:ths[colIdx].textContent)||'');
      }
    }
  }

  if(!header) return '';

  // 行号：优先从 el-table 体里数，否则 fallback 到当前 table 的 tbody
  var rowsContainer = elTable
    ? elTable.querySelector('.el-table__body tbody,.el-table__body-wrapper tbody,.el-table-v2__body')
    : (bodyTable ? bodyTable.querySelector('tbody') : null);
  var rowIdx = 0;
  if(rowsContainer){
    var rows = rowsContainer.querySelectorAll('tr,[role="row"]');
    rowIdx = Array.prototype.indexOf.call(rows, tr) + 1;
  }
  return rowIdx > 0 ? (header + rowIdx) : header;
}
function clean(t){return t?t.replace(/[*:\uFF1A\n\r]/g,'').trim():'';}

// ============================================================
//  值设置
// ============================================================

function setInputValue(el,val){
  el.focus();
  var setter=null;
  if(el.tagName==='TEXTAREA'||el.tagName==='textarea'){
    try{setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;}catch(e){}
  }else{
    try{setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){}
  }
  if(setter)setter.call(el,val);else el.value=val;

  var proto=(el.tagName==='TEXTAREA'||el.tagName==='textarea')?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  var nativeSet=Object.getOwnPropertyDescriptor(proto,'value')&&Object.getOwnPropertyDescriptor(proto,'value').set;
  if(nativeSet)nativeSet.call(el,val);

  // 用 InputEvent 而不是 Event，带 data + inputType，更接近真实用户输入
  // 一些 Vue 3 组件（el-input-number 在严格模式下）会通过 event.data 来判断是不是真输入
  try{
    el.dispatchEvent(new InputEvent('input',{data: String(val), bubbles: true, cancelable: true, inputType: 'insertText'}));
  }catch(e){
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
  el.dispatchEvent(new Event('blur',{bubbles:true}));

  if(el.tagName==='TEXTAREA'||el.tagName==='textarea'){
    var inner=el.closest('.el-textarea');
    if(inner&&inner.querySelector('.el-textarea__inner')) inner.querySelector('.el-textarea__inner').value=val;
  }
}

// ============================================================
//  智能值生成
// ============================================================

// ★ 日期值生成：根据 label 智能返回年份/年月/完整日期
function genDateValue(label, el){
  var L = (label||'').toLowerCase();
  var now = new Date();
  var start = now.toISOString().slice(0,10);
  // ★ v3.8.10: 检测是否是日期范围（daterange/datetimerange/timerange/monthrange/yearrange）
  if(el){
    try{
      var wrap = el.closest && el.closest('.el-date-editor,.el-range-editor,.ant-range-picker');
      if(wrap){
        // 容器有 .el-range-editor 或有两个 input 且有开始/结束 placeholder
        var isRange = wrap.classList.contains('el-range-editor') ||
                      wrap.classList.contains('el-range-editor--default') ||
                      !!wrap.querySelector('.el-range-input') ||
                      (wrap.querySelectorAll('input').length >= 2 &&
                       (function(){
                         var ins = wrap.querySelectorAll('input');
                         for(var i=0;i<ins.length;i++){
                           var p = (ins[i].placeholder||'');
                           if(/开始|起始|起|start|from/.test(p)) return true;
                         }
                         return false;
                       })()) ||
                      (wrap.className||'').indexOf('range') >= 0;
        if(isRange){
          // 范围类型：返回 [开始日期, 结束日期] 数组
          var end = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
          var endStr = end.toISOString().slice(0,10);
          console.log('    [date] 检测到范围组件 → ['+start+', '+endStr+']');
          return [start, endStr];
        }
      }
    }catch(e){}
  }
  // 纯年份（年出现在末尾或带"年份"且无月日）：预计达产年份、建档年份、统计年
  if((/\u5e74$/.test(L) || /\u5e74\u4efd/.test(L)) && !/\u6708|\u65e5/.test(L)){
    return String(now.getFullYear());
  }
  // 年+月：统计年月、达产年月、签约年月
  if(/\u5e74\u6708/.test(L)){
    return now.toISOString().slice(0,7);
  }
  // 默认完整日期
  return start;
}

function genValue(label,idx){
  var L=(label||'').toLowerCase();
  var now=new Date();
  var td=''+now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
  var rnd=function(n){return String(Math.floor(Math.random()*Math.pow(10,n))).padStart(n,'0');};
  var r4=function(){return String(Math.floor(Math.random()*9000)+1000);};

  if(/合同名|合同名称|contract.?name/.test(L))return'\u6d4b\u8bd5\u5408\u540c_'+td+'_'+r4();
  if(/\u8ba2\u5355|order|\u5355\u53f7/.test(L)) return 'ORD-'+Date.now().toString(36).toUpperCase();
  if(/(\u516c\u53f8|\u4f01\u4e1a|\u5355\u4f4d|\u7532\u65b9|\u4e59\u65b9\u\u4f9b\u5546|\u5ba2\u6237)/.test(L)&&!/(\u7c7b\u578b|\u8054\u7cfb|\u7535\u8bdd|\u624b\u673a)$/.test(L))
    return['\u5317\u4eac\u79d1\u6280\u6709\u9650\u516c\u53f8','\u4e0a\u6d77\u6d4b\u8bd5\u6709\u9650\u516c\u53f8','\u6df1\u5733\u521b\u65b0\u79d1\u6280','\u5e7f\u5dde\u4fe1\u606f\u516c\u53f8'][idx%4]+r4();
  if(/\u5ba2\u6237.*\u540d\u79f0|customer.*name/.test(L)) return '\u6d4b\u8bd5\u5ba2\u6237'+r4()+'\u6709\u9650\u516c\u53f8';
  if(/\u6cd5\u5b9a\u4ee3\u8868|legal|\u8d1f\u8d4b\u4eba/.test(L)) return ['\u5f20\u4e09','\u674e\u56db','\u738b\u4e94','\u8d66\u516d'][idx%4];
  if(/\u8054\u7cfb\u4eba|contact/.test(L)&&!/(\u65b9\u5f0f|\u7535\u8bdd|\u624b\u673a|\u90ae\u7bb1)/.test(L))
    return ['\u5f20\u4e09','\u674e\u56db','\u738b\u4e94','\u8d66\u516d','\u94b1\u4e03'][idx%5];
  if(/\u8bc1\u4ef6\u7c7b\u578b|card.*type/.test(L)) return '';
  if(/\u8bc1\u4ef6\u53f7|idcard|credit|\u7edf\u4e00\u4fe1\u7528|\u7a0e\u53f7/.test(L)) return '91'+rnd(8)+'X';
  if(/(\u7535\u8bdd|tel|phone|\u624b\u673a|\u8054\u7cfb\u65b9\u5f0f)/.test(L)&&!/\u8054\u7cfb\u4eba/.test(L.replace(/\u8054\u7cfb\u4eba/g,'')))
    return ['138','139','150','151','186','187','188'][idx%7]+rnd(8);
  if(/(\u90ae\u7bb1|email|mail)/.test(L)) return 'test'+r4()+'@example.com';
  if(/(\u5730\u5740|address)/.test(L))
    return ['\u5317\u4eac\u5e02\u6d77\u6dc0\u533a\u4e2d\u5173\u6751\u5927\u88571\u53f7','\u4e0a\u6d77\u5e02\u6d6e\u4e1c\u65b0\u533a\u4e16\u7eaa\u5927\u9053100\u53f7','\u5e7f\u5dde\u5e02\u5929\u6cb3\u533a\u73e0\u6c5f\u65b0\u57ce','\u6df1\u5733\u5e02\u5357\u5c71\u533a\u79d1\u6280\u56ed路1\u53f7'][idx%4]+'A\u5ea7'+r4()+'\u5ba4';
  if(/\u94f6\u884c\u8d26\u53f7|bank.*account|\u8d26\u53f7/.test(L)) return ['6222','6225','6217'][idx%3]+rnd(13);
  if(/(\u5f00\u6237\u884c|bank.*name|\u652f\u884c)/.test(L))
    return ['\u4e2d\u56fd\u5de5\u5546\u94f6\u884c\u5317\u4eac\u6d77\u6dc0\u652f\u884c','\u4e2d\u5efa\u94f6\u884c\u4e0a\u6d77\u5206\u884c','\u519c\u4e1a\u94f6\u884c\u5e7f\u5dde\u5929\u6cb3\u652f\u884c'][idx%3];
  if(/(\u6237\u540d|account.*name)/.test(L)) return '\u5317\u4eac\u79d1\u6280\u6709\u9650\u516c\u53f8';
  if(/(\u91d1\u989d|amount|\u4ef7\u683c|price|\u8d39\u7528|fee)/.test(L)) return (Math.random()*90000+1000).toFixed(2);
  if(/(\u6570\u91cf|quantity)/.test(L)) return String(Math.floor(Math.random()*90+10));
  if(/(\u6bd4\u4f8b|rate|\u6298\u6263)/.test(L)) return (Math.random()*0.3+0.7).toFixed(2);
  // 日期/时间/年份：扩展中文年月日等关键词
  if(/\u5e74\u4efd|\u5e74$|\u6708\u4efd|\u6708$|\u65e5|date|time|\u5e94\u6536|\u56de\u6b3e|\u5230\u671f|\u5f00\u59cb|\u622a\u6b62|\u751f\u6548/.test(L)){
    // 纯年份（年份/年结尾且无月日）
    if((/\u5e74$/.test(L) || /\u5e74\u4efd/.test(L)) && !/\u6708|\u65e5/.test(L)){
      return String(now.getFullYear());
    }
    // 年+月
    if(/\u5e74\u6708/.test(L)){
      return now.toISOString().slice(0,7);
    }
    return now.toISOString().slice(0,10);
  }
  if(/(\u89c4\u5219\u63cf\u8ff0|\u89c4\u5219\u8bf4\u660e)/.test(L)) return '\u672c\u89c4\u5219\u7528\u4e8e\u81ea\u52a8\u5316\u6d4b\u8bd5\uff0c\u6ee1\u8db3\u6761\u4ef6\u65f6\u89e6\u53d1\u5206\u914d\u3002';
  if(/(\u5907\u6ce8|remark|note|\u8bf4\u660e|\u63cf\u8ff0|desc)/.test(L)) return '\u81ea\u52a8\u5316\u6d4b\u8bd5\u6570\u636e-'+td;
  if(/(\u8d23\u4efb\u5206\u5de5|\u8d1d\u8d23|duty)/.test(L))
    return ['\u8d1f\u8d24\u524d\u671f\u5bf9\u63a5\u4e0e\u9700\u6c42\u786e\u8ba4','\u8d1f\u8d24\u65b9\u6848\u8bbe\u8ba1\u4e0e\u6280\u672f\u8bc4\u5ba1','\u8d1f\u8d24\u5f00\u53d1\u5b9e\u65bd\u4e0e\u8d28\u91cf\u4fdd\u969c','\u8d1f\u8d24\u9a8c\u6536\u4ea4\u4ed8\u4e0e\u552e\u540e\u652f\u6301'][idx%4];
  if(/(\u89c4\u5219\u540d\u79f0|\u89c4\u5219\u540d)/.test(L)) return '\u81ea\u52a8\u5316\u6d4b\u8bd5\u89c4\u5219_'+r4();
  if(/(\u6fc0\u52b1\u6bd4\u4f8b|\u5206\u914d\u6bd4\u4f8b)/.test(L)) return (Math.random()*0.3+0.5).toFixed(2);
  if(/(\u7f16\u7801|code|\u7f16\u53f7)/.test(L)) return 'CODE-'+td+'-'+r4();
  if(/(\u662f\u5426|\u662f.*\u5426|\u6709\u65e0)/.test(L)) return '\u662f';
  if(/(\u9762\u79ef|m²|\u5e73\u7c73)/.test(L)) return (Math.random()*500+50).toFixed(2);
  if(/(\u697c\u5c42)/.test(L)) return String(Math.floor(Math.random()*30+1));
  if(/(\u6237\u578b)/.test(L)) return ['\u4e00\u5c45\u5ba4','\u4e24\u5c45\u5ba4','\u4e09\u5c45\u5ba4','\u56db\u5c45\u5ba4'][idx%4];
  if(/(\u610f\u5411|intention)/.test(L)) return ['\u8d2d\u4e70','\u79df\u8d41','\u54a8\u8be2'][idx%3];

  var pool=[
    function(){return '\u6d4b\u8bd5\u6570\u636e'+(idx+1);},
    function(){return 'Auto'+r4();},
    function(){return '100';},
    function(){return now.toISOString().slice(0,10);},
    function(){return '\u5907\u6ce8-'+td;},
    function(){return '\u5317\u4eac\u671d\u9633\u6d4b\u8bd5\u8def'+idx+'\u53f7';},
    function(){return '138'+rnd(8);},
    function(){return 'user'+r4()+'@test.com';},
    function(){return 'CODE-'+idx;},
    function(){return (Math.random()*10000).toFixed(2);},
    function(){return '\u9009\u9879A';}
  ];
  return pool[idx%pool.length]();
}

// ==================== 公开接口 ====================
function _detectAll(){return scanFields().map(function(f){return{label:f.label||'(?)',placeholder:f.placeholder,type:f.type,disabled:!!f.disabled,currentValue:(f.element.value||'').slice(0,60),iframe:f.iframe};});}
// 清空所有字段：
// - text/number/textarea: 清值，【不 focus】避免触发下拉弹层
// - select / cascader: 优先走 Vue 实例 emit('update:modelValue', empty)，绕开 clearable 限制
//                       fallback 点击 clearable 清除图标
// - radio-group: 跳过（单选无可靠"反选"操作）
function _clearAll(){
  console.log('[clear] ======== 开始清空 ========');

  // ★ 第1步：遍历所有 Vue 组件实例，把响应式数据对象递归清空
  var seen = {};
  var keysFound = {};
  var allEls = document.querySelectorAll('*');
  for(var i=0; i<allEls.length; i++){
    var inst = allEls[i].__vueParentComponent;
    if(!inst) continue;
    var comp = inst, d = 0;
    while(comp && d < 20){
      d++;
      var uid = comp.uid;
      if(!uid || seen[uid]) break;
      seen[uid] = true;
      clearSetupStateRecursive(comp.setupState, keysFound);
      // 也清理 props 中的 model 数据
      clearPropsRecursive(comp.props, keysFound);
      comp = comp.parent;
    }
  }

  var foundList = Object.keys(keysFound);
  console.log('[clear] 发现并清空了 '+foundList.length+' 个数据对象:', foundList.join(', '));

  // ★ 第2步：静默清空所有文本输入框 DOM 值（零事件）
  var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea');
  for(var j=0; j<inputs.length; j++){
    var el = inputs[j];
    try{
      if(el.disabled || el.readOnly) continue;
      try{ var s = getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden') continue; }catch(e){}
      el.value = '';
    }catch(e){}
  }

  console.log('[clear] 完成');
}

// ★ 递归清理 setupState 中所有像表单数据的对象
function clearSetupStateRecursive(ss, found){
  if(!ss || typeof ss !== 'object') return;

  // 定义表单数据对象的特征 key（匹配更多模式）
  var formKeys = [
    'templateForm','formData','copyFormData','contractInfo',
    'form','model','formModel','data','formState','info',
    'queryForm','ruleForm','baseForm','detailForm',
    'partyA','partyB','customerInfo','contactInfo','bankInfo'
  ];
  var otherKeys = [];

  // 收集所有 key
  try{ otherKeys = Object.keys(ss); }catch(e){ return; }

  for(var k=0; k<otherKeys.length; k++){
    var key = otherKeys[k];
    if(!(key in ss)) continue;

    // 跳过函数、非对象、内部属性
    try{
      var val = ss[key];
      if(val === null || val === undefined) continue;
      if(typeof val === 'function') continue;
      if(/^__|^_internal|^\$/.test(key)) continue;
    }catch(e){ continue; }

    // 如果是 ref，清理 .value
    if(typeof val === 'object' && val !== null && val.__v_isRef){
      try{ clearObjectRecursive(val.value); found[key] = 1; }catch(e){}
      continue;
    }

    // 如果 key 在已知表单 key 列表中，或者是普通对象
    var isFormKey = formKeys.indexOf(key) >= 0;
    var isPlainObj = (typeof val === 'object' && val !== null && !Array.isArray(val));

    if(isFormKey || isPlainObj){
      try{ clearObjectRecursive(val); found[key] = 1; }catch(e){}
    }
  }
}

// ★ 清理 props 中的 model 相关数据
function clearPropsRecursive(pp, found){
  if(!pp || typeof pp !== 'object') return;
  var modelKeys = ['model', 'modelValue', 'formModel', 'formData'];
  for(var i=0; i<modelKeys.length; i++){
    var key = modelKeys[i];
    if(key in pp){
      try{ clearObjectRecursive(pp[key]); found['props.'+key] = 1; }catch(e){}
    }
  }
}

// ★ 递归清空一个对象的全部属性（含嵌套）
function clearObjectRecursive(obj){
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  var keys;
  try{ keys = Object.keys(obj); }catch(e){ return; }
  for(var i=0; i<keys.length; i++){
    var k = keys[i];
    if(k === '__v_isRef' || k === '__v_raw' || k === '__v_skip') continue;
    try{
      var v = obj[k];
      if(Array.isArray(v)){
        obj[k] = [];
      }else if(v !== null && typeof v === 'object' && !v.__v_isRef){
        // 嵌套对象 → 递归清空
        clearObjectRecursive(v);
      }else{
        obj[k] = '';
      }
    }catch(e){}
  }
}

// 兼容
function quietClearAllInputs(){}
function quietClear(el){}
function resetComponent(){ return false; }
function forceInputClear(el){}
function clearInputValueNoFocus(el){}
function resetAllElForms(){ return 0; }
function clearAllTextFields(){}
function clearAllSelects(){}
function clearViaVue(){ return false; }
function clearViaDomBtn(){ return false; }
function findVueComp(){ return null; }
function clearReactiveData(){ return false; }

function processSelects(){}
function handleSelect(){}
function handleCascader(){}
function findPopper(){return null;}
function closePopper(){}
function selectCascaderLevel(){}
