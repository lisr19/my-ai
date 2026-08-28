/**
 * 发音封装（Web Speech API - speechSynthesis）
 * 支持美式/英式口音选择、语速调节；浏览器不支持时降级。
 *
 * 健壮性设计（解决"英式没声音"）：
 * 1. 本地语音优先：Chrome 的 Google 网络语音（localService=false）需联网、易静默失败，
 *    因此优先选本地语音，网络语音仅作候选。
 * 2. 发声看门狗：speak 后若 onstart 未在 ~600ms 内触发，说明该语音发不出声，
 *    自动取消并尝试下一个候选语音（本地英式 → 网络英式 → 本地美式 → 仅设 lang）。
 * 3. onerror（非 canceled）同样触发降级。
 */
(function () {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let voices = [];

  function loadVoices() {
    if (!supported) return;
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  }

  if (supported) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    // 语音列表异步加载，多次延迟补取
    [200, 600, 1500].forEach((t) => setTimeout(loadVoices, t));
  }

  function normLang(l) {
    return (l || '').toLowerCase().replace(/_/g, '-');
  }

  function isLocal(v) {
    // localService 为 false 表示是网络语音（Chrome/Edge 的 Google/Microsoft Online）
    return v.localService !== false;
  }

  /** 口音匹配度：0=不匹配 1=任意英语 2=宽松匹配 3=精确口音 */
  function accentMatch(v, accent) {
    const l = normLang(v.lang);
    if (!l.startsWith('en')) return 0;
    if (accent === 'uk') {
      if (l === 'en-gb') return 3;
      if (/gb|uk|scotland|ireland|wales/.test(l)) return 2;
      return 1;
    }
    if (l === 'en-us') return 3;
    if (/us|usa|canada/.test(l)) return 2;
    // en-au / en-nz 等算"非英式"，给 1 分
    if (/gb|uk|scotland|ireland|wales/.test(l)) return 1;
    return 1;
  }

  /** 语音质量评分（在口音匹配基础上叠加） */
  function qualityScore(v) {
    const n = (v.name || '').toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 60;
    if (/microsoft/.test(n)) s += 40;
    if (v.default) s += 20;
    // 本地语音大幅加分（网络语音易静默失败）
    if (isLocal(v)) s += 100;
    // 系统自带的高质量本地语音
    if (/daniel|kate|serena|arthur|martha|oliver|george|hazel|moira|tessa|karen|samantha|alex|fred|victoria|zira|david|mark|susan|tom/.test(n)) s += 30;
    // Google 网络语音不再额外加分（避免选到发不出声的网络语音）
    return s;
  }

  /**
   * 构建候选语音链。
   * 排序优先级：① 口音匹配度（精确英式 > 宽松英式 > 任意英语）
   *           ② 同口音下本地语音优先（网络语音易静默失败）
   *           ③ 质量分
   * 这样：有本地英式 → 用本地英式；只有网络英式 → 先试网络英式，
   * 看门狗检测到发不出声再自动降级到本地美式，兼顾"口音准确"与"一定有声音"。
   */
  function buildCandidates(accent) {
    if (!voices.length) loadVoices();
    const en = voices.filter((v) => normLang(v.lang).startsWith('en'));
    const ranked = en
      .map((v) => ({ v, m: accentMatch(v, accent), q: qualityScore(v), local: isLocal(v) }))
      .sort((a, b) => {
        // ① 口音匹配度优先
        if (b.m !== a.m) return b.m - a.m;
        // ② 同口音下本地优先
        if (a.local !== b.local) return a.local ? -1 : 1;
        // ③ 质量分
        return b.q - a.q;
      });
    return ranked.map((r) => r.v);
  }

  let speaking = false;
  let session = 0; // 每次 speak 自增，用于作废旧的看门狗/回调

  // Chrome 已知 bug：长文本朗读约 15 秒后 synthesis 会自动暂停（speaking 卡住），
  // 导致后续点击无声。定时 resume 规避。
  if (supported) {
    setInterval(() => {
      try {
        const s = window.speechSynthesis;
        if (s.speaking && s.paused) s.resume();
      } catch (e) {}
    }, 5000);
  }

  function attempt(text, accent, wantLang, rate, candidates, idx) {
    const synth = window.speechSynthesis;
    const mySession = session;
    const v = candidates[idx] || null;

    const u = new SpeechSynthesisUtterance(String(text));
    if (v) {
      u.voice = v;
      u.lang = v.lang || wantLang;
    } else {
      // 最后兜底：不指定语音，仅设 lang，交给系统默认
      u.lang = wantLang;
    }
    u.rate = rate || 1;
    u.pitch = 1;
    u.volume = 1;

    let started = false;
    // 看门狗：若 onstart 一直不触发，说明该语音发不出声，降级到下一个
    const watchdog = setTimeout(() => {
      if (mySession !== session) return;      // 已被新的 speak/cancel 作废
      if (started) return;                    // 已正常开始
      try { synth.cancel(); } catch (e) {}
      tryNext();
    }, 700);

    function cleanup() {
      clearTimeout(watchdog);
    }

    function tryNext() {
      cleanup();
      if (mySession !== session) return;
      if (idx + 1 < candidates.length) {
        // 还有候选语音，延迟一点再试（等 cancel 生效）
        setTimeout(() => {
          if (mySession === session) attempt(text, accent, wantLang, rate, candidates, idx + 1);
        }, 90);
      } else if (idx === candidates.length - 1 && v) {
        // 所有带语音的候选都失败，最后用"仅 lang、不指定 voice"再试一次
        setTimeout(() => {
          if (mySession === session) attempt(text, accent, wantLang, rate, candidates, candidates.length);
        }, 90);
      }
    }

    u.onstart = () => {
      started = true;
      speaking = true;
    };
    u.onend = () => {
      cleanup();
      if (mySession === session) speaking = false;
    };
    u.onerror = (e) => {
      cleanup();
      const err = e && e.error;
      if (mySession !== session) return;
      speaking = false;
      if (err === 'canceled' || err === 'interrupted') return;
      console.warn('Speech error:', err, v ? v.name : '(lang-only)');
      tryNext();
    };

    if (synth.paused) { try { synth.resume(); } catch (e) {} }
    try { synth.speak(u); } catch (e) {
      cleanup();
      tryNext();
    }
  }

  window.VocabSpeech = {
    supported,
    /** 调试用：列出当前候选语音链 */
    diagnose(accent) {
      return buildCandidates(accent || 'uk').map((v) => ({
        name: v.name, lang: v.lang, local: isLocal(v),
      }));
    },
    speak(text, opts) {
      if (!supported || !text) return;
      opts = opts || {};
      const synth = window.speechSynthesis;
      if (!voices.length) loadVoices();
      const accent = opts.accent || 'us';
      const wantLang = accent === 'uk' ? 'en-GB' : 'en-US';

      // 作废上一轮的看门狗与回调
      session++;
      speaking = false;
      try { synth.cancel(); } catch (e) {}

      const candidates = buildCandidates(accent);
      const wasBusy = synth.speaking || synth.pending;
      // cancel 后立即 speak 在部分浏览器会被静默丢弃，延迟一小段再发起
      setTimeout(() => attempt(text, accent, wantLang, opts.rate, candidates, 0), wasBusy ? 80 : 30);
    },
    cancel() {
      if (supported) {
        session++;
        speaking = false;
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    },
  };
})();
