import { createElement, lazy, Suspense } from 'react'
import type { ComponentType } from 'react'

import type { LearningApi, WorkspaceApi } from '../../public'

type LearningStatisticsPageProps = {
  learning: LearningApi
  workspace: WorkspaceApi
  onBackHome: () => void | Promise<void>
}

export async function loadLearningStatisticsPageModule() {
  const module = await import('./LearningStatisticsPage.tsx')
  return {
    default: module.LearningStatisticsPage as ComponentType<LearningStatisticsPageProps>,
  }
}

const LazyLearningStatisticsPage = lazy(loadLearningStatisticsPageModule)

export function LearningStatisticsPageEntry(props: LearningStatisticsPageProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement('div', { className: 'h-full w-full' }),
    },
    createElement(LazyLearningStatisticsPage, props),
  )
}
