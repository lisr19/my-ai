// background.js - Service Worker
// 监听扩展安装/更新，显示系统通知 + 通知所有标签页

chrome.runtime.onInstalled.addListener(function(details) {
  var currentVersion = chrome.runtime.getManifest().version;

  if (details.reason === 'install') {
    chrome.notifications.create('af-install', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🚀 智能表单自动填充 已安装',
      message: '感谢安装！\n\n点击页面右下角紫色浮动按钮即可自动填写表单。\n\n支持 Element UI / Ant Design / 原生表单 / iframe 内嵌表单',
      priority: 2
    });
  } else if (details.reason === 'update') {
    var previousVersion = details.previousVersion;

    // 读取 CHANGELOG.md 解析最新版本更新内容
    fetch(chrome.runtime.getURL('CHANGELOG.md'))
      .then(function(r) { return r.text(); })
      .then(function(text) {
        var changes = parseLatestChangelog(text);
        showUpdateNotification(previousVersion, currentVersion, changes);
        notifyAllTabs(previousVersion, currentVersion, changes);
      })
      .catch(function() {
        showUpdateNotification(previousVersion, currentVersion, []);
        notifyAllTabs(previousVersion, currentVersion, []);
      });
  }
});

// 解析 CHANGELOG.md 最新版本的变更列表
function parseLatestChangelog(text) {
  var lines = text.split('\n');
  var changes = [];
  var inLatest = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^##\s*\[/.test(line)) {
      if (inLatest) break;
      inLatest = true;
      continue;
    }
    if (inLatest && /^-\s/.test(line)) {
      changes.push(line.replace(/^-\s*/, '').trim());
    }
  }
  return changes;
}

// 显示 Chrome 系统通知
function showUpdateNotification(prevV, currV, changes) {
  var message = 'v' + prevV + ' → v' + currV + '\n';
  if (changes.length > 0) {
    message += '\n更新内容：\n';
    changes.slice(0, 4).forEach(function(c) {
      message += '• ' + c + '\n';
    });
  }
  message += '\n💡 请刷新页面以加载最新版本';

  chrome.notifications.create('af-update-' + currV, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '🚀 智能表单自动填充 已更新到 v' + currV,
    message: message,
    priority: 2,
    buttons: [
      { title: '🔄 刷新所有页面' },
      { title: '📋 查看更新日志' }
    ]
  });
}

// 通知所有标签页（页面内显示更新卡片）
function notifyAllTabs(prevV, currV, changes) {
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'extensionUpdated',
        previousVersion: prevV,
        version: currV,
        changes: changes
      }, function() {
        if (chrome.runtime.lastError) { /* 页面没有 content script，忽略 */ }
      });
    });
  });
}

// 通知按钮点击处理
chrome.notifications.onButtonClicked.addListener(function(notifId, btnIdx) {
  if (notifId.indexOf('af-update') === 0) {
    if (btnIdx === 0) {
      // 刷新所有 http/https 页面
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(function(tab) {
          if (tab.url && /^https?:/.test(tab.url)) {
            chrome.tabs.reload(tab.id);
          }
        });
      });
    } else if (btnIdx === 1) {
      // 打开更新日志
      chrome.tabs.create({
        url: 'chrome-extension://' + chrome.runtime.id + '/CHANGELOG.md'
      });
    }
    chrome.notifications.clear(notifId);
  }
});

// 点击通知体本身 → 关闭
chrome.notifications.onClicked.addListener(function(notifId) {
  chrome.notifications.clear(notifId);
});
