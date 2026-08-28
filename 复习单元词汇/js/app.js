/* ============================================================
 * 复习单元词汇 - 主应用（Vue 3 全局构建版，无构建步骤）
 * ============================================================ */
const { createApp, reactive, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

/* ---------------- 全局状态 ---------------- */
const store = reactive({
  ready: false,
  activeTab: 'library',
  libraries: [],
  currentLibId: null,
  wordsByLib: {},   // libId -> words[]
  reviewFilter: '__all__', // 复习页范围（错词本跳转共用）
  settings: { accent: 'us', rate: 1, autoInterval: 3 },
});

const tabs = [
  { id: 'library', name: '词库管理' },
  { id: 'review', name: '单词复习' },
  { id: 'match', name: '连线练习' },
  { id: 'wrong', name: '错词本' },
];

/* ---------------- 通用工具 ---------------- */
const toast = reactive({ show: false, msg: '', type: 'info' });
let toastTimer = null;
function showToast(msg, type = 'info', duration = 2600) {
  if (window.ElementPlus && window.ElementPlus.ElMessage) {
    const map = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
    window.ElementPlus.ElMessage({ message: msg, type: map[type] || 'info', duration });
  }
  toast.msg = msg;
  toast.type = type;
  toast.show = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.show = false), duration);
}

/** Promise 风格确认框（基于 ElMessageBox），返回 true/false */
function confirmDialog(message, title = '提示', type = 'warning') {
  if (window.ElementPlus && window.ElementPlus.ElMessageBox) {
    return window.ElementPlus.ElMessageBox.confirm(message, title, {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type,
    }).then(() => true).catch(() => false);
  }
  return Promise.resolve(window.confirm(message));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------- 提示音（Web Audio，无需音频文件） ---------------- */
const Sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, start, dur, type = 'sine', vol = 0.18) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },
  correct() {
    // 清脆上行双音（叮咚）
    this.tone(660, 0, 0.12, 'sine', 0.2);
    this.tone(990, 0.09, 0.22, 'sine', 0.2);
  },
  wrong() {
    // 低沉短促双音（嘟嗡）
    this.tone(220, 0, 0.16, 'square', 0.08);
    this.tone(160, 0.12, 0.28, 'square', 0.08);
  },
  finish() {
    // 完成小琶音（叮咚叮咚叮）
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.12, 0.25, 'sine', 0.18));
  },
};

function speak(text) {
  if (!text) return;
  if (!VocabSpeech.supported) {
    showToast('当前浏览器不支持语音合成功能', 'error');
    return;
  }
  VocabSpeech.speak(text, { accent: store.settings.accent, rate: store.settings.rate });
}

/* ---------------- 数据加载 ---------------- */
async function refreshLibraries() {
  store.libraries = await VocabDB.getAllLibraries();
  if (!store.libraries.some((l) => l.id === store.currentLibId)) {
    store.currentLibId = store.libraries[0] ? store.libraries[0].id : null;
  }
}

async function loadAllWords() {
  const map = {};
  for (const lib of store.libraries) {
    map[lib.id] = await VocabDB.getWords(lib.id);
  }
  store.wordsByLib = map;
}

const currentWords = computed(() => store.wordsByLib[store.currentLibId] || []);

const totalWrong = computed(() =>
  store.libraries.reduce(
    (n, lib) => n + (store.wordsByLib[lib.id] || []).filter((w) => w.status === 'wrong').length,
    0
  )
);

/* ============================================================
 * 页面一：词库管理
 * ============================================================ */
const libraryView = {
  template: `
  <div class="view">
    <div class="toolbar">
      <el-button type="primary" :icon="null" @click="triggerFile">📥 导入 Excel 词库</el-button>
      <el-button @click="VocabExcel.downloadTemplate()">📄 下载导入模板</el-button>
      <el-button @click="openSamplePicker">📗 示例词库（下载 / 载入）</el-button>
      <div class="spacer"></div>
      <el-button size="small" @click="exportBackup">导出备份</el-button>
      <el-button size="small" @click="triggerBackup">导入备份</el-button>
      <el-button size="small" type="danger" plain @click="clearAll">清空数据</el-button>
      <input ref="fileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onFileChange">
      <input ref="backupInput" type="file" accept=".json" style="display:none" @change="onBackupChange">
    </div>

    <el-empty v-if="!store.libraries.length" description="还没有词库，导入 Excel 或载入示例词库开始复习">
      <el-button type="primary" @click="openSamplePicker">✨ 载入示例词库</el-button>
    </el-empty>

    <div v-else class="lib-grid">
      <div v-for="lib in store.libraries" :key="lib.id"
           :class="['lib-card', { active: lib.id === store.currentLibId }]"
           @click="selectLib(lib)">
        <div class="lib-card-head">
          <h3>{{ lib.name }}</h3>
          <span class="lib-date">{{ formatDate(lib.createdAt) }}</span>
        </div>
        <div class="lib-stats">
          <span>📚 {{ libWords(lib).length }} 词</span>
          <span>✅ {{ libMastered(lib) }} 已掌握</span>
          <span>❌ {{ libWrong(lib) }} 错词</span>
          <span>📁 {{ libUnits(lib).length }} 单元</span>
        </div>
        <el-progress :percentage="masteryPct(lib)" :stroke-width="10" :show-text="false"
                     :color="'#6366f1'" class="lib-progress" />
        <div class="lib-actions" @click.stop>
          <el-tag v-if="lib.id === store.currentLibId" type="success" size="small" effect="dark">当前使用</el-tag>
          <el-button size="small" type="primary" @click="selectLib(lib)">去复习</el-button>
          <el-button size="small" type="danger" plain @click="deleteLib(lib)">删除</el-button>
        </div>
      </div>
    </div>

    <!-- 示例词库选择弹窗 -->
    <el-dialog v-model="samplePicker.show" title="📗 示例词库（人教版初中英语）" width="560px">
      <p class="muted">选择一册直接载入体验，或下载 Excel 查看格式 / 自行编辑后导入。</p>
      <div class="sample-list">
        <div v-for="b in sampleBooks" :key="b.key" class="sample-item">
          <div class="sample-info">
            <div class="sample-name">{{ b.name.replace('示例词库-', '') }}</div>
            <div class="sample-meta">{{ b.words.length }} 词 · {{ unitCountOf(b) }} 个单元</div>
          </div>
          <div class="sample-ops">
            <el-button size="small" @click="VocabExcel.downloadSample(b.key)">下载 Excel</el-button>
            <el-button size="small" type="primary" @click="loadSample(b.key)">载入词库</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="samplePicker.show = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 导入预览弹窗 -->
    <el-dialog v-model="im.show" title="导入预览" width="560px">
      <p>文件：{{ im.fileName }}</p>
      <div class="form-row">
        <label>词库名称：</label>
        <el-input v-model="im.libName" :disabled="im.mode !== 'new'" style="max-width:280px" />
      </div>
      <p>解析到 <b>{{ im.words.length }}</b> 个单词，共 <b>{{ im.units.length }}</b> 个单元：</p>
      <div class="chip-wrap">
        <el-tag v-for="u in im.units" :key="u" class="chip" effect="plain" round>{{ u }}</el-tag>
      </div>
      <div v-if="im.existing" class="form-row">
        <label>同名词库已存在：</label>
        <el-select v-model="im.mode" style="width:260px">
          <el-option label="追加到现有词库（自动去重）" value="append" />
          <el-option label="覆盖现有词库（旧数据将被替换）" value="overwrite" />
        </el-select>
      </div>
      <el-alert v-if="im.errors.length" type="warning" :closable="false" show-icon
                :title="im.errors.length + ' 条提示'" class="import-errors">
        <ul><li v-for="(e, i) in im.errors" :key="i">{{ e }}</li></ul>
      </el-alert>
      <template #footer>
        <el-button @click="im.show = false">取消</el-button>
        <el-button type="primary" @click="doImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
  `,
  setup() {
    const fileInput = ref(null);
    const backupInput = ref(null);
    const im = reactive({
      show: false, fileName: '', words: [], units: [], errors: [],
      libName: '', mode: 'new', existing: null,
    });

    function triggerFile() { fileInput.value.click(); }
    function triggerBackup() { backupInput.value.click(); }

    async function onFileChange(e) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const { words, units, errors } = await VocabExcel.parseExcelFile(file);
        if (!words.length) {
          showToast(errors[0] || '未解析到有效单词', 'error');
          return;
        }
        const baseName = file.name.replace(/\.(xlsx|xls)$/i, '');
        const existing = store.libraries.find((l) => l.name === baseName) || null;
        im.fileName = file.name;
        im.words = words;
        im.units = units;
        im.errors = errors;
        im.libName = baseName;
        im.mode = existing ? 'append' : 'new';
        im.existing = existing;
        im.show = true;
      } catch (err) {
        showToast('文件解析失败：' + err.message, 'error');
      }
    }

    async function doImport() {
      const name = im.libName.trim();
      if (!name) { showToast('请填写词库名称', 'error'); return; }

      let libId;
      if (im.mode === 'overwrite' && im.existing) {
        libId = im.existing.id;
        await VocabDB.clearWordsByLib(libId);
        store.wordsByLib[libId] = [];
      } else if (im.mode === 'append' && im.existing) {
        libId = im.existing.id;
      } else {
        libId = 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        await VocabDB.putLibrary({ id: libId, name, createdAt: Date.now() });
      }

      let words = im.words.map((w) => ({
        id: VocabDB.genId(),
        libId, status: 'new', wrongCount: 0, lastReviewAt: null, ...w,
      }));

      let skipped = 0;
      if (im.mode === 'append') {
        const have = new Set((store.wordsByLib[libId] || []).map((w) => w.word.toLowerCase()));
        const before = words.length;
        words = words.filter((w) => !have.has(w.word.toLowerCase()));
        skipped = before - words.length;
      }

      if (words.length) await VocabDB.addWords(words);
      store.wordsByLib[libId] = await VocabDB.getWords(libId);
      await refreshLibraries();
      store.currentLibId = libId;
      im.show = false;
      showToast(
        `导入成功：新增 ${words.length} 个单词` + (skipped ? `，跳过重复 ${skipped} 个` : ''),
        'success'
      );
      store.activeTab = 'review';
    }

    const samplePicker = reactive({ show: false });
    const sampleBooks = VocabExcel.sampleBooks();
    const unitCountOf = (b) => new Set(b.words.map((r) => r[0])).size;

    function openSamplePicker() {
      samplePicker.show = true;
    }

    async function loadSample(key) {
      const book = sampleBooks.find((b) => b.key === key) || sampleBooks[0];
      if (!book) { showToast('示例词库数据未加载', 'error'); return; }
      const name = book.name;
      const existing = store.libraries.find((l) => l.name === name);
      if (existing) {
        samplePicker.show = false;
        store.currentLibId = existing.id;
        store.reviewFilter = '__all__';
        store.activeTab = 'review';
        showToast(`「${name}」已存在，已为你切换`, 'info');
        return;
      }
      const libId = 'lib_sample_' + Date.now();
      await VocabDB.putLibrary({ id: libId, name, createdAt: Date.now() });
      const words = VocabExcel.sampleWords(book.key).map((w) => ({
        id: VocabDB.genId(),
        libId, status: 'new', wrongCount: 0, lastReviewAt: null, ...w,
      }));
      await VocabDB.addWords(words);
      store.wordsByLib[libId] = await VocabDB.getWords(libId);
      await refreshLibraries();
      samplePicker.show = false;
      store.currentLibId = libId;
      store.reviewFilter = '__all__';
      showToast(`「${name}」已载入，共 ${words.length} 个单词`, 'success');
      store.activeTab = 'review';
    }

    function selectLib(lib) {
      store.currentLibId = lib.id;
      store.activeTab = 'review';
    }

    async function deleteLib(lib) {
      const ok = await confirmDialog(`确定删除词库「${lib.name}」吗？该词库的所有单词和学习记录将被删除，不可恢复。`, '删除词库', 'error');
      if (!ok) return;
      await VocabDB.deleteLibrary(lib.id);
      delete store.wordsByLib[lib.id];
      await refreshLibraries();
      showToast('词库已删除', 'success');
    }

    async function exportBackup() {
      if (!store.libraries.length) { showToast('暂无数据可备份'); return; }
      const data = await VocabDB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `词汇复习备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('备份文件已下载', 'success');
    }

    function onBackupChange(e) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.libraries) || !Array.isArray(data.words)) {
            throw new Error('缺少 libraries/words 数据');
          }
          const ok = await confirmDialog('导入备份将覆盖当前所有词库和学习记录，确定继续吗？', '导入备份', 'warning');
          if (!ok) return;
          await VocabDB.importData(data);
          store.wordsByLib = {};
          await refreshLibraries();
          await loadAllWords();
          showToast('备份导入成功', 'success');
        } catch (err) {
          showToast('备份文件无效：' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    }

    async function clearAll() {
      if (!store.libraries.length) { showToast('暂无数据'); return; }
      const ok = await confirmDialog('确定清空所有词库和学习记录吗？此操作不可恢复！', '清空全部数据', 'error');
      if (!ok) return;
      await VocabDB.clearAll();
      store.wordsByLib = {};
      await refreshLibraries();
      showToast('已清空全部数据', 'success');
    }

    const libWords = (lib) => store.wordsByLib[lib.id] || [];
    const libMastered = (lib) => libWords(lib).filter((w) => w.status === 'mastered').length;
    const libWrong = (lib) => libWords(lib).filter((w) => w.status === 'wrong').length;
    const libUnits = (lib) => [...new Set(libWords(lib).map((w) => w.unit))];
    const masteryPct = (lib) => {
      const ws = libWords(lib);
      return ws.length ? Math.round((libMastered(lib) / ws.length) * 100) : 0;
    };

    return {
      store, im, fileInput, backupInput, VocabExcel, formatDate,
      triggerFile, triggerBackup, onFileChange, doImport, loadSample,
      selectLib, deleteLib, exportBackup, onBackupChange, clearAll,
      libWords, libMastered, libWrong, libUnits, masteryPct,
      samplePicker, sampleBooks, unitCountOf, openSamplePicker,
    };
  },
};

/* ============================================================
 * 页面二：单词复习（卡片模式）
 * ============================================================ */
const reviewView = {
  template: `
  <div class="view">
    <div v-if="!currentWords.length" class="empty">
      当前词库还没有单词。请先到「词库管理」导入词汇表，或载入示例词库。
    </div>
    <template v-else>
      <div class="control-bar">
        <label>词库
          <el-select v-model="store.currentLibId" size="small" class="ctrl-select">
            <el-option v-for="l in store.libraries" :key="l.id" :label="l.name" :value="l.id" />
          </el-select>
        </label>
        <label>范围
          <el-select v-model="store.reviewFilter" size="small" class="ctrl-select">
            <el-option :label="'全部单词（' + currentWords.length + '）'" value="__all__" />
            <el-option :label="'错词本（' + libWrongCount + '）'" value="__wrong__" />
            <el-option v-for="u in units" :key="u" :label="u + '（' + unitCount(u) + '）'" :value="u" />
          </el-select>
        </label>
        <div class="spacer"></div>
        <label>口音
          <el-select v-model="store.settings.accent" size="small" class="ctrl-mini">
            <el-option label="🇺🇸 美式" value="us" />
            <el-option label="🇬🇧 英式" value="uk" />
          </el-select>
        </label>
        <label>语速
          <el-select v-model="store.settings.rate" size="small" class="ctrl-mini">
            <el-option label="慢" :value="0.7" />
            <el-option label="正常" :value="1" />
            <el-option label="快" :value="1.3" />
          </el-select>
        </label>
      </div>

      <div v-if="!deckWords.length" class="empty">
        {{ store.reviewFilter === '__wrong__' ? '🎉 错词本是空的，全部掌握啦！' : '该范围没有单词。' }}
      </div>
      <template v-else>
        <div class="review-progress">
          <div class="progress-text">{{ idx + 1 }} / {{ order.length }}</div>
          <el-progress :percentage="Math.round(((idx + 1) / order.length) * 100)" :stroke-width="10"
                       :show-text="false" color="#6366f1" />
        </div>

        <div class="card-stage" @click="flip">
          <div :class="['flashcard', { flipped }]">
            <div class="card-face card-front">
              <button class="speak-btn" @click.stop="speak(currentWord.word)" :disabled="!speechSupported" title="朗读单词">🔊</button>
              <div class="card-word">{{ currentWord.word }}</div>
              <div v-if="currentWord.phonetic" class="card-phonetic">{{ currentWord.phonetic }}</div>
              <div v-if="currentWord.pos" class="card-pos">{{ currentWord.pos }}</div>
              <div class="card-hint">点击卡片查看释义</div>
            </div>
            <div class="card-face card-back">
              <div class="card-word-small">{{ currentWord.word }}</div>
              <div class="card-meaning">{{ currentWord.meaning }}</div>
              <div v-if="currentWord.example" class="card-example">
                <button class="speak-btn small" @click.stop="speak(currentWord.example)" :disabled="!speechSupported" title="朗读例句">🔊</button>
                {{ currentWord.example }}
                <div v-if="currentWord.exampleTrans" class="example-trans">{{ currentWord.exampleTrans }}</div>
              </div>
              <div class="card-hint">点击卡片返回单词</div>
            </div>
          </div>
        </div>

        <div class="card-controls">
          <el-button @click="prev" :disabled="order.length < 2">⬅ 上一个</el-button>
          <el-button type="success" @click="markKnown">✅ 认识 <small>(1)</small></el-button>
          <el-button type="warning" @click="markUnknown">❌ 不认识 <small>(2)</small></el-button>
          <el-button @click="next" :disabled="order.length < 2">下一个 ➡</el-button>
          <el-button @click="toggleShuffle">{{ randomMode ? '🔀 随机中' : '🔢 顺序播放' }}</el-button>
          <el-button :type="autoPlaying ? 'primary' : 'default'" @click="toggleAuto">
            {{ autoPlaying ? '⏸ 停止自动' : '▶ 自动播放' }}
          </el-button>
          <label v-if="autoPlaying" class="interval-label">间隔
            <el-select v-model="store.settings.autoInterval" size="small" class="ctrl-mini">
              <el-option label="2秒" :value="2" />
              <el-option label="3秒" :value="3" />
              <el-option label="5秒" :value="5" />
              <el-option label="8秒" :value="8" />
            </el-select>
          </label>
        </div>
        <div class="kb-hint">快捷键：空格 翻面 · ← / → 切换单词 · 1 认识 · 2 不认识</div>
      </template>
    </template>
  </div>
  `,
  setup() {
    const randomMode = ref(false);
    const order = ref([]);   // 牌组：单词 id 序列
    const idx = ref(0);
    const flipped = ref(false);
    const autoPlaying = ref(false);
    let autoTimer = null;
    const speechSupported = VocabSpeech.supported;

    const units = computed(() => [...new Set(currentWords.value.map((w) => w.unit))]);
    const libWrongCount = computed(() => currentWords.value.filter((w) => w.status === 'wrong').length);
    const unitCount = (u) => currentWords.value.filter((w) => w.unit === u).length;

    const deckWords = computed(() => {
      const f = store.reviewFilter;
      if (f === '__wrong__') return currentWords.value.filter((w) => w.status === 'wrong');
      if (f === '__all__') return currentWords.value;
      return currentWords.value.filter((w) => w.unit === f);
    });

    const currentWord = computed(() => {
      const id = order.value[idx.value];
      return deckWords.value.find((w) => w.id === id) || null;
    });

    function rebuildDeck() {
      stopAuto();
      const list = deckWords.value;
      const base = randomMode.value ? shuffle(list) : list.slice();
      order.value = base.map((w) => w.id);
      idx.value = 0;
      flipped.value = false;
    }

    watch(
      [() => store.currentLibId, () => store.reviewFilter, randomMode],
      () => rebuildDeck(),
      { immediate: true }
    );

    // 牌组缩短时夹紧下标
    watch(order, () => {
      if (idx.value >= order.value.length) {
        idx.value = Math.max(0, order.value.length - 1);
      }
    });

    function flip() {
      if (!currentWord.value) return;
      flipped.value = !flipped.value;
    }

    function next() {
      if (order.value.length < 2) return;
      flipped.value = false;
      idx.value = idx.value < order.value.length - 1 ? idx.value + 1 : 0;
    }

    function prev() {
      if (order.value.length < 2) return;
      flipped.value = false;
      idx.value = idx.value > 0 ? idx.value - 1 : order.value.length - 1;
    }

    function persist(w) { VocabDB.putWord(w); }

    function markKnown() {
      const w = currentWord.value;
      if (!w) return;
      w.status = 'mastered';
      w.lastReviewAt = Date.now();
      persist(w);
      // 错词本模式：答对后移出当前牌组
      if (store.reviewFilter === '__wrong__') {
        order.value.splice(idx.value, 1);
        if (idx.value >= order.value.length) idx.value = order.value.length - 1;
        flipped.value = false;
        if (!order.value.length) {
          stopAuto();
          showToast('🎉 错词本已全部复习完！', 'success');
        }
        return;
      }
      next();
    }

    function markUnknown() {
      const w = currentWord.value;
      if (!w) return;
      w.status = 'wrong';
      w.wrongCount = (w.wrongCount || 0) + 1;
      w.lastReviewAt = Date.now();
      persist(w);
      next();
    }

    function toggleShuffle() {
      randomMode.value = !randomMode.value;
    }

    function toggleAuto() {
      autoPlaying.value ? stopAuto() : startAuto();
    }

    function startAuto() {
      if (!order.value.length) return;
      autoPlaying.value = true;
      runAutoStep();
    }

    function stopAuto() {
      autoPlaying.value = false;
      clearTimeout(autoTimer);
      VocabSpeech.cancel();
    }

    function runAutoStep() {
      if (!autoPlaying.value) return;
      const w = currentWord.value;
      if (!w) { stopAuto(); return; }
      flipped.value = false;
      speak(w.word);
      const interval = (store.settings.autoInterval || 3) * 1000;
      autoTimer = setTimeout(() => {
        if (!autoPlaying.value) return;
        flipped.value = true;
        if (w.example) setTimeout(() => speak(w.example), 400);
        autoTimer = setTimeout(() => {
          if (!autoPlaying.value) return;
          if (idx.value >= order.value.length - 1) {
            stopAuto();
            showToast('本组单词已自动播放完毕', 'success');
            return;
          }
          next();
          runAutoStep();
        }, interval);
      }, interval);
    }

    function onKey(e) {
      if (store.activeTab !== 'review') return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); flip(); }
      else if (e.code === 'ArrowRight') next();
      else if (e.code === 'ArrowLeft') prev();
      else if (e.key === '1') markKnown();
      else if (e.key === '2') markUnknown();
    }

    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => {
      window.removeEventListener('keydown', onKey);
      stopAuto();
    });

    return {
      store, currentWords, units, libWrongCount, unitCount,
      deckWords, currentWord, order, idx, flipped,
      randomMode, autoPlaying, speechSupported,
      flip, next, prev, markKnown, markUnknown, toggleShuffle, toggleAuto, speak,
    };
  },
};

/* ============================================================
 * 页面三：中英文连线练习
 * ============================================================ */
const matchView = {
  template: `
  <div class="view">
    <!-- 配置阶段 -->
    <div v-if="phase === 'config'" class="match-config">
      <h2>中英文连线练习</h2>
      <div v-if="!currentWords.length" class="empty">请先到「词库管理」导入词汇表。</div>
      <template v-else>
        <div class="control-bar">
          <label>词库
            <el-select v-model="store.currentLibId" class="ctrl-select">
              <el-option v-for="l in store.libraries" :key="l.id" :label="l.name" :value="l.id" />
            </el-select>
          </label>
          <label>范围
            <el-select v-model="cfg.unitSel" class="ctrl-select">
              <el-option :label="'全部单词（' + currentWords.length + '）'" value="__all__" />
              <el-option :label="'错词本（' + libWrongCount + '）'" value="__wrong__" />
              <el-option v-for="u in units" :key="u" :label="u + '（' + unitCount(u) + '）'" :value="u" />
            </el-select>
          </label>
          <label>每组数量
            <el-select v-model="cfg.groupSize" class="ctrl-mini">
              <el-option label="5 个" :value="5" />
              <el-option label="10 个" :value="10" />
              <el-option label="15 个" :value="15" />
              <el-option label="20 个" :value="20" />
            </el-select>
          </label>
          <el-button type="primary" @click="startGame">开始练习</el-button>
        </div>
        <p class="hint">玩法：点击左侧英文单词，再点击右侧对应的中文释义即可连线。配对正确连线变绿并锁定；配错闪红后消失，计入错误数。</p>
      </template>
    </div>

    <!-- 游戏阶段 -->
    <div v-else-if="phase === 'playing'">
      <div class="match-hud">
        <span>⏱ {{ fmtTime(game.elapsed) }}</span>
        <span>✅ {{ game.done.length }} / {{ game.items.length }}</span>
        <span>❌ 错误 {{ game.errors }}</span>
        <span class="spacer"></span>
        <el-button size="small" @click="quitGame">退出</el-button>
      </div>
      <div class="match-board" ref="boardEl">
        <svg class="match-lines" :width="boardSize.w" :height="boardSize.h">
          <line v-for="c in coords" :key="c.key"
                :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2"
                :class="['match-line', c.type]"></line>
        </svg>
        <div class="match-col">
          <div v-for="id in game.englishOrder" :key="'e' + id"
               :ref="(el) => setEngRef(el, id)"
               :class="['match-item', 'english', {
                 selected: game.selectedEnglish === id,
                 done: game.done.includes(id),
                 'wrong-flash': game.wrongFlash.eng === id
               }]"
               @click="clickEnglish(id)">
            <span>{{ wordById(id).word }}</span>
            <button class="speak-btn small" @click.stop="speak(wordById(id).word)" title="朗读">🔊</button>
          </div>
        </div>
        <div class="match-col">
          <div v-for="id in game.chineseOrder" :key="'c' + id"
               :ref="(el) => setChnRef(el, id)"
               :class="['match-item', {
                 selected: game.selectedChinese === id,
                 done: game.done.includes(id),
                 'wrong-flash': game.wrongFlash.chn === id
               }]"
               @click="clickChinese(id)">
            {{ wordById(id).meaning }}
          </div>
        </div>
      </div>
    </div>

    <!-- 结果阶段 -->
    <div v-else class="match-result">
      <h2>练习结果</h2>
      <div class="result-stats">
        <div class="stat"><b>{{ fmtTime(result.seconds) }}</b><span>用时</span></div>
        <div class="stat"><b>{{ accuracy }}%</b><span>正确率</span></div>
        <div class="stat"><b>{{ result.total - result.wrongWords.length }} / {{ result.total }}</b><span>一次配对正确</span></div>
        <div class="stat"><b>{{ result.errors }}</b><span>错误次数</span></div>
      </div>
      <div v-if="result.wrongWords.length">
        <h3 class="section-title">出错的单词（已自动加入错词本）</h3>
        <table class="wrong-table">
          <tr><th>单词</th><th>音标</th><th>中文释义</th><th>发音</th></tr>
          <tr v-for="w in result.wrongWords" :key="w.id">
            <td><b>{{ w.word }}</b></td>
            <td>{{ w.phonetic }}</td>
            <td>{{ w.meaning }}</td>
            <td><button class="speak-btn small" @click="speak(w.word)">🔊</button></td>
          </tr>
        </table>
      </div>
      <div v-else class="success-text">🎉 全部一次配对正确，太棒了！</div>
      <div class="card-controls">
        <el-button @click="phase = 'config'">返回设置</el-button>
        <el-button type="primary" @click="startGame">🔁 再来一组</el-button>
      </div>
    </div>
  </div>
  `,
  setup() {
    const phase = ref('config'); // config | playing | result
    const cfg = reactive({ unitSel: '__all__', groupSize: 10 });
    const boardEl = ref(null);
    const boardSize = reactive({ w: 0, h: 0 });
    const engRefs = {};
    const chnRefs = {};
    const coords = ref([]);

    const game = reactive({
      items: [],
      englishOrder: [],
      chineseOrder: [],
      selectedEnglish: null,
      selectedChinese: null,
      done: [],
      errors: 0,
      wrongIds: [],
      wrongFlash: { eng: null, chn: null },
      elapsed: 0,
      startAt: 0,
    });
    const result = reactive({ seconds: 0, errors: 0, total: 0, wrongWords: [] });
    let timerId = null;

    const units = computed(() => [...new Set(currentWords.value.map((w) => w.unit))]);
    const libWrongCount = computed(() => currentWords.value.filter((w) => w.status === 'wrong').length);
    const unitCount = (u) => currentWords.value.filter((w) => w.unit === u).length;

    const wordMap = computed(() => {
      const m = {};
      game.items.forEach((w) => { m[w.id] = w; });
      return m;
    });
    function wordById(id) { return wordMap.value[id]; }

    function poolWords() {
      const f = cfg.unitSel;
      if (f === '__wrong__') return currentWords.value.filter((w) => w.status === 'wrong');
      if (f === '__all__') return currentWords.value;
      return currentWords.value.filter((w) => w.unit === f);
    }

    function startGame() {
      const pool = poolWords();
      if (pool.length < 2) {
        showToast('该范围单词不足 2 个，无法出题', 'error');
        return;
      }
      const n = Math.min(cfg.groupSize, pool.length);
      const picked = shuffle(pool).slice(0, n).map((w) => ({ ...w }));
      game.items = picked;
      game.englishOrder = shuffle(picked.map((w) => w.id));
      game.chineseOrder = shuffle(picked.map((w) => w.id));
      game.selectedEnglish = null;
      game.selectedChinese = null;
      game.done = [];
      game.errors = 0;
      game.wrongIds = [];
      game.wrongFlash = { eng: null, chn: null };
      game.elapsed = 0;
      game.startAt = Date.now();
      coords.value = [];
      phase.value = 'playing';
      clearInterval(timerId);
      timerId = setInterval(() => {
        game.elapsed = Math.floor((Date.now() - game.startAt) / 1000);
      }, 500);
      nextTick(() => {
        measureBoard();
      });
    }

    function quitGame() {
      phase.value = 'config';
      clearInterval(timerId);
    }

    function setEngRef(el, id) {
      if (el) engRefs[id] = el;
      else delete engRefs[id];
    }
    function setChnRef(el, id) {
      if (el) chnRefs[id] = el;
      else delete chnRefs[id];
    }

    function measureBoard() {
      if (!boardEl.value) return;
      const rect = boardEl.value.getBoundingClientRect();
      boardSize.w = rect.width;
      boardSize.h = rect.height;
      redrawLines();
    }

    function redrawLines() {
      const list = [];
      const boardRect = boardEl.value ? boardEl.value.getBoundingClientRect() : null;
      if (!boardRect) { coords.value = list; return; }
      game.done.forEach((id) => {
        const e = engRefs[id];
        const c = chnRefs[id];
        if (!e || !c) return;
        const er = e.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        list.push({
          key: 'ok-' + id,
          x1: er.right - boardRect.left,
          y1: er.top + er.height / 2 - boardRect.top,
          x2: cr.left - boardRect.left,
          y2: cr.top + cr.height / 2 - boardRect.top,
          type: 'correct',
        });
      });
      coords.value = list;
    }

    function flashWrong(engId, chnId) {
      game.wrongFlash = { eng: engId, chn: chnId };
      setTimeout(() => {
        game.wrongFlash = { eng: null, chn: null };
      }, 450);
    }

    function clickEnglish(id) {
      if (game.done.includes(id)) return;
      game.selectedEnglish = game.selectedEnglish === id ? null : id;
      tryJudge();
    }

    function clickChinese(id) {
      if (game.done.includes(id)) return;
      game.selectedChinese = game.selectedChinese === id ? null : id;
      tryJudge();
    }

    function tryJudge() {
      if (game.selectedEnglish == null || game.selectedChinese == null) return;
      const engId = game.selectedEnglish;
      const chnId = game.selectedChinese;
      game.selectedEnglish = null;
      game.selectedChinese = null;

      if (engId === chnId) {
        game.done.push(engId);
        Sfx.correct();
        nextTick(redrawLines);
        if (game.done.length === game.items.length) finishGame();
      } else {
        game.errors++;
        Sfx.wrong();
        if (!game.wrongIds.includes(engId)) game.wrongIds.push(engId);
        if (!game.wrongIds.includes(chnId)) game.wrongIds.push(chnId);
        flashWrong(engId, chnId);
      }
    }

    async function finishGame() {
      clearInterval(timerId);
      Sfx.finish();
      const seconds = Math.floor((Date.now() - game.startAt) / 1000);
      const wrongWords = game.items.filter((w) => game.wrongIds.includes(w.id));
      // 出错单词写入错词本
      const toSave = [];
      wrongWords.forEach((w) => {
        const real = currentWords.value.find((x) => x.id === w.id);
        if (real && real.status !== 'mastered') {
          real.status = 'wrong';
          real.wrongCount = (real.wrongCount || 0) + 1;
          real.lastReviewAt = Date.now();
          toSave.push(real);
        }
      });
      if (toSave.length) await VocabDB.putWords(toSave);
      result.seconds = seconds;
      result.errors = game.errors;
      result.total = game.items.length;
      result.wrongWords = wrongWords;
      phase.value = 'result';
    }

    const accuracy = computed(() => {
      const attempts = result.total + result.errors;
      return attempts ? Math.round((result.total / attempts) * 100) : 100;
    });

    function onResize() {
      if (phase.value === 'playing') measureBoard();
    }

    onMounted(() => window.addEventListener('resize', onResize));
    onUnmounted(() => {
      window.removeEventListener('resize', onResize);
      clearInterval(timerId);
    });

    return {
      store, currentWords, units, libWrongCount, unitCount,
      phase, cfg, boardEl, boardSize, coords, game, result, accuracy,
      startGame, quitGame, setEngRef, setChnRef, wordById,
      clickEnglish, clickChinese, fmtTime, speak,
    };
  },
};

/* ============================================================
 * 页面四：错词本
 * ============================================================ */
const wrongView = {
  template: `
  <div class="view wrong-view">
    <h2>错词本</h2>
    <div v-if="!currentWords.length" class="empty">请先到「词库管理」导入词汇表。</div>
    <template v-else>
      <div class="control-bar">
        <label>词库
          <el-select v-model="store.currentLibId" size="small" class="ctrl-select">
            <el-option v-for="l in store.libraries" :key="l.id" :label="l.name" :value="l.id" />
          </el-select>
        </label>
        <el-input v-model="kw" placeholder="搜索单词 / 中文…" size="small" clearable class="kw-input" />
        <div class="spacer"></div>
        <el-button type="primary" size="small" :disabled="!wrongWords.length" @click="reviewWrong">📖 复习错词</el-button>
        <el-button size="small" :disabled="!wrongWords.length" @click="practiceWrong">🔗 连线练习</el-button>
        <el-button type="danger" size="small" plain :disabled="!wrongWords.length" @click="clearWrong">清空错词本</el-button>
      </div>

      <el-empty v-if="!wrongWords.length" description="🎉 当前词库还没有错词，继续保持！" />
      <template v-else>
        <div class="unit-progress-list">
          <div v-for="u in unitStats" :key="u.name" class="unit-progress">
            <span class="up-name">{{ u.name }}</span>
            <el-progress :percentage="u.pct" :stroke-width="10" :show-text="false" color="#6366f1" class="up-bar" />
            <span class="up-num">已掌握 {{ u.mastered }} / {{ u.total }}（错词 {{ u.wrong }}）</span>
          </div>
        </div>

        <el-table :data="filteredWrong" stripe class="wrong-table" style="width:100%">
          <el-table-column label="单词" min-width="120">
            <template #default="{ row }"><b>{{ row.word }}</b></template>
          </el-table-column>
          <el-table-column prop="phonetic" label="音标" min-width="140" />
          <el-table-column prop="pos" label="词性" width="90" />
          <el-table-column prop="meaning" label="中文释义" min-width="160" />
          <el-table-column prop="unit" label="单元" min-width="110" />
          <el-table-column label="错次" width="70" align="center">
            <template #default="{ row }">
              <el-tag type="danger" size="small" effect="plain">{{ row.wrongCount || 1 }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="230" align="center">
            <template #default="{ row }">
              <el-button circle size="small" @click="speak(row.word)" title="朗读">🔊</el-button>
              <el-button size="small" type="success" @click="markMastered(row)">已掌握</el-button>
              <el-button size="small" type="danger" plain @click="removeOne(row)">移出</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </template>
  </div>
  `,
  setup() {
    const kw = ref('');

    const wrongWords = computed(() => currentWords.value.filter((w) => w.status === 'wrong'));
    const filteredWrong = computed(() => {
      const k = kw.value.trim().toLowerCase();
      if (!k) return wrongWords.value;
      return wrongWords.value.filter(
        (w) => w.word.toLowerCase().includes(k) || w.meaning.includes(kw.value.trim())
      );
    });

    const unitStats = computed(() => {
      const map = {};
      currentWords.value.forEach((w) => {
        if (!map[w.unit]) map[w.unit] = { name: w.unit, total: 0, mastered: 0, wrong: 0 };
        map[w.unit].total++;
        if (w.status === 'mastered') map[w.unit].mastered++;
        if (w.status === 'wrong') map[w.unit].wrong++;
      });
      return Object.values(map).map((u) => ({
        ...u,
        pct: u.total ? Math.round((u.mastered / u.total) * 100) : 0,
      }));
    });

    function reviewWrong() {
      store.reviewFilter = '__wrong__';
      store.activeTab = 'review';
    }

    function practiceWrong() {
      store.reviewFilter = '__wrong__';
      store.activeTab = 'match';
    }

    async function markMastered(w) {
      w.status = 'mastered';
      w.lastReviewAt = Date.now();
      await VocabDB.putWord(w);
      showToast(`「${w.word}」已标记为掌握`, 'success');
    }

    async function removeOne(w) {
      w.status = 'new';
      await VocabDB.putWord(w);
      showToast(`「${w.word}」已移出错词本`, 'success');
    }

    async function clearWrong() {
      const ok = await confirmDialog('确定清空当前词库的错词本吗？（单词不会被删除，仅重置错词标记）', '清空错词本', 'warning');
      if (!ok) return;
      const toSave = wrongWords.value.map((w) => ({ ...w, status: 'new' }));
      toSave.forEach((w) => {
        const real = currentWords.value.find((x) => x.id === w.id);
        if (real) real.status = 'new';
      });
      await VocabDB.putWords(toSave);
      showToast('错词本已清空', 'success');
    }

    return {
      store, currentWords, kw, wrongWords, filteredWrong, unitStats,
      reviewWrong, practiceWrong, markMastered, removeOne, clearWrong, speak,
    };
  },
};

/* ============================================================
 * 根组件 & 挂载
 * ============================================================ */
const app = createApp({
  components: { libraryView, reviewView, matchView, wrongView },
  setup() {
    onMounted(async () => {
      try {
        await VocabDB.init();
        const saved = localStorage.getItem('vocab-review-settings');
        if (saved) {
          try { Object.assign(store.settings, JSON.parse(saved)); } catch (e) { /* ignore */ }
        }
        await refreshLibraries();
        await loadAllWords();
      } catch (err) {
        showToast('本地数据库初始化失败：' + err.message, 'error');
      } finally {
        store.ready = true;
      }
    });

    watch(
      () => store.settings,
      (v) => localStorage.setItem('vocab-review-settings', JSON.stringify(v)),
      { deep: true }
    );

    return { store, tabs, totalWrong };
  },
});

// 注册 Element Plus（中文语言包）
if (window.ElementPlus) {
  app.use(window.ElementPlus, { locale: window.ElementPlusLocaleZhCn });
}

app.mount('#app');
