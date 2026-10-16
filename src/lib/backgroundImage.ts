/**
 * @author MoShangHuaKai
 *
 * Shared image-import and crop math for the custom widget background editor.
 * The editor works in a fixed 300px stage coordinate system, then writes a
 * square raster data URL. A square result keeps the expanded card and compact
 * orb aligned even when the source image is portrait or landscape oriented.
 */

export const MAX_BACKGROUND_FILE_BYTES = 4 * 1024 * 1024;
export const SUPPORTED_BACKGROUND_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const CROP_STAGE_SIZE = 300;
export const DEFAULT_CROP_SIZE = 252;
export const MIN_CROP_SIZE = 160;
export const MAX_CROP_SIZE = 276;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export interface CropImageLayout {
  width: number;
  height: number;
}

export interface CropImageOffset {
  x: number;
  y: number;
}

export function isSupportedBackgroundType(type: string): boolean {
  return SUPPORTED_BACKGROUND_TYPES.includes(type as (typeof SUPPORTED_BACKGROUND_TYPES)[number]);
}

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("image-read-failed"));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("image-result-invalid"));
    };
    reader.readAsDataURL(file);
  });
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-decode-failed"));
    image.src = dataUrl;
  });
}

export function getCropImageLayout(image: HTMLImageElement, zoom: number): CropImageLayout {
  const baseScale = Math.max(
    CROP_STAGE_SIZE / image.naturalWidth,
    CROP_STAGE_SIZE / image.naturalHeight,
  );
  return {
    width: image.naturalWidth * baseScale * zoom,
    height: image.naturalHeight * baseScale * zoom,
  };
}

/** Keep the source image covering the complete crop window after every drag. */
export function clampCropImageOffset(
  offset: CropImageOffset,
  layout: CropImageLayout,
  cropSize: number,
): CropImageOffset {
  const frameLeft = (CROP_STAGE_SIZE - cropSize) / 2;
  const frameRight = frameLeft + cropSize;
  return {
    x: Math.min(frameLeft, Math.max(frameRight - layout.width, offset.x)),
    y: Math.min(frameLeft, Math.max(frameRight - layout.height, offset.y)),
  };
}

export function clampCropSize(value: number): number {
  const rounded = Math.round(value / 4) * 4;
  return Math.min(MAX_CROP_SIZE, Math.max(MIN_CROP_SIZE, rounded));
}

export function centeredCropImageOffset(layout: CropImageLayout, cropSize = DEFAULT_CROP_SIZE): CropImageOffset {
  return clampCropImageOffset({
    x: (CROP_STAGE_SIZE - layout.width) / 2,
    y: (CROP_STAGE_SIZE - layout.height) / 2,
  }, layout, cropSize);
}

export function cropImageToDataUrl(
  image: HTMLImageElement,
  layout: CropImageLayout,
  offset: CropImageOffset,
  cropSize: number,
  outputSize = 900,
): string {
  const frameLeft = (CROP_STAGE_SIZE - cropSize) / 2;
  const sourceX = ((frameLeft - offset.x) / layout.width) * image.naturalWidth;
  const sourceY = ((frameLeft - offset.y) / layout.height) * image.naturalHeight;
  const sourceWidth = (cropSize / layout.width) * image.naturalWidth;
  const sourceHeight = (cropSize / layout.height) * image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas-context-unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputSize,
    outputSize,
  );

  // WebP keeps the stored image small while preserving enough detail for a
  // 306px widget. The JPEG fallback covers WebViews without WebP canvas export.
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88);
}
