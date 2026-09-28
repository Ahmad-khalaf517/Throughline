import { describe, expect, it } from 'vitest';
import { computePreviewScale } from '@/lib/preview-scale';

describe('computePreviewScale', () => {
  it('scales down a narrower container proportionally', () => {
    expect(computePreviewScale(640, 1280)).toBe(0.5);
  });

  it('never scales up', () => {
    expect(computePreviewScale(1280, 1280)).toBe(1);
    expect(computePreviewScale(2560, 1280)).toBe(1);
  });

  it('falls back to 1 for unmeasured or invalid container widths', () => {
    expect(computePreviewScale(0, 1280)).toBe(1);
    expect(computePreviewScale(-10, 1280)).toBe(1);
    expect(computePreviewScale(Number.NaN, 1280)).toBe(1);
    expect(computePreviewScale(Number.POSITIVE_INFINITY, 1280)).toBe(1);
  });

  it('falls back to 1 for an invalid design width', () => {
    expect(computePreviewScale(640, 0)).toBe(1);
    expect(computePreviewScale(640, -1280)).toBe(1);
    expect(computePreviewScale(640, Number.NaN)).toBe(1);
  });
});
