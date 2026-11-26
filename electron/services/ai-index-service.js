/**
 * P3 / D：简版 RAG 正文索引（主进程，纯 ESM，IO 全部可注入）。
 *
 * 设计依据：docs/design/native-ai-agent-design.md §9 / §8 / §4.1。
 * 只索引 `.tdoc.json`（BlockNote blocks）与 `.tmind.json`（脑图节点标签）的纯文本；
 * `.exdraw.json` / `.cardspec.json` / `.timg.json` / `.tflow.json` 沿用主需求文档
 * §2.3「不索引正文」约定。索引只写 `<workDir>/.topomind/ai-index/documents.json`，
 * **绝不改写任何业务文件**；业务文件的读一律走注入的 fs/path，便于门禁真跑。
 *
 * 硬约束：
 *  - 首次问答才建索引（query 时惰性 ensureIndex），应用启动不扫描；
 *  - 按源文件 `mtime + size`（并叠加 tree.json 签名与标题）增量重解析，
 *    只重建变化的源文件，倒排表整体重算，删除的源文件自动裁掉；
 *  - 索引损坏 / 版本不符 / 结构异常一律全量重建自愈，任何失败都降级返回，
 *    绝不阻断本地功能（离线基线）；
 *  - 不引 embedding / 向量库 / rerank / native 模块 / 远程服务，纯 JS；
 *  - 中文 `Intl.Segmenter` 分词 + bigram 兜底，简化 BM25 + 标题加权 + 一跳图邻居加权；
 *  - 不记正文日志、不发起任何网络请求。
 */
import nodeFs from 'fs';
import nodePath from 'path';
import { collectDocsDirs, TOPO_DOCUMENT_MANIFEST } from './document-id-service.js';

export const AI_INDEX_VERSION = 1;
export const AI_INDEX_DIR = 'ai-index';
export const AI_INDEX_FILE = 'documents.json';
export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 80;
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 10;
export const MAX_QUESTION_LENGTH = 1000;
const MAX_TEXT_LENGTH = 120000;
const MAX_INDEX_FILES = 800;
const MAX_CHUNKS_PER_FILE = 320;
const MAX_FRAGMENT_LENGTH = 600;
/**
 * 查询词命中率下限。中文问题里常夹带「检索 / 方法 / 内容」这类通用词，只靠
 * 「有词撞上正文」会造成完全无关的问题也返回 [ref:i]，模型随后据此编造引用。
 * 只有 >= 1/4 的查询词真正命中索引时才认定检索成功，其余一律按未命中处理。
 */
const MIN_QUERY_TERM_COVERAGE = 0.25;
const SKIP_DIRS = new Set(['.trash', '_graph', '_attach', 'node_modules', '.git', '.topomind', AI_INDEX_DIR]);
const INDEXABLE_TYPES = new Set(['smart', 'mindmap']);
const INDEXABLE_EXTENSIONS = { smart: '.tdoc.json', mindmap: '.tmind.json' };
/** 正文抽取只走白名单键，避免把 id / type / 颜色 token / base64 当作文本内容。 */
const TEXT_KEYS = new Set(['text', 'content', 'children', 'props', 'data', 'value', 'title', 'caption']);
/** 中文单字词（的 / 了 / 在 …）与常见虚词会让「完全不存在的问题」也命中正文，必须剔除。 */
const STOP_TERMS = new Set([
  '什么', '怎么', '怎样', '如何', '可以', '是否', '关于', '一下', '这个', '那个',
  '我们', '你们', '他们', '以及', '并且', '但是', '因为', '所以', '请帮', '帮我',
  '告诉', '哪些', '多少', '没有', '还有', '一些', '一种', '这样', '那样', '然后',
]);

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function toPosix(value) {
  return String(value ?? '').split(nodePath.sep).join('/').replace(/\\/g, '/');
}

function readJsonSafe(fs, filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(fs, path, filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function signatureOf(stat) {
  return `${Math.round(stat?.mtimeMs ?? 0)}:${stat?.size ?? 0}`;
}

function safeFileName(value, extension) {
  const name = String(value ?? '').replace(/\\/g, '/').split('/').pop() || '';
  if (!name.endsWith(extension) || name.includes('..') || /[\u0000-\u001f]/.test(name)) return '';
  return name;
}

/** 从 BlockNote 块 / 脑图节点里递归抽纯文本，跳过 base64 与超长串。 */
export function extractPlainText(content, type) {
  const visit = (node, depth) => {
    if (node == null || depth > 14) return '';
    if (typeof node === 'string') {
      const value = node.trim();
      if (!value || value.startsWith('data:')) return '';
      return value.replace(/[\u0000-\u001f]/g, ' ').slice(0, 4000);
    }
    if (typeof node !== 'object') return '';
    if (Array.isArray(node)) {
      return node.map((item) => visit(item, depth + 1)).filter(Boolean).join('\n');
    }
    const parts = [];
    for (const [key, value] of Object.entries(node)) {
      if (!TEXT_KEYS.has(key)) continue;
      if (key === 'props' && isPlainObject(value)) {
        for (const [propKey, propValue] of Object.entries(value)) {
          if (TEXT_KEYS.has(propKey)) parts.push(visit(propValue, depth + 1));
        }
      } else {
        parts.push(visit(value, depth + 1));
      }
    }
    return parts.filter(Boolean).join('\n');
  };
  if (!isPlainObject(content)) return '';
  const raw = type === 'mindmap' ? visit(content.root, 0) : visit(content.blocks, 0);
  return raw.slice(0, MAX_TEXT_LENGTH).trim();
}

/** 约 400 字一切、重叠 80 字；尽量在句号 / 换行处断开，charRange 相对抽取全文。 */
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const source = String(text ?? '');
  if (!source) return [];
  const chunks = [];
  let start = 0;
  while (start < source.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      const slice = source.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('；'));
      if (breakAt >= Math.floor(size * 0.6)) end = start + breakAt + 1;
    }
    chunks.push({ start, end, text: source.slice(start, end) });
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** 中文按词切 + bigram 兜底；ASCII 词整体保留，单字母与标点忽略。 */
export function tokenize(text) {
  const source = String(text ?? '').toLowerCase();
  const terms = new Set();
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  for (const item of segmenter.segment(source)) {
    const word = item.segment.replace(/[^\p{L}\p{N}]/gu, '');
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) {
      if (word.length >= 2 || /\d/.test(word)) terms.add(word);
      continue;
    }
    // 单字中文词一律丢弃（停用词兜底），只保留 >=2 字的词与词内 bigram。
    const chars = [...word];
    if (chars.length < 2 || STOP_TERMS.has(word)) continue;
    terms.add(word);
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const bigram = `${chars[i]}${chars[i + 1]}`;
      if (!STOP_TERMS.has(bigram)) terms.add(bigram);
    }
  }
  return [...terms];
}

function termCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/** 读 v1 单文件 / v2 分片的房间图，产出 cardPath → { name, neighborNames }。 */
function collectGraphInfo(fs, path, kbsDir) {
  const info = {};
  const mergeChildren = (target, raw) => {
    if (!isPlainObject(raw)) return;
    if (isPlainObject(raw.children)) Object.assign(target, raw.children);
  };
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const graphPath = path.join(dir, '_graph.json');
    const raw = readJsonSafe(fs, graphPath);
    if (raw) {
      const children = {};
      const edges = [];
      mergeChildren(children, raw);
      if (Array.isArray(raw.edges)) edges.push(...raw.edges);
      const shardsDir = path.join(dir, '_graph');
      if (raw.version === 2 && fs.existsSync(shardsDir)) {
        let names = [];
        try { names = fs.readdirSync(shardsDir); } catch { names = []; }
        for (const name of names) {
          if (!/^(nodes|edges)-.*\.json$/.test(name)) continue;
          const shard = readJsonSafe(fs, path.join(shardsDir, name));
          if (!shard) continue;
          if (name.startsWith('nodes-')) mergeChildren(children, shard);
          else if (Array.isArray(shard)) edges.push(...shard);
        }
      }
      const roomPath = toPosix(path.relative(kbsDir, dir));
      for (const [key, child] of Object.entries(children)) {
        const cardPath = roomPath ? `${roomPath}/${key}` : key;
        const neighborNames = [];
        for (const edge of edges) {
          if (!isPlainObject(edge)) continue;
          const other = edge.source === key ? edge.target : edge.target === key ? edge.source : '';
          const name = isPlainObject(children[other]) ? children[other].name : '';
          if (typeof name === 'string' && name) neighborNames.push(name.toLowerCase());
        }
        info[cardPath] = {
          name: String(isPlainObject(child) && child.name ? child.name : key).toLowerCase(),
          neighborNames: [...new Set(neighborNames)].slice(0, 24),
        };
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  if (fs.existsSync(kbsDir)) walk(kbsDir, 0);
  return info;
}

/** 枚举全部可索引源文件（不读正文，只取 stat / 标题 / 签名）。 */
function scanSourceFiles(fs, path, workDir) {
  const kbsDir = path.join(workDir, 'kbs');
  const docsDirs = fs.existsSync(kbsDir) ? collectDocsDirs(fs, path, kbsDir, 24) : [];
  const rootDocs = path.join(workDir, '_docs');
  if (fs.existsSync(path.join(rootDocs, TOPO_DOCUMENT_MANIFEST))) docsDirs.push(rootDocs);
  const found = [];
  for (const docsDir of docsDirs) {
    const manifestPath = path.join(docsDir, TOPO_DOCUMENT_MANIFEST);
    const manifest = readJsonSafe(fs, manifestPath);
    if (!manifest || manifest.version !== 2 || !isPlainObject(manifest.documents)) continue;
    let treeStat;
    try { treeStat = fs.statSync(manifestPath); } catch { continue; }
    const cardPath = path.dirname(docsDir) === workDir
      ? '__ROOT__'
      : toPosix(path.relative(kbsDir, path.dirname(docsDir)));
    const breadcrumb = cardPath === '__ROOT__' ? '工作区根节点' : cardPath.split('/').join(' / ');
    for (const [docId, item] of Object.entries(manifest.documents)) {
      if (!isPlainObject(item) || !INDEXABLE_TYPES.has(item.type)) continue;
      const extension = INDEXABLE_EXTENSIONS[item.type];
      const fileName = safeFileName(item.path, extension);
      if (!fileName) continue;
      const filePath = path.resolve(docsDir, fileName);
      if (path.dirname(filePath) !== path.resolve(docsDir)) continue;
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (!stat.isFile()) continue;
      const title = String(item.title || docId).trim().slice(0, 200) || docId;
      found.push({
        sourceKey: toPosix(path.relative(workDir, filePath)),
        filePath, docId, cardPath, breadcrumb, title, type: item.type,
        signature: `${signatureOf(stat)}:${signatureOf(treeStat)}:${title}`,
      });
      if (found.length >= MAX_INDEX_FILES) return found;
    }
  }
  return found;
}

function buildSource(fs, entry) {
  const content = readJsonSafe(fs, entry.filePath);
  if (!content) return null;
  const text = extractPlainText(content, entry.type);
  const chunks = chunkText(`${entry.title}\n${text}`.trim());
  return {
    signature: entry.signature,
    docId: entry.docId,
    cardPath: entry.cardPath,
    breadcrumb: entry.breadcrumb,
    title: entry.title,
    type: entry.type,
    textLength: text.length,
    chunks,
    titleTokens: tokenize(entry.title),
    terms: chunks.map((chunk) => [...termCounts(tokenize(`${entry.title}\n${chunk.text}`)).entries()]),
  };
}

/** 从每个 source 的局部 term 表合成全局倒排 term → [sourceKey, chunkIndex, tf]。 */
function buildPostings(sources) {
  const postings = {};
  for (const [sourceKey, source] of Object.entries(sources)) {
    if (!Array.isArray(source.terms)) continue;
    source.terms.forEach((pairs, chunkIndex) => {
      if (!Array.isArray(pairs)) return;
      for (const [term, tf] of pairs) {
        if (!Array.isArray(postings[term])) postings[term] = [];
        postings[term].push([sourceKey, chunkIndex, tf]);
      }
    });
  }
  return postings;
}

function normalizeQuery(raw) {
  const input = isPlainObject(raw) ? raw : {};
  const question = typeof input.question === 'string' ? input.question.trim().slice(0, MAX_QUESTION_LENGTH) : '';
  const scope = ['all', 'kb', 'room'].includes(input.scope) ? input.scope : 'all';
  const roomPath = typeof input.roomPath === 'string' ? input.roomPath.trim().replace(/\\/g, '/').slice(0, 256) : '';
  const topK = Math.min(MAX_TOP_K, Math.max(1, Math.round(Number(input.topK) || DEFAULT_TOP_K)));
  return { question, scope, roomPath, topK };
}

function inScope(source, query) {
  if (query.scope === 'all') return true;
  const kbRoot = query.roomPath.split('/').filter(Boolean)[0] ?? '';
  if (!kbRoot) return true;
  if (query.scope === 'kb') return source.cardPath.split('/')[0] === kbRoot;
  return source.cardPath === query.roomPath || source.cardPath.startsWith(`${query.roomPath}/`);
}

/**
 * @param {{ getWorkDir: () => string, fs?: object, path?: object, now?: () => number }} deps
 */
export function createAiIndexService({ getWorkDir, fs = nodeFs, path = nodePath, now = () => Date.now() }) {
  function indexPath() {
    return path.join(getWorkDir(), '.topomind', AI_INDEX_DIR, AI_INDEX_FILE);
  }

  function loadIndex() {
    const raw = readJsonSafe(fs, indexPath());
    if (!raw || raw.version !== AI_INDEX_VERSION
      || !isPlainObject(raw.sources) || !isPlainObject(raw.postings) || !isPlainObject(raw.graph)) {
      return null;
    }
    return raw;
  }

  /** 惰性增量重建；返回 null 表示索引服务暂不可用（调用方降级，不抛错）。 */
  function ensureIndex() {
    const workDir = String(getWorkDir() || '').trim();
    if (!workDir || !fs.existsSync(workDir)) return null;
    let index = loadIndex();
    const created = !index;
    if (!index) index = { version: AI_INDEX_VERSION, sources: {}, postings: {}, graph: {} };
    const files = scanSourceFiles(fs, path, workDir);
    const seen = new Set();
    let rebuilt = 0;
    let removed = 0;
    for (const entry of files) {
      seen.add(entry.sourceKey);
      const previous = index.sources[entry.sourceKey];
      if (previous && previous.signature === entry.signature && Array.isArray(previous.chunks)) continue;
      const built = buildSource(fs, entry);
      if (!built) continue;
      index.sources[entry.sourceKey] = built;
      rebuilt += 1;
    }
    for (const key of Object.keys(index.sources)) {
      if (seen.has(key)) continue;
      delete index.sources[key];
      removed += 1;
    }
    if (created || rebuilt > 0 || removed > 0) {
      index.graph = collectGraphInfo(fs, path, path.join(workDir, 'kbs'));
      index.postings = buildPostings(index.sources);
      index.version = AI_INDEX_VERSION;
      index.generatedAt = now();
      try {
        writeJsonAtomic(fs, path, indexPath(), index);
      } catch {
        // 只写派生目录失败不应阻断问答：本次查询仍用内存里的索引继续。
      }
    }
    return { index, created, rebuilt, removed };
  }

  function query(raw) {
    const started = now();
    const queryState = normalizeQuery(raw);
    const meta = {
      created: false, rebuiltSources: 0, removedSources: 0,
      totalSources: 0, totalChunks: 0, scope: queryState.scope,
      tookMs: 0, noHit: false,
    };
    if (!queryState.question) {
      return { ok: false, code: 'invalid_request', message: '问题不能为空', hits: [], meta: { ...meta, tookMs: now() - started } };
    }
    let state;
    try {
      state = ensureIndex();
    } catch {
      return { ok: false, code: 'index_unavailable', message: '本地索引暂不可用，请稍后重试', hits: [], meta: { ...meta, tookMs: now() - started } };
    }
    if (!state) {
      return { ok: false, code: 'index_unavailable', message: '工作目录不可用，无法建立本地索引', hits: [], meta: { ...meta, tookMs: now() - started } };
    }
    const { index, created, rebuilt, removed } = state;
    meta.created = created;
    meta.rebuiltSources = rebuilt;
    meta.removedSources = removed;
    meta.totalSources = Object.keys(index.sources).length;
    const sources = Object.entries(index.sources).filter(([, source]) => inScope(source, queryState));
    const chunksBySource = sources.map(([, source]) => (Array.isArray(source.chunks) ? source.chunks.length : 0));
    const totalChunks = chunksBySource.reduce((sum, count) => sum + count, 0);
    meta.totalChunks = totalChunks;

    const terms = tokenize(queryState.question);
    const scores = new Map();
    const matchedTerms = new Set();
    if (terms.length > 0 && totalChunks > 0) {
      for (const term of terms) {
        const postings = Array.isArray(index.postings[term]) ? index.postings[term] : [];
        const df = new Set(postings.map((item) => `${item[0]}#${item[1]}`)).size;
        if (df === 0) continue;
        matchedTerms.add(term);
        const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
        for (const posting of postings) {
          const [sourceKey, chunkIndex, tf] = posting;
          const source = index.sources[sourceKey];
          if (!source || !inScope(source, queryState)) continue;
          const key = `${sourceKey}#${chunkIndex}`;
          scores.set(key, (scores.get(key) ?? 0) + idf * (Number(tf) / (Number(tf) + 1.2)));
        }
      }
      // 标题加权 + 一跳图邻居标题加权：让「只命中标题 / 关联节点」的文档也能被找到。
      for (const [sourceKey, source] of sources) {
        const titleHits = terms.filter((term) => Array.isArray(source.titleTokens) && source.titleTokens.includes(term)).length;
        const graph = index.graph?.[source.cardPath];
        let graphBoost = 0;
        if (graph) {
          if (terms.some((term) => graph.name.includes(term))) graphBoost += 0.8;
          if (terms.some((term) => graph.neighborNames.some((name) => name.includes(term)))) graphBoost += 0.4;
        }
        const boost = titleHits * 1.6 + graphBoost;
        if (boost <= 0 || !Array.isArray(source.chunks) || source.chunks.length === 0) continue;
        const key = `${sourceKey}#0`;
        scores.set(key, (scores.get(key) ?? 0) + boost);
      }
    }

    const coverage = terms.length > 0 ? matchedTerms.size / terms.length : 0;
    meta.termCoverage = Math.round(coverage * 1000) / 1000;
    // 覆盖率过低时直接判定未命中：不把「只撞上一个通用词」的无关片段交给模型。
    const ranked = coverage < MIN_QUERY_TERM_COVERAGE ? [] : [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, queryState.topK);
    const hits = ranked.map(([key, score], position) => {
      const split = key.lastIndexOf('#');
      const sourceKey = key.slice(0, split);
      const chunkIndex = Number(key.slice(split + 1));
      const source = index.sources[sourceKey];
      const chunk = source.chunks[chunkIndex] ?? { start: 0, end: 0, text: '' };
      return {
        ref: position + 1,
        docId: source.docId,
        cardPath: source.cardPath,
        title: source.title,
        breadcrumb: source.breadcrumb,
        charRange: [chunk.start, chunk.end],
        text: String(chunk.text).slice(0, MAX_FRAGMENT_LENGTH),
        score: Math.round(score * 1000) / 1000,
      };
    });
    meta.noHit = hits.length === 0;
    meta.tookMs = Math.max(0, now() - started);
    return { ok: true, hits, meta };
  }

  /** 设置页 / 诊断用：不建索引，只回报当前索引文件的统计。 */
  function stats() {
    const index = loadIndex();
    if (!index) return { built: false, sources: 0, chunks: 0 };
    const chunks = Object.values(index.sources)
      .reduce((sum, source) => sum + (Array.isArray(source.chunks) ? source.chunks.length : 0), 0);
    return { built: true, sources: Object.keys(index.sources).length, chunks, generatedAt: index.generatedAt ?? 0 };
  }

  return { query, stats, ensureIndex };
}

export default createAiIndexService;
