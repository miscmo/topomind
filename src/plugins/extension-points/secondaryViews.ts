export const SECONDARY_VIEW_PLACEMENTS = ['workspace-secondary'] as const

export type SecondaryViewPlacement = (typeof SECONDARY_VIEW_PLACEMENTS)[number]

export interface SecondaryViewContribution {
  id: string
  title: string
  icon?: string
  placement: SecondaryViewPlacement
  openCommand?: string
}
