# 更新日志 (CHANGELOG)

## [2.9.1] - 2026-06-17

### 🐛 修复（iframe 内嵌页面抽屉弹窗自动关闭）
- **根因**: v2.9.0 的 keydown Escape 拦截器和 el-drawer emit 劫持只在 **主 document 和主 window** 上安装，iframe 内的 Escape/drawer 完全不被保护
- **修复**: 所有防护改为在 `getAllDocuments()` 返回的**所有同源 document 上安装**（包括 iframe 的 document 和 window）
  1. **document keydown 拦截** → 遍历 allDocs，在**每个 doc** 上安装 capture keydown handler
  2. **window keydown 拦截** → 遍历 allDocs，在**每个 doc.defaultView** 上安装 capture handler（iframe 的 window）
  3. **el-drawer emit 劫持** → 遍历 allDocs，在**每个 doc** 中查找 `.el-drawer` 并劫持 emit
- 清理时通过 `_drawerGuards` 数组中记录的 type 统一清理

### 📁 修改文件
- `autoFiller.js` — keydown 拦截 + emit 劫持改为全 document 遍历；移除不再使用的 `_docKeyGuard`

---

## [2.9.0] - 2026-06-17

### 🐛 修复（抽屉弹窗填写后自动关闭 — 终极修复）
- **根因**: 经排查，`closeDropdown()` 的 Escape 事件可能在 `window` 上被 el-drawer 捕获（而非 document），导致 `_docKeyGuard` 拦截不到；此外 el-drawer 的 `emit('update:modelValue', false)` 可能通过 Vue 组件树传播
- **修复（三重防护）**:
  1. **Overlay click 拦截** (原有) — capture 阶段拦截 overlay 上的 click 事件
  2. **document + window 双级 keydown Escape 拦截** (增强) — 新增 window 级别 capture 拦截器，确保无论 el-drawer 在 document 还是 window 上监听 Escape 都能拦截
  3. **el-drawer emit 劫持** (新增) — 通过 `__vueParentComponent` 找到 el-drawer 组件实例，劫持其 `emit` 函数，在填充期间阻止 `emit('update:modelValue', false)` 的调用，这是**最后一道防线**——无论什么路径触发关闭，都会被 emit 劫持拦截
- 清理时恢复所有劫持，无副作用

### 📁 修改文件
- `autoFiller.js` — 新增 `_docKeyGuard_window` 变量；installDrawerGuards 增加 window keydown 拦截 + el-drawer emit 劫持；uninstallDrawerGuards 清理所有防护

---

## [2.8.9] - 2026-06-17

### 🐛 修复（日期选择器依然未自动选择 — 全面改用 Vue emit）
- **根因（v2.8.8）**：`doDatePickerSelect` 通过面板交互（fireFullClick 打开面板 → 找单元格 → 点击选中）依赖 `.el-picker-panel` 等特定类名，不同 Element Plus 版本结构不同导致面板查找失败
- **修复**：彻底放弃面板交互，改用 `syncDatePickerModel()` 直接通过 Vue 组件内部 `emit('update:modelValue', val)` 更新响应式模型
  - 从 `.el-date-editor` 的 `__vueParentComponent` 向上遍历组件树
  - 找到有 `modelValue` props 的组件实例
  - 调用 `comp.emit('update:modelValue', dateValue)` 触发 v-model 更新
  - 不受 readonly input / 面板样式 / Element Plus 版本影响
- 同时保留 `setInputValue` 作为视觉反馈（不影响 readonly input）

### 📁 修改文件
- `autoFiller.js` — 删除 `doDatePickerSelect` + `findCellByText`；新增 `syncDatePickerModel`；date-picker 分支改为双路径（emit + input）

---

## [2.8.8] - 2026-06-17

### 🐛 修复（日期选择器被填入文本而非打开面板选择）
- **根因**: `<el-date-picker type="year">` 的 input 是 readonly 的，`setInputValue` 虽然能改 DOM 值但 Vue 响应式模型不更新，且效果是"填入内容"而非"选择"
- **修复**: 日期选择器改为 **fire-and-forget 面板交互模式**（同 radio-group），不再调用 `setInputValue`
  1. 新增 `doDatePickerSelect(el, label)` — 点击触发器打开面板 → 等待面板出现 → 找到对应年/月/日单元格 → 点击选中
  2. 新增 `findCellByText(panel, text, selector)` — 在面板中按文本查找单元格
  3. 智能识别选择器类型：`type="year"` → 选年份 / `type="month"` → 选月份 / 默认 → 选今天
  4. 兼容 Element Plus + Ant Design date-picker 类库

### 📁 修改文件
- `autoFiller.js` — 新增 `doDatePickerSelect()` + `findCellByText()`；`handleNonSelectFieldSync` 中 date-picker 分支改为面板交互

---

## [2.8.7] - 2026-06-17

### 🐛 修复（抽屉弹窗填写后自动关闭 — 根源修复）
- **根因**: `closeDropdown()` 派发的 `Escape` 键事件（`doc.dispatchEvent` 直接在 document 上派发）被 el-drawer 的 `keydown` 监听器捕获，触发其默认 `close-on-press-escape: true` 关闭 drawer
- **影响链路**: 每个下拉/级联选择完成后 → `closeDropdown` 发 Escape 到 document → 下拉面板关闭 ✅ → 事件到达 el-drawer 的 document 级 keydown handler → 抽屉关闭 ❌
- **修复（双层防护）**:
  1. **Overlay click 拦截**（capture 阶段）— 拦截 `fireFullClick` 产生的冒泡 click 事件在 `.el-overlay / .el-drawer__wrapper` 上，防止触发 `close-on-click-modal`
  2. **Document 级 Escape 拦截**（capture 阶段）— `closeDropdown` 在 document 上 dispatchEvent Escape 时，直接在其到达 el-drawer handler 之前 intercept，因为事件不经过 overlay，**必须**在 document 上 capture 拦截
- 新增 `_docKeyGuard` 变量存储文档级拦截器引用

### 📁 修改文件
- `autoFiller.js` — drawer guard 系统：增加 document 级 keydown(Escape) capture 拦截器；`uninstallDrawerGuards()` 同时清理 document 级拦截器

---

## [2.8.6] - 2026-06-17

### 🐛 修复（日期选择器被填入非日期文本）
- **根因**：`genValue()` 中日期关键词匹配不全，如"预计达产年份"的"年份""年"未匹配，落入兜底 pool 被分配了地址/文本数据
- **修复**：
  1. 新增 `genDateValue(label)` 函数，专用于日期选择器的值生成
  2. `handleNonSelectFieldSync` 中 `date-picker` 类型统一走 `genDateValue`，不经过 genValue 兜底
  3. genValue 扩展日期正则：增加 `年份`、`年$`（年结尾）、`月份`、`月$`（月结尾）、`日` 关键词
  4. 智能判断：标签含"年份"/年结尾且无月日 → 返回 YYYY（如"2026"）；含"年月" → 返回 YYYY-MM（如"2026-06"）；其余 → 返回 YYYY-MM-DD

### 📁 修改文件
- `autoFiller.js` — 新增 `genDateValue()`；修改 `handleNonSelectFieldSync` 增加 date-picker 分支；修改 `genValue()` 日期正则

---

## [2.8.5] - 2026-06-17

### ✨ 新功能（版本更新自动通知）
- **Chrome 系统通知**：扩展更新后弹出系统通知，显示版本号 + 更新内容摘要
  - 通知按钮1：🔄 一键刷新所有页面
  - 通知按钮2：📋 查看完整更新日志
- **页面内更新卡片**：在页面右下角显示渐变色更新卡片，展示从旧版本到新版本的变更列表
  - 刷新按钮：刷新当前页面加载新版本
  - 知道了按钮：关闭卡片
  - 12秒后自动消失
- **双保险检测机制**：
  1. background.js 的 `onInstalled` 事件 → 向所有 tab 发送 `extensionUpdated` 消息
  2. content.js 通过 `chrome.storage.local` 检测版本变化（旧页面可能收不到消息）
- 新增 `background.js` Service Worker
- 自动从 `CHANGELOG.md` 解析最新版本变更内容，无需手动维护

### 📁 修改文件
- `background.js` — 新建，监听 onInstalled + 系统通知 + tab 消息广播
- `manifest.json` — 添加 `notifications` 权限 + `background.service_worker`
- `content.js` — 添加 `extensionUpdated` 消息处理 + `checkVersionUpdate()` + `showUpdateCard()`
- `content.css` — 添加 `.af-update-card` 更新通知卡片样式

---

## [2.8.4] - 2026-06-17

### 🐛 修复（iframe 内嵌页面填写时抽屉弹窗被自动关闭）
- **根因**：`fireFullClick()` 末尾的 `el.click()` + `closeDropdown()` 的 `body.click()` 产生的冒泡 click 事件，传播到 el-drawer/el-dialog 遮罩层触发 `close-on-click-modal` 关闭
- **修复方案——抽屉防护系统**：
  1. 新增 `installDrawerGuards()` / `uninstallDrawerGuards()` 函数
  2. 填充开始时在**所有 document（含同源 iframe）**的遮罩层上安装 capture 阶段 click 拦截器
  3. 拦截器在 `_AFCtrl.running` 期间吃掉所有 click 事件的 `stopPropagation` + `stopImmediatePropagation`
  4. 填充结束后自动清理拦截器
  5. 覆盖：`.el-overlay` / `.el-drawer__wrapper` / `.el-dialog__wrapper` / `.ant-modal-wrap` / `.ant-drawer-wrap`

### 📁 修改文件
- `autoFiller.js` — 新增 drawer guard 系统；修改 `_fillAll` 启动/结束流程

---

## [2.8.3] - 2026-06-17

### 🐛 修复（抽屉弹窗填写完成后自动关闭）
- **根因**：`closeDropdown()` 函数在下拉选择完成后调用 `doc.body.click()` + 全局 `click` 事件冒泡来关闭下拉面板
- **影响链路**：`body.click()` → click 事件冒泡 → el-drawer/el-dialog 的遮罩层收到 click → `close-on-click-modal=true` 默认行为 → 抽屉弹窗被误关闭
- **修复**：移除 `doc.body.click()` 和全局 `MouseEvent('click')` 派发，仅保留 `Escape` 键关闭下拉（所有 el-select/el-cascader 都监听 Escape 关闭）

### 📁 修改文件
- `autoFiller.js` — `closeDropdown()` 移除危险的 body.click() 调用

---

## [2.7.1] - 2026-05-29

### 🐛 修复（清空表单——定位到下拉弹窗根因）
- **根本原因**：`clearViaDomBtn` 选择器匹配了 `.el-input__suffix .el-icon`（下拉箭头图标！），点击它触发了 wrapper 的 toggle → 下拉弹出一片
- **修复**：
  1. 清除按钮选择器精简为 9 个精确类名（如 `.el-select__clear-icon`），绝不匹配通用图标
  2. 只派发 `click` 事件（不派发 `mousedown/mouseup`，避免被 wrapper 的 toggle 捕获）
  3. `quietClear()` 替代 `forceInputClear`：不 blur，只 set value + input/change
  4. 每个字段先 blur + Escape 关闭下拉，再逐个清空

### 📁 修改文件
- `autoFiller.js` — 重写 `_clearAll()` / `clearViaDomBtn()` 选择器 / `quietClear()`

---

## [2.7.0] - 2026-05-29

### 🐛 修复（清空表单第四次重写——双路径兜底）
- **Vue 路径 `clearViaVue()`**：从 wrapper + 子元素收集 `__vueParentComponent`，向上走找到有 `modelValue` 的组件，emit/vnode.props/Ref.value 三级清空
- **DOM 路径 `clearViaDomBtn()`**：找到清除按钮后派发 `mousedown/mouseup/click` 事件，**关键突破：`bubbles:false`** → 只触发按钮自身 handler，不冒泡到 wrapper → 下拉不弹出
- 每个 select/cascader/date-picker 先走 Vue 路径，失败自动走 DOM 路径
- 控制台输出清空日志方便排查

### 📁 修改文件
- `autoFiller.js` — `_clearAll()` 重写 / 新增 `clearViaVue()` `clearViaDomBtn()` / 清理死代码

---

## [2.6.9] - 2026-05-29

### 🐛 修复（清空表单第三次重写——从 DOM 出发）
- **核心思路转变**：不再从 Vue app 根实例遍历组件树，改为从 **DOM 全量扫描** 
- **新方案 `clearAllVueSelectsByDom()`**：
  1. `doc.querySelectorAll('*')` 扫描所有 DOM 元素（含 iframe）
  2. 对每个元素的 `__vueParentComponent` 向上递归 `.parent`
  3. `getModelValue()` 检测 `setupState.modelValue` / `props.modelValue`
  4. **三级清空**：`emit('update:modelValue')` → `vnode.props 回调` → `Ref.value = ''` 直接写
  5. 零 DOM 事件派发，杜绝下拉弹出
- 相比之前方案：不依赖找 app 根、不依赖 vnode 树遍历、不漏组件

### 📁 修改文件
- `autoFiller.js` — `_clearAll()` / `clearAllVueSelectsByDom()` / `getModelValue()` 重写

---

## [2.6.8] - 2026-05-29

### 🐛 修复（清空表单完全重写）
- **彻底方案**：select/cascader/date-picker 清空改为"零 DOM 事件 + 全局 Vue 组件树遍历"
- **为什么之前不行**：
  - 任何 DOM 事件（mousedown/click 等）派发到 select/cascader 的子元素 → 事件冒泡触发 wrapper 的 toggle handler → 下拉弹出
  - 单个组件查找 Vue 实例不可靠（`__vueParentComponent` 可能指向 wrapper 而非组件本身）
- **新方案**：
  1. `findVueApp()` 找到页面 Vue 3 app 根实例
  2. `walkComponentTree()` 栈式 BFS 遍历整个组件树（含 children + dynamicChildren + component.subTree）
  3. `tryClearVueComponent()` 仅对 `setupState.modelValue` / `props.modelValue` 存在的组件调用 `emit('update:modelValue', empty)` 或 props callback
  4. 文本输入框单独走 `forceInputClear`（不再派发 Escape/blur 避免副作用）

### 📁 修改文件
- `autoFiller.js` — `_clearAll()` / 新增 `vueClearAllComponents()` `findVueApp()` `walkComponentTree()` `tryClearVueComponent()`

---

## [2.6.7] - 2026-05-29

### 🐛 修复（清空表单彻底重写）
- **根因**：`vueClearComponent` 依赖 `inst.type.name` 正则 `/Select|Cascader/i/` → 生产环境组件名混淆后永远匹配失败 → Vue 实例清空路径完全无效
- **下拉弹出问题**：Fallback 中 `mouseenter`/`mouseover` 事件派发到级联选择器容器 → 触发展开下拉面板
- **修复方案**：
  1. **彻底去掉 mouseenter/mouseover**：find clearBtn 不再派发任何悬停事件，click 只发 mousedown/mouseup/click
  2. **重写 Vue 实例查找**：`forceVueClear()` 不依赖组件名，改为遍历 `__vueParentComponent` / `_vnode` / `__vue_app__` 并通过 `inst.props.modelValue` + `inst.emit` 匹配组件
  3. **强制清空增强**：`forceInputClear()` 先 blur + Escape 关闭下拉 → 再清值 + input/change/blur 事件链

### 📁 修改文件
- `autoFiller.js` — `_clearAll()` / 新增 `forceVueClear()` `forceInputClear()` `collectVueInstances()` `collectSubComponents()`

---

## [2.6.6] - 2026-05-29

### 🐛 修复
- **清空表单bug**：`_clearAll()` 中 select/cascader 清空链路增强，新增三级兜底：
  1. Vue 实例清除（扩展 `__vue_app__` 树遍历 + `setupState.modelValue`）
  2. 点击 clear 图标
  3. 强制清空内部 input 值 + 派发 input/change 事件
- 日期选择器类型也纳入清空逻辑，走 Vue 清空 → 图标点击 → 强制清 input 三级兜底
- 停止按钮默认改为红色（红框粉底，hover 反色）

### 📁 修改文件
- `autoFiller.js` — `vueClearComponent()` 重写 + 新增 `vueClearByTree()` / `doVueEmitClear()` / `vueClearDatePicker()`
- `content.css` — `.af-filling-stop-btn` 默认红色
- `content.js` — 同步按钮文案保留

---

## [2.6.5] - 2026-05-29

### ✨ 新增
- **填充弹窗增加"停止"按钮**：`⏹ 停止填写` 按钮点击后立即调用 `_AF.stop()` 中断填充并关闭弹窗，同时 toast 提示"已停止填写"
- 按钮默认灰色低调，hover 时变红，避免误触

### 📁 修改文件
- `content.css` — 新增 `.af-filling-stop-btn` 样式（灰底黑字 → hover 红字红框）
- `content.js` — `showFilling()` 增加停止按钮及点击事件绑定

---

## [2.6.4] - 2026-05-29

### ✨ 优化
- **填充中弹窗升级**：从左上角 toast 改为页面居中模态遮罩，带旋转加载动画 + "正在自动填写表单" 标题，半透明背景遮罩确保用户无法误操作页面，填写完成后自动关闭再显示结果

### 📁 修改文件
- `content.css` — 新增 `.af-filling-overlay` / `.af-filling-card` / `.af-filling-spinner` 等居中加载弹窗样式
- `content.js` — 新增 `showFilling()` / `hideFilling()` 函数，`doFill()` 改用居中弹窗替代 toast

---

## [2.6.3] - 2026-05-29

### ✨ 优化
- **填充中菜单不消失**：从浮动菜单点击"一键填写"后，菜单保持显示加载状态，填充完成后才自动关闭
- **已有值保留不覆盖**：增强 `getFieldCurrentValue()` 检测逻辑，识别 Element/Ant 组件（el-select / el-cascader / date-picker 等）已选中的值，检测到已有值的字段自动跳过不再填写

### 📁 修改文件
- `autoFiller.js` — `getFieldCurrentValue()` 增强：遍历外层面板容器检测 `.el-tag__content`、`.el-select__placeholder`、`.el-cascader__label`、date-picker input 等
- `content.js` — `doFill()` 新增 `onDone` 回调；菜单"一键填写"按钮改为异步等待完成后关闭；完成提示文案调整

---

## [2.6.2] - 2026-05-29

### 🐛 修复
- **日期选择器类型识别问题**：`getType()` 新增 `.el-date-editor`、`.el-time-picker`、`.ant-picker` 等日期/时间选择器容器检测，返回 `date-picker` 类型
- **日期相关标签值生成修复**：`genValue()` 新增 `时间|time|应收|回款|到期|开始|截止|生效` 匹配规则，避免日期选择器被填入随机文本
- **兜底扫描遗漏修复**：`scanFields()` wrapperFallback 加入 `.el-date-editor` 等日期选择器容器
- **兜底值生成对齐**：`content.js genFallbackValue()` 同步新增时间相关标签正则
- **预览面板显示**：`date-picker` 类型显示为蓝色"日期"标签，新增 `.af-type-date` 样式

### 📁 修改文件
- `autoFiller.js` — `getType()` / `genValue()` / `scanFields()` wrapperFallback
- `content.js` — `genFallbackValue()` / 预览面板类型分类
- `content.css` — 新增 `.af-type-date` 样式

---

## [2.6.1] - 之前

- Element Plus 2.4+ 兼容性修复
- iframe 内嵌表单支持
- 多轮填充引擎 (v10)
- 级联选择器递归选中
- 下拉选择器点击+键盘兜底
- 数字输入区间智能生成
- checkbox/radio-group 处理
