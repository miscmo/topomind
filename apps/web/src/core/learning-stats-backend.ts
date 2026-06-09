const META_KEY = '__meta__'
const STORAGE_PREFIX = 'topomind:learning-stats:'

function buildStorageKey(workspaceKey: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(workspaceKey || 'default')}`
}

function readWorkspaceStats(workspaceKey: string) {
  const raw = window.localStorage.getItem(buildStorageKey(workspaceKey))
  if (!raw) {
    return {} as Record<string, unknown>
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeWorkspaceStats(workspaceKey: string, data: Record<string, unknown>) {
  window.localStorage.setItem(buildStorageKey(workspaceKey), JSON.stringify(data))
}

export async function readLearningStatsData(workspaceKey: string, dateStr?: string) {
  const data = readWorkspaceStats(workspaceKey)
  return dateStr ? (data[dateStr] ?? null) : (data[META_KEY] ?? null)
}

export async function readAllLearningStatsData(workspaceKey: string) {
  const data = readWorkspaceStats(workspaceKey)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === META_KEY) {
      continue
    }
    result[key] = value
  }
  return result
}

export async function readLearningStatsSummary(workspaceKey: string, days: number) {
  const data = await readAllLearningStatsData(workspaceKey)
  const summary: Record<string, number> = {}
  const safeDays = Math.max(0, Math.floor(days))
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - Math.max(0, safeDays - 1))

  for (const [date, value] of Object.entries(data)) {
    if (date < start.toISOString().slice(0, 10)) {
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const record = value as { totalDuration?: unknown }
    const totalDuration = typeof record.totalDuration === 'number' ? record.totalDuration : 0
    summary[date] = totalDuration
  }

  return summary
}

export async function writeLearningStatsData(
  workspaceKey: string,
  dateStr: string | undefined | null,
  content: unknown,
) {
  const data = readWorkspaceStats(workspaceKey)
  data[dateStr || META_KEY] = content
  writeWorkspaceStats(workspaceKey, data)
}
