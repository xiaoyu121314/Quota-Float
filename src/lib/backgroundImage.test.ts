/**
 * @author MoShangHuaKai
 *
 * Regression tests for the pure image-editor helpers. Browser canvas output is
 * covered by the rendered settings-page interaction because jsdom does not
 * provide a real canvas implementation.
 */
import { describe, expect, it } from "vitest";
import {
  CROP_STAGE_SIZE,
  DEFAULT_CROP_SIZE,
  getCropImageLayout,
  isSupportedBackgroundType,
  clampCropImageOffset,
} from "./backgroundImage";

describe("custom background image helpers", () => {
  it("accepts only the supported raster formats", () => {
    expect(isSupportedBackgroundType("image/png")).toBe(true);
    expect(isSupportedBackgroundType("image/jpeg")).toBe(true);
    expect(isSupportedBackgroundType("image/webp")).toBe(true);
    expect(isSupportedBackgroundType("image/svg+xml")).toBe(false);
  });

  it("fits the source image over the crop stage before zooming", () => {
    const layout = getCropImageLayout({ naturalWidth: 1600, naturalHeight: 800 } as HTMLImageElement, 1);
    expect(layout.height).toBe(CROP_STAGE_SIZE);
    expect(layout.width).toBe(CROP_STAGE_SIZE * 2);
  });

  it("keeps dragged content inside the adjustable crop window", () => {
    const layout = { width: 600, height: 400 };
    const offset = clampCropImageOffset({ x: -500, y: 500 }, layout, DEFAULT_CROP_SIZE);
    const frameLeft = (CROP_STAGE_SIZE - DEFAULT_CROP_SIZE) / 2;
    const frameRight = frameLeft + DEFAULT_CROP_SIZE;
    expect(offset.x).toBe(frameRight - layout.width);
    expect(offset.y).toBe(frameLeft);
  });
});
