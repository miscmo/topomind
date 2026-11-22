/**
 * 生成统一表情选择器的本地化数据与字形资源。
 *
 * 数据源（全部为成熟开源、可商用）：
 *  - emoji-picker-react v5 自带 `emojis-zh.json`：官方简体中文名/关键词，按 picker 的 8 个分类组织
 *  - emojibase-data `/zh/compact.json`（MIT）：补充中文 label / tags
 *  - pinyin-pro（MIT，国产）：构建期把中文词预计算为全拼与首字母，运行时零计算
 *  - @lobehub/fluent-emoji-flat（MIT，国产 LobeHub 维护）：微软 Fluent Emoji Flat 本地 SVG，按 unified 码点命名
 *
 * 产出：
 *  - src/shared/ui/emoji/emojiData.zh.json  picker 的自定义数据集（n 数组含中文 / 别名 / 拼音 / 首字母）
 *  - src/shared/ui/emoji/emojiMeta.json     常用表情、unified→SVG 文件名映射、中文主名
 *  - public/fluent-emoji-flat/*.svg        本地字形资源（不入库，见 .gitignore）
 *
 * 用法：node scripts/build-emoji-assets.mjs [--assets-only]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinyin } from 'pinyin-pro'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_ONLY = process.argv.includes('--assets-only')
const OUT_DIR = path.join(ROOT, 'src', 'shared', 'ui', 'emoji')
const PUBLIC_DIR = path.join(ROOT, 'public', 'fluent-emoji-flat')
const FLAT_ASSETS = path.join(ROOT, 'node_modules', '@lobehub', 'fluent-emoji-flat', 'assets')
const EPR_ZH = path.join(ROOT, 'node_modules', 'emoji-picker-react', 'dist', 'data', 'emojis-zh.json')
const EPR_EN = path.join(ROOT, 'node_modules', 'emoji-picker-react', 'dist', 'data', 'emojis-en.json')
const EMODIBASE_ZH = path.join(ROOT, 'node_modules', 'emojibase-data', 'zh', 'compact.json')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

/** picker 的分类改成本地化、更贴近国内软件的命名。 */
const CATEGORY_LABELS = {
  suggested: '常用',
  smileys_people: '笑脸与人物',
  animals_nature: '动物与自然',
  food_drink: '食物与饮料',
  travel_places: '旅行与地点',
  activities: '活动',
  objects: '物品',
  symbols: '符号',
  flags: '旗帜',
  custom: '自定义',
}
const CATEGORY_ORDER = [
  'suggested', 'smileys_people', 'animals_nature', 'food_drink',
  'travel_places', 'activities', 'objects', 'symbols', 'flags', 'custom',
]

/**
 * 国内语义别名：把「收到 / 点赞 / 打工人 / 摸鱼」这类中文工作语境词映射到标准 emoji。
 * 只做词库与排序的本地化，不引入任何第三方贴纸图片（避免美术作品著作权风险）。
 * key 为 unified 码点，允许书写带 / 不带 fe0f 的形式，脚本会自动对齐。
 */
const SEMANTIC_ALIASES = {
  '1f44d': ['点赞', '赞', '好评', '收到', '棒', '认可'],
  '1f44c': ['OK', '好的', '没问题', '收到', '可以'],
  '1f44f': ['鼓掌', '厉害', '欢迎'],
  '1f64c': ['鼓掌', '欢迎', '太棒了'],
  '1f4aa': ['加油', '给力', '努力', '冲'],
  '1f389': ['庆祝', '恭喜', '生日', '派对'],
  '1f38a': ['庆功', '完成', '上线'],
  '1f680': ['上线', '发布', '启动', '加速'],
  '1f525': ['火', '热门', '爆', '绝了'],
  '1f4a1': ['想法', '灵感', '点子', '提示'],
  '1f4dd': ['笔记', '记录', '备忘', '待办'],
  '1f4da': ['书', '学习', '资料', '知识库'],
  '1f4c1': ['文件夹', '归档', '分类'],
  '1f9e0': ['大脑', '思考', '知识', '脑图'],
  '1f4c8': ['增长', '数据', '报表'],
  '1f6a7': ['施工中', '进行中', '待办'],
  '2705': ['完成', '已完成', '通过', '打勾'],
  '274c': ['失败', '错误', '不行', '否决'],
  '26a0': ['警告', '注意', '风险'],
  '1f9d1-200d-1f4bb': ['打工人', '程序员', '办公', '加班'],
  '1f60e': ['酷', '自信', '稳了'],
  '1f644': ['无语', '翻白眼', '服了'],
  '1f62d': ['大哭', '崩溃', '破防'],
  '1f602': ['笑哭', '笑不活了', '乐死了'],
  '1f926': ['捂脸', '尴尬', '无奈'],
  '1f914': ['思考', '疑惑', '琢磨'],
  '1f970': ['喜欢', '爱了', '心动'],
  '2764': ['爱心', '红心', '爱', '喜欢'],
  '1f64f': ['谢谢', '拜托', '感谢'],
  '1f91d': ['合作', '握手', '达成'],
  '1f3af': ['目标', '命中', '重点'],
  '1f4cc': ['置顶', '标记', '重要'],
  '1f4c5': ['日程', '日期', '排期'],
  '23f3': ['稍等', '等待', '进行中'],
  '1f4a4': ['摸鱼', '睡觉', '累了'],
  '1f971': ['叹气', '累', '无奈'],
  '1f92f': ['震惊', '惊呆', '离谱'],
  '1f620': ['生气', '愤怒', '火大'],
  '1f622': ['哭', '难过', '委屈'],
  '1f60a': ['腼腆', '害羞', '微笑'],
  '1f917': ['抱抱', '安慰'],
  '1f4bc': ['工作', '办公', '商务'],
  '1f4b0': ['钱', '预算', '收入'],
  '1f510': ['锁', '私密', '加密'],
  '1f50d': ['搜索', '查找'],
  '1f9ea': ['实验', '测试'],
  '2699': ['设置', '配置'],
  '1f4e6': ['打包', '交付', '发布'],
  '1f331': ['新芽', '成长', '新手'],
  '1f31f': ['星标', '收藏', '重点'],
  '2b50': ['星标', '收藏'],
  '1f340': ['好运', '锦鲤'],
  '1f4cd': ['位置', '地点'],
  '1f3a8': ['设计', '配色'],
  '1f4ca': ['统计', '图表', '数据'],
  '1f4cb': ['清单', '列表', '待办'],
  '1f5c3': ['归档', '卡片盒'],
  '1f517': ['链接', '关联'],
  '1f4ac': ['评论', '讨论', '留言'],
  '1f4e3': ['公告', '通知'],
  '1f6e1': ['安全', '防护'],
  '1f9ed': ['地图', '导航', '路径'],
}

/**
 * 国内高频表情。前 9 个会被「最近使用」LRU 覆盖，其余作为稳定置顶的常用区。
 * 只登记在官方中文数据里确实存在的 unified，脚本会过滤无效项并告警。
 */
const POPULAR = [
  '1f44d', '1f602', '2764', '1f389', '1f4aa', '1f525', '1f680', '1f60a', '1f914',
  '1f4a1', '1f4dd', '1f4da', '1f9e0', '1f3af', '2705', '1f4cc', '1f31f', '1f64f',
  '1f44c', '1f91d', '1f4c1', '1f4c5', '1f6a7', '1f9ea', '1f4ca', '1f517', '1f4ac',
]

/** Fluent Emoji Flat 文件名解析：unified 码点 → 实际 SVG 文件名。 */
function resolveAsset(unified) {
  const raw = String(unified).toLowerCase()
  const bare = raw.replace(/-fe0f/g, '')
  const candidates = [
    `${bare}.svg`,
    `${raw}.svg`,
    `${bare}-fe0f.svg`,
    `${raw.replace(/-fe0f/g, '')}.svg`,
    `${bare.replace(/^0+/, '')}.svg`,
  ]
  for (const name of candidates) {
    if (fs.existsSync(path.join(FLAT_ASSETS, name))) return name
  }
  return null
}

/** 一个中文词的全拼与首字母，都是 picker 搜索可直接匹配的字符串。 */
function pinyinForms(word) {
  if (!/^[\u4e00-\u9fa5]+$/.test(word) || word.length > 8) return []
  try {
    const full = pinyin(word, { toneType: 'none', type: 'array' }).join('').toLowerCase()
    const initials = pinyin(word, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase()
    return [full, initials].filter((s) => /^[a-z]+$/.test(s) && s.length >= 2)
  } catch {
    return []
  }
}

function build() {
  for (const required of [EPR_ZH, EPR_EN, EMODIBASE_ZH, FLAT_ASSETS]) {
    if (!fs.existsSync(required)) {
      throw new Error(`缺少依赖产物 ${required}，请先执行 npm install`)
    }
  }

  const zh = readJson(EPR_ZH)
  const en = readJson(EPR_EN)
  const emojibase = readJson(EMODIBASE_ZH)

  // 英文关键词保留：旧版 emoji-mart 支持英文搜索，汉化不能以丢失英文能力为代价
  const enByUnified = new Map()
  for (const list of Object.values(en.emojis ?? {})) {
    for (const item of list) {
      const key = String(item.u).toLowerCase().replace(/-fe0f/g, '')
      enByUnified.set(key, (item.n ?? []).filter((n) => typeof n === 'string'))
    }
  }

  // emojibase 的简体中文 label / tags 作为同义词补充，按 unified 归一（去掉 fe0f 便于对齐）
  const extraByUnified = new Map()
  for (const item of emojibase) {
    if (!item.hexcode) continue
    const key = item.hexcode.toLowerCase().replace(/-fe0f/g, '')
    const words = [item.label, ...(item.tags ?? [])].filter((w) => typeof w === 'string' && w.trim())
    if (words.length) extraByUnified.set(key, words)
  }

  // 语义别名按「去 fe0f」归一
  const aliasByUnified = new Map()
  for (const [key, words] of Object.entries(SEMANTIC_ALIASES)) {
    aliasByUnified.set(key.toLowerCase().replace(/-fe0f/g, ''), words)
  }

  const assetMap = {}
  const labels = {}
  const emojis = {}
  const knownUnified = new Set()
  let enhancedCount = 0

  for (const category of CATEGORY_ORDER) {
    const source = zh.emojis?.[category] ?? []
    emojis[category] = source.map((entry) => {
      const unified = String(entry.u).toLowerCase()
      const bare = unified.replace(/-fe0f/g, '')
      knownUnified.add(unified)
      knownUnified.add(bare)

      const originalNames = Array.isArray(entry.n) ? entry.n.filter((n) => typeof n === 'string' && n.trim()) : []
      const extra = extraByUnified.get(bare) ?? []
      const aliases = aliasByUnified.get(bare) ?? []
      const english = enByUnified.get(bare) ?? []

      // 所有中文词 → 全拼 + 首字母；原有的英文词（如 shortcode）原样保留
      const chineseWords = [...originalNames, ...extra, ...aliases].filter((w) => /[\u4e00-\u9fa5]/.test(w))
      const latinForms = new Set()
      for (const word of chineseWords) for (const form of pinyinForms(word)) latinForms.add(form)

      // 只把「新增词」放在原 names 之前：v5 用 names 最后一项作为显示名，
      // 保持原数组尾部不动，预览与 aria-label 就仍是官方中文主名。
      const additions = [...latinForms, ...extra, ...aliases, ...english]
        .map((w) => String(w).trim().toLowerCase())
        .filter(Boolean)
      const seen = new Set(originalNames.map((w) => w.toLowerCase()))
      const merged = []
      for (const word of additions) {
        if (seen.has(word)) continue
        seen.add(word)
        merged.push(word)
      }
      if (merged.length) enhancedCount++

      labels[unified] = originalNames[originalNames.length - 1] ?? extra[0] ?? ''
      const asset = resolveAsset(unified)
      if (asset) assetMap[unified] = asset
      if (asset && bare !== unified) assetMap[bare] = asset
      for (const variation of entry.v ?? []) {
        const v = String(variation).toLowerCase()
        const vAsset = resolveAsset(v)
        if (vAsset) assetMap[v] = vAsset
      }

      return { n: [...merged, ...originalNames], u: unified, ...(entry.v ? { v: entry.v } : {}), a: String(entry.a ?? '1') }
    })
  }

  // 肤色变体统一登记（picker 传入的 ListEmoji.unified 会带 -1f3fX 后缀）。
  // 只登记词库里存在基础 emoji 的变体，避免把资源包中与本词库无关的文件一并打包。
  for (const name of fs.readdirSync(FLAT_ASSETS)) {
    const match = /^(.*)-1f3f[b-f]\.svg$/.exec(name)
    if (!match) continue
    const base = match[1]
    if (!knownUnified.has(base) && !knownUnified.has(`${base}-fe0f`)) continue
    assetMap[name.slice(0, -4)] = name
  }

  const categories = {}
  for (const category of CATEGORY_ORDER) {
    categories[category] = { category, name: CATEGORY_LABELS[category] }
  }
  const popular = POPULAR.filter((u) => knownUnified.has(u.replace(/-fe0f/g, '')))

  const dataJson = JSON.stringify({ categories, emojis })
  const metaJson = JSON.stringify({
    popular,
    assetMap,
    labels,
    generatedFrom: {
      picker: 'emoji-picker-react/dist/data/emojis-zh.json',
      dictionary: 'emojibase-data/zh/compact.json',
      pinyin: 'pinyin-pro',
      glyphs: '@lobehub/fluent-emoji-flat (MIT, Microsoft Fluent Emoji Flat)',
    },
  })

  if (!ASSETS_ONLY) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUT_DIR, 'emojiData.zh.json'), dataJson, 'utf8')
    fs.writeFileSync(path.join(OUT_DIR, 'emojiMeta.json'), metaJson, 'utf8')
  }

  // 只同步词库真正用到的字形，避免把 40MB 的整个资源包塞进安装包
  const wanted = new Set(Object.values(assetMap))
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  const existing = new Set(fs.readdirSync(PUBLIC_DIR))
  let copied = 0
  for (const name of wanted) {
    if (existing.has(name)) continue
    fs.copyFileSync(path.join(FLAT_ASSETS, name), path.join(PUBLIC_DIR, name))
    copied++
  }
  for (const stale of existing) {
    if (!wanted.has(stale)) fs.rmSync(path.join(PUBLIC_DIR, stale))
  }

  const total = Object.values(emojis).reduce((n, list) => n + list.length, 0)
  console.log(`[emoji-assets] 表情 ${total} 个 · 中文/拼音增强 ${enhancedCount} 个 · 字形 ${wanted.size} 个 · 新增复制 ${copied} 个 · 常用 ${popular.length} 个`)
  return { total, wanted: wanted.size }
}

try {
  build()
} catch (error) {
  console.error('[emoji-assets] 生成失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
