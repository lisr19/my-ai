<template>
  <div class="app-container">
    <div class="app-header">
      <div class="title-shell">
        <h1 class="page-title">{{ config.pageTitle }}</h1>
      </div>
    </div>
    
    <div class="app-main">
        <el-card class="import-card">
          <template #header>
            <div class="card-header-row">
              <div class="card-header">📊 数据导入 & 竞赛控制</div>
              <div class="control-row primary-row header-actions">
                <el-upload
                  action="#"
                  :auto-upload="false"
                  :multiple="false"
                  :show-file-list="false"
                  accept=".xlsx,.xls"
                  @change="handleExcelUpload"
                >
                  <template #trigger>
                    <el-button class="btn-import">📂 导入Excel</el-button>
                  </template>
                </el-upload>

                <el-upload
                  action="#"
                  :auto-upload="false"
                  :show-file-list="false"
                  accept="image/*"
                  @change="handleBgUpload"
                >
                  <template #trigger>
                    <el-button class="btn-bg">🖼 更换背景</el-button>
                  </template>
                </el-upload>

                <el-button class="btn-config" @click="showConfigDialog">⚙️ 竞赛配置</el-button>
                <el-button class="btn-usage" @click="showUsageDialog">📘 使用说明</el-button>
              </div>
            </div>
          </template>
          
          <div class="import-controls">
            <div class="control-row action-row">
              <el-button type="danger" @click="startRace" :disabled="!studentData.length">开始竞赛</el-button>
              <el-button type="primary" @click="showRankDialog" class="rank-btn">查看排名</el-button>
            </div>
          </div>
        </el-card>

        <div class="race-container">
          <div class="race-area" :class="[{ finished: raceFinished }, `perf-${performanceLevel}`]" ref="raceArea" :style="{ backgroundImage: bgImage ? `url(${bgImage})` : '' }">
            <div class="water-wave"></div>
            <div class="water-wave"></div>
            <div class="finish-line"></div>
            <div class="finish-text">终点线</div>
            
            <div v-for="(player, idx) in displayPlayers" :key="`player-${idx}`" class="player"
              :class="[
                player.rank === 0 ? 'first' : player.rank === 1 ? 'second' : player.rank === 2 ? 'third' : '',
                config.avatarMode === 'surname' ? 'surname-avatar' : '',
                player.rankPulse ? 'rank-pulse' : '',
                player.arrived ? 'arrived' : ''
              ]"
              :style="getPlayerStyle(player)">
              <div v-if="player.trophy && raceStarted" class="trophy">{{ player.trophy }}</div>
              <div v-if="player.arrived && player.rank === 0" class="firework firework-gold"></div>
              <div v-if="player.arrived && player.rank === 1" class="firework firework-silver"></div>
              <div v-if="player.arrived && player.rank === 2" class="firework firework-bronze"></div>
              <div class="info-tag" :style="getInfoTagStyle(player)">
                <span class="student-name">{{ player.name }}{{ config.showGroup && player.group ? `（${player.group}组）` : '' }}</span>
                <span v-if="config.showScore" class="score">{{ isValidScore(player.score) ? player.score + '分' : player.score }}</span>
              </div>
              <span v-if="config.avatarMode === 'surname'" class="avatar-text">{{ getSurname(player.name) }}</span>
            </div>
          </div>
        </div>
    </div>

    <el-dialog v-model="configDialogVisible" title="⚙️ 竞赛参数配置" width="500px">
      <el-form :model="config" label-width="150px">
        <el-form-item label="页面标题">
          <el-input v-model="config.pageTitle"></el-input>
        </el-form-item>

        <el-form-item label="竞赛模式">
          <el-select v-model="config.raceMode">
            <el-option label="全员到达终点（同起跑线，按速度决胜）" value="all-finish"></el-option>
            <el-option label="分层显示（高分更靠近终点）" value="layered"></el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="显示组别">
          <el-checkbox v-model="config.showGroup"></el-checkbox>
        </el-form-item>

        <el-form-item label="显示分数">
          <el-checkbox v-model="config.showScore"></el-checkbox>
        </el-form-item>

        <el-form-item label="头像显示">
          <el-select v-model="config.avatarMode">
            <el-option label="默认头像" value="default"></el-option>
            <el-option label="姓名匹配个人头像" value="name-match"></el-option>
            <el-option label="姓氏" value="surname"></el-option>
            <el-option label="自定义头像" value="custom"></el-option>
          </el-select>
        </el-form-item>

        <el-form-item v-if="config.avatarMode === 'custom'" label="上传自定义头像">
          <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/*" @change="handleCustomAvatarUpload">
            <template #trigger>
              <el-button type="primary" plain>上传并替换默认头像</el-button>
            </template>
          </el-upload>
        </el-form-item>

        <template v-if="config.raceMode === 'all-finish'">
          <el-form-item label="最快选手时长(秒)">
            <el-input-number v-model="config.minDuration" :min="1" :max="30"></el-input-number>
          </el-form-item>
          <el-form-item label="最慢选手时长(秒)">
            <el-input-number v-model="config.maxDuration" :min="5" :max="50"></el-input-number>
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="动画时长(秒)">
            <el-input-number v-model="config.animationDuration" :min="1" :max="30"></el-input-number>
          </el-form-item>
        </template>

        <el-form-item label="头像大小(像素)">
          <el-input-number v-model="config.playerSize" :min="30" :max="100"></el-input-number>
        </el-form-item>

        <el-form-item label="标签字体大小(像素)">
          <el-input-number v-model="config.nameFontSize" :min="8" :max="20"></el-input-number>
        </el-form-item>

        <el-divider content-position="left">🔊 音效设置</el-divider>

        <el-form-item label="音效">
          <el-switch v-model="config.soundEnabled" active-text="开启" inactive-text="关闭"></el-switch>
        </el-form-item>

        <el-form-item label="自定义音乐">
          <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="audio/*" @change="handleBgMusicUpload">
            <template #trigger>
              <el-button type="primary" plain size="small">上传音频</el-button>
            </template>
          </el-upload>
          <span v-if="customBgMusic" style="margin-left: 8px; color: #67c23a; font-size: 12px;">✅ 已设置</span>
          <el-button v-if="customBgMusic" type="danger" plain size="small" style="margin-left: 8px;" @click="customBgMusic = null">清除</el-button>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button type="danger" plain @click="resetConfig">重置配置</el-button>
        <el-button @click="configDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveConfig">保存配置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="usageDialogVisible" title="📘 使用说明" width="760px">
      <div class="usage-content">
        <h3>一、系统功能说明</h3>
        <ul>
          <li><b>导入Excel：</b>点击"导入Excel"上传成绩表，系统自动读取并在赛道上生成选手。</li>
          <li><b>更换背景：</b>点击"更换背景"上传任意图片，替换赛道背景，支持 jpg/png。</li>
          <li><b>竞赛配置：</b>可调整竞赛模式、动画时长、头像方式、标签字体、组别显示、标题等。配置会自动保存，刷新后不丢失。</li>
          <li><b>开始竞赛：</b>点击后选手同时出发，分数决定速度或终点位置，可随时重新开始。</li>
          <li><b>查看排名：</b>按分数排序展示所有选手最终排名，随时可查看。</li>
          <li><b>重置配置：</b>在竞赛配置弹窗底部，点"重置配置"可恢复全部参数为默认值。</li>
        </ul>

        <h3>二、Excel 数据格式说明</h3>
        <p>使用 .xlsx 或 .xls 格式，第一行为列名，从第二行开始为数据。</p>
        <table class="usage-table">
          <thead><tr><th>列名</th><th>是否必填</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>姓名</td><td>✅ 必填</td><td>学生姓名，用于标签显示和头像匹配</td></tr>
            <tr><td>总分</td><td>✅ 必填</td><td>数字，用于计算速度/位置和排名</td></tr>
            <tr><td>组 / 组别 / 分组</td><td>⬜ 可选</td><td>如 A、B、C、D（或 A组），勾选"显示组别"后不同组显示不同颜色</td></tr>
          </tbody>
        </table>
        <p class="usage-note">示例行：姓名=张三，总分=98，组别=A组</p>

        <h3>三、竞赛模式详解</h3>
        <ul>
          <li><b>全员到达终点：</b>所有选手从同一位置同时出发，分数越高速度越快，最终全部到达终点。过程中可看到前三名实时竞争，名次变化有动态高亮效果，适合营造激烈竞赛氛围。</li>
          <li><b>分层显示：</b>最高分到达终点，其余按分数比例分布在不同位置，低分离终点更远。整体效果一目了然，适合直观展示成绩梯度分布。</li>
        </ul>

        <h3>四、头像显示模式说明</h3>
        <ul>
          <li><b>默认头像：</b>所有选手共用同一张默认图片（img/默认头像.png）。</li>
          <li><b>姓名匹配个人头像：</b>在 img/ 下找与姓名同名的图片（如张三.png），有则用个人头像，没有则用默认头像。</li>
          <li><b>姓氏：</b>头像圆圈内显示姓名第一字，背景色与名字标签颜色保持一致，无需准备图片。</li>
          <li><b>自定义头像：</b>上传一张图片，所有选手共用此头像（适合统一风格场景）。</li>
        </ul>

        <h3>五、个人头像文件命名规范</h3>
        <ul>
          <li>将头像图片放在项目 <code>img/</code> 目录下</li>
          <li>文件名与 Excel 中姓名列完全一致，例如：<code>张三.png</code>、<code>李四.jpg</code></li>
          <li>支持格式：png、jpg、jpeg（大小写均可）</li>
          <li>找不到对应文件时自动使用默认头像</li>
        </ul>
      </div>
    </el-dialog>

    <el-drawer v-model="rankDialogVisible" title="🏆 比赛结果" size="400px" direction="ltr" :lock-scroll="true">
      <div class="rank-list">
        <div v-for="(student, idx) in rankedStudents" :key="`rank-${idx}`" class="rank-item"
          :class="idx === 0 ? 'first-item' : idx === 1 ? 'second-item' : idx === 2 ? 'third-item' : ''">
          <span class="rank-num">{{ idx + 1 }}</span>
          <div v-if="config.avatarMode === 'name-match'" class="rank-avatar-wrap">
            <img :src="getRankAvatarUrl(student.name)" class="rank-avatar-img" />
          </div>
          <span class="rank-name">{{ student.name }}</span>
          <span class="rank-score">{{ isValidScore(student.score) ? student.score + '分' : student.score }}</span>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { ElMessage, ElMessageBox } from 'element-plus'

// 默认头像从 img/ 目录读取，不打包进 bundle
const isFile = typeof location !== 'undefined' && location.protocol === 'file:'
const defaultAvatarUrl = isFile ? 'img/默认头像.png' : '/img/默认头像.png'

// 姓名匹配头像：优先从 img/ 查找，找不到则回退默认头像
const avatarMap = {}
const avatarCache = new Map()

const audioCtx = ref(null)
let bgMusicInterval = null
let bgMusicAudio = null

const initAudioCtx = () => {
  if (!audioCtx.value) {
    audioCtx.value = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioCtx.value.state === 'suspended') {
    audioCtx.value.resume()
  }
}

const getAudioCtx = () => {
  initAudioCtx()
  return audioCtx.value
}

const playStartSound = () => {
  if (!config.soundEnabled) return
  try {
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    const notes = [261.63, 329.63, 392.00, 523.25]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, now + i * 0.12)
      gain.gain.setValueAtTime(0, now + i * 0.12)
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.3)
    })
  } catch {}
}

const playFinishSound = () => {
  if (!config.soundEnabled) return
  try {
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    const melody = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50]
    const durations = [0.15, 0.15, 0.15, 0.3, 0.15, 0.5]
    let offset = 0
    melody.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq, now + offset)
      gain.gain.setValueAtTime(0, now + offset)
      gain.gain.linearRampToValueAtTime(0.12, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + durations[i])
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + durations[i])
      offset += durations[i]
    })
  } catch {}
}

const playArrivalSound = (rank) => {
  if (!config.soundEnabled) return
  try {
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    const freqs = [880, 698.46, 587.33]
    const types = ['sine', 'sine', 'triangle']
    const freq = freqs[rank] || 523.25
    const type = types[rank] || 'sine'
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.15)
    gain.gain.setValueAtTime(0.18, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.5)
  } catch {}
}

const startBgMusic = () => {
  stopBgMusic()
  if (!config.soundEnabled) return
  if (customBgMusic.value) {
    bgMusicAudio = new Audio(customBgMusic.value)
    bgMusicAudio.volume = 0.5
    bgMusicAudio.loop = true
    bgMusicAudio.play().catch(() => {})
    return
  }
  try {
    const ctx = getAudioCtx()
    const bpm = 140
    const beatInterval = 60 / bpm
    let beatIndex = 0

    const bassPattern = [130.81, 0, 0, 130.81, 0, 164.81, 0, 130.81]
    const hihatPattern = [1, 0, 1, 0, 1, 0, 1, 0]
    const kickPattern = [1, 0, 0, 0, 1, 0, 0, 0]

    const playBeat = () => {
      const now = ctx.currentTime
      const idx = beatIndex % bassPattern.length

      if (bassPattern[idx] > 0) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(bassPattern[idx], now)
        gain.gain.setValueAtTime(2.2, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + beatInterval * 0.8)
        osc.connect(gain).connect(ctx.destination)
        osc.start(now)
        osc.stop(now + beatInterval * 0.8)
      }

      if (hihatPattern[idx]) {
        const bufferSize = ctx.sampleRate * 0.05
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
        }
        const noise = ctx.createBufferSource()
        const gain = ctx.createGain()
        const filter = ctx.createBiquadFilter()
        noise.buffer = buffer
        filter.type = 'highpass'
        filter.frequency.setValueAtTime(8000, now)
        gain.gain.setValueAtTime(0.1, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
        noise.connect(filter).connect(gain).connect(ctx.destination)
        noise.start(now)
      }

      if (kickPattern[idx]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(150, now)
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1)
        gain.gain.setValueAtTime(0.35, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        osc.connect(gain).connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.15)
      }

      beatIndex++
    }

    playBeat()
    bgMusicInterval = setInterval(playBeat, beatInterval * 1000)
  } catch {}
}

const stopBgMusic = () => {
  if (bgMusicInterval) {
    clearInterval(bgMusicInterval)
    bgMusicInterval = null
  }
  if (bgMusicAudio) {
    bgMusicAudio.pause()
    bgMusicAudio.currentTime = 0
    bgMusicAudio = null
  }
}

const CONFIG_STORAGE_KEY = 'vue-race-system-config-v1'

const raceArea = ref(null)
const studentData = ref([])
const displayPlayers = ref([])
const bgImage = ref('')
const configDialogVisible = ref(false)
const rankDialogVisible = ref(false)
const usageDialogVisible = ref(false)
const raceFinished = ref(false)
const raceStarted = ref(false)
const performanceLevel = ref('high')
let animationFrameId = null

const defaultConfig = {
  raceMode: 'layered',
  minDuration: 10,
  maxDuration: 25,
  animationDuration: 12,
  playerSize: 40,
  nameFontSize: 12,
  avatarMode: 'default',
  showGroup: false,
  showScore: true,
  pageTitle: '🏆 总分竞赛 🏆',
  soundEnabled: true
}

const config = reactive({
  ...defaultConfig,
  groupColors: { 'A': '#FFD700', 'B': '#4CAF50', 'C': '#2196F3', 'D': '#FF9800' }
})

const customAvatarUrl = ref(defaultAvatarUrl)

const customBgMusic = ref(null)

const defaultData = [
  { name: '熊子轩', score: 65, group: 'D' },
  { name: '周子涵', score: 91, group: 'B' },
  { name: '方慧琳', score: '请假', group: 'C' },
  { name: '韩宇豪', score: 83, group: 'A' },
  { name: '罗明远', score: 60, group: 'B' },
  { name: '沈雅欣', score: 84, group: 'D' },
  { name: '陈宇飞', score: 98, group: 'A' },
  { name: '丁雨萌', score: 72, group: 'C' },
  { name: '赵梦琪', score: 93, group: 'D' },
  { name: '魏思远', score: 73, group: 'B' },
  { name: '林依依', score: 77, group: 'B' },
  { name: '孙晨曦', score: 92, group: 'A' },
  { name: '田思琪', score: 63, group: 'A' },
  { name: '冯晓萌', score: 86, group: 'B' },
  { name: '江浩宇', score: 71, group: 'D' },
  { name: '王浩然', score: 95, group: 'C' },
  { name: '彭子轩', score: 74, group: 'A' },
  { name: '郑佳怡', score: 88, group: 'D' },
  { name: '许晨阳', score: 78, group: 'A' },
  { name: '蒋明轩', score: 85, group: 'C' },
  { name: '刘思雨', score: 96, group: 'B' },
  { name: '谢雨桐', score: 70, group: 'A' },
  { name: '钱博文', score: 87, group: 'A' },
  { name: '杨诗涵', score: 82, group: 'B' },
  { name: '曹欣悦', score: 75, group: 'D' },
  { name: '吴雨桐', score: 90, group: 'C' },
  { name: '何俊杰', score: 76, group: 'C' },
  { name: '秦乐天', score: 79, group: 'D' },
  { name: '姜子煊', score: 68, group: 'B' },
  { name: '朱子墨', score: 81, group: 'C' }
]

const rankedStudents = computed(() => {
  const sorted = [...studentData.value].sort((a, b) => {
    const scoreA = typeof a.score === 'number' ? a.score : 0
    const scoreB = typeof b.score === 'number' ? b.score : 0
    return scoreB - scoreA
  })
  return sorted
})

const normalizeGroup = (rawGroup) => {
  if (rawGroup === undefined || rawGroup === null) return ''
  const text = String(rawGroup).trim().toUpperCase()
  const match = text.match(/[ABCD]/)
  return match ? match[0] : ''
}

const getGroupColor = (group) => {
  const groupKey = normalizeGroup(group)
  if (!groupKey) return '#d1d5db'
  return config.groupColors[groupKey] || '#d1d5db'
}

const surnameColorMap = reactive({})
const randomNameColors = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#84cc16']

const getSurname = (name) => String(name || '').trim().charAt(0) || '名'

const isValidScore = (score) => typeof score === 'number' && !isNaN(score)

const getNoGroupColor = (name) => {
  const key = getSurname(name)
  if (!surnameColorMap[key]) {
    const hash = key.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    surnameColorMap[key] = randomNameColors[hash % randomNameColors.length]
  }
  return surnameColorMap[key]
}

const getInfoTagStyle = (player) => {
  const groupKey = normalizeGroup(player.group)

  if (config.showGroup && groupKey) {
    return { backgroundColor: getGroupColor(groupKey) }
  }

  return { backgroundColor: getNoGroupColor(player.name) }
}

// 检查 public/img/ 下是否有指定姓名的图片（支持 png/jpg/jpeg）
// file:// 协议下用相对路径，http(s) 下用绝对路径
const findPublicAvatar = (name) => {
  return new Promise((resolve) => {
    const cleanName = String(name || '').trim()
    if (!cleanName) {
      resolve(null)
      return
    }

    const exts = ['png', 'jpg', 'jpeg']
    const isFile = location.protocol === 'file:'
    // file:// 协议下 index.html 在 dist/ 根目录，img/ 与 index.html 同级
    const base = isFile ? 'img/' : '/img/'

    const encodedName = encodeURIComponent(cleanName)
    const urls = []
    for (const ext of exts) {
      urls.push(`${base}${encodedName}.${ext}`)
      if (encodedName !== cleanName) {
        urls.push(`${base}${cleanName}.${ext}`)
      }
    }

    let resolved = false
    let tried = 0

    urls.forEach((url) => {
      const img = new Image()
      img.onload = () => {
        if (!resolved) {
          resolved = true
          resolve(url)
        }
      }
      img.onerror = () => {
        tried++
        if (tried === urls.length && !resolved) resolve(null)
      }
      img.src = url
    })
  })
}

// 加载学生头像
const loadPlayerAvatar = async (name) => {
  const cleanName = String(name || '').trim()

  if (config.avatarMode === 'surname') {
    return ''
  }

  if (config.avatarMode === 'custom') {
    return customAvatarUrl.value || defaultAvatarUrl
  }

  if (config.avatarMode === 'name-match') {
    const cacheKey = `name-match:${cleanName}`
    if (avatarCache.has(cacheKey)) {
      return avatarCache.get(cacheKey)
    }

    let avatarUrl = await findPublicAvatar(cleanName)
    if (!avatarUrl && avatarMap[cleanName]) {
      avatarUrl = avatarMap[cleanName]
    }

    const resolvedUrl = avatarUrl || defaultAvatarUrl
    avatarCache.set(cacheKey, resolvedUrl)
    return resolvedUrl
  }

  return defaultAvatarUrl
}

const getPlayerStyle = (player) => {
  const noGroupColor = getNoGroupColor(player.name)
  const tagBgColor = config.showGroup && player.group ? getGroupColor(player.group) : noGroupColor

  const style = {
    '--player-size': `${config.playerSize}px`,
    '--name-font-size': `${config.nameFontSize}px`,
    left: `${player.left}px`,
    top: `${player.top}px`,
    borderColor: tagBgColor,
    backgroundColor: config.avatarMode === 'surname' ? tagBgColor : undefined
  }
  
  if (config.avatarMode !== 'surname' && player.avatarUrl) {
    style.backgroundImage = `url(${player.avatarUrl})`
  }
  
  return style
}

const getRankAvatarUrl = (name) => {
  if (config.avatarMode !== 'name-match') {
    return null
  }

  const cleanName = String(name || '').trim()
  const cacheKey = `name-match:${cleanName}`
  if (avatarCache.has(cacheKey)) {
    return avatarCache.get(cacheKey)
  }

  return defaultAvatarUrl
}


const handleCustomAvatarUpload = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    customAvatarUrl.value = e.target.result
    ElMessage.success('自定义头像已替换默认头像')
    showInitialPlayers()
  }
  reader.readAsDataURL(file.raw)
}

const handleBgMusicUpload = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    customBgMusic.value = e.target.result
    ElMessage.success('竞赛音乐已替换')
  }
  reader.readAsDataURL(file.raw)
}

const handleExcelUpload = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(worksheet)

      if (!jsonData.length || !jsonData[0]['姓名'] || jsonData[0]['总分'] === undefined) {
        ElMessage.error('Excel格式错误！请确保列名为「姓名」和「总分」')
        return
      }

      const groupKey = Object.keys(jsonData[0]).find((key) => ['组', '组别', '分组', 'GROUP', 'Group', 'group'].includes(key))

      studentData.value = jsonData.map(item => ({
        name: item['姓名'],
        score: item['总分'],
        group: normalizeGroup(groupKey ? item[groupKey] : '')
      }))

      ElMessage.success(`成功导入 ${studentData.value.length} 条学生数据！`)
      showInitialPlayers()
    } catch (err) {
      ElMessage.error('解析Excel失败：' + err.message)
    }
  }
  reader.readAsArrayBuffer(file.raw)
}

const handleBgUpload = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    bgImage.value = e.target.result
    ElMessage.success('背景图片更换成功！')
  }
  reader.readAsDataURL(file.raw)
}

const evaluatePerformanceLevel = () => {
  const count = studentData.value.length
  if (count > 60) {
    performanceLevel.value = 'low'
  } else if (count > 36) {
    performanceLevel.value = 'mid'
  } else {
    performanceLevel.value = 'high'
  }
}

const showInitialPlayers = async () => {
  if (!studentData.value.length) return
  evaluatePerformanceLevel()
  raceFinished.value = false
  raceStarted.value = false

  const raceHeight = raceArea.value?.clientHeight || 700
  const playerCount = studentData.value.length
  const verticalSpacing = (raceHeight - 40) / playerCount

  displayPlayers.value = await Promise.all(studentData.value.map(async (student, idx) => {
    const avatarUrl = await loadPlayerAvatar(student.name)
    return {
      ...student,
      left: 150,
      baseTop: 20 + (idx + 0.5) * verticalSpacing,
      top: 20 + (idx + 0.5) * verticalSpacing,
      waveAmp: 4 + (idx % 4) * 1.5,
      wavePhase: idx * 0.9,
      rank: -1,
      prevRank: -1,
      rankPulse: false,
      trophy: null,
      avatarUrl,
      animationDuration: 0.3,
      startDelayMs: 0
    }
  }))
}

const startRace = async () => {
  if (!studentData.value.length) {
    ElMessage.error('请先导入数据！')
    return
  }

  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  evaluatePerformanceLevel()
  raceFinished.value = false
  raceStarted.value = true
  playStartSound()
  startBgMusic()

  const raceWidth = raceArea.value?.clientWidth || 1600
  const raceHeight = raceArea.value?.clientHeight || 700
  const finishLineX = raceWidth - 28
  const playerCount = studentData.value.length
  const verticalSpacing = (raceHeight - 40) / playerCount

  const validStudents = studentData.value.filter(s => isValidScore(s.score) && s.score !== 0)
  const maxScore = Math.max(...validStudents.map(s => s.score))
  const minScore = Math.min(...validStudents.map(s => s.score))
  const scoreRange = maxScore - minScore || 1

  const rankedStudents = [...validStudents]
    .map((s) => ({ ...s, originalIndex: studentData.value.indexOf(s) }))
    .sort((a, b) => b.score - a.score)

  const scoreRankMap = {}
  rankedStudents.forEach((s, rank) => {
    scoreRankMap[s.originalIndex] = rank
  })

  displayPlayers.value = await Promise.all(studentData.value.map(async (student, idx) => {
    const avatarUrl = await loadPlayerAvatar(student.name)
    const noScore = !isValidScore(student.score) || student.score === 0

    let targetX
    let animationDuration

    if (noScore) {
      targetX = 150
      animationDuration = 0.01
    } else {
      const rank = scoreRankMap[idx]
      const speedRatio = (student.score - minScore) / scoreRange

      if (config.raceMode === 'all-finish') {
        targetX = finishLineX
      } else {
        const minOffset = 80
        const maxTravel = finishLineX - 28 - config.playerSize - 150
        targetX = rank === 0
          ? finishLineX
          : Math.min(150 + minOffset + (maxTravel - minOffset) * speedRatio, finishLineX - 28 - config.playerSize)
      }

      const totalPlayers = validStudents.length
      if (config.raceMode === 'all-finish') {
        const durationRange = config.maxDuration - config.minDuration
        animationDuration = config.minDuration + (durationRange * rank / totalPlayers)
      } else {
        const minDuration = config.animationDuration * 0.8
        const maxDuration = config.animationDuration * 1.2
        const durationRange = maxDuration - minDuration
        animationDuration = minDuration + (durationRange * rank / totalPlayers)
      }
    }

    return {
      ...student,
      left: 150,
      startLeft: 150,
      baseTop: 20 + (idx + 0.5) * verticalSpacing,
      top: 20 + (idx + 0.5) * verticalSpacing,
      waveAmp: 4 + (idx % 4) * 1.5,
      wavePhase: idx * 0.9,
      targetX,
      animationDuration,
      startDelayMs: 0,
      rank: -1,
      prevRank: -1,
      rankPulse: false,
      trophy: null,
      arrived: false,
      arrivalSoundPlayed: false,
      originalIndex: idx,
      avatarUrl
    }
  }))

  updateRanking(true)
}

const updateRanking = (restart = false) => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)

  const raceWidth = raceArea.value?.clientWidth || 1600
  const finishLineX = raceWidth - 28
  const raceStartTime = performance.now()

  const updateFrame = (timestamp) => {
    const elapsed = timestamp - raceStartTime
    let hasMovingPlayers = false

    for (const player of displayPlayers.value) {
      const delay = player.startDelayMs || 0
      const durationMs = (player.animationDuration || 1) * 1000
      const activeElapsed = Math.max(0, elapsed - delay)
      const progress = Math.min(activeElapsed / durationMs, 1)
      player.left = player.startLeft + (player.targetX - player.startLeft) * progress

      const waveFactor = 1 - Math.min(progress, 1) * 0.55
      player.top = player.baseTop + Math.sin((elapsed / 220) + player.wavePhase) * player.waveAmp * waveFactor

      if (progress >= 1 && isValidScore(player.score) && player.score !== 0) {
        if (!player.arrived) {
          player.arrived = true
        }
      }

      if (Math.abs((player.targetX ?? player.left) - player.left) > 0.5) {
        hasMovingPlayers = true
      }
    }

    const rankIndexes = displayPlayers.value
      .map((_, idx) => idx)
      .filter(idx => isValidScore(displayPlayers.value[idx].score) && displayPlayers.value[idx].score !== 0)
    rankIndexes.sort((idxA, idxB) => {
      const a = displayPlayers.value[idxA]
      const b = displayPlayers.value[idxB]
      const distanceA = finishLineX - a.left
      const distanceB = finishLineX - b.left

      if (distanceA !== distanceB) return distanceA - distanceB
      if (config.raceMode === 'all-finish' && a.score !== b.score) {
        return b.score - a.score
      }
      return a.originalIndex - b.originalIndex
    })

    for (const p of displayPlayers.value) {
      p.prevRank = p.rank
      p.rank = -1
      p.trophy = null
      p.rankPulse = false
    }

    rankIndexes.slice(0, 3).forEach((idx, rank) => {
      const player = displayPlayers.value[idx]
      player.rank = rank
      player.trophy = ['🏆', '🥈', '🥉'][rank]
      if (player.prevRank !== -1 && player.prevRank !== rank) {
        player.rankPulse = true
      }
      if (player.arrived && !player.arrivalSoundPlayed) {
        player.arrivalSoundPlayed = true
        if (config.raceMode === 'all-finish') {
          playArrivalSound(rank)
        } else if (rank === 0) {
          playArrivalSound(rank)
        }
      }
    })

    if (hasMovingPlayers) {
      animationFrameId = requestAnimationFrame(updateFrame)
    } else {
      if (config.raceMode === 'all-finish') {
        const finalByScoreIndexes = displayPlayers.value
          .map((_, idx) => idx)
          .filter(idx => isValidScore(displayPlayers.value[idx].score) && displayPlayers.value[idx].score !== 0)
          .sort((idxA, idxB) => displayPlayers.value[idxB].score - displayPlayers.value[idxA].score)

        for (const p of displayPlayers.value) {
          p.rank = -1
          p.trophy = null
          p.rankPulse = false
        }

        finalByScoreIndexes.slice(0, 3).forEach((idx, rank) => {
          const player = displayPlayers.value[idx]
          player.rank = rank
          player.trophy = ['🏆', '🥈', '🥉'][rank]
        })
      }

      raceFinished.value = true
      animationFrameId = null
      stopBgMusic()
      playFinishSound()
      showRankDialog()
    }
  }

  animationFrameId = requestAnimationFrame(updateFrame)
}

const persistConfig = () => {
  const payload = {
    raceMode: config.raceMode,
    minDuration: config.minDuration,
    maxDuration: config.maxDuration,
    animationDuration: config.animationDuration,
    playerSize: config.playerSize,
    nameFontSize: config.nameFontSize,
    avatarMode: config.avatarMode,
    showGroup: config.showGroup,
    showScore: config.showScore,
    pageTitle: config.pageTitle,
    soundEnabled: config.soundEnabled
  }
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload))
}

const loadPersistedConfig = () => {
  const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
  if (!raw) return
  try {
    const saved = JSON.parse(raw)
    Object.assign(config, defaultConfig, saved)
  } catch {
    localStorage.removeItem(CONFIG_STORAGE_KEY)
  }
}

const showConfigDialog = () => {
  configDialogVisible.value = true
}

const showUsageDialog = () => {
  usageDialogVisible.value = true
}

const saveConfig = async () => {
  configDialogVisible.value = false
  persistConfig()
  await showInitialPlayers()
  ElMessage.success('配置保存成功！')
}

const resetConfig = async () => {
  try {
    await ElMessageBox.confirm('确定要重置配置吗？这将恢复为默认参数。', '重置配置确认', {
      confirmButtonText: '确认重置',
      cancelButtonText: '取消',
      type: 'warning'
    })
    Object.assign(config, defaultConfig)
    localStorage.removeItem(CONFIG_STORAGE_KEY)
    await showInitialPlayers()
    ElMessage.success('已恢复默认配置')
  } catch {
    // 用户取消
  }
}

const showRankDialog = () => {
  rankDialogVisible.value = true
}

onMounted(() => {
  initAudioCtx()
  loadPersistedConfig()
  studentData.value = [...defaultData]
  showInitialPlayers()
})
</script>

<style scoped>
.app-container { min-height: 100vh; background: linear-gradient(145deg, #0a2a43 0%, #115b8a 45%, #22a6b3 100%); position: relative; overflow: hidden; margin: 0; padding: 0; }
.app-header { height: auto !important; min-height: 0; background: transparent; border-bottom: none; padding: 20px 24px 0 !important; }
.title-shell { background: linear-gradient(135deg, rgba(11, 52, 84, 0.94), rgba(21, 78, 120, 0.92)); border-radius: 18px; border: 1px solid rgba(180, 220, 255, .35); box-shadow: 0 12px 30px rgba(2, 20, 38, 0.28); padding: 16px 22px; }
.page-title { text-align: center; color: #f3fbff; font-size: 32px; font-weight: 800; margin: 0; text-shadow: 0 2px 10px rgba(0,0,0,.28); letter-spacing: 1px; }
.app-main { padding: 16px 24px 28px; }
.race-container { position: relative; margin-bottom: 30px; }
.import-card { margin-top: 6px; margin-bottom: 20px; background: rgba(255, 255, 255, 0.96); border-radius: 20px; box-shadow: 0 12px 32px rgba(8, 35, 57, 0.22); border: 1px solid rgba(255,255,255,.8); }
.card-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.card-header { font-size: 16px; font-weight: 700; color: #1e3a54; white-space: nowrap; }
.header-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-left: auto; }
.import-controls { display: flex; flex-direction: column; gap: 12px; }
.control-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.action-row { justify-content: flex-start; }
.import-controls .rank-btn { margin-left: 0; }
.btn-import, .btn-bg, .btn-config, .btn-usage { border: none !important; font-weight: 600; border-radius: 10px !important; padding: 8px 16px !important; font-size: 13px !important; cursor: pointer; transition: all .2s ease; }
.btn-import { background: linear-gradient(135deg, #2563eb, #3b82f6) !important; color: #fff !important; box-shadow: 0 4px 12px rgba(37,99,235,.35); }
.btn-import:hover { background: linear-gradient(135deg, #1d4ed8, #2563eb) !important; transform: translateY(-1px); }
.btn-bg { background: linear-gradient(135deg, #059669, #10b981) !important; color: #fff !important; box-shadow: 0 4px 12px rgba(5,150,105,.3); }
.btn-bg:hover { background: linear-gradient(135deg, #047857, #059669) !important; transform: translateY(-1px); }
.btn-config { background: linear-gradient(135deg, #7c3aed, #8b5cf6) !important; color: #fff !important; box-shadow: 0 4px 12px rgba(124,58,237,.3); }
.btn-config:hover { background: linear-gradient(135deg, #6d28d9, #7c3aed) !important; transform: translateY(-1px); }
.btn-usage { background: rgba(30,58,84,0.08) !important; color: #1e3a54 !important; border: 1.5px solid rgba(30,58,84,.22) !important; box-shadow: none; }
.btn-usage:hover { background: rgba(30,58,84,0.15) !important; transform: translateY(-1px); }
.race-container { position: relative; margin-bottom: 30px; }
.race-area { position: relative; height: 700px; background: linear-gradient(180deg, #8fd3ff 0%, #3a8fdd 100%); background-size: cover; background-position: center; border-radius: 26px; overflow: hidden; box-shadow: 0 24px 45px rgba(4, 18, 39, 0.35); padding: 20px 0 20px 80px; }
.race-area.finished { box-shadow: 0 0 0 4px rgba(255, 215, 0, 0.45), 0 24px 45px rgba(4, 18, 39, 0.35); animation: finishPulse 1.2s ease-in-out 2; }
@keyframes finishPulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.01); }
  100% { transform: scale(1); }
}
.water-wave { position: absolute; width: 200%; height: 200%; top: -50%; left: -50%; background: rgba(255, 255, 255, 0.1); border-radius: 40%; animation: wave 15s infinite linear; z-index: 0; pointer-events: none; }
.water-wave:nth-child(2) { animation: wave 20s infinite linear reverse; opacity: 0.8; }
@keyframes wave { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
/* mid 模式：简化水波 */
.race-area.perf-mid .water-wave { animation-duration: 30s; }
.race-area.perf-mid .water-wave:nth-child(2) { display: none; }
/* low 模式：关闭水波、发光、脉冲，提升帧率 */
.race-area.perf-low .water-wave { display: none; }
.race-area.perf-low .player.first { animation: none; filter: none; }
.race-area.perf-low .player.second { animation: none; filter: none; }
.race-area.perf-low .player.third { animation: none; filter: none; }
.race-area.perf-low .player.rank-pulse { animation: none; }
.race-area.perf-low .trophy { animation: none; }
.race-area.perf-mid .player.first { animation: firstGlow 2.5s infinite alternate; }
.race-area.perf-mid .player.second { animation: secondGlow 2.5s infinite alternate; }
.race-area.perf-mid .player.third { animation: thirdGlow 2.5s infinite alternate; }
.finish-line { position: absolute; right: 20px; top: 0; width: 8px; height: 100%; background: repeating-linear-gradient(0deg, #ff0000, #ff0000 15px, #ffffff 15px, #ffffff 30px); z-index: 2; box-shadow: 0 0 20px rgba(255, 0, 0, 0.8); border-radius: 4px; }
.finish-text { position: absolute; right: 0px; top: 50%; transform: translateY(-50%) rotate(90deg); font-size: 18px; font-weight: 700; color: #fff; text-shadow: 0 0 10px rgba(255, 0, 0, 0.8), 2px 2px 4px rgba(0, 0, 0, 0.5); z-index: 2; letter-spacing: 5px; background: rgba(255, 0, 0, 0.7); padding: 5px 10px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3); }
.player { position: absolute; width: var(--player-size, 40px); height: var(--player-size, 40px); border-radius: 50%; z-index: 3; transform: translateY(-50%); filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.22)); background-position: center; background-size: cover; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; color: #333; font-size: 18px; font-weight: bold; text-shadow: 0 1px 3px rgba(255, 255, 255, 0.8); transition: transform .25s ease; }
.player.first { animation: firstGlow 1.5s infinite alternate; filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.8)); border-color: #ffd700; border-width: 4px; transform: translateY(-50%) scale(1.1); z-index: 10; }
.player.second { animation: secondGlow 1.5s infinite alternate; filter: drop-shadow(0 0 20px rgba(192, 192, 192, 0.8)); border-color: #c0c0c0; border-width: 4px; transform: translateY(-50%) scale(1.05); z-index: 9; }
.player.third { animation: thirdGlow 1.5s infinite alternate; filter: drop-shadow(0 0 20px rgba(205, 127, 50, 0.8)); border-color: #cd7f32; border-width: 4px; transform: translateY(-50%) scale(1.02); z-index: 8; }
@keyframes firstGlow { from { filter: drop-shadow(0 0 15px rgba(255, 215, 0, 0.6)); } to { filter: drop-shadow(0 0 30px rgba(255, 215, 0, 1)); } }
@keyframes secondGlow { from { filter: drop-shadow(0 0 15px rgba(192, 192, 192, 0.6)); } to { filter: drop-shadow(0 0 30px rgba(192, 192, 192, 1)); } }
@keyframes thirdGlow { from { filter: drop-shadow(0 0 15px rgba(205, 127, 50, 0.6)); } to { filter: drop-shadow(0 0 30px rgba(205, 127, 50, 1)); } }
.player.arrived { transition: transform .3s cubic-bezier(.34,1.56,.64,1), filter .3s ease; }
.player.arrived.first { animation: arrivedFirst 1s ease-in-out infinite alternate; }
.player.arrived.second { animation: arrivedSecond 1.2s ease-in-out infinite alternate; }
.player.arrived.third { animation: arrivedThird 1.4s ease-in-out infinite alternate; }
@keyframes arrivedFirst {
  0% { transform: translateY(-50%) scale(1.1); filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.8)) brightness(1); }
  50% { transform: translateY(-55%) scale(1.2); filter: drop-shadow(0 0 40px rgba(255, 215, 0, 1)) brightness(1.15); }
  100% { transform: translateY(-50%) scale(1.15); filter: drop-shadow(0 0 35px rgba(255, 215, 0, 0.9)) brightness(1.1); }
}
@keyframes arrivedSecond {
  0% { transform: translateY(-50%) scale(1.05); filter: drop-shadow(0 0 20px rgba(192, 192, 192, 0.8)) brightness(1); }
  50% { transform: translateY(-54%) scale(1.12); filter: drop-shadow(0 0 35px rgba(192, 192, 192, 1)) brightness(1.1); }
  100% { transform: translateY(-50%) scale(1.08); filter: drop-shadow(0 0 30px rgba(192, 192, 192, 0.9)) brightness(1.05); }
}
@keyframes arrivedThird {
  0% { transform: translateY(-50%) scale(1.02); filter: drop-shadow(0 0 20px rgba(205, 127, 50, 0.8)) brightness(1); }
  50% { transform: translateY(-53%) scale(1.08); filter: drop-shadow(0 0 30px rgba(205, 127, 50, 1)) brightness(1.08); }
  100% { transform: translateY(-50%) scale(1.05); filter: drop-shadow(0 0 25px rgba(205, 127, 50, 0.9)) brightness(1.04); }
}
.firework { position: absolute; width: 100%; height: 100%; top: 0; left: 0; pointer-events: none; z-index: 6; }
.firework::before, .firework::after { content: ''; position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; border-radius: 50%; }
.firework-gold::before { animation: sparkBurst 1.2s ease-out infinite; box-shadow: 0 0 8px 2px #ffd700, 0 0 16px 4px rgba(255, 215, 0, 0.5); background: #ffd700; }
.firework-gold::after { animation: sparkBurst 1.2s ease-out 0.3s infinite; box-shadow: 0 0 8px 2px #ffec80, 0 0 16px 4px rgba(255, 236, 128, 0.5); background: #ffec80; }
.firework-silver::before { animation: sparkBurst 1.4s ease-out infinite; box-shadow: 0 0 8px 2px #c0c0c0, 0 0 16px 4px rgba(192, 192, 192, 0.5); background: #c0c0c0; }
.firework-silver::after { animation: sparkBurst 1.4s ease-out 0.4s infinite; box-shadow: 0 0 8px 2px #e8e8e8, 0 0 16px 4px rgba(232, 232, 232, 0.5); background: #e8e8e8; }
.firework-bronze::before { animation: sparkBurst 1.6s ease-out infinite; box-shadow: 0 0 8px 2px #cd7f32, 0 0 16px 4px rgba(205, 127, 50, 0.5); background: #cd7f32; }
.firework-bronze::after { animation: sparkBurst 1.6s ease-out 0.5s infinite; box-shadow: 0 0 8px 2px #e8a862, 0 0 16px 4px rgba(232, 168, 98, 0.5); background: #e8a862; }
@keyframes sparkBurst {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
  50% { transform: translate(-50%, -50%) scale(5); opacity: 0.7; }
  100% { transform: translate(-50%, -50%) scale(8); opacity: 0; }
}
.race-area.perf-low .player.arrived { animation: none; }
.race-area.perf-low .firework { display: none; }
.race-area.perf-mid .player.arrived.first { animation: arrivedFirst 2s ease-in-out infinite alternate; }
.race-area.perf-mid .player.arrived.second { animation: arrivedSecond 2.4s ease-in-out infinite alternate; }
.race-area.perf-mid .player.arrived.third { animation: arrivedThird 2.8s ease-in-out infinite alternate; }
.trophy { position: absolute; top: -40px; left: 50%; transform: translateX(-50%); font-size: 36px; z-index: 5; animation: trophyRotate 3s infinite ease-in-out; }
.avatar-text { position: relative; z-index: 4; font-size: calc(var(--player-size, 40px) * 0.46); font-weight: 900; color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,.35); letter-spacing: 1px; }
.player.surname-avatar { box-shadow: inset 0 0 0 2px rgba(255,255,255,.45), 0 8px 18px rgba(0,0,0,.25); }
.player.surname-avatar::before { content: ''; position: absolute; inset: 5px; border-radius: 50%; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), rgba(255,255,255,0) 55%); pointer-events: none; }
.rank-pulse { animation: rankPulse .45s ease; }
@keyframes rankPulse {
  0% { transform: translateY(-50%) scale(1); }
  40% { transform: translateY(-58%) scale(1.18); }
  100% { transform: translateY(-50%) scale(1); }
}
.form-tip { margin-left: 10px; font-size: 12px; color: #6b7280; }
.form-mode-tip { margin-top: 8px; font-size: 12px; line-height: 1.6; color: #4b5563; background: #f7fafc; border: 1px solid #e5edf7; border-radius: 8px; padding: 8px 10px; }
.usage-content h3 { margin: 14px 0 8px; color: #1f3b57; }
.usage-content ul { margin: 0; padding-left: 18px; line-height: 1.75; color: #334155; }
.usage-content code { background: #edf2f7; border-radius: 4px; padding: 1px 4px; }
.usage-content p { margin: 6px 0; color: #334155; }
.usage-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; }
.usage-table th, .usage-table td { border: 1px solid #d1d5db; padding: 7px 12px; text-align: left; }
.usage-table thead { background: #f0f4f8; font-weight: 600; }
.usage-note { margin-top: 8px; color: #6b7280; font-size: 12px; }
@keyframes trophyRotate { 0%, 100% { transform: translateX(-50%) rotate(-5deg); } 50% { transform: translateX(-50%) rotate(5deg); } }
.info-tag { position: absolute; top: 50%; right: calc(100% + 5px); transform: translateY(-50%); padding: 4px 8px; border-radius: 6px; font-size: var(--name-font-size, 12px); font-weight: 600; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); z-index: 4; border: 1px solid #ddd; pointer-events: none; max-width: 150px; overflow: hidden; text-overflow: ellipsis; color: #333; }
.student-name { color: #000000; font-weight: bold; }
.score { color: #e67e22; margin-left: 4px; font-weight: bold; }
.rank-btn { border-radius: 999px; box-shadow: 0 10px 20px rgba(25, 118, 210, 0.35); }
.rank-list { display: flex; flex-direction: column; gap: 10px; }
.rank-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-radius: 15px; font-size: 16px; background: rgba(255, 255, 255, 0.8); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); transition: all 0.2s ease; }
.rank-item:hover { transform: translateX(5px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
.rank-item.first-item { background: linear-gradient(45deg, #fff8e1, #fff3cd); border: 2px solid #ffd700; }
.rank-item.second-item { background: linear-gradient(45deg, #f8f9fa, #e9ecef); border: 2px solid #c0c0c0; }
.rank-item.third-item { background: linear-gradient(45deg, #fff3e0, #ffe0b2); border: 2px solid #cd7f32; }
.rank-num { display: inline-block; width: 35px; height: 35px; line-height: 35px; text-align: center; background: #1677ff; color: #fff; border-radius: 50%; margin-right: 15px; font-weight: 700; font-size: 16px; flex-shrink: 0; }
.rank-item.first-item .rank-num { background: #ffd700; color: #000; box-shadow: 0 0 15px rgba(255, 215, 0, 0.5); }
.rank-item.second-item .rank-num { background: #c0c0c0; color: #000; box-shadow: 0 0 15px rgba(192, 192, 192, 0.5); }
.rank-item.third-item .rank-num { background: #cd7f32; color: #000; box-shadow: 0 0 15px rgba(205, 127, 50, 0.5); }
.rank-avatar-wrap { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; margin-right: 10px; border: 2px solid #ddd; display: flex; align-items: center; justify-content: center; }
.rank-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.rank-avatar-surname { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #fff; font-size: 14px; }
.rank-name { flex: 1; font-weight: 600; }
.rank-score { color: #ff7d00; font-weight: 700; }
@media (max-width: 768px) {
  .race-area { height: 500px; padding: 10px 0 10px 60px; }
  .title-shell { padding: 12px 14px; border-radius: 14px; }
  .page-title { font-size: 22px; }
  .app-header { height: auto !important; padding: 14px 16px 4px !important; }
  .app-main { padding: 12px 16px 20px; }
  .import-card { margin-top: 8px; }
  .card-header-row { flex-direction: column; align-items: stretch; }
  .header-actions { margin-left: 0; justify-content: stretch; }
  .import-controls { gap: 10px; }
  .control-row { flex-direction: column; align-items: stretch; }
  .action-row { justify-content: stretch; }
  .import-controls .rank-btn { margin-left: 0; }
}
</style>
