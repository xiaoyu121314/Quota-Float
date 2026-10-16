/**
 * @author MoShangHuaKai
 *
 * Local crop editor for the widget background. It deliberately keeps the
 * selection square because both the expanded card and compact orb are square
 * visual surfaces. Users resize that square from its edges, zoom with the
 * mouse wheel, and drag the image underneath the selection before the cropped
 * result is persisted.
 */
import { ArrowCounterClockwise, Check, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import {
  CROP_STAGE_SIZE,
  DEFAULT_CROP_SIZE,
  clampCropImageOffset,
  clampCropSize,
  centeredCropImageOffset,
  cropImageToDataUrl,
  getCropImageLayout,
  loadImage,
  MAX_ZOOM,
  MIN_ZOOM,
  type CropImageOffset,
} from "../lib/backgroundImage";

interface Props {
  image: string;
  onCancel: () => void;
  onApply: (image: string) => Promise<void>;
}

type ResizeEdge = "top" | "right" | "bottom" | "left" | "top-left" | "top-right" | "bottom-right" | "bottom-left";
const RESIZE_EDGES: ResizeEdge[] = ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"];

type DragState =
  | {
      type: "move";
      pointerId: number;
      startX: number;
      startY: number;
      offset: CropImageOffset;
    }
  | {
      type: "resize";
      pointerId: number;
      startX: number;
      startY: number;
      cropSize: number;
      edge: ResizeEdge;
    };

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function BackgroundCropEditor({ image, onCancel, onApply }: Props) {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [cropSize, setCropSize] = useState(DEFAULT_CROP_SIZE);
  const [offset, setOffset] = useState<CropImageOffset>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragState = useRef<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => (source ? getCropImageLayout(source, zoom) : null), [source, zoom]);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setLoading(true);
    setError(null);
    setZoom(MIN_ZOOM);
    setCropSize(DEFAULT_CROP_SIZE);
    void loadImage(image).then((nextSource) => {
      if (cancelled) return;
      const nextLayout = getCropImageLayout(nextSource, MIN_ZOOM);
      setSource(nextSource);
      setOffset(centeredCropImageOffset(nextLayout));
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError("图片读取失败，请重新选择。");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [image]);

  useEffect(() => {
    if (!layout) return;
    setOffset((current) => clampCropImageOffset(current, layout, cropSize));
  }, [cropSize, layout]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applying) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [applying, onCancel]);

  const updateZoom = (value: number) => {
    if (!source || !layout) return;
    const nextZoom = clampZoom(value);
    const nextLayout = getCropImageLayout(source, nextZoom);
    // Keep the stage centre anchored while zooming so the visible selection
    // does not jump unexpectedly; the user can then drag for fine adjustment.
    const center = CROP_STAGE_SIZE / 2;
    const anchorX = (center - offset.x) / layout.width;
    const anchorY = (center - offset.y) / layout.height;
    const nextOffset = {
      x: center - anchorX * nextLayout.width,
      y: center - anchorY * nextLayout.height,
    };
    setZoom(nextZoom);
    setOffset(clampCropImageOffset(nextOffset, nextLayout, cropSize));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!source || applying || event.deltaY === 0) return;
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!layout || applying) return;
    stageRef.current?.setPointerCapture(event.pointerId);
    dragState.current = { type: "move", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offset };
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLSpanElement>, edge: ResizeEdge) => {
    if (!layout || applying) return;
    event.stopPropagation();
    stageRef.current?.setPointerCapture(event.pointerId);
    dragState.current = { type: "resize", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cropSize, edge };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = dragState.current;
    if (!current || current.pointerId !== event.pointerId || !layout) return;
    if (current.type === "move") {
      setOffset(clampCropImageOffset({
        x: current.offset.x + event.clientX - current.startX,
        y: current.offset.y + event.clientY - current.startY,
      }, layout, cropSize));
      return;
    }

    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    const horizontalDelta = current.edge.includes("right") ? deltaX : current.edge.includes("left") ? -deltaX : 0;
    const verticalDelta = current.edge.includes("bottom") ? deltaY : current.edge.includes("top") ? -deltaY : 0;
    const delta = horizontalDelta !== 0 && verticalDelta !== 0
      ? (horizontalDelta + verticalDelta) / 2
      : horizontalDelta || verticalDelta;
    setCropSize(clampCropSize(current.cropSize + delta));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
  };

  const handleApply = async () => {
    if (!source || !layout || applying) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(cropImageToDataUrl(source, layout, offset, cropSize));
    } catch {
      setError("裁剪结果保存失败，请重试。");
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    if (!source || applying) return;
    const nextLayout = getCropImageLayout(source, MIN_ZOOM);
    setZoom(MIN_ZOOM);
    setCropSize(DEFAULT_CROP_SIZE);
    setOffset(centeredCropImageOffset(nextLayout));
  };

  return (
    <div className="settings-background-editor" role="dialog" aria-modal="true" aria-labelledby="background-editor-title">
      <section className="settings-background-editor__dialog">
        <header className="settings-background-editor__header">
          <div>
            <p className="settings-panel__eyebrow">QUOTA FLOAT · BACKGROUND</p>
            <h2 id="background-editor-title">调整背景图片</h2>
            <p>拖动图片选择显示区域，框选结果会同时用于卡片和悬浮球。</p>
          </div>
          <button type="button" className="settings-background-editor__close" onClick={onCancel} disabled={applying} aria-label="取消调整"><X /></button>
        </header>

        <div
          className="settings-background-editor__stage"
          ref={stageRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          aria-label="背景图片裁剪区域"
        >
          {layout && source ? <img src={source.src} alt="待裁剪背景图片" draggable={false} style={{ width: layout.width, height: layout.height, left: offset.x, top: offset.y }} /> : null}
          <div className="settings-background-editor__crop" style={{ width: cropSize, height: cropSize }} aria-hidden="true">
            {RESIZE_EDGES.map((edge) => <span key={edge} className={`settings-background-editor__crop-handle settings-background-editor__crop-handle--${edge}`} onPointerDown={(event) => handleResizePointerDown(event, edge)} />)}
          </div>
          {loading ? <span className="settings-background-editor__loading">正在读取图片…</span> : null}
        </div>

        <div className="settings-background-editor__controls">
          <div className="settings-background-editor__gesture-readout"><span><b>缩放</b><output>{Math.round(zoom * 100)}%</output></span><small>在图片区域滚动鼠标滚轮</small></div>
          <div className="settings-background-editor__gesture-readout"><span><b>框选区域</b><output>{Math.round(cropSize)}px</output></span><small>拖动框选边缘或四角调整大小</small></div>
        </div>

        {error ? <p className="settings-background-editor__error" role="alert">{error}</p> : null}
        <footer className="settings-background-editor__actions">
          <button type="button" className="settings-background-editor__reset" onClick={handleReset} disabled={!source || applying}><ArrowCounterClockwise />重置</button>
          <div>
            <button type="button" className="settings-background-editor__cancel" onClick={onCancel} disabled={applying}>取消</button>
            <button type="button" className="settings-background-editor__apply" onClick={() => void handleApply()} disabled={!source || applying}>{applying ? "应用中…" : <><Check />应用裁剪</>}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
