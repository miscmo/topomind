import { createElement, lazy, Suspense } from 'react'
import type { ComponentType } from 'react'

import type { LearningApi, WorkspaceApi } from '../../public'

type LearningTrackerWidgetProps = {
  learning: LearningApi
  workspace: WorkspaceApi
  onOpenStatistics: () => void | Promise<void>
}

const LazyLearningTrackerWidget = lazy(async () => {
  const module = await import('./LearningTrackerWidget.tsx')
  return {
    default: module.LearningTrackerWidget as ComponentType<LearningTrackerWidgetProps>,
  }
})

export function LearningTrackerWidgetEntry(props: LearningTrackerWidgetProps) {
  return createElement(
    Suspense,
    {
      fallback: null,
    },
    createElement(LazyLearningTrackerWidget, props),
  )
}
