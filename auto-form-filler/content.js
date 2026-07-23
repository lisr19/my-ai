// content.js - v7 (适配串行级联填充引擎)
(function() {
  console.log('[AutoFiller v7] Content script 已加载');
  
  // 检查核心函数是否就绪
  var isReady = function() {
    return typeof window._AF === 'object' && 
           typeof window._AF.fill === 'function' &&
           typeof window._AF.detect === 'function' &&
           typeof window._AF.clear === 'function';
  };
  
  if (!isReady()) {
    console.warn('[AutoFiller] 核心函数未就绪，等待...');
  }
  
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('[AutoFiller] 收到消息:', request.action);
    
    try {
      if (request.action === 'fillForm') {
        setTimeout(function(){
          try {
            // ★ 统一显示遮罩 + 设置进度回调（所有入口一致）
            showFilling();
            if(window._AF && window._AF.setProgressCallback){
              window._AF.setProgressCallback(function(progress){
                updateFillingProgress(progress);
              });
            }

            var result;
            if (typeof window._AF === 'object' && typeof window._AF.fill === 'function') {
              result = window._AF.fill(request.data || {});
              // v7 返回 Promise → 需要异步等待结果
              if (result && typeof result.then === 'function') {
                result.then(function(r){
                  hideFilling();
                  sendResponse(r);
                }).catch(function(e){
                  hideFilling();
                  sendResponse({ success: false, error: e.message });
                });
                return true; // keep channel open
              }
              hideFilling();
              sendResponse(result);
            } else if (typeof window.autoFillForm === 'function') {
              result = window.autoFillForm(request.data || {});
              if (result && typeof result.then === 'function') {
                result.then(function(r){
                  hideFilling();
                  sendResponse(r);
                });
                return true;
              }
              hideFilling();
              sendResponse(result);
            } else {
              result = fillFallback(request.data || {});
              hideFilling();
              sendResponse(result);
            }
          } catch(e) {
            hideFilling();
            console.error('[AutoFiller] 填充出错:', e);
            sendResponse({ success: false, error: e.message });
          }
        }, 100);
        return true; // 异步响应
      }
      
      if (request.action === 'getFormData') {
        var fields = [];
        if (typeof window._AF === 'object' && typeof window._AF.detect === 'function') {
          fields = window._AF.detect();
        }
        sendResponse({ fields: fields });
      }
      
      if (request.action === 'clearForm') {
        if (typeof window._AF === 'object' && typeof window._AF.clear === 'function') {
          window._AF.clear();
        }
        sendResponse({ success: true });
      }
      
      // ★ 扩展更新通知
      if (request.action === 'extensionUpdated') {
        showUpdateCard(request.previousVersion, request.version, request.changes || []);
        sendResponse({ success: true });
      }
      
      // ★ AI 模式配置
      if (request.action === 'setAI') {
        if (request.apiKey) {
          if (typeof window._AF === 'object' && typeof window._AF.setApiKey === 'function') {
            window._AF.setApiKey(request.apiKey);
          }
        }
        if (request.enabled !== undefined) {
          if (typeof window._AF === 'object' && typeof window._AF.enableAI === 'function') {
            window._AF.enableAI(request.enabled);
          }
        }
        console.log('[AutoFiller] AI模式:', request.enabled ? '启用' : '关闭');
        sendResponse({ success: true });
      }
    } catch(e) {
      sendResponse({ success: false, error: e.message });
    }
    
    return true;
  });

  // setTimeout(addFloatingButton, 800); // 已隐藏浮动按钮，统一使用 Side Panel 入口
  
  // ★ 版本更新检测
  checkVersionUpdate();
  
  // ★ 初始化 AI 配置
  initAIConfig();
})();

// ★ 初始化 AI 配置
function initAIConfig() {
  // 内置默认 API Key
  var DEFAULT_API_KEY = 'sk-e1a584e3325e4e40bb6e048a62ca047f';
  try {
    // 先设置内置 Key
    if (typeof window._AF === 'object' && typeof window._AF.setApiKey === 'function') {
      window._AF.setApiKey(DEFAULT_API_KEY);
    }
    chrome.storage.local.get(['af_ai_enabled'], function(result) {
      // 读取用户是否启用 AI（Key 已内置，不需要再从 storage 读取）
      if (result.af_ai_enabled !== undefined && typeof window._AF === 'object' && typeof window._AF.enableAI === 'function') {
        window._AF.enableAI(result.af_ai_enabled);
        if (result.af_ai_enabled) console.log('[AutoFiller] AI 模式已启用');
      }
    });
  } catch(e) {}
}

// 兜底填充（如果 _AF 未加载成功）
function fillFallback(data) {
  console.log('[AutoFiller] 使用兜底填充模式');
  var count = 0;
  var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
  
  inputs.forEach(function(el, i) {
    if (!el.offsetParent && el.clientWidth === 0 && el.clientHeight === 0) return;
    if (el.disabled || el.readOnly) return;
    try {
      var s = getComputedStyle(el);
      if (s.display==='none'||s.visibility==='hidden') return;
    } catch(e){return;}
    
    try {
      var val = genFallbackValue((el.placeholder||''), i);
      el.focus();
      var setter = null;
      if (el.tagName==='TEXTAREA'||el.tagName==='textarea') {
        try{setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;}catch(e){}
      } else {
        try{setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){}
      }
      if(setter) setter.call(el,val); else el.value=val;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      count++;
      if (el.tagName==='SELECT'&&el.options.length>1){el.selectedIndex=1;el.dispatchEvent(new Event('change',{bubbles:true}));}
      if(el.closest('.el-select')){el.click();}
      if(el.closest('.el-cascader')){el.click();}
    } catch(e){}
  });

  return { success: true, filledCount: count };
}

function genFallbackValue(label, idx) {
  var L=(label||'').toLowerCase();
  var r4=function(){return String(Math.floor(Math.random()*9000)+1000);};
  var rnd9=function(){return String(Math.floor(Math.random()*1e9)).padStart(9,'0');};
  var d=new Date();var td=''+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');

  if(/合同|contract|订单|order/.test(L)) return '测试_'+td+'_'+r4();
  if(/公司|企业|单位|甲方|乙方|客户|supplier/.test(L)) return '测试公司'+r4();
  if(/电话|phone|tel|手机/.test(L)) return '138'+rnd9().slice(0,8);
  if(/邮箱|email|mail/.test(L)) return 'test'+r4()+'@example.com';
  if(/地址|address/.test(L)) return '北京市海淀区测试路'+r4()+'号';
  if(/证件号|idcard|credit|税号/.test(L)) return '91'+rnd9().slice(0,8)+'X';
  if(/金额|amount|price/.test(L)) return (Math.random()*10000+100).toFixed(2);
  if(/日期|date/.test(L)) return d.toISOString().slice(0,10);
  if(/时间|time|应收|回款|到期|开始|截止|生效/.test(L)) return d.toISOString().slice(0,10);
  if(/备注|remark|note|说明|desc|描述|规则描述|责任分工/.test(L)) return '自动化测试数据-'+td;
  return ['测试数据'+(idx+1),'Auto'+r4(),'100','正常'][idx%4];
}

// ==================== 浮动按钮 ====================

function addFloatingButton() {
  // ★ all_frames: true 会让 content script 在每个 frame 都执行
  // 但浮动按钮只需要在顶层 frame 显示
  if (window !== window.top) {
    // 在 iframe 里：不创建按钮（顶层已创建）
    return;
  }
  if (document.getElementById('autoFillerFloatingBtn')) return;

  var btn=document.createElement('div');btn.id='autoFillerFloatingBtn';
  btn.innerHTML=''+
    '<button id="autoFillerMainBtn" title="点击展开菜单">'+
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">'+
        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'+
        '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'+
      '</svg>'+
    '</button>'+
    '<div id="autoFillerMenu" style="display:none;">'+
      '<button data-action="fill" class="menu-item menu-item--primary">✨ 一键填写</button>'+
      '<button data-action="preview" class="menu-item">📋 字段预览面板</button>'+
      '<button data-action="pause-toggle" class="menu-item" data-pause-label></button>'+
      '<div class="menu-divider"></div>'+
      '<button data-action="clear" class="menu-item">🗑️ 清空表单</button>'+
    '</div>'+
    '<div id="autoFillerPanel" style="display:none;"></div>';
  document.body.appendChild(btn);

  var mainBtn = document.getElementById('autoFillerMainBtn');
  var menu = document.getElementById('autoFillerMenu');
  var panel = document.getElementById('autoFillerPanel');

  function doFill(panelBtnEl, onDone){
    var fillFn = (window._AF && typeof window._AF.fill==='function') ? window._AF.fill
               : (typeof window.autoFillForm==='function' ? window.autoFillForm : null);
    if(!fillFn){ toast('⚠️ 填充引擎未加载'); if(onDone)onDone(); return; }

    showFilling();

    // ★ 设置进度回调：让 autoFiller.js 在处理每个字段时更新遮罩层
    if(window._AF && window._AF.setProgressCallback){
      window._AF.setProgressCallback(function(progress){
        updateFillingProgress(progress);
      });
    }

    if(panelBtnEl){
      panelBtnEl.disabled = true;
      panelBtnEl.innerHTML = '<span class="af-spinner"></span>正在填写...';
    }

    function restore(){
      hideFilling();
      if(panelBtnEl){ panelBtnEl.disabled=false; panelBtnEl.innerHTML='✨ 一键填写'; }
      if(onDone) onDone();
    }

    try{
      var p = fillFn({});
      if(p && typeof p.then==='function'){
        p.then(function(res){
          var msg='✅ 完成! ';
          if(res) msg += '填充:'+(res.filledCount||0)+' | 已有/联动:'+(res.cascadedCount||0);
          else msg += '已执行';
          toast(msg);
          if(panel.style.display!=='none') renderPreviewPanel();
          restore();
        }).catch(function(e){
          restore();
          setTimeout(function(){ toast('⚠️ 填充出错:'+e.message); }, 260);
        });
      }else{ restore(); toast('✅ 填写完成'); }
    }catch(err){
      console.error('[AutoFiller] fill错误:',err);
      restore();
      setTimeout(function(){ toast('⚠️ '+err.message); }, 260);
    }
  }

  function escHtml(s){
    if(s==null) return '';
    return String(s).replace(/[<>&"']/g, function(c){
      return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function renderPreviewPanel(){
    var fields = [];
    try{ fields = (window._AF && window._AF.detect) ? window._AF.detect() : []; }catch(e){}

    var SELECT = ['el-select','el-cascader','ant-select','ant-cascader','select'];
    var textCount = fields.filter(function(f){ return SELECT.indexOf(f.type)<0 && f.type!=='radio-group'; }).length;
    var selectCount = fields.filter(function(f){ return SELECT.indexOf(f.type)>=0; }).length;
    var radioCount = fields.filter(function(f){ return f.type==='radio-group'; }).length;
    var disabledCount = fields.filter(function(f){ return f.disabled; }).length;

    var listHtml = '';
    if(fields.length === 0){
      listHtml = '<div class="af-no-fields">未检测到表单字段</div>';
    }else{
      fields.forEach(function(f,i){
        var typeCls='af-type-text', typeTxt='文本';
        if(['el-select','ant-select','select'].indexOf(f.type)>=0){ typeCls='af-type-select'; typeTxt='下拉'; }
        else if(['el-cascader','ant-cascader'].indexOf(f.type)>=0){ typeCls='af-type-cascader'; typeTxt='级联'; }
        else if(f.type==='radio-group'){ typeCls='af-type-radio'; typeTxt='单选'; }
        else if(f.type==='number'){ typeCls='af-type-number'; typeTxt='数字'; }
        else if(f.type==='date-picker'){ typeCls='af-type-date'; typeTxt='日期'; }
        var iframeTag = f.iframe ? '<span class="af-iframe-tag">iframe</span>' : '';
        var disabledTag = f.disabled ? '<span class="af-disabled-tag" title="当前禁用，多轮填充会等依赖字段解锁后重试">禁用</span>' : '';
        var label = escHtml(f.label) || '<i style="color:#bbb">(未命名)</i>';
        var titleAttr = escHtml(f.label+' | '+f.type+(f.disabled?' | 禁用':'')+' | 当前:'+(f.currentValue||''));
        var rowCls = f.disabled ? 'af-field-item af-field-item--disabled' : 'af-field-item';
        listHtml += '<div class="'+rowCls+'" title="'+titleAttr+'">'+
          '<span class="af-field-num">'+(i+1)+'</span>'+
          '<span class="af-field-label">'+label+'</span>'+
          '<span class="af-field-type '+typeCls+'">'+typeTxt+'</span>'+
          disabledTag +
          iframeTag+'</div>';
      });
    }

    panel.innerHTML =
      '<div class="af-panel-header">'+
        '<h3>🪄 一键表单填充</h3>'+
        '<button class="af-close" data-close title="关闭">×</button>'+
      '</div>'+
      '<div class="af-panel-body">'+
        '<button class="af-big-btn" data-panel-fill>✨ 一键填写</button>'+
        '<div class="af-stats">'+
          '<div class="af-stat-box"><div class="af-stat-num">'+fields.length+'</div><div class="af-stat-label">检测到字段</div></div>'+
          '<div class="af-stat-box"><div class="af-stat-num">'+textCount+'</div><div class="af-stat-label">文本字段</div></div>'+
          '<div class="af-stat-box"><div class="af-stat-num">'+selectCount+'</div><div class="af-stat-label">下拉字段</div></div>'+
          '<div class="af-stat-box"><div class="af-stat-num">'+radioCount+'</div><div class="af-stat-label">单选组</div></div>'+
          '<div class="af-stat-box"><div class="af-stat-num">'+disabledCount+'</div><div class="af-stat-label">当前禁用</div></div>'+
        '</div>'+
        '<div class="af-panel-section-title">📋 当前页面字段</div>'+
        '<div class="af-field-list">'+listHtml+'</div>'+
        '<button class="af-refresh-btn" data-refresh>🔄 重新扫描</button>'+
      '</div>';

    panel.querySelector('[data-close]').addEventListener('click', function(e){
      e.stopPropagation(); panel.style.display='none';
    });
    panel.querySelector('[data-panel-fill]').addEventListener('click', function(e){
      e.stopPropagation(); doFill(e.currentTarget);
    });
    panel.querySelector('[data-refresh]').addEventListener('click', function(e){
      e.stopPropagation(); renderPreviewPanel();
    });
    // 重新渲染会重建 header，每次都得重新绑拖拽
    var header = panel.querySelector('.af-panel-header');
    if(header) makeDraggable(panel, header);
  }

  // 状态读取助手
  function afStatus(){
    try{ return (window._AF && window._AF.getStatus) ? window._AF.getStatus() : {running:false,paused:false,mode:'sequential'}; }
    catch(e){ return {running:false,paused:false,mode:'sequential'}; }
  }

  // 刷新菜单上 pause 那项的文案
  function refreshMenuLabels(){
    var st = afStatus();
    var pauseBtn = menu.querySelector('[data-pause-label]');
    if(pauseBtn){
      if(!st.running){ pauseBtn.textContent = '⏸ 暂停/继续'; pauseBtn.disabled = true; }
      else { pauseBtn.textContent = st.paused ? '▶️ 继续填充' : '⏸ 暂停填充'; pauseBtn.disabled = false; }
    }
  }

  function runAction(action){
    switch(action){
      case 'fill': doFill(); break;
      case 'preview':
        renderPreviewPanel();
        panel.style.display = 'block';
        break;
      case 'pause-toggle':
        var st2 = afStatus();
        if(!st2.running){ toast('当前没有在填充'); return; }
        if(st2.paused){
          if(window._AF && window._AF.resume) window._AF.resume();
          toast('▶️ 继续填充');
        }else{
          if(window._AF && window._AF.pause) window._AF.pause();
          toast('⏸ 已暂停');
        }
        break;
      case 'clear':
        try{ if(window._AF&&window._AF.clear) window._AF.clear(); }catch(e){}
        toast('🗑️ 已清空');
        break;
    }
  }

  // 模式 UI 已隐藏，强制走默认（fast）；底层 API 保留，需要时可在控制台 _AF.setMode 切换

  // ============== 拖拽工具 ==============
  // 返回一个 { didDrag() } 检查器，供 click handler 判断是否要屏蔽这次 click
  function makeDraggable(target, handle){
    handle = handle || target;
    var startX, startY, startLeft, startTop;
    var dragging = false;
    var didDragFlag = false;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', function(e){
      if(e.button !== 0) return; // 左键
      // 排除输入控件，避免拖拽干扰
      if(e.target.matches && e.target.matches('input,textarea,select,[contenteditable="true"]')) return;

      startX = e.clientX;
      startY = e.clientY;
      var rect = target.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      dragging = false;
      didDragFlag = false;

      function onMove(ev){
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if(!dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)){
          dragging = true;
          didDragFlag = true;
          // 第一次确认是拖拽：切到 left/top 定位（消掉原本的 right/bottom）
          target.style.left = startLeft + 'px';
          target.style.top = startTop + 'px';
          target.style.right = 'auto';
          target.style.bottom = 'auto';
          document.body.style.userSelect = 'none';
        }
        if(dragging){
          var nl = Math.max(0, Math.min(window.innerWidth - target.offsetWidth, startLeft + dx));
          var nt = Math.max(0, Math.min(window.innerHeight - target.offsetHeight, startTop + dy));
          target.style.left = nl + 'px';
          target.style.top = nt + 'px';
        }
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if(dragging){
          document.body.style.userSelect = '';
          // 持久化
          try{
            localStorage.setItem('af-pos-' + target.id, JSON.stringify({
              left: target.style.left, top: target.style.top
            }));
          }catch(e){}
          dragging = false;
        }
        // didDragFlag 在 click handler 检查并自行复位
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // capture 阶段拦 click：拖拽刚结束的第一次 click 不要触发原本动作
    handle.addEventListener('click', function(e){
      if(didDragFlag){
        e.stopPropagation();
        e.preventDefault();
        didDragFlag = false;
      }
    }, true);

    return { didDrag: function(){ return didDragFlag; } };
  }

  function restorePosition(target){
    try{
      var raw = localStorage.getItem('af-pos-' + target.id);
      if(!raw) return;
      var pos = JSON.parse(raw);
      if(pos && pos.left && pos.top){
        target.style.left = pos.left;
        target.style.top = pos.top;
        target.style.right = 'auto';
        target.style.bottom = 'auto';
      }
    }catch(e){}
  }

  // FAB 拖拽：整个 #autoFillerFloatingBtn 容器跟着 main button 拖
  restorePosition(btn);
  makeDraggable(btn, mainBtn);

  // 面板：首次恢复位置（drag 绑定在 renderPreviewPanel 每次渲染时重新做）
  restorePosition(panel);

  // ============== 菜单事件 ==============
  // 这些动作点完留着菜单（连续操作友好），其余点完就关
  var STICKY_ACTIONS = ['pause-toggle'];

  // 单击 = 弹菜单（弹出时刷新文案）
  mainBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if(menu.style.display==='none'){
      refreshMenuLabels();
      menu.style.display = 'block';
    }else{
      menu.style.display = 'none';
    }
  });

  menu.querySelectorAll('button').forEach(function(item){
    item.addEventListener('click', function(e){
      e.stopPropagation();
      var action = item.dataset.action;

      // 一键填写：菜单保持打开，填充完才关闭
      if(action === 'fill'){
        var origHtml = item.innerHTML;
        item.innerHTML = '<span class="af-spinner"></span>填写中...';
        item.disabled = true;
        doFill(null, function(){
          item.innerHTML = origHtml;
          item.disabled = false;
          refreshMenuLabels();
          menu.style.display = 'none';
        });
        return;
      }

      runAction(action);
      if(STICKY_ACTIONS.indexOf(action) >= 0){
        refreshMenuLabels();
      }else{
        menu.style.display = 'none';
      }
    });
  });

  // 点面板内部不关
  panel.addEventListener('click', function(e){ e.stopPropagation(); });

  // 点外面：关菜单（面板独立保留）
  document.addEventListener('click', function(){
    menu.style.display = 'none';
  });
}

function toast(msg) {
  var t=document.querySelector('.af-toast');if(t)t.remove();
  var el=document.createElement('div');el.className='af-toast';el.textContent=msg;
  document.body.appendChild(el);
  requestAnimationFrame(function(){el.classList.add('show');});
  setTimeout(function(){el.classList.remove('show');setTimeout(function(){el.remove()},300);},3500);
}

// 页面居中填充加载弹窗（增强版 v3.8.0）
// ★ 支持区分规则/AI模式 + 实时进度显示 + 全屏锁定
var _afFillingOverlay = null;
var _afProgressEl = null;  // 进度文本元素引用

function showFilling(){
  hideFilling();

  // 检测当前模式
  var isAI = false;
  try { isAI = window._AF && window._AF.isAIEnabled && window._AF.isAIEnabled(); } catch(e) {}

  var modeIcon = isAI ? '🤖' : '📋';
  var modeText = isAI ? 'AI 智能模式' : '规则模式';
  var modeDesc = isAI ? 'DeepSeek 正在智能分析表单...' : '正在按规则匹配字段...';

  var overlay = document.createElement('div');
  overlay.className = 'af-filling-overlay';
  overlay.innerHTML =
    '<div class="af-filling-card">'+
      '<div class="af-filling-spinner"></div>'+
      '<div class="af-filling-mode-badge '+(isAI?'mode-ai':'mode-rule')+'">'+modeIcon+' '+modeText+'</div>'+
      '<div class="af-filling-title">正在自动填写表单</div>'+
      '<div class="af-filling-sub">'+modeDesc+'</div>'+
      '<div class="af-filling-progress">准备中...</div>'+
      '<div class="af-filling-progress-bar"><div class="af-filling-progress-fill"></div></div>'+
      '<button class="af-filling-stop-btn">⏹ 停止填写</button>'+
    '</div>';

  // 停止按钮事件
  overlay.querySelector('.af-filling-stop-btn').addEventListener('click', function(e){
    e.stopPropagation();
    try{ if(window._AF&&window._AF.stop)window._AF.stop(); }catch(e){}
    hideFilling();
    setTimeout(function(){ toast('⏹ 已停止填写'); }, 260);
  });

  document.body.appendChild(overlay);
  _afFillingOverlay = overlay;
  _afProgressEl = overlay.querySelector('.af-filling-progress');
}

/**
 * 更新填充进度（由 autoFiller.js 调用）
 * @param {Object} progress - { current: string, index: number, total: number, fieldLabel: string }
 */
function updateFillingProgress(progress){
  if(!_afFillingOverlay || !_afProgressEl) return;

  // 更新进度文本
  if(progress && progress.fieldLabel){
    var txt = '['+ (progress.index||0) +'/'+ (progress.total||'?') +'] ' + progress.fieldLabel;
    if(progress.action) txt += ' → ' + progress.action;
    _afProgressEl.textContent = txt;
  }

  // 更新进度条
  var fillBar = _afFillingOverlay.querySelector('.af-filling-progress-fill');
  if(fillBar && progress && progress.total > 0){
    var pct = Math.min(100, Math.round((progress.index / progress.total) * 100));
    fillBar.style.width = pct + '%';
  }
}

function hideFilling(){
  if(!_afFillingOverlay) return;
  _afFillingOverlay.classList.add('af-filling-overlay--out');
  var el = _afFillingOverlay;
  _afFillingOverlay = null;
  _afProgressEl = null;
  setTimeout(function(){
    if(el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

// ==================== 版本更新通知 ====================

function checkVersionUpdate(){
  try{
    var CURRENT_VERSION = chrome.runtime.getManifest().version;
    chrome.storage.local.get(['af_last_version'], function(result){
      var last = result.af_last_version;
      if(last && last !== CURRENT_VERSION){
        // 版本变了，读取 CHANGELOG 显示更新卡片
        fetch(chrome.runtime.getURL('CHANGELOG.md'))
          .then(function(r){ return r.text(); })
          .then(function(text){
            var changes = parseChangelogLatest(text);
            showUpdateCard(last, CURRENT_VERSION, changes);
          })
          .catch(function(){
            showUpdateCard(last, CURRENT_VERSION, []);
          });
      }
      chrome.storage.local.set({ af_last_version: CURRENT_VERSION });
    });
  }catch(e){
    console.warn('[AutoFiller] 版本检测失败:', e);
  }
}

function parseChangelogLatest(text){
  var lines = text.split('\n');
  var changes = [];
  var inLatest = false;
  for(var i=0; i<lines.length; i++){
    var line = lines[i];
    if(/^##\s*\[/.test(line)){
      if(inLatest) break;
      inLatest = true;
      continue;
    }
    if(inLatest && /^-\s/.test(line)){
      changes.push(line.replace(/^-\s*/, '').trim());
    }
  }
  return changes;
}

function _escUpdate(s){
  if(s==null) return '';
  return String(s).replace(/[<>&"']/g, function(c){
    return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c];
  });
}

function showUpdateCard(prevV, currV, changes){
  var existing = document.querySelector('.af-update-card');
  if(existing) existing.remove();

  var card = document.createElement('div');
  card.className = 'af-update-card';

  var changesHtml = '';
  if(changes.length > 0){
    changesHtml = '<ul class="af-update-list">' +
      changes.slice(0,5).map(function(c){
        return '<li>' + _escUpdate(c) + '</li>';
      }).join('') +
      '</ul>';
  }

  card.innerHTML =
    '<div class="af-update-header">' +
      '<span class="af-update-badge">v' + _escUpdate(currV) + '</span>' +
      '<span class="af-update-title">🚀 已更新到新版本</span>' +
      '<button class="af-update-close" title="关闭">×</button>' +
    '</div>' +
    '<div class="af-update-body">' +
      '<div class="af-update-ver">从 v' + _escUpdate(prevV) + ' → v' + _escUpdate(currV) + '</div>' +
      changesHtml +
    '</div>' +
    '<div class="af-update-footer">' +
      '<button class="af-update-reload">🔄 刷新页面</button>' +
      '<button class="af-update-dismiss">知道了</button>' +
    '</div>';

  document.body.appendChild(card);
  requestAnimationFrame(function(){ card.classList.add('af-update-card--show'); });

  card.querySelector('.af-update-close').addEventListener('click', function(){ dismissUpdateCard(card); });
  card.querySelector('.af-update-dismiss').addEventListener('click', function(){ dismissUpdateCard(card); });
  card.querySelector('.af-update-reload').addEventListener('click', function(){ location.reload(); });

  setTimeout(function(){
    if(card.parentNode) dismissUpdateCard(card);
  }, 12000);
}

function dismissUpdateCard(card){
  card.classList.remove('af-update-card--show');
  card.classList.add('af-update-card--out');
  setTimeout(function(){
    if(card.parentNode) card.parentNode.removeChild(card);
  }, 300);
}
