import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Breadcrumb from './Breadcrumb'
import { tabStore } from '../../stores/tabStore'

const graph = {
  navigateToRoot: vi.fn(async () => undefined),
  navigateToRoom: vi.fn(async () => undefined),
}

vi.mock('../../contexts/GraphContext', () => ({
  useGraphContext: () => graph,
}))

vi.mock('../../core/log-backend', () => ({
  logAction: vi.fn(async () => true),
}))

describe('Breadcrumb', () => {
  beforeEach(() => {
    tabStore.getState().reset()
    graph.navigateToRoot.mockClear()
    graph.navigateToRoom.mockClear()
  })

  it('renders only the knowledge base at root', () => {
    tabStore.getState().addKBTab({ id: 'kb:KB', label: 'KB', kbPath: 'KB' })

    render(<Breadcrumb tabId="kb:KB" />)

    expect(screen.getByRole('button', { name: 'KB' })).toBeDisabled()
    expect(screen.queryByText('>')).not.toBeInTheDocument()
  })

  it('renders knowledge base and current room without duplicating root history', () => {
    tabStore.getState().addKBTab({ id: 'kb:KB', label: 'KB', kbPath: 'KB' })
    tabStore.getState().enterRoomInTab('kb:KB', { path: 'KB/Child', kbPath: 'KB', name: 'Child' })

    render(<Breadcrumb tabId="kb:KB" />)

    expect(screen.getByRole('button', { name: 'KB' })).not.toBeDisabled()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.getAllByText('KB')).toHaveLength(1)
  })

  it('keeps original history index when filtered items are hidden', async () => {
    tabStore.getState().addKBTab({ id: 'kb:KB', label: 'KB', kbPath: 'KB' })
    tabStore.getState().enterRoomInTab('kb:KB', { path: 'KB/Parent', kbPath: 'KB', name: 'Parent' })
    tabStore.getState().enterRoomInTab('kb:KB', { path: 'KB/Parent/Child', kbPath: 'KB', name: 'Child' })

    render(<Breadcrumb tabId="kb:KB" />)

    screen.getByRole('button', { name: 'Parent' }).click()

    expect(graph.navigateToRoom).toHaveBeenCalledWith(1)
  })
})
