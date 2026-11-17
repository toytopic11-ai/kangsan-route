/** 펜 색상·굵기·즐겨찾기 프리셋 (기기별로 브라우저에 저장) */
import { DEFAULT_SETTINGS, type InkSettings, type InkTool } from "./inkEngine";

export const PEN_COLORS = [
  { name: "검정", value: "#111827" },
  { name: "파랑", value: "#1d4ed8" },
  { name: "빨강", value: "#dc2626" },
  { name: "초록", value: "#15803d" },
  { name: "보라", value: "#7c3aed" },
  { name: "주황", value: "#ea580c" },
];

/** 형광펜: 곱하기 합성용 밝은 색 → 글자가 그대로 비침 */
export const HIGHLIGHTER_COLORS = [
  { name: "노랑", value: "#fde047" },
  { name: "초록", value: "#86efac" },
  { name: "분홍", value: "#f9a8d4" },
  { name: "하늘", value: "#7dd3fc" },
  { name: "주황", value: "#fdba74" },
];

export const PEN_SIZE = { min: 1, max: 16, step: 0.5 };
export const HIGHLIGHTER_SIZE = { min: 8, max: 40, step: 1 };
export const ERASER_SIZE = { min: 6, max: 60, step: 1 };

/** 굵기 빠른 선택(단위: 페이지 가로폭 1000 기준) */
export const PEN_SIZE_STEPS = [
  { name: "가늘게", value: 1.8 },
  { name: "보통", value: 3 },
  { name: "굵게", value: 5 },
];
export const HL_SIZE_STEPS = [
  { name: "가늘게", value: 12 },
  { name: "보통", value: 18 },
  { name: "굵게", value: 26 },
];

export interface PenPreset {
  id: string;
  label: string;
  tool: Extract<InkTool, "pen" | "highlighter" | "line">;
  color: string;
  size: number;
}

export const DEFAULT_PRESETS: PenPreset[] = [
  { id: "p1", label: "검정 펜", tool: "pen", color: "#111827", size: 3 },
  { id: "p2", label: "빨강 펜", tool: "pen", color: "#dc2626", size: 3 },
  { id: "p3", label: "노랑 형광", tool: "highlighter", color: "#fde047", size: 18 },
  { id: "p4", label: "파랑 밑줄", tool: "line", color: "#1d4ed8", size: 2.5 },
];

const KEY_SETTINGS = "hoemu.ink.settings.v1";
const KEY_PRESETS = "hoemu.ink.presets.v1";

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings(): InkSettings {
  return safeGet(KEY_SETTINGS, DEFAULT_SETTINGS);
}

export function saveSettings(s: InkSettings) {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

export function loadPresets(): PenPreset[] {
  try {
    const raw = localStorage.getItem(KEY_PRESETS);
    const list = raw ? (JSON.parse(raw) as PenPreset[]) : null;
    return Array.isArray(list) && list.length ? list : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function savePresets(list: PenPreset[]) {
  try {
    localStorage.setItem(KEY_PRESETS, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

/** 프리셋 → 엔진 설정 패치 */
export function presetToSettings(p: PenPreset): Partial<InkSettings> {
  return p.tool === "highlighter"
    ? { tool: "highlighter", highlighterColor: p.color, highlighterSize: p.size }
    : { tool: p.tool, penColor: p.color, penSize: p.size };
}

/** 현재 설정 → 프리셋 */
export function settingsToPreset(s: InkSettings, label: string): PenPreset | null {
  if (s.tool === "highlighter")
    return {
      id: crypto.randomUUID(),
      label,
      tool: "highlighter",
      color: s.highlighterColor,
      size: s.highlighterSize,
    };
  if (s.tool === "pen" || s.tool === "line")
    return { id: crypto.randomUUID(), label, tool: s.tool, color: s.penColor, size: s.penSize };
  return null;
}
