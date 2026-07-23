// sidepanel.js - v10 AI智能版（Side Panel 侧边栏版本）
// 简化版：内置默认 API Key，UI 只保留模式开关
document.addEventListener('DOMContentLoaded', () => {
  const fillBtn = document.getElementById('fillBtn');
  const fillBtnText = document.getElementById('fillBtnText');
  const clearBtn = document.getElementById('clearBtn');
  const statusBar = document.getElementById('statusBar');
  const fieldList = document.getElementById('fieldList');
  const resultStats = document.getElementById('resultStats');

  // AI 配置元素
  const aiToggle = document.getElementById('aiToggle');
  const topModeBadge = document.getElementById('topModeBadge');

  // ★ 内置默认 API Key
  const DEFAULT_API_KEY = 'sk-e1a584e3325e4e40bb6e048a62ca047f';

  // 全局状态
  var aiEnabled = false;

  // 更新顶部模式徽章
  function updateTopModeBadge(isAI){
    aiEnabled = isAI;
    if(isAI){
      topModeBadge.className = 'top-mode-badge ai';
      topModeBadge.innerHTML =
        '<span class="mode-icon">🤖</span>' +
        '<div class="mode-info">' +
          '<span class="mode-name">当前模式：AI 智能模式</span>' +
          '<span class="mode-desc">DeepSeek 理解表单语义 · 智能生成真实数据</span>' +
        '</div>';
    }else{
      topModeBadge.className = 'top-mode-badge';
      topModeBadge.innerHTML =
        '<span class="mode-icon">📋</span>' +
        '<div class="mode-info">' +
          '<span class="mode-name">当前模式：规则模式</span>' +
          '<span class="mode-desc">基于字段名匹配生成测试数据</span>' +
        '</div>';
    }
  }

  // 通知 content script
  function notifyContent(enabled){
    chrome.tabs.query({active:true, currentWindow:true}, function(tabs){
      if(tabs[0]){
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'setAI',
          enabled: enabled,
          apiKey: DEFAULT_API_KEY  // ★ 始终发送内置 Key
        });
      }
    });
  }

  // ========== AI 配置逻辑 ==========

  // 从 storage 加载配置
  chrome.storage.local.get(['af_ai_enabled'], function(result) {
    var enabled = !!result.af_ai_enabled;
    if(enabled){
      aiToggle.checked = true;
      updateTopModeBadge(true);
    }else{
      aiToggle.checked = false;
      updateTopModeBadge(false);
    }
  });

  // ★ 模式徽章可点击切换
  topModeBadge.addEventListener('click', function(){
    if(aiEnabled){
      aiToggle.checked = false;
      aiToggle.dispatchEvent(new Event('change'));
    }else{
      aiToggle.checked = true;
      aiToggle.dispatchEvent(new Event('change'));
    }
  });

  // 切换 AI 开关
  aiToggle.addEventListener('change', function() {
    var checked = this.checked;
    if(checked){
      chrome.storage.local.set({ af_ai_enabled: true, af_api_key: DEFAULT_API_KEY });
      updateTopModeBadge(true);
      notifyContent(true);
    }else{
      chrome.storage.local.set({ af_ai_enabled: false });
      updateTopModeBadge(false);
      notifyContent(false);
    }
  });

  // ========== 一键填写 ==========
  fillBtn.addEventListener('click', () => {
    var isAI = aiEnabled;
    fillBtn.classList.add('loading');
    fillBtnText.innerHTML = '<span class="spinner"></span>' + (isAI ? '正在AI智能分析...' : '正在扫描并填写...');
    fillBtn.disabled = true;

    showStatus('🔍 正在扫描页面表单字段（含iframe）...', 'info');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { doneLoading(); return; }

      const tabId = tabs[0].id;

      chrome.tabs.sendMessage(tabId, { action: 'getFormData' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus(`❌ ${chrome.runtime.lastError.message}\n请确认已在目标页面上，然后刷新页面后重试`, 'error');
          doneLoading();
          return;
        }

        if (!response?.fields || response.fields.length === 0) {
          showStatus('⚠️ 当前页面未发现可填写的表单\n确保页面已完全加载且不是登录页/搜索页', 'error');
          doneLoading();
          renderFieldList([]);
          return;
        }

        const fields = response.fields;
        const textCount = fields.filter(f => !['el-select','el-cascader','ant-select','ant-cascader','select'].includes(f.type)).length;
        const selectCount = fields.length - textCount;
        const iframeCount = fields.filter(f => f.iframe).length;

        renderFieldList(fields);
        showResultStats(fields.length, textCount, selectCount, iframeCount);

        var estTime = isAI ? Math.max(3, fields.length * 0.5) : Math.max(1.5, fields.length * 0.3);
        var iframeTip = iframeCount > 0 ? '\n📦 其中 ' + iframeCount + ' 个字段来自iframe内嵌页面' : '';
        var aiTip = isAI ? '\n🤖 DeepSeek AI 将智能分析并生成真实数据...' : '';
        showStatus(`✅ 检测到 ${fields.length} 个字段（${textCount}文本 + ${selectCount}下拉/级联）${iframeTip}${aiTip}\n⏳ 开始串行填充（预计 ${estTime.toFixed(1)}s）...`, 'info');

        chrome.tabs.sendMessage(tabId, { action: 'fillForm', data: {} }, (fillResponse) => {
          doneLoading();

          if (fillResponse && fillResponse.success) {
            var filled = fillResponse.filledCount || 0;
            var cascaded = fillResponse.cascadedCount || 0;
            var total = fillResponse.totalCount || fields.length;
            var details = fillResponse.details || [];
            var usedAI = fillResponse.aiEnabled;

            var msg =
              `🎉 填写完成！${usedAI ? ' 🤖' : ''}\n` +
              `━━━━━━━━━━━━━━━━━━━\n` +
              `📝 手动填写：${filled} 个字段\n` +
              `⚡ 联动带出：${cascaded} 个字段\n` +
              `📊 总计处理：${total} 个字段`;

            if (usedAI) {
              msg += `\n🤖 数据来源：DeepSeek AI 智能生成`;
            }
            if (iframeCount > 0) {
              msg += `\n📦 包含 ${details.filter(d=>d.iframe).length} 个iframe内嵌字段`;
            }

            msg += `\n━━━━━━━━━━━━━━━━━━━\n`;
            msg += `\n💡 每个字段按从上到下顺序逐一处理`;

            showStatus(msg, 'success');

            if (details.length > 0) {
              renderFieldListWithResults(fields, details);
            }

          } else {
            var errMsg = fillResponse?.error || '未知错误';
            if (errMsg.indexOf('AI调用失败') >= 0 || errMsg.indexOf('API') >= 0) {
              errMsg = errMsg
                .replace('AI调用失败: ', '')
                .replace('API请求失败: ', '');
              showStatus(
                `❌ DeepSeek AI 调用失败\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `错误原因：${errMsg}\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `请检查：\n` +
                `1. API Key 是否正确（sk-xxx）\n` +
                `2. 网络是否能访问 api.deepseek.com\n` +
                `3. 账户是否有余额`,
                'error'
              );
            } else {
              showStatus(
                `⚠️ 填充过程中出现问题：${errMsg}\n` +
                `按 F12 打开控制台可查看详细日志`,
                'error'
              );
            }
          }
        });
      });
    });
  });

  // ========== 清空 ==========
  clearBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'clearForm' }, (r) => {
        if (r?.success) {
          showStatus('🗑️ 已清空所有表单字段（含iframe）', 'info');
          resultStats.style.display = 'none';
        }
      });
    });
  });

  function doneLoading() {
    fillBtn.classList.remove('loading');
    fillBtnText.innerHTML = '<span class="btn-icon">✨</span> 一键填写全部字段';
    fillBtn.disabled = false;
  }

  function showResultStats(total, text, select, iframe) {
    resultStats.style.display = 'flex';
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statText').textContent = text;
    document.getElementById('statSelect').textContent = select;
    var iframeEl = document.getElementById('statIframe');
    if (iframeEl) iframeEl.textContent = iframe;
  }

  function showStatus(msg, type) {
    statusBar.className = `status-bar status-${type || 'info'}`;
    statusBar.innerHTML = msg.replace(/\n/g, '<br>');
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderFieldList(fields) {
    if (!fields || fields.length === 0) {
      fieldList.innerHTML = '<div class="no-fields">未检测到表单字段</div>';
      return;
    }

    var html = '';
    fields.forEach(function(f, i) {
      var typeClass = 'type-text';
      var typeText = f.type;
      var iframeTag = f.iframe ? '<span class="iframe-tag" title="iframe内嵌">iframe</span>' : '';
      var disabledTag = f.disabled ? '<span class="disabled-tag" title="当前禁用，多轮填充会等依赖字段解锁后重试">禁用</span>' : '';
      var itemClass = f.disabled ? 'field-item field-item--disabled' : 'field-item';

      if (['el-select','ant-select','select'].indexOf(f.type) !== -1) { typeClass = 'type-select'; typeText = '下拉'; }
      else if (['el-cascader','ant-cascader'].indexOf(f.type) !== -1) { typeClass = 'type-cascader'; typeText = '级联'; }
      else if (f.type === 'radio-group') { typeClass = 'type-radio'; typeText = '单选'; }
      else if (f.type === 'number') { typeClass = 'type-number'; typeText = '数字'; }
      else { typeText = '文本'; }

      html +=
        '<div class="'+itemClass+'">' +
          '<span class="field-num">'+(i+1)+'</span>' +
          '<span class="field-label" title="'+esc(f.label)+'\nplaceholder: '+esc(f.placeholder)+(f.disabled?'\n[当前禁用]':'')+'\ncurrent: '+esc(f.currentValue)+'">'+(esc(f.label) || '(未命名)')+'</span>' +
          '<span class="field-type-tag '+typeClass+'">'+typeText+'</span>' +
          disabledTag +
          iframeTag +
        '</div>';
    });

    fieldList.innerHTML = html;
  }

  function renderFieldListWithResults(fields, results) {
    if (!fields || fields.length === 0) {
      fieldList.innerHTML = '<div class="no-fields">未检测到表单字段</div>';
      return;
    }

    var html = '';
    fields.forEach(function(f, i) {
      var r = results && results[i] ? results[i] : {};
      var actionText = r.action || '⏳ 等待';

      var typeClass = 'type-text';
      var typeText = f.type;
      var iframeTag = (f.iframe || r.iframe) ? '<span class="iframe-tag" title="iframe内嵌">iframe</span>' : '';

      if (['el-select','select'].indexOf(f.type) !== -1) { typeClass = 'type-select'; typeText = '下拉'; }
      else if (f.type === 'el-cascader') { typeClass = 'type-cascader'; typeText = '级联'; }
      else { typeText = '文本'; }

      var actionClass = '';
      if (actionText.indexOf('联动') !== -1 || actionText.indexOf('⚡') !== -1) actionClass = 'cascaded';
      else if (actionText.indexOf('AI') !== -1) actionClass = 'ai-filled';
      else if (actionText.indexOf('填写') !== -1 || actionText.indexOf('OK') !== -1 || actionText.indexOf('选中') !== -1) actionClass = 'filled';
      else if (actionText.indexOf('失败') !== -1 || actionText.indexOf('FAIL') !== -1 || actionText.indexOf('❌') !== -1) actionClass = 'failed';

      html +=
        '<div class="field-item '+actionClass+'">' +
          '<span class="field-num">'+(i+1)+'</span>' +
          '<span class="field-label" title="'+esc(f.label)+'\n操作: '+actionText+'\n值: '+esc(r.value||'')+'">'+(esc(f.label) || '(未命名)')+'</span>' +
          '<span class="field-type-tag '+typeClass+'">'+typeText+'</span>' +
          '<span class="field-action" title="'+esc(r.value||'')+'">'+actionText+'</span>' +
          iframeTag +
        '</div>';
    });

    fieldList.innerHTML = html;
  }

  // ========== 使用说明弹窗 ==========
  const helpBtn = document.getElementById('helpBtn');
  const helpModalOverlay = document.getElementById('helpModalOverlay');
  const helpCloseBtn = document.getElementById('helpCloseBtn');

  // 显示当前版本号
  try {
    var ver = chrome.runtime.getManifest().version || '3.7.1';
    var versionTag = document.getElementById('versionTag');
    var modalVersion = document.getElementById('modalVersion');
    if (versionTag) versionTag.textContent = 'v' + ver;
    if (modalVersion) modalVersion.textContent = ver;
  } catch(e) {}

  function openHelpModal() {
    helpModalOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeHelpModal() {
    helpModalOverlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  helpBtn.addEventListener('click', openHelpModal);
  helpCloseBtn.addEventListener('click', closeHelpModal);
  helpModalOverlay.addEventListener('click', function(e) {
    if (e.target === helpModalOverlay) closeHelpModal();
  });
  // ESC 关闭
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && helpModalOverlay.classList.contains('show')) {
      closeHelpModal();
    }
  });
});
