/**
 * 회무노트 S펜 필기 엔진 (프레임워크 독립, 순수 TypeScript)
 *
 * 핵심 설계
 *  - 좌표 정규화: 페이지 가로폭 = 1000 단위. 확대/축소·기기(폰/탭/PC)가 달라도 필기 위치가 정확히 유지됨.
 *  - 3단 캔버스: [형광펜 층] → [펜 층] → [실시간 층], 레이어 전체는 PDF 위에 '곱하기' 합성
 *      · 형광펜은 글자 아래에 깔리고, 겹쳐 칠해도 진해지지 않음(실제 형광펜과 동일)
 *      · 완성된 획은 다시 그리지 않고, 그리는 중인 획만 매 프레임 갱신 → 부드러움
 *  - 부드러운 선: perfect-freehand(필압 기반 외곽선) + getCoalescedEvents(중간 좌표 누락 방지)
 *    + getPredictedEvents(지연 체감 감소) + desynchronized 캔버스(저지연 모드)
 *  - 손바닥 오인식 방지: penOnly=true 이면 S펜만 필기, 손가락은 스크롤(관성)·두 손가락 확대
 *  - S펜 측면 버튼을 누른 채 그리면 지우개(설정으로 끌 수 있음)
 *  - 꾹 누르고 멈추면 직선으로 자동 보정(밑줄 긋기)
 */
import { getStroke } from "perfect-freehand";

export type InkTool = "pen" | "highlighter" | "line" | "eraser" | "none";
export type StrokeKind = "pen" | "highlighter";

/** [x, y, pressure] — x,y 는 페이지 가로폭 1000 기준 좌표 */
export type InkPoint = [number, number, number];

export interface InkStroke {
  id: string;
  kind: StrokeKind;
  color: string;
  /** 굵기(페이지 가로폭 1000 기준 단위) */
  size: number;
  /** 필압 민감도 0~0.9 (펜만 해당) */
  thinning: number;
  /** 마우스·손가락처럼 필압이 없는 입력이면 true → 속도로 굵기 흉내 */
  simulatePressure: boolean;
  /** 직선 보정된 획 */
  straight?: boolean;
  points: InkPoint[];
  createdAt: number;
}

export interface PageInkData {
  v: 1;
  strokes: InkStroke[];
}

export interface InkSettings {
  tool: InkTool;
  penColor: string;
  penSize: number;
  penThinning: number;
  highlighterColor: string;
  highlighterSize: number;
  eraserSize: number;
  /** true: 펜만 필기, 손가락은 스크롤/확대 (탭 + S펜 권장) */
  penOnly: boolean;
  /** S펜 측면 버튼 누르고 그리면 지우개 */
  sideButtonEraser: boolean;
  /** 멈추면 직선 보정 */
  holdToStraighten: boolean;
  /** 손떨림 보정 0~1 (클수록 매끈, 약간 늦게 따라옴) */
  streamline: number;
}

export const DEFAULT_SETTINGS: InkSettings = {
  tool: "pen",
  penColor: "#111827",
  penSize: 3,
  penThinning: 0.55,
  highlighterColor: "#fde047",
  highlighterSize: 18,
  eraserSize: 14,
  penOnly: true,
  sideButtonEraser: true,
  holdToStraighten: true,
  streamline: 0.45,
};

export interface InkEngineOptions {
  /** 초기 데이터 */
  data?: PageInkData;
  settings?: Partial<InkSettings>;
  /** 획 추가/삭제 시 호출 (저장은 앱에서 디바운스) */
  onChange?: (data: PageInkData) => void;
  /** 실행취소/다시실행 가능 여부 변경 */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  /** 손가락 한 개 이동(펜 전용 모드). 기본: 가장 가까운 스크롤 영역을 스크롤 */
  onPan?: (dx: number, dy: number) => void;
  /** 손가락 두 개 확대/축소. ratio>1 확대 */
  onPinch?: (ratio: number, centerX: number, centerY: number) => void;
}

type HistoryEntry =
  { type: "add"; strokes: InkStroke[] } | { type: "remove"; strokes: InkStroke[] };

const UNITS = 1000;
const HOLD_MS = 550;
const HOLD_TOLERANCE = 2.5; // 단위
const MIN_LINE_LENGTH = 12; // 단위

let idSeq = 0;
const newId = () =>
  `${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** perfect-freehand 외곽선 → Path2D (2차 곡선으로 매끈하게) */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  const at = (i: number): [number, number] => {
    const q = outline[i % n] ?? [0, 0];
    return [q[0] ?? 0, q[1] ?? 0];
  };
  const [sx, sy] = at(0);
  path.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i);
    const [x1, y1] = at(i + 1);
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

export function strokeOutline(
  s: Pick<InkStroke, "kind" | "size" | "thinning" | "simulatePressure" | "straight" | "points">,
  streamline = 0.45,
  last = true,
) {
  const isHl = s.kind === "highlighter";
  const p0 = s.points[0];
  const pts: InkPoint[] =
    s.points.length === 1 && p0 ? [p0, [p0[0] + 0.01, p0[1], p0[2]]] : s.points;
  return getStroke(pts, {
    size: s.size,
    thinning: isHl || s.straight ? 0 : s.thinning,
    smoothing: 0.6,
    streamline: s.straight ? 0 : streamline,
    simulatePressure: isHl || s.straight ? false : s.simulatePressure,
    easing: (t) => Math.sin((t * Math.PI) / 2), // 필압 곡선: 가볍게 눌러도 반응
    start: { taper: false, cap: true },
    end: { taper: false, cap: true },
    last,
  });
}

/**
 * 저장된 필기 데이터를 아무 캔버스에나 그리기(PDF 내보내기·썸네일용, 화면 엔진 없이 동작).
 * width = 대상 캔버스의 페이지 가로 픽셀. only 로 형광펜/펜 층만 따로 그릴 수 있음.
 */
export function renderInkData(
  ctx: CanvasRenderingContext2D,
  data: PageInkData | null | undefined,
  width: number,
  only?: StrokeKind,
) {
  if (!data?.strokes?.length) return;
  const s = width / UNITS;
  ctx.save();
  ctx.scale(s, s);
  const draw = (kind: StrokeKind) => {
    for (const st of data.strokes) {
      if (st.kind !== kind) continue;
      ctx.fillStyle = st.color;
      ctx.fill(outlineToPath(strokeOutline(st, DEFAULT_SETTINGS.streamline, true)));
    }
  };
  if (!only || only === "highlighter") {
    ctx.globalCompositeOperation = only ? "source-over" : "multiply";
    draw("highlighter");
  }
  if (!only || only === "pen") {
    ctx.globalCompositeOperation = "source-over";
    draw("pen");
  }
  ctx.restore();
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const st = getComputedStyle(cur);
    if (
      /(auto|scroll)/.test(st.overflowY + st.overflowX) &&
      (cur.scrollHeight > cur.clientHeight || cur.scrollWidth > cur.clientWidth)
    )
      return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ZERO: InkPoint = [0, 0, 0.5];
const firstPt = (pts: InkPoint[]): InkPoint => pts[0] ?? ZERO;
const lastPt = (pts: InkPoint[]): InkPoint => pts[pts.length - 1] ?? ZERO;

export class InkEngine {
  readonly root: HTMLDivElement;
  private hlCanvas: HTMLCanvasElement;
  private inkCanvas: HTMLCanvasElement;
  private liveCanvas: HTMLCanvasElement;
  private cursorEl: HTMLDivElement;
  private hlCtx: CanvasRenderingContext2D;
  private inkCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;

  private strokes: InkStroke[] = [];
  private pathCache = new WeakMap<InkStroke, Path2D>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  private settings: InkSettings;
  private opts: InkEngineOptions;

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private resizeObs: ResizeObserver;

  // 그리기 상태
  private activePointer: number | null = null;
  private activeTool: InkTool = "none";
  private current: InkStroke | null = null;
  private predicted: InkPoint[] = [];
  private erasedNow: InkStroke[] = [];
  private rect: DOMRect | null = null;
  private rafId = 0;
  private holdTimer = 0;
  private lastMove = { x: 0, y: 0, t: 0 };
  private snapped = false;

  // 손가락(펜 전용 모드)
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private velocity = { x: 0, y: 0, t: 0 };
  private inertiaId = 0;

  constructor(container: HTMLElement, options: InkEngineOptions = {}) {
    this.opts = options;
    this.settings = { ...DEFAULT_SETTINGS, ...options.settings };

    this.root = document.createElement("div");
    this.root.className = "ink-root";
    // 레이어 전체를 '곱하기'로 합성 → 형광펜 아래 PDF 글자가 선명하게 비침
    // (각 캔버스가 아니라 루트에 적용해야 아래 PDF 와 합성됨)
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      zIndex: "5",
      mixBlendMode: "multiply",
    } as CSSStyleDeclaration);

    const mk = (z: number, extra: Partial<CSSStyleDeclaration> = {}) => {
      const c = document.createElement("canvas");
      Object.assign(c.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: String(z),
        ...extra,
      });
      this.root.appendChild(c);
      return c;
    };
    // 형광펜 층(펜 층 아래) — 같은 층이라 겹쳐 칠해도 진해지지 않음
    this.hlCanvas = mk(1);
    this.inkCanvas = mk(2);
    this.liveCanvas = mk(3);

    this.cursorEl = document.createElement("div");
    Object.assign(this.cursorEl.style, {
      position: "absolute",
      left: "0",
      top: "0",
      zIndex: "4",
      pointerEvents: "none",
      borderRadius: "50%",
      border: "1.5px solid rgba(30,58,138,.8)",
      background: "rgba(255,255,255,.25)",
      display: "none",
      transform: "translate(-50%,-50%)",
    } as CSSStyleDeclaration);
    this.root.appendChild(this.cursorEl);

    const ctx = (c: HTMLCanvasElement, lowLatency: boolean) =>
      (c.getContext(
        "2d",
        lowLatency ? ({ desynchronized: true } as CanvasRenderingContext2DSettings) : undefined,
      ) ?? c.getContext("2d"))!;
    this.hlCtx = ctx(this.hlCanvas, false);
    this.inkCtx = ctx(this.inkCanvas, false);
    this.liveCtx = ctx(this.liveCanvas, true);

    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(this.root);

    if (options.data?.strokes) this.strokes = options.data.strokes.slice();

    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.root);
    this.resize();
    this.applyToolMode();
  }

  // ───────────────────────── 공개 API ─────────────────────────
  getSettings(): InkSettings {
    return { ...this.settings };
  }

  setSettings(patch: Partial<InkSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.applyToolMode();
  }

  getData(): PageInkData {
    return { v: 1, strokes: this.strokes.slice() };
  }

  /** 외부에서 데이터 교체(다른 기기에서 동기화 등). 실행취소 기록은 초기화 */
  setData(data: PageInkData | null | undefined) {
    this.strokes = data?.strokes?.slice() ?? [];
    this.undoStack = [];
    this.redoStack = [];
    this.redrawBase();
    this.emitHistory();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.type === "add") this.removeStrokes(e.strokes);
    else this.strokes.push(...e.strokes);
    this.redoStack.push(e);
    this.commitChange();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.type === "add") this.strokes.push(...e.strokes);
    else this.removeStrokes(e.strokes);
    this.undoStack.push(e);
    this.commitChange();
  }

  /** 이 페이지 필기 전체 지우기(실행취소 가능) */
  clear() {
    if (!this.strokes.length) return;
    const all = this.strokes.slice();
    this.strokes = [];
    this.pushHistory({ type: "remove", strokes: all });
    this.commitChange();
  }

  /** 필기를 다른 캔버스(PDF 내보내기·썸네일)에 그리기. width = 대상 픽셀 폭 */
  renderTo(ctx: CanvasRenderingContext2D, width: number) {
    const s = width / UNITS;
    ctx.save();
    ctx.scale(s, s);
    // 형광펜 먼저(곱하기), 펜 나중
    ctx.globalCompositeOperation = "multiply";
    for (const st of this.strokes) if (st.kind === "highlighter") this.fillStroke(ctx, st);
    ctx.globalCompositeOperation = "source-over";
    for (const st of this.strokes) if (st.kind === "pen") this.fillStroke(ctx, st);
    ctx.restore();
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.inertiaId);
    clearTimeout(this.holdTimer);
    this.resizeObs.disconnect();
    this.root.remove();
  }

  // ───────────────────────── 내부 ─────────────────────────
  private applyToolMode() {
    const drawing = this.settings.tool !== "none";
    // 그리기 도구일 때만 이벤트를 받음. '보기' 모드에서는 브라우저 기본 스크롤·글자 선택 그대로
    this.root.style.pointerEvents = drawing ? "auto" : "none";
    // 펜 입력이 스크롤로 빠지지 않도록 기본 제스처 차단(손가락은 엔진이 직접 스크롤 처리)
    this.root.style.touchAction = drawing ? "none" : "auto";
    this.root.style.cursor = drawing ? "crosshair" : "default";
    if (!drawing) this.cursorEl.style.display = "none";
  }

  private resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (r.width === this.cssW && r.height === this.cssH && dpr === this.dpr) return;
    this.cssW = r.width;
    this.cssH = r.height;
    this.dpr = dpr;
    for (const c of [this.hlCanvas, this.inkCanvas, this.liveCanvas]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    this.redrawBase();
  }

  /** CSS px → 단위 변환 배율 */
  private get scale() {
    return this.cssW / UNITS;
  }

  private setTransform(ctx: CanvasRenderingContext2D) {
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  private pathOf(s: InkStroke) {
    let p = this.pathCache.get(s);
    if (!p) {
      p = outlineToPath(strokeOutline(s, this.settings.streamline, true));
      this.pathCache.set(s, p);
    }
    return p;
  }

  private fillStroke(ctx: CanvasRenderingContext2D, s: InkStroke) {
    ctx.fillStyle = s.color;
    ctx.fill(this.pathOf(s));
  }

  private redrawBase() {
    for (const ctx of [this.hlCtx, this.inkCtx]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      this.setTransform(ctx);
    }
    for (const s of this.strokes)
      this.fillStroke(s.kind === "highlighter" ? this.hlCtx : this.inkCtx, s);
  }

  private drawOnBase(s: InkStroke) {
    const ctx = s.kind === "highlighter" ? this.hlCtx : this.inkCtx;
    this.setTransform(ctx);
    this.fillStroke(ctx, s);
  }

  private clearLive() {
    const c = this.liveCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }

  private renderLive = () => {
    this.rafId = 0;
    this.clearLive();
    const s = this.current;
    if (!s) return;
    const ctx = this.liveCtx;
    this.setTransform(ctx);
    const pts = this.predicted.length && !this.snapped ? s.points.concat(this.predicted) : s.points;
    const outline = strokeOutline({ ...s, points: pts }, this.settings.streamline, false);
    ctx.fillStyle = s.color;
    ctx.fill(outlineToPath(outline));
  };

  private requestLive() {
    if (!this.rafId) this.rafId = requestAnimationFrame(this.renderLive);
  }

  private toUnits(e: PointerEvent): InkPoint {
    const r = this.rect ?? this.root.getBoundingClientRect();
    const k = UNITS / r.width;
    const pressure = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    return [round2((e.clientX - r.left) * k), round2((e.clientY - r.top) * k), round2(pressure)];
  }

  private bindEvents() {
    const el = this.root;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    // 펜 길게 누르기 시 뜨는 메뉴/선택 방지
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("selectstart", (e) => e.preventDefault());
  }

  private isDrawingPointer(e: PointerEvent) {
    if (e.pointerType === "pen" || e.pointerType === "mouse") return true;
    return !this.settings.penOnly; // 손가락: 펜 전용 모드가 아닐 때만 필기
  }

  private resolveTool(e: PointerEvent): InkTool {
    // buttons 32 = S펜/스타일러스 지우개 끝, 2 = 측면(배럴) 버튼
    if (e.pointerType === "pen" && e.buttons & 32) return "eraser";
    if (e.pointerType === "pen" && this.settings.sideButtonEraser && e.buttons & 2) return "eraser";
    if (e.pointerType === "mouse" && e.button === 2) return "eraser";
    return this.settings.tool;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.isDrawingPointer(e)) {
      this.onTouchDown(e);
      return;
    }
    if (this.activePointer !== null) return; // 이미 그리는 중(멀티터치 무시)
    const tool = this.resolveTool(e);
    if (tool === "none") return;
    e.preventDefault();
    cancelAnimationFrame(this.inertiaId);
    this.activePointer = e.pointerId;
    this.activeTool = tool;
    this.rect = this.root.getBoundingClientRect();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* 일부 브라우저 무시 */
    }

    const p = this.toUnits(e);
    if (tool === "eraser") {
      this.erasedNow = [];
      this.eraseAt(p[0], p[1]);
      this.showCursor(e, this.settings.eraserSize);
      return;
    }

    const isHl = tool === "highlighter";
    this.snapped = tool === "line";
    this.current = {
      id: newId(),
      kind: isHl ? "highlighter" : "pen",
      color: isHl ? this.settings.highlighterColor : this.settings.penColor,
      size: isHl ? this.settings.highlighterSize : this.settings.penSize,
      thinning: this.settings.penThinning,
      simulatePressure: e.pointerType !== "pen",
      ...(tool === "line" ? { straight: true } : {}),
      points: [p],
      createdAt: Date.now(),
    };
    this.lastMove = { x: p[0], y: p[1], t: performance.now() };
    this.armHold();
    this.cursorEl.style.display = "none";
    this.requestLive();
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.onTouchMove(e);
      return;
    }
    if (this.activePointer === null) {
      // S펜 호버: 굵기 미리보기 원
      if ((e.pointerType === "pen" || e.pointerType === "mouse") && this.settings.tool !== "none") {
        const t = this.resolveTool(e);
        const size =
          t === "eraser"
            ? this.settings.eraserSize
            : t === "highlighter"
              ? this.settings.highlighterSize
              : this.settings.penSize;
        this.showCursor(e, size);
      }
      return;
    }
    if (e.pointerId !== this.activePointer) return;
    e.preventDefault();

    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];

    if (this.activeTool === "eraser") {
      for (const ev of list) {
        const p = this.toUnits(ev);
        this.eraseAt(p[0], p[1]);
      }
      this.showCursor(e, this.settings.eraserSize);
      return;
    }
    const s = this.current;
    if (!s) return;

    if (this.snapped) {
      const end = this.toUnits(e);
      s.points = this.straightPoints(firstPt(s.points), end);
      this.predicted = [];
    } else {
      for (const ev of list) {
        const p = this.toUnits(ev);
        const prev = lastPt(s.points);
        if (Math.abs(prev[0] - p[0]) < 0.05 && Math.abs(prev[1] - p[1]) < 0.05) continue;
        s.points.push(p);
      }
      const pred = typeof e.getPredictedEvents === "function" ? e.getPredictedEvents() : [];
      this.predicted = pred.slice(0, 2).map((ev) => this.toUnits(ev));
      const last = lastPt(s.points);
      if (Math.hypot(last[0] - this.lastMove.x, last[1] - this.lastMove.y) > HOLD_TOLERANCE) {
        this.lastMove = { x: last[0], y: last[1], t: performance.now() };
        this.armHold();
      }
    }
    this.requestLive();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.onTouchUp(e);
      return;
    }
    if (e.pointerId !== this.activePointer) return;
    clearTimeout(this.holdTimer);
    try {
      this.root.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    this.activePointer = null;
    this.rect = null;

    if (this.activeTool === "eraser") {
      if (this.erasedNow.length) {
        this.pushHistory({ type: "remove", strokes: this.erasedNow });
        this.emitChange();
      }
      this.erasedNow = [];
      if (e.pointerType !== "pen") this.cursorEl.style.display = "none";
      return;
    }

    const s = this.current;
    this.current = null;
    this.predicted = [];
    this.snapped = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.clearLive();
    if (!s) return;
    // 너무 짧은 직선(실수 탭)은 버림
    if (s.straight && s.points.length >= 2) {
      const a = firstPt(s.points);
      const b = lastPt(s.points);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 3) return;
    }
    this.strokes.push(s);
    this.drawOnBase(s);
    this.pushHistory({ type: "add", strokes: [s] });
    this.emitChange();
  };

  private onLeave = (e: PointerEvent) => {
    if (this.activePointer === null && e.pointerType !== "touch")
      this.cursorEl.style.display = "none";
  };

  private showCursor(e: PointerEvent, sizeUnits: number) {
    const r = this.root.getBoundingClientRect();
    const d = Math.max(4, sizeUnits * this.scale);
    Object.assign(this.cursorEl.style, {
      display: "block",
      width: `${d}px`,
      height: `${d}px`,
      left: `${e.clientX - r.left}px`,
      top: `${e.clientY - r.top}px`,
    });
  }

  /** 멈춰서 잠시 누르고 있으면 직선으로 보정 */
  private armHold() {
    clearTimeout(this.holdTimer);
    if (!this.settings.holdToStraighten || this.snapped) return;
    this.holdTimer = window.setTimeout(() => {
      const s = this.current;
      if (!s || this.snapped) return;
      const a = firstPt(s.points);
      const b = lastPt(s.points);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_LINE_LENGTH) return;
      this.snapped = true;
      s.straight = true;
      s.points = this.straightPoints(a, b);
      this.predicted = [];
      if (navigator.vibrate) navigator.vibrate(15);
      this.requestLive();
    }, HOLD_MS);
  }

  private straightPoints(a: InkPoint, b: InkPoint): InkPoint[] {
    // 수평/수직에 가까우면(±4°) 정확히 수평/수직으로
    let bx = b[0];
    let by = b[1];
    const ang = Math.abs((Math.atan2(by - a[1], bx - a[0]) * 180) / Math.PI);
    if (ang < 4 || ang > 176) by = a[1];
    else if (Math.abs(ang - 90) < 4) bx = a[0];
    const n = 12;
    const pts: InkPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([round2(a[0] + (bx - a[0]) * t), round2(a[1] + (by - a[1]) * t), 0.5]);
    }
    return pts;
  }

  private eraseAt(x: number, y: number) {
    const r = this.settings.eraserSize / 2;
    const hit: InkStroke[] = [];
    for (const s of this.strokes) {
      const reach = r + s.size / 2;
      const pts = s.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i] ?? ZERO;
        const b = pts[Math.min(i + 1, pts.length - 1)] ?? a;
        if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= reach) {
          hit.push(s);
          break;
        }
      }
    }
    if (!hit.length) return;
    this.removeStrokes(hit);
    this.erasedNow.push(...hit);
    this.redrawBase();
  }

  private removeStrokes(list: InkStroke[]) {
    const ids = new Set(list.map((s) => s.id));
    this.strokes = this.strokes.filter((s) => !ids.has(s.id));
  }

  private pushHistory(e: HistoryEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  private commitChange() {
    this.redrawBase();
    this.emitHistory();
    this.emitChange();
  }

  private emitChange() {
    this.opts.onChange?.(this.getData());
  }
  private emitHistory() {
    this.opts.onHistoryChange?.(this.canUndo(), this.canRedo());
  }

  // ───────────── 손가락: 스크롤(관성) + 두 손가락 확대 ─────────────
  private onTouchDown(e: PointerEvent) {
    cancelAnimationFrame(this.inertiaId);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (this.touches.size === 2) this.pinchDist = this.touchDistance();
    this.velocity = { x: 0, y: 0, t: performance.now() };
  }

  private onTouchMove(e: PointerEvent) {
    const prev = this.touches.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    this.touches.set(e.pointerId, cur);
    if (this.touches.size >= 2) {
      const d = this.touchDistance();
      if (this.pinchDist > 0 && d > 0) {
        const [t0, t1] = [...this.touches.values()];
        if (t0 && t1) this.opts.onPinch?.(d / this.pinchDist, (t0.x + t1.x) / 2, (t0.y + t1.y) / 2);
      }
      this.pinchDist = d;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    this.pan(dx, dy);
    const now = performance.now();
    const dt = Math.max(1, now - this.velocity.t);
    this.velocity = {
      x: 0.8 * (dx / dt) + 0.2 * this.velocity.x,
      y: 0.8 * (dy / dt) + 0.2 * this.velocity.y,
      t: now,
    };
  }

  private onTouchUp(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
    if (this.touches.size === 0 && performance.now() - this.velocity.t < 80) this.startInertia();
  }

  private touchDistance() {
    const [t0, t1] = [...this.touches.values()];
    return t0 && t1 ? Math.hypot(t0.x - t1.x, t0.y - t1.y) : 0;
  }

  private pan(dx: number, dy: number) {
    if (this.opts.onPan) this.opts.onPan(dx, dy);
    else findScrollParent(this.root)?.scrollBy(-dx, -dy);
  }

  private startInertia() {
    let vx = this.velocity.x * 16;
    let vy = this.velocity.y * 16;
    const step = () => {
      vx *= 0.94;
      vy *= 0.94;
      if (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4) return;
      this.pan(vx, vy);
      this.inertiaId = requestAnimationFrame(step);
    };
    this.inertiaId = requestAnimationFrame(step);
  }
}
