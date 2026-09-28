/**
 * Scale factor for showing a fixed-width design (a desktop Stitch screen) in a
 * narrower container: `containerWidth / designWidth`, clamped to (0, 1] - it
 * never scales up. A container width that is 0, negative or not finite (not
 * measured yet, `display: none`) or a bad design width yields 1, so callers
 * never get a zero/NaN/negative transform.
 */
export function computePreviewScale(containerWidth: number, designWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  if (!Number.isFinite(designWidth) || designWidth <= 0) return 1;
  return Math.min(1, containerWidth / designWidth);
}
