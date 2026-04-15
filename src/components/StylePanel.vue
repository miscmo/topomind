<!-- 左侧样式面板：节点样式编辑 -->
<template>
  <div id="nav-panel">
    <div id="style-panel-header">
      <div class="sp-header-actions">
        <button class="sp-header-btn" @click="resetAllStyles" title="恢复全部默认">重置</button>
      </div>
    </div>
    <div id="style-panel-body">

      <!-- 空状态 -->
      <div v-if="!selectedNodeId" class="sp-empty" id="sp-empty">
        <span>点击节点<br>设置样式</span>
      </div>

      <!-- 内容 -->
      <div v-else id="sp-body">
        <div class="sp-node-name">{{ nodeName }}</div>

        <!-- ── 文字 ── -->
        <div class="sp-section-title sp-section-title--first">文字</div>

        <div class="sp-row">
          <label class="sp-label">颜色</label>
          <div class="sp-color-picker-wrap">
            <div class="sp-color-swatch" :style="{ background: styles.fontColor }" @click="$refs.fontColorInput.click()">
              <input ref="fontColorInput" type="color" v-model="styles.fontColor" class="sp-color-hidden" @input="applyStyle('fontColor', styles.fontColor)" />
            </div>
            <button type="button" class="sp-text-btn" @click="resetColor('fontColor')">默认</button>
            <div class="sp-recent-inline">
              <span class="sp-recent-label">最近</span>
              <span v-for="c in recentFontColors" :key="c" class="sp-recent-dot" :style="{ background: c }" @click="applyColor('fontColor', c)" title="使用"></span>
              <button v-if="recentFontColors.length" class="sp-recent-clear" @click="clearRecentColors('fontColor')" title="清除历史">✕</button>
            </div>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">大小</label>
          <div class="sp-num-wrap sp-num-wrap--stepper">
            <button type="button" class="sp-step-btn" @click="stepFontSize(-2)" title="减小 2px">−</button>
            <input type="number" v-model.number="styles.fontSize" class="sp-num-input" min="8" max="72" @change="applyStyle('fontSize', clampFontSize(styles.fontSize))" />
            <button type="button" class="sp-step-btn" @click="stepFontSize(2)" title="增大 2px">+</button>
            <span class="sp-num-unit">px</span>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">样式</label>
          <div class="sp-btn-group">
            <button class="sp-icon-btn sp-font-style-btn" :class="{ active: isBold }" @click="toggleFontStyle('bold')" title="加粗"><b>B</b></button>
            <button class="sp-icon-btn sp-font-style-btn" :class="{ active: isItalic }" @click="toggleFontStyle('italic')" title="斜体"><i>I</i></button>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">对齐</label>
          <div class="sp-btn-group">
            <button v-for="align in ['left','center','right']" :key="align"
              class="sp-icon-btn" :class="{ active: styles.textAlign === align }"
              :title="align === 'left' ? '左对齐' : align === 'center' ? '居中' : '右对齐'"
              @click="applyStyle('textAlign', align)">
              {{ align === 'left' ? '⬅' : align === 'center' ? '⬛' : '➡' }}
            </button>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">折行</label>
          <label class="sp-toggle" title="启用或关闭文本自动折行">
            <input type="checkbox" v-model="styles.textWrap" @change="applyStyle('textWrap', styles.textWrap)" />
            <span class="sp-toggle-slider"></span>
          </label>
        </div>

        <!-- ── 节点 ── -->
        <div class="sp-section-title">节点</div>

        <div class="sp-row">
          <label class="sp-label">背景色</label>
          <div class="sp-color-picker-wrap">
            <div class="sp-color-swatch" :style="{ background: styles.color }" @click="bgColorInput.click()">
              <input ref="bgColorInput" type="color" v-model="styles.color" class="sp-color-hidden" @input="applyStyle('color', styles.color)" />
            </div>
            <button type="button" class="sp-text-btn" @click="resetColor('color')">默认</button>
            <div class="sp-recent-inline">
              <span class="sp-recent-label">最近</span>
              <span v-for="c in recentBgColors" :key="c" class="sp-recent-dot" :style="{ background: c }" @click="applyColor('color', c)" title="使用"></span>
              <button v-if="recentBgColors.length" class="sp-recent-clear" @click="clearRecentColors('color')" title="清除历史">✕</button>
            </div>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">宽度</label>
          <div class="sp-num-wrap sp-num-wrap--stepper">
            <button type="button" class="sp-step-btn" @click="stepNodeSize('nodeWidth', -10)" title="减小 10px">−</button>
            <input type="number" v-model.number="styles.nodeWidth" class="sp-num-input" min="0" max="1000" placeholder="自动" @change="applyStyle('nodeWidth', normalizeNodeSize(styles.nodeWidth))" />
            <button type="button" class="sp-step-btn" @click="stepNodeSize('nodeWidth', 10)" title="增大 10px">+</button>
            <span class="sp-num-unit">px</span>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">高度</label>
          <div class="sp-num-wrap sp-num-wrap--stepper">
            <button type="button" class="sp-step-btn" @click="stepNodeSize('nodeHeight', -10)" title="减小 10px">−</button>
            <input type="number" v-model.number="styles.nodeHeight" class="sp-num-input" min="0" max="1000" placeholder="自动" @change="applyStyle('nodeHeight', normalizeNodeSize(styles.nodeHeight))" />
            <button type="button" class="sp-step-btn" @click="stepNodeSize('nodeHeight', 10)" title="增大 10px">+</button>
            <span class="sp-num-unit">px</span>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">透明度</label>
          <div class="sp-slider-wrap">
            <button type="button" class="sp-step-btn sp-step-btn--compact" @click="stepOpacity(-5)" title="降低 5%">−</button>
            <input type="range" v-model.number="styles.nodeOpacity" class="sp-slider" min="10" max="100" step="5" @input="applyStyle('nodeOpacity', styles.nodeOpacity / 100)" />
            <button type="button" class="sp-step-btn sp-step-btn--compact" @click="stepOpacity(5)" title="增加 5%">+</button>
            <span class="sp-slider-val">{{ styles.nodeOpacity }}%</span>
          </div>
        </div>

        <!-- ── 边框 ── -->
        <div class="sp-section-title">边框</div>

        <div class="sp-row">
          <label class="sp-label">颜色</label>
          <div class="sp-color-picker-wrap">
            <div class="sp-color-swatch" :style="{ background: styles.borderColor }" @click="borderColorInput.click()">
              <input ref="borderColorInput" type="color" v-model="styles.borderColor" class="sp-color-hidden" @input="applyStyle('borderColor', styles.borderColor)" />
            </div>
            <button type="button" class="sp-text-btn" @click="resetColor('borderColor')">默认</button>
          </div>
        </div>

        <div class="sp-row">
          <label class="sp-label">粗细</label>
          <div class="sp-num-wrap sp-num-wrap--stepper">
            <button type="button" class="sp-step-btn" @click="stepBorderWidth(-1)" title="减小 1px">−</button>
            <input type="number" v-model.number="styles.borderWidth" class="sp-num-input" min="0" max="20" @change="applyStyle('borderWidth', normalizeBorderWidth(styles.borderWidth))" />
            <button type="button" class="sp-step-btn" @click="stepBorderWidth(1)" title="增大 1px">+</button>
            <span class="sp-num-unit">px</span>
          </div>
        </div>

        <!-- ── 形状 ── -->
        <div class="sp-section-title">形状</div>
        <div class="sp-row">
          <div class="sp-shape-grid">
            <button v-for="s in shapes" :key="s.value"
              class="sp-shape-btn" :class="{ active: styles.nodeShape === s.value }"
              :title="s.label"
              @click="applyStyle('nodeShape', s.value)">{{ s.icon }}</button>
          </div>
        </div>


      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'

const fontColorInput = ref(null)
const bgColorInput = ref(null)
const borderColorInput = ref(null)

const props = defineProps({
  selectedNodeId: { type: String, default: null },
  cy: { type: Object, default: null },
})
const emit = defineEmits(['collapse', 'update-style', 'update-font-style'])

const styles = reactive({
  color: '#4a6fa5',
  fontColor: '#ffffff',
  fontSize: 12,
  fontStyle: '',
  textAlign: 'center',
  textWrap: true,
  nodeWidth: '',
  nodeHeight: '',
  nodeOpacity: 100,
  borderColor: '#3d5d8a',
  borderWidth: 0,
  nodeShape: 'roundrectangle',
})

const recentBgColors = reactive([])
const recentFontColors = reactive([])

function clearRecentColors(key) {
  if (key === 'fontColor') {
    recentFontColors.splice(0, recentFontColors.length)
  } else {
    recentBgColors.splice(0, recentBgColors.length)
  }
}

const shapes = [
  { value: 'roundrectangle', label: '圆角矩形', icon: '▭' },
  { value: 'rectangle', label: '矩形', icon: '□' },
  { value: 'ellipse', label: '椭圆', icon: '○' },
  { value: 'diamond', label: '菱形', icon: '◇' },
  { value: 'hexagon', label: '六边形', icon: '⬡' },
  { value: 'triangle', label: '三角形', icon: '△' },
]

const nodeName = computed(() => {
  if (!props.cy || !props.selectedNodeId) return ''
  return props.cy.getElementById(props.selectedNodeId)?.data('label') || ''
})

const isBold = computed(() => styles.fontStyle.includes('bold'))
const isItalic = computed(() => styles.fontStyle.includes('italic'))

// 当选中节点变化时，读取其样式
watch(() => props.selectedNodeId, (id) => {
  if (!id || !props.cy) return
  const node = props.cy.getElementById(id)
  if (!node?.length) return
  const d = node.data()
  styles.color = d.color || '#4a6fa5'
  styles.fontColor = d.fontColor || '#ffffff'
  styles.fontSize = d.fontSize || 12
  styles.fontStyle = d.fontStyle || ''
  styles.textAlign = d.textAlign || 'center'
  styles.textWrap = d.textWrap !== false
  styles.nodeWidth = d.nodeWidth || ''
  styles.nodeHeight = d.nodeHeight || ''
  styles.nodeOpacity = Math.round((d.nodeOpacity ?? 1) * 100)
  styles.borderColor = d.borderColor || '#3d5d8a'
  styles.borderWidth = d.borderWidth || 0
  styles.nodeShape = d.nodeShape || 'roundrectangle'
})

function applyStyle(key, value) {
  if (!props.selectedNodeId) return
  emit('update-style', props.selectedNodeId, { [key]: value })
}

function clampFontSize(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return styles.fontSize
  return Math.min(72, Math.max(8, Math.round(n)))
}

function normalizeNodeSize(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return Math.min(1000, Math.max(0, Math.round(n)))
}

function normalizeBorderWidth(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(20, Math.max(0, Math.round(n)))
}

function stepFontSize(delta) {
  const next = clampFontSize((Number(styles.fontSize) || 12) + delta)
  styles.fontSize = next
  applyStyle('fontSize', next)
}

function stepNodeSize(key, delta) {
  const current = normalizeNodeSize(styles[key])
  const base = current === '' ? 0 : current
  const next = Math.min(1000, Math.max(0, base + delta))
  styles[key] = next || ''
  applyStyle(key, styles[key])
}

function stepBorderWidth(delta) {
  const next = normalizeBorderWidth((Number(styles.borderWidth) || 0) + delta)
  styles.borderWidth = next
  applyStyle('borderWidth', next)
}

function stepOpacity(delta) {
  const next = Math.min(100, Math.max(10, (Number(styles.nodeOpacity) || 100) + delta))
  styles.nodeOpacity = next
  applyStyle('nodeOpacity', next / 100)
}

function applyColor(key, color) {
  styles[key] = color
  applyStyle(key, color)
}

function resetColor(key) {
  const defaults = {
    fontColor: '#ffffff',
    color: '#4a6fa5',
    borderColor: '#3d5d8a',
  }
  const next = defaults[key]
  if (!next) return
  styles[key] = next
  applyStyle(key, next)
}

function resetAllStyles() {
  styles.color = '#4a6fa5'
  styles.fontColor = '#ffffff'
  styles.fontSize = 12
  styles.fontStyle = ''
  styles.textAlign = 'center'
  styles.textWrap = true
  styles.nodeWidth = ''
  styles.nodeHeight = ''
  styles.nodeOpacity = 100
  styles.borderColor = '#3d5d8a'
  styles.borderWidth = 0
  styles.nodeShape = 'roundrectangle'
  if (!props.selectedNodeId) return
  emit('update-style', props.selectedNodeId, {
    color: styles.color,
    fontColor: styles.fontColor,
    fontSize: styles.fontSize,
    fontStyle: styles.fontStyle,
    textAlign: styles.textAlign,
    textWrap: styles.textWrap,
    nodeWidth: styles.nodeWidth,
    nodeHeight: styles.nodeHeight,
    nodeOpacity: styles.nodeOpacity / 100,
    borderColor: styles.borderColor,
    borderWidth: styles.borderWidth,
    nodeShape: styles.nodeShape,
  })
}

function toggleFontStyle(style) {
  const parts = styles.fontStyle.split(' ').filter(Boolean)
  const idx = parts.indexOf(style)
  if (idx >= 0) parts.splice(idx, 1)
  else parts.push(style)
  styles.fontStyle = parts.join(' ')
  emit('update-font-style', props.selectedNodeId, style, idx < 0)
}
</script>
