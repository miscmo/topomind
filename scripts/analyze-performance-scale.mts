#!/usr/bin/env node
/**
 * 画布规模阈值标定 / 取样分析（只读工具，不修改应用代码）
 *
 *   node --experimental-strip-types --experimental-specifier-resolution=node \
 *     scripts/analyze-performance-scale.mts
 *   npm run perf:calibrate -- --input outputs/perf-samples.json [--out outputs/scale-calibration.md] [--strict]
 *   npm run perf:calibrate -- --input <日志按日文件 .jsonl> [--out report.md]
 *
 * --input 同时接受三种形状：宿主导出的样本数组 / {samples:[...]}、样本 JSONL、
 * 以及宿主按日落盘的原始日志 JSONL（自动只取 action=性能:记录 的行，并复用
 * extractPerformanceSamples 的同一套反解口径）。
 * 无 --input 时用由契约派生的确定性合成夹具自检标定逻辑；传入真实样本后，
 * 报告里的「建议倍数」可直接用来调整 thresholdForScale 的系数，或增删
 * SCALE_ADJUSTED_OPERATIONS。合成数据只验证算法与报告格式，不代表真实负载。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PerformanceSample } from '../src/shared/observability/performanceMetrics.ts'
import type {
  CalibrationSummary,
  CalibrationVerdict,
  ScaleCalibrationRow,
} from '../src/shared/observability/performanceStatistics.ts'

type Sample = PerformanceSample

interface ContractApi {
  PERFORMANCE_ACTION: string
  CANVAS_OPERATION_THRESHOLDS: Record<string, number>
  SCALE_ADJUSTED_OPERATIONS: readonly string[]
  thresholdForScale: (base: number, nodeCount: number, operation?: string) => number
}

/** 日志行反解：与宿主 PerformanceApi 共用同一实现，避免两处口径分叉。 */
interface MetricsApi {
  extractPerformanceSamples: (entries: Array<Record<string, unknown>>) => Sample[]
}

interface StatisticsApi {
  CALIBRATION_MIN_SAMPLES: number
  CALIBRATION_TIGHT_SLOW_RATE: number
  CALIBRATION_LOOSE_RATIO: number
  CALIBRATION_VERDICT_LABELS: Record<CalibrationVerdict, string>
  SCALE_BUCKETS: ReadonlyArray<{ id: string; label: string; min: number; max: number }>
  computeScaleCalibration: (samples: Sample[], minSamples?: number) => ScaleCalibrationRow[]
  computeCalibrationSummary: (rows: ScaleCalibrationRow[]) => CalibrationSummary
}

// 源码内部是无扩展名相对导入，Node 的 strip-types 直接跑会断链；
// 与第 40 组门禁一致，用 esbuild 真打包这两个零依赖纯函数模块后再加载。
const { build: esbuildBuild } = await import('esbuild')
const loadModule = async (relative: string): Promise<unknown> => {
  const result = await esbuildBuild({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const contractApi = await loadModule('../src/shared/observability/performanceContract.ts') as ContractApi
const statisticsApi = await loadModule('../src/shared/observability/performanceStatistics.ts') as StatisticsApi
const metricsApi = await loadModule('../src/shared/observability/performanceMetrics.ts') as MetricsApi
const {
  PERFORMANCE_ACTION,
  CANVAS_OPERATION_THRESHOLDS,
  SCALE_ADJUSTED_OPERATIONS,
  thresholdForScale,
} = contractApi
const { extractPerformanceSamples } = metricsApi
const {
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_TIGHT_SLOW_RATE,
  CALIBRATION_LOOSE_RATIO,
  CALIBRATION_VERDICT_LABELS,
  SCALE_BUCKETS,
  computeScaleCalibration,
  computeCalibrationSummary,
} = statisticsApi

const argv = process.argv.slice(2)
const readArg = (name: string): string | undefined => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const hasFlag = (name: string): boolean => argv.includes(name)

if (hasFlag('--help')) {
  console.log('用法: analyze-performance-scale.mts [--input samples.json|samples.jsonl|<日志>.jsonl] [--out report.md] [--strict]')
  console.log('  --input 可为宿主导出的样本、{samples:[...]}、样本 JSONL，或宿主按日落盘的原始日志 JSONL')
  process.exit(0)
}

type Sample = PerformanceSample

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 宿主导出的样本可能缺字段或把规模字段放顶层，这里补齐到统计层需要的形状。 */
function normalizeSample(raw: Record<string, unknown>, index: number): Sample {
  const rawParams = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
    ? raw.params as Record<string, unknown>
    : {}
  const params: Record<string, unknown> = { ...rawParams }
  if (params.nodeCount === undefined && typeof raw.nodeCount === 'number') params.nodeCount = raw.nodeCount
  if (params.operation === undefined && typeof raw.operation === 'string') params.operation = raw.operation
  if (params.scaleLabel === undefined && typeof raw.scaleLabel === 'string') params.scaleLabel = raw.scaleLabel
  const timestampMs = asNumber(raw.timestampMs, Number.isFinite(Date.parse(String(raw.timestamp ?? '')))
    ? Date.parse(String(raw.timestamp)) : 0)
  return {
    id: String(raw.id ?? `sample-${index}`),
    metric: String(raw.metric ?? 'canvas_edit') as Sample['metric'],
    label: String(raw.label ?? raw.metric ?? '未命名指标'),
    shortLabel: String(raw.shortLabel ?? raw.label ?? ''),
    color: String(raw.color ?? 'var(--color-accent)'),
    category: String(raw.category ?? 'canvas') as Sample['category'],
    thresholdMs: asNumber(raw.thresholdMs, asNumber(params.thresholdMs, 1000)),
    durationMs: asNumber(raw.durationMs, asNumber(params.durationMs, 0)),
    success: raw.success !== false,
    timestamp: String(raw.timestamp ?? new Date(timestampMs || Date.now()).toISOString()),
    timestampMs,
    source: typeof raw.source === 'string' ? raw.source : '',
    module: typeof raw.module === 'string' ? raw.module : '',
    params,
  }
}

async function loadSamples(inputPath: string): Promise<{ samples: Sample[]; label: string }> {
  const text = (await readFile(resolve(inputPath), 'utf8')).trim()
  if (!text) throw new Error(`样本文件为空: ${inputPath}`)
  let rawList: unknown[]
  if (text.startsWith('[')) {
    rawList = JSON.parse(text) as unknown[]
  } else {
    // JSONL 每行都是完整 JSON，整体 parse 必然失败；失败后再按行解析。
    // 单条 {samples:[...]} 也能被这个分支正确识别。
    try {
      const parsed: unknown = JSON.parse(text)
      rawList = Array.isArray(parsed) ? parsed : (parsed as { samples?: unknown[] }).samples ?? []
    } catch {
      rawList = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
    }
  }
  if (!Array.isArray(rawList)) throw new Error('样本格式应为数组、{samples:[...]}、样本 JSONL 或日志 JSONL')

  // 宿主按日落盘的是 LogEntry JSONL（action 在顶层、性能字段在 params 里），
  // 与已反解的样本数组形状不同。识别到日志行就复用宿主的 extractPerformanceSamples，
  // 保证 metric / 生效阈值 / success / 规模字段的反解口径与监控页完全一致；
  // 非性能日志行由该函数自行过滤，不会被当成 0ms 样本混进标定分母。
  const isLogRow = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).action === 'string'
  const logRows = rawList.filter(isLogRow)
  if (logRows.length > 0) {
    // 字符串 params 等历史格式由宿主反解器自己容错，CLI 不再维护第二份清洗逻辑。
    const samples = extractPerformanceSamples(logRows)
    return {
      samples,
      label: `日志 ${inputPath}（${logRows.length} 条日志 → ${samples.length} 条${PERFORMANCE_ACTION}样本）`,
    }
  }

  return {
    samples: rawList.map((raw, index) => normalizeSample(raw as Record<string, unknown>, index)),
    label: `文件 ${inputPath}`,
  }
}

// ===== 合成基准 =====
// 用途：在没有任何真实样本时，验证「阈值放宽速度」与「耗时增长速度」错配能否被
// 标定算法识别出来。固定 seed，报告可复现；不要拿它当线上性能结论。

const SYNTHETIC_SEED = 20261114
const SYNTHETIC_NODE_COUNTS = [80, 600, 2500, 9000, 25000]
/** 200 节点以内的健康负载水平（占静态阈值的比例），小图不应被标红。 */
const SYNTHETIC_LOAD_LEVEL = 0.6
/** 每个动作超出 200 节点后随 log2(规模) 增长的耗时系数；与 thresholdForScale 的 0.6 形成对照。 */
const SYNTHETIC_GROWTH: Record<string, number> = {
  meta_build: 1.5,      // 增长快于阈值 → 大图应判「过紧」
  delete_batch: 1.15,
  subtree_select: 1.05,
  meta_flush: 0.85,
  search: 0.8,
  batch_style: 0.7,
  tree_expand: 0.55,
  lod_recompute: 0.3,   // 增长慢于阈值 → 大图应判「过松」
}
const SYNTHETIC_INTERACTIVE = ['create', 'drag'] // 固定阈值，耗时不随规模变化

function buildSyntheticSamples(): Sample[] {
  let seed = SYNTHETIC_SEED
  const jitter = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const samples: Sample[] = []
  let sequence = 0
  let timestampMs = Date.parse('2026-11-14T12:00:00.000Z')
  const operations = [...SCALE_ADJUSTED_OPERATIONS, ...SYNTHETIC_INTERACTIVE]
  for (const operation of operations) {
    const base = CANVAS_OPERATION_THRESHOLDS[operation]
    const growth = SYNTHETIC_GROWTH[operation] ?? 0
    for (const nodeCount of SYNTHETIC_NODE_COUNTS) {
      const thresholdMs = thresholdForScale(base, nodeCount, operation)
      for (let i = 0; i < 8; i += 1) {
        const noise = 0.85 + jitter() * 0.3
        // 只在超过 200 节点后按 log2 增长，小图保持健康；
        // 阈值同样按 log2 放宽，两者增速差决定标定是过紧、合理还是过松。
        const growthTerm = growth > 0
          ? Math.log2(1 + Math.max(0, nodeCount - 200) / 200) * growth
          : 0
        const durationMs = growth > 0
          ? Math.round(base * SYNTHETIC_LOAD_LEVEL * (1 + growthTerm) * noise)
          : Math.round(base * (0.55 + jitter() * 0.25))
        timestampMs += 37
        sequence += 1
        samples.push({
          id: `synthetic-${sequence}`,
          metric: 'canvas_edit',
          label: `合成 · ${operation}`,
          shortLabel: operation,
          color: 'var(--color-accent)',
          category: 'canvas',
          thresholdMs,
          durationMs,
          success: true,
          timestamp: new Date(timestampMs).toISOString(),
          timestampMs,
          source: 'analyze-performance-scale:synthetic',
          module: 'synthetic',
          params: {
            operation,
            nodeCount,
            edgeCount: Math.round(nodeCount * 1.3),
            affectedCount: 1,
            hiddenCount: 0,
            scaleLabel: `${nodeCount} 节点`,
          },
        })
      }
    }
  }
  return samples
}

function formatMs(value: number): string {
  return `${Math.round(value)} ms`
}

function renderReport(
  samples: Sample[],
  rows: ScaleCalibrationRow[],
  label: string,
  synthetic: boolean,
): string {
  const summary = computeCalibrationSummary(rows)
  const verdictCounts: Record<CalibrationVerdict, number> = {
    too_tight: summary.tooTight,
    too_loose: summary.tooLoose,
    healthy: summary.healthy,
    insufficient: summary.insufficient,
  }
  const lines: string[] = [
    '# 画布规模阈值标定报告',
    '',
    `- 数据来源：${label}${synthetic ? '（**合成基准，仅用于自检算法，不代表真实负载**）' : ''}`,
    `- 样本数：${samples.length}；有效分组（动作 × 规模桶）：${summary.totalRows}，覆盖样本 ${summary.sampleCount}`,
    `- 判定口径：慢操作 = 成功且耗时 > 生效阈值；慢率 > ${CALIBRATION_TIGHT_SLOW_RATE}% 且 P95 越线判「过紧」；零慢样本且 P95/阈值 < ${CALIBRATION_LOOSE_RATIO} 判「过松」；不足 ${CALIBRATION_MIN_SAMPLES} 条不下结论。分位数与慢率只基于成功样本，失败样本单独计`,
    `- 规模桶：${SCALE_BUCKETS.map((bucket) => `${bucket.id}(${bucket.min}~${bucket.max === Infinity ? '∞' : bucket.max})`).join(' / ')}`,
    '',
    '## 汇总',
    '',
    '| 判定 | 分组数 |',
    '| --- | ---: |',
    ...(['too_tight', 'too_loose', 'healthy', 'insufficient'] as const).map((verdict) =>
      `| ${CALIBRATION_VERDICT_LABELS[verdict]} | ${verdictCounts[verdict]} |`),
    '',
    '## 动作 × 规模桶',
    '',
    '| 动作 | 规模桶 | 样本 | P50 | P95 | 基础阈值 | 生效阈值 | 实际倍数 | 慢率 | 判定 | 建议倍数 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
    ...rows.map((row) => [
      row.label,
      row.bucketLabel,
      row.count,
      formatMs(row.p50Ms),
      formatMs(row.p95Ms),
      formatMs(row.baseThresholdMs),
      formatMs(row.effectiveThresholdMs),
      `×${row.appliedFactor}`,
      `${row.slowRate}%`,
      CALIBRATION_VERDICT_LABELS[row.verdict],
      `×${row.suggestedFactor}`,
    ].join(' | ')).map((line) => `| ${line} |`),
    '',
    '## 调参建议',
    '',
  ]

  const tight = rows.filter((row) => row.verdict === 'too_tight')
  const loose = rows.filter((row) => row.verdict === 'too_loose')
  if (summary.worst) {
    lines.push(`- **优先处理**：${summary.worst.label} / ${summary.worst.bucketLabel} 慢率 ${summary.worst.slowRate}%，建议把放宽倍数从 ×${summary.worst.appliedFactor} 调到约 ×${summary.worst.suggestedFactor}。`)
  }
  if (tight.length > 0) {
    const names = [...new Set(tight.map((row) => row.label))].join('、')
    lines.push(`- **阈值过紧**（${tight.length} 组）：${names}。耗时增长快于 \`thresholdForScale\` 的对数放宽，可提高系数或把这些动作的静态阈值调高。`)
  }
  if (loose.length > 0) {
    const names = [...new Set(loose.map((row) => row.label))].join('、')
    lines.push(`- **阈值过松**（${loose.length} 组）：${names}。规模放宽超过了实际耗时增长，可从 \`SCALE_ADJUSTED_OPERATIONS\` 移除或降低系数，避免漏报慢操作。`)
  }
  if (rows.some((row) => row.verdict === 'too_tight' && row.suggestedFactor > 8)) {
    lines.push('- 部分建议倍数已超过 `thresholdForScale` 的 8 倍上限：此时应调高该动作的静态阈值或优化实现，单纯调系数不会生效。')
  }
  if (tight.length === 0 && loose.length === 0) lines.push('- 当前样本下未发现明显错配；样本不足的分组需补数据后再判断。')
  lines.push('- `suggestedFactor` 只是调参参考，工具不会自动修改契约；改完请重跑本脚本与 `verify:critical`。')
  if (synthetic) {
    lines.push('', '> 合成基准用固定 seed 生成，目的是验证标定算法能区分「放宽不足」与「放宽过度」。真实标定可直接传宿主按日落盘的日志 JSONL，或监控页「导出样本」得到的 JSON；建议在 5k+ 节点房间做批量删除、缩放后再导出。')
  }
  return `${lines.join('\n')}\n`
}

const inputPath = readArg('--input')
const { samples, label } = inputPath
  ? await loadSamples(inputPath)
  : { samples: buildSyntheticSamples(), label: `合成基准 seed=${SYNTHETIC_SEED}` }
const rows = computeScaleCalibration(samples)
const report = renderReport(samples, rows, label, !inputPath)
const outPath = readArg('--out')
if (outPath) await writeFile(resolve(outPath), report, 'utf8')
console.log(outPath ? `标定报告已写入 ${resolve(outPath)}` : report)

const summary = computeCalibrationSummary(rows)
if (hasFlag('--strict') && summary.tooTight > 0) {
  console.error(`strict: 发现 ${summary.tooTight} 个阈值过紧分组`)
  process.exit(1)
}
