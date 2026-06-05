import { useEffect, useState } from 'react'

import type { LearningApi, LearningStateSnapshot } from '../../public'

const EMPTY_LEARNING_STATE: LearningStateSnapshot = {
  isActive: false,
  todayDuration: 0,
  currentSession: null,
  meta: null,
}

export function useLearningRuntimeState(learning: LearningApi): LearningStateSnapshot {
  const [state, setState] = useState<LearningStateSnapshot>(() => learning.getState())

  useEffect(() => {
    setState(learning.getState())
    const subscription = learning.subscribeState((nextState) => {
      setState(nextState)
    })
    return () => {
      subscription.dispose()
    }
  }, [learning])

  return state ?? EMPTY_LEARNING_STATE
}
