/**
 * PDF 한 페이지 위에 겹치는 필기 레이어 (React 래퍼)
 *
 * 사용 예:
 *   <div className="relative" style={{ width: pageWidthPx, aspectRatio: `${w} / ${h}` }}>
 *     <canvas ref={pdfCanvas} />                       // PDF.js 가 그린 페이지
 *     <InkLayer data={ink} settings={settings} onChange={save} ref={inkRef} />
 *   </div>
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { InkEngine, type InkSettings, type PageInkData } from "./inkEngine";

export interface InkLayerHandle {
  undo(): void;
  redo(): void;
  clear(): void;
  getData(): PageInkData | null;
  renderTo(ctx: CanvasRenderingContext2D, width: number): void;
}

interface Props {
  data?: PageInkData | null;
  settings: InkSettings;
  onChange?: (data: PageInkData) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  onPinch?: (ratio: number, cx: number, cy: number) => void;
  onPan?: (dx: number, dy: number) => void;
  className?: string;
}

export const InkLayer = forwardRef<InkLayerHandle, Props>(function InkLayer(
  { data, settings, onChange, onHistoryChange, onPinch, onPan, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  // 최신 콜백 유지(엔진 재생성 없이)
  const cb = useRef({ onChange, onHistoryChange, onPinch, onPan });
  cb.current = { onChange, onHistoryChange, onPinch, onPan };
  // 엔진이 직접 만든 데이터를 다시 setData 하지 않도록 기록
  const lastEmitted = useRef<PageInkData | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new InkEngine(hostRef.current, {
      ...(data ? { data } : {}),
      settings,
      onChange: (d) => {
        lastEmitted.current = d;
        cb.current.onChange?.(d);
      },
      onHistoryChange: (u, r) => cb.current.onHistoryChange?.(u, r),
      onPinch: (r, x, y) => cb.current.onPinch?.(r, x, y),
      ...(cb.current.onPan
        ? { onPan: (dx: number, dy: number) => cb.current.onPan?.(dx, dy) }
        : {}),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // 엔진은 마운트 시 한 번만 생성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    // 외부(서버 로딩 등)에서 바뀐 데이터만 반영
    if (data && data !== lastEmitted.current) engineRef.current?.setData(data);
  }, [data]);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => engineRef.current?.undo(),
      redo: () => engineRef.current?.redo(),
      clear: () => engineRef.current?.clear(),
      getData: () => engineRef.current?.getData() ?? null,
      renderTo: (ctx, w) => engineRef.current?.renderTo(ctx, w),
    }),
    [],
  );

  return <div ref={hostRef} className={className} style={{ position: "absolute", inset: 0 }} />;
});
