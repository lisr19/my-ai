// autoFiller.js - v10 AI智能版
// 核心：串行按序填充 + 强健的下拉选择 + 同源iframe表单自动填写 + DeepSeek AI智能数据生成
// ============================================================

// 填充控制器：模式 + 暂停/停止状态，被 _fillAll 主循环检查
var _AFCtrl = {
  paused: false,
  stopped: false,
  running: false,
  mode: 'fast',       // 默认一次性。'sequential' 模式仍保留代码路径，可通过 _AF.setMode 切回
  aiEnabled: false,   // AI 智能模式
  apiKey: ''          // DeepSeek API Key
};

// 抽屉/弹窗防护：填充期间拦截遮罩层 click 事件，防止 el-drawer/el-dialog 被误关闭
var _drawerGuards = [];

// ★ document 级 keydown 拦截器（不再单独存储，全部存 _drawerGuards 数组）
// ★ window 级别的 keydown 拦截器（部分 Element Plus 版本在 window 上注册 keydown）
var _docKeyGuard_window = null;

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
  isAIEnabled: function(){ return _AFCtrl.aiEnabled && !!_AFCtrl.apiKey; }
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
  var docs = [document]; // 主文档
  try {
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument;
        // 跨域 iframe 访问会抛出 SecurityError
        if (doc && doc !== document) {
          docs.push(doc);
          console.log('[v9] 发现可访问iframe #' + i + ': ' + (iframes[i].src || '(无src)').slice(0, 80));
        }
      } catch (err) {
        console.log('[v9] iframe #' + i + ' 跨域不可访问');
      }
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
      '你是一个专业的表单数据填充助手。你需要按照以下步骤完成填充任务：',
      '',
      '【第1步：全局理解】',
      '仔细阅读整个表单的所有字段，判断这个表单是用来做什么的。',
      '例如：合同管理表单、客户信息表单、采购订单表单、员工入职表单等。',
      '理解表单的业务场景后，你才能生成符合业务逻辑的真实数据。',
      '',
      '【第2步：提取主体画像】',
      '从【当前已有值】的字段中提取主体信息：',
      '- 主体名称（公司/个人/项目名称）',
      '- 地理区域（省/市/区）',
      '- 行业属性（科技/金融/医疗/制造等）',
      '- 关键关联人（法定代表人/联系人等）',
      '这些信息是你生成其他字段值的"基准"，所有字段必须围绕同一主体。',
      '',
      '【第3步：建立数据关联（上下文一致性）】',
      '以下关联规则必须严格遵守：',
      '',
      '▶ 地理一致性（最高优先级）：',
      '  - 从主体名称提取城市关键字，所有地址必须属于同一城市',
      '  - 如主体名含"广东/广州/深圳/珠海" → 所有地址必须在广东省内',
      '  - 如主体名含"上海" → 所有地址必须在上海市内',
      '  - 如主体名含"北京" → 所有地址必须在北京市内',
      '  - 禁止出现"广东公司+北京地址"这种矛盾！',
      '  - 级联器(cascader)层级不固定，根据字段名判断：',
      '    · 地址类通常是 3 级（省/市/区）',
      '    · 房间/楼宇可能是 2-6 级（如"广州律师大厦/1栋/2单元/9层/981A"）',
      '    · 用"/"分隔每一级',
      '  - 详细地址(textarea)返回格式："省+市+区+街道+门牌号"',
      '',
      '▶ 日期逻辑链（关键，必须严格执行）：',
      '  - 签约日期 < 合同开始日期 < 合同结束日期（时间顺序不能乱）',
      '  - 出生日期 < 入职日期 < 当前日期',
      '  - 申请日期 ≈ 创建日期 ≈ 今天前后',
      '  - 截止日期/到期日期 = 未来时间',
      '  - ⚠️ 强制要求：每个日期字段必须生成不同的日期，不能全部同一天！',
      '  - 假设今天是 2026-07-21，请按以下规则生成不同日期：',
      '    · 签约日期 → 2026-04-21 到 2026-06-21 之间随机一天',
      '    · 合同开始日期 → 签约日期之后 1-30 天（如 2026-05-10）',
      '    · 合同结束日期 → 合同开始日期 + 1-3 年（如 2028-09-15）',
      '    · 生日 → 1970-2000 年之间随机一天',
      '    · 入职日期 → 2016-2025 年之间随机一天',
      '    · 申请/创建/提交日期 → 2026-07-01 到 2026-07-21 之间随机一天',
      '    · 截止/到期/结束 → 2026-08 到 2027-12 之间随机一天',
      '',
      '▶ 编号/号码一致性：',
      '  - 合同编号（必须！不要用占位符如 "BYGJ-" 这种）：',
      '    · 允许的前缀：HT、CON、AG、HTN、CT',
      '    · 格式："PREFIX-YYYY-XXXXXXXX"（8位随机数字）',
      '    · 示例（仅供参考风格，不要照抄）："HT-2026-45128903"、"CON-2026-00781234"',
      '    · 多个合同编号字段时，必须使用不同的随机数字',
      '  - 证件号：根据主体地理位置生成对应地区编码',
      '    · 广东 → 44 开头（4401 广州, 4403 深圳, 4404 珠海, 4420 白云区）',
      '    · 上海 → 31 开头（3101 市区, 3102 浦东, 3103 闵行）',
      '    · 北京 → 11 开头（1101 市区, 1102 朝阳, 1103 海淀）',
      '    · 浙江 → 33 开头（3301 杭州, 3302 宁波, 3303 温州）',
      '    · 江苏 → 32 开头（3201 南京, 3202 苏州, 3203 无锡）',
      '  - 银行账号：真实格式如"6222021234567890123"',
      '  - 电话号码：与主体联系人匹配',
      '',
      '▶ 业务数据合理性：',
      '  - 金额要合理：采购合同5-500万，服务合同1-50万，小商品0.01-5万',
      '  - 数量要合理：批发10-10000，零售1-100，服务天数30-365',
      '  - 面积要合理：办公室50-500㎡，厂房500-5000㎡，住宅30-200㎡',
      '  - 邮箱格式：联系人姓名拼音@公司域名.com',
      '',
      '【第4步：字段处理规则】',
      '- 已有值的字段 → 返回""（保留原值）',
      '- 禁用的字段 → 返回""',
      '- 下拉框(el-select)：根据业务场景返回一个最合理的选项名（不是"请选择"），如"重点程度"→"重要"、"区域"→"华南区"等。如果不确定就返回""（系统会随机选）',
      '- 单选组(radio-group) → 返回""（系统自动选第一项）',
      '- 级联器(el-cascader) → 根据字段名判断层级返回路径，用"/"分隔',
      '  · 字段名含"地址/地区/省市区" → 3级"省/市/区"',
      '  · 字段名含"房间/楼宇/楼层/单元/栋" → 2-6级（按实际情况）',
      '  · 字段名含"分类/类别/类型" → 2-4级',
      '- 其他字段 → 返回符合以上所有规则的真实数据',
      '',
      '【输出格式】',
      '只返回JSON对象，不要任何解释文字：',
      '{ "字段标签1": "值1", "字段标签2": "值2", ... }',
      'key必须与用户输入中的字段标签完全一致。',
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
      '请先理解这个表单的业务场景，再按照系统指令中的规则，为每个字段生成真实、合理、符合逻辑的数据。',
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
          dateVal = genDateValue(f.label || f.placeholder);
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
    var cl = wrap.querySelector('.el-cascader__label,.ant-cascader-picker-label');
    if(cl && cl.textContent.trim()) return cl.textContent.trim();
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

      setTimeout(function(){
        var afterVal = realInput ? (realInput.value||'') : '';
        var committed = afterVal && afterVal !== beforeVal &&
                        afterVal !== (realInput && realInput.placeholder || '');
        if(committed){
          cb(txt);
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
  // 仅用 Escape 键关闭下拉面板
  // ★ 只对 activeElement 派发（避免冒泡到全局关闭其他组件）
  var target = doc.activeElement || doc.body;
  var ev = new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
  target.dispatchEvent(ev);
}

/** 关闭所有文档中已打开的下拉面板 */
function closeAllDropdowns(){
  var allDocs = getAllDocuments();
  for(var d=0; d<allDocs.length; d++){
    // 用 Escape 关闭（Element Plus 监听 Escape 自动关闭面板并清理状态）
    allDocs[d].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
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
          var clickGuard = function(e){
            if(_AFCtrl.running){
              e.stopPropagation();
              e.stopImmediatePropagation();
              return false;
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
        
        if(aiPath && aiPath.length > 0){
          console.log('    🤖 按AI路径选择: ['+aiPath.join(' / ')+']');
          cascadeRecursiveByPath(panel, 0, aiPath, [], resolve);
        } else {
          console.log('    级联面板OK，开始递归...');
          cascadeRecursive(panel,0,6,[],resolve);
        }
      },450);
    },120)});
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

  // 文本：优先取 label，避免把箭头/checkbox 的内容拼进来
  var labelEl=node.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
  var txt=((labelEl?labelEl.textContent:node.textContent)||'').trim().slice(0,25);
  path.push(txt);

  // 叶子判定：以 is-leaf 类为主，回退到"无展开图标"
  var isLeaf=node.classList.contains('is-leaf');
  if(!isLeaf){
    var hasExpand=node.querySelector('.el-cascader-node__postfix,.ant-cascader-menu-item-expand-icon,[class*="expand-icon"]');
    if(!hasExpand && !node.querySelector('[aria-expanded]')) isLeaf=true;
  }
  
  // ★ 增强叶子判定：如果当前列是最后一列，也视为叶子
  if(!isLeaf){
    var allMenus=panel.querySelectorAll(CASCADE_MENU_SEL);
    if(allMenus && allMenus.length <= level+1){
      isLeaf=true;
    }
  }

  // 用统一的完整事件序列点击节点
  setTimeout(function(){
    fireFullClick(node);
    console.log('    [级联 L'+level+'] -> "'+txt+'"'+(isLeaf?' (叶子✓)':'')+' [列'+(menus?menus.length:0)+'/'+(level+1)+']');

    if(isLeaf){
      // ★ 叶子：等待足够长时间让 Element Plus 完成值同步，再用 Escape 关闭面板
      setTimeout(function(){
        closeDropdown(getOwnerDoc(panel));
        done(path.join(' > '));
      },500);
      return;
    }

    // 非叶子：轮询等待下一级菜单出现
    waitForCascadeColumn(panel,level+1,function(ok){
      if(ok){
        cascadeRecursive(panel,level+1,max,path,done);
      }else{
        console.log('    [级联 L'+level+'] 下一级未出现，结束');
        closeDropdown(getOwnerDoc(panel));
        done(path.join(' > '));
      }
    });
  },120);
}

/** ★ 按 AI 给定路径选择（完全基于 cascadeRecursive 的稳定逻辑改造） */
function cascadeRecursiveByPath(panel, level, aiPath, path, done){
  if(level >= aiPath.length){
    closeDropdown(getOwnerDoc(panel));
    done(path.join(' > '));
    return;
  }

  var wantText = aiPath[level];
  // ★ 和 cascadeRecursive 完全一致的取列逻辑
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

  // ★ 在列内找匹配节点（唯一和 cascadeRecursive 不同的地方）
  var matchedNode = null;
  for(var i=0; i<allNodes.length; i++){
    var n = allNodes[i];
    var labelEl = n.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
    var txt = ((labelEl?labelEl.textContent:n.textContent)||'').trim();

    if(txt === wantText ||
       txt.indexOf(wantText) >= 0 ||
       wantText.indexOf(txt) >= 0 ||
       // 去除各类后缀匹配
       txt.replace(/[@#（(][^)）]*[)）]?/g,'').trim() === wantText ||
       wantText.replace(/[@#（(][^)）]*[)）]?/g,'').trim() === txt ||
       txt.replace(/[省市区县旗栋楼层单元室号]/g,'') === wantText.replace(/[省市区县旗栋楼层单元室号]/g,'')){
      matchedNode = n;
      break;
    }
  }

  // 找不到 → 兜底选第一个（和 cascadeRecursive 行为一致）
  if(!matchedNode){
    console.log('    [AI级联 L'+level+'] 未匹配"'+wantText+'"，兜底选第一项');
    matchedNode = allNodes[0];
  }

  // ★ 以下和 cascadeRecursive 完全一致的逻辑
  var labelEl = matchedNode.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content');
  var matchedTxt = ((labelEl?labelEl.textContent:matchedNode.textContent)||'').trim();
  path.push(matchedTxt);

  var isLeaf = matchedNode.classList.contains('is-leaf');
  if(!isLeaf){
    var hasExpand = matchedNode.querySelector('.el-cascader-node__postfix,.ant-cascader-menu-item-expand-icon,[class*="expand-icon"]');
    if(!hasExpand && !matchedNode.querySelector('[aria-expanded]')) isLeaf = true;
  }
  
  // ★ 增强叶子判定：当前列是最后一列时强制设为叶子（与 cascadeRecursive 保持一致）
  if(!isLeaf){
    var allMenusPath=panel.querySelectorAll(CASCADE_MENU_SEL);
    if(allMenusPath && allMenusPath.length <= level+1){
      isLeaf=true;
    }
  }

  setTimeout(function(){
    fireFullClick(matchedNode);
    console.log('    [AI级联 L'+level+'] -> "'+matchedTxt+'"'+(isLeaf?' (叶子✓)':'')+' [列'+(allMenusPath?allMenusPath.length:0)+'/'+(level+1)+']');

    if(isLeaf){
      // ★ 叶子：与 cascadeRecursive 完全一致 - 等待 + closeDropdown
      setTimeout(function(){
        closeDropdown(getOwnerDoc(panel));
        done(path.join(' > '));
      },500);
      return;
    }

    waitForCascadeColumn(panel, level+1, function(ok){
      if(ok){
        cascadeRecursiveByPath(panel, level+1, aiPath, path, done);
      }else{
        console.log('    [AI级联 L'+level+'] 下一级未出现，结束');
        closeDropdown(getOwnerDoc(panel));
        done(path.join(' > '));
      }
    });
  },120);
}

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
          comp.emit('update:modelValue', val);
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
      
      for(var i=0;i<all.length;i++){
        var el=all[i];
        if(!isVisible(el)) continue;
        // 注意：
        // - readOnly 不过滤：el-select / el-cascader 非 filterable 模式下 input 是 readonly，它就是触发器
        // - disabled 也不过滤：有联动关系的字段，前面字段填完后会从 disabled 解除（如「审核流程」依赖「合同类型」）
        //   在多轮填充中，本轮 disabled 的会跳过本轮，下一轮自动重试
        if(isNonForm(el)) continue;

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
      for(var wi=0; wi<wrapperFallback.length; wi++){
        var wrp = wrapperFallback[wi];
        // 排除 dropdown / panel / 内部嵌套（仅取根级触发器容器）
        if(wrp.closest('.el-select-dropdown,.el-cascader-panel,.el-cascader-menu,.ant-select-dropdown,.ant-cascader-menus,.el-picker-panel,.el-date-picker__time-header,.ant-picker-dropdown,.el-popper')) continue;
        if(!isVisible(wrp)) continue;
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
  var sa=el.closest('header,nav,footer,[role="search"],.search-bar,.navbar,.filter-bar,.query-bar,.toolbar');
  if(sa)return true;
  
  var pc=el.closest('[class]');
  if(pc){
    var cn=String(pc.className||'');
    if(/search|query|filter|global|topbar|navbar|header-bar/.test(cn)&&!pc.closest('.el-dialog,.el-drawer,.ant-modal,[role="dialog"],.ant-drawer'))
      return true;
  }

  // 检查弹窗：需要在元素所属的document中查找
  var ownerDoc = getOwnerDoc(el);
  var hasDlg=!!ownerDoc.querySelector(
    '.el-dialog__wrapper:not([style*="display: none"]),.el-dialog,.el-drawer,.ant-modal-wrap:not(.ant-modal-wrap-hidden),[role="dialog"]:not([aria-hidden="true"])'
  );
  if(hasDlg&&!el.closest('.el-dialog,.el-dialog__wrapper,.el-drawer,.el-drawer__wrapper,.ant-modal,.ant-modal-wrap,.ant-modal-content,[role="dialog"]'))
    return true;
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
function genDateValue(label){
  var L = (label||'').toLowerCase();
  var now = new Date();
  // 纯年份（年出现在末尾或带"年份"且无月日）：预计达产年份、建档年份、统计年
  if((/\u5e74$/.test(L) || /\u5e74\u4efd/.test(L)) && !/\u6708|\u65e5/.test(L)){
    return String(now.getFullYear());
  }
  // 年+月：统计年月、达产年月、签约年月
  if(/\u5e74\u6708/.test(L)){
    return now.toISOString().slice(0,7);
  }
  // 默认完整日期
  return now.toISOString().slice(0,10);
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
