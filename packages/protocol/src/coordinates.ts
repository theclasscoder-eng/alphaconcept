/**
 * Pure coordinate-translation helpers used on both ends of a session.
 *
 * Wire format: pointer positions travel as NORMALIZED coordinates in [0, 1]
 * relative to the shared display's content, independent of either machine's
 * resolution or DPI. The controller converts local viewer pixels -> normalized;
 * the host converts normalized -> its display's coordinate space.
 *
 * These functions are deterministic and side-effect free so they can be unit
 * tested exhaustively (see coordinates.test.ts).
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPoint {
  /** 0..1 across the shared display width. */
  nx: number;
  /** 0..1 down the shared display height. */
  ny: number;
}

export interface DisplayInfo {
  /** Display bounds in the OS virtual-screen coordinate space (logical/DIP). */
  bounds: Rect;
  /** OS DPI scale factor (e.g. 1.0, 1.25, 1.5, 2.0). */
  scaleFactor: number;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Compute the letterboxed content rectangle for a video of `video` aspect ratio
 * drawn "fit-to-window" (contain) inside a `viewport`. The returned rect is the
 * on-screen area the actual frame occupies; the remaining viewport is bars.
 */
export function computeContentRect(viewport: Size, video: Size): Rect {
  if (viewport.width <= 0 || viewport.height <= 0 || video.width <= 0 || video.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const viewportAspect = viewport.width / viewport.height;
  const videoAspect = video.width / video.height;

  let width: number;
  let height: number;
  if (videoAspect > viewportAspect) {
    // Video is wider -> full width, bars top/bottom.
    width = viewport.width;
    height = viewport.width / videoAspect;
  } else {
    // Video is taller/narrower -> full height, bars left/right.
    height = viewport.height;
    width = viewport.height * videoAspect;
  }
  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
}

/**
 * Convert a pointer position (in viewer element pixels) to normalized display
 * coordinates, accounting for letterboxing. `inBounds` is false when the pointer
 * is over the letterbox bars (outside the actual frame) — callers should drop or
 * clamp such events rather than injecting an edge click.
 */
export function viewerPixelToNormalized(
  pointer: { x: number; y: number },
  contentRect: Rect,
): NormalizedPoint & { inBounds: boolean } {
  if (contentRect.width <= 0 || contentRect.height <= 0) {
    return { nx: 0, ny: 0, inBounds: false };
  }
  const rawX = (pointer.x - contentRect.x) / contentRect.width;
  const rawY = (pointer.y - contentRect.y) / contentRect.height;
  const inBounds = rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1;
  return { nx: clamp01(rawX), ny: clamp01(rawY), inBounds };
}

/**
 * Convert normalized coordinates to a point in the host display's LOGICAL
 * (DIP) coordinate space. This is what Electron's `screen` API and a
 * DPI-aware injector expect. Coordinates are clamped to the display.
 */
export function normalizedToLogicalPoint(
  point: NormalizedPoint,
  display: DisplayInfo,
): { x: number; y: number } {
  const nx = clamp01(point.nx);
  const ny = clamp01(point.ny);
  const x = display.bounds.x + nx * display.bounds.width;
  const y = display.bounds.y + ny * display.bounds.height;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Convert normalized coordinates to PHYSICAL pixels for the target display.
 * Used when the input injector operates in raw device pixels rather than DIP.
 * Note: for multi-monitor setups with mixed DPI, physical offsets across
 * monitors are approximate; prefer logical mapping with a DPI-aware injector.
 */
export function normalizedToPhysicalPoint(
  point: NormalizedPoint,
  display: DisplayInfo,
): { x: number; y: number } {
  const logical = normalizedToLogicalPoint(point, display);
  return {
    x: Math.round(logical.x * display.scaleFactor),
    y: Math.round(logical.y * display.scaleFactor),
  };
}
