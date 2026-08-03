export const IMAGE_PREVIEW_MIN_SCALE = 0.25
export const IMAGE_PREVIEW_MAX_SCALE = 8
export const IMAGE_PREVIEW_SCALE_STEP = 0.15

export function getImagePreviewScale(currentScale: number, deltaY: number) {
  const direction = deltaY < 0 ? 1 : -1
  const nextScale = currentScale * (1 + direction * IMAGE_PREVIEW_SCALE_STEP)
  return Math.min(IMAGE_PREVIEW_MAX_SCALE, Math.max(IMAGE_PREVIEW_MIN_SCALE, nextScale))
}
