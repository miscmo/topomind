import type { Disposable, LearningApi, LearningDailyRecord, WorkspaceApi } from '../../public'
import { ensureDailyRecord } from './analytics.ts'

export interface LoadedLearningStatisticsData {
  summaryByDate: Record<string, number>
  rangeRecords: Record<string, LearningDailyRecord>
}

export function subscribeLearningStatisticsWorkspace(
  workspace: WorkspaceApi,
  listener: (workspaceId: string | null) => void,
): Disposable {
  return workspace.subscribeCurrentWorkspaceId(listener)
}

export async function loadLearningStatisticsData(input: {
  learning: LearningApi
  loadedRecordDates: string[]
  summaryWindowDays: number
}): Promise<LoadedLearningStatisticsData> {
  const [summaryByDate, records] = await Promise.all([
    input.learning.getSummary({ days: input.summaryWindowDays }),
    input.learning.getDailyRecords({ dates: input.loadedRecordDates }),
  ])

  return {
    summaryByDate,
    rangeRecords: Object.fromEntries(
      Object.entries(records).map(([date, record]) => [date, ensureDailyRecord(date, record)]),
    ),
  }
}
