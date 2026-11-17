/**
 * 필기 도구 막대 (Tailwind 만 사용, 외부 UI 라이브러리 불필요)
 * - 도구: 보기 / 펜 / 형광펜 / 직선 / 지우개
 * - 색상 견본 + 사용자 지정 색, 굵기 3단계 + 슬라이더 + 미리보기
 * - 즐겨찾기 펜(프리셋) 한 번 탭으로 전환, [+] 로 현재 펜 저장, 길게 눌러 삭제
 * - 상세 설정: 필압 민감도, 손떨림 보정, 펜 전용, S펜 버튼 지우개, 직선 자동 보정
 */
import { useEffect, useRef, useState } from "react";
import type { InkSettings, InkTool } from "./inkEngine";
import {
  ERASER_SIZE, HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZE, HL_SIZE_STEPS, PEN_COLORS, PEN_SIZE, PEN_SIZE_STEPS,
  loadPresets, presetToSettings, savePresets, settingsToPreset, type PenPreset,
} from "./penSettings";

interface Props {
  settings: InkSettings;
  onChange: (patch: Partial<InkSettings>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearPage?: () => void;
}

const TOOLS: { id: InkTool; label: string; icon: string }[] = [
  { id: "none", label: "보기", icon: "✋" },
  { id: "pen", label: "펜", icon: "✒️" },
  { id: "highlighter", label: "형광펜", icon: "🖍" },
  { id: "line", label: "직선", icon: "📏" },
  { id: "eraser", label: "지우개", icon: "🧽" },
];

export function PenToolbar({ settings, onChange, canUndo, canRedo, onUndo, onRedo, onClearPage }: Props) {
  const [presets, setPresets] = useState<PenPreset[]>(() => loadPresets());
  const [showMore, setShowMore] = useState(false);
  const pressTimer = useRef<number>(0);

  useEffect(() => savePresets(presets), [presets]);

  const t = settings.tool;
  const isHl = t === "highlighter";
  const isPenLike = t === "pen" || t === "line";
  const colors = isHl ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const color = isHl ? settings.highlighterColor : settings.penColor;
  const range = isHl ? HIGHLIGHTER_SIZE : t === "eraser" ? ERASER_SIZE : PEN_SIZE;
  const size = isHl ? settings.highlighterSize : t === "eraser" ? settings.eraserSize : settings.penSize;
  const steps = isHl ? HL_SIZE_STEPS : PEN_SIZE_STEPS;

  const setColor = (c: string) => onChange(isHl ? { highlighterColor: c } : { penColor: c });
  const setSize = (v: number) =>
    onChange(isHl ? { highlighterSize: v } : t === "eraser" ? { eraserSize: v } : { penSize: v });

  const addPreset = () => {
    const p = settingsToPreset(settings, `${isHl ? "형광" : t === "line" ? "직선" : "펜"} ${presets.length + 1}`);
    if (p && presets.length < 8) setPresets([...presets, p]);
  };
  const startLongPress = (id: string) => {
    pressTimer.current = window.setTimeout(() => {
      if (confirm("이 즐겨찾기 펜을 삭제할까요?")) setPresets((l) => l.filter((x) => x.id !== id));
    }, 700);
  };
  const cancelLongPress = () => clearTimeout(pressTimer.current);

  const btn = "min-w-[44px] h-11 px-2 rounded-xl flex items-center justify-center gap-1 text-sm select-none transition";
  const on = "bg-[#1e3a8a] text-white shadow";
  const off = "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200";

  return (
    <div className="w-full bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm select-none">
      {/* 1줄: 도구 + 실행취소 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto">
        {TOOLS.map((x) => (
          <button key={x.id} type="button" aria-label={x.label} onClick={() => onChange({ tool: x.id })}
            className={`${btn} ${t === x.id ? on : off}`}>
            <span className="text-lg leading-none">{x.icon}</span>
            <span className="hidden sm:inline">{x.label}</span>
          </button>
        ))}
        <div className="w-px h-8 bg-slate-200 mx-1 shrink-0" />
        <button type="button" aria-label="실행취소" disabled={!canUndo} onClick={onUndo} className={`${btn} ${off} disabled:opacity-30`}>↶</button>
        <button type="button" aria-label="다시실행" disabled={!canRedo} onClick={onRedo} className={`${btn} ${off} disabled:opacity-30`}>↷</button>
        <button type="button" aria-label="상세 설정" onClick={() => setShowMore((v) => !v)} className={`${btn} ${showMore ? on : off}`}>⚙︎</button>
      </div>

      {/* 2줄: 즐겨찾기 펜 */}
      <div className="flex items-center gap-1.5 px-2 pb-1.5 overflow-x-auto">
        {presets.map((p) => {
          const active = (p.tool === t) && (p.tool === "highlighter" ? settings.highlighterColor === p.color && settings.highlighterSize === p.size : settings.penColor === p.color && settings.penSize === p.size);
          return (
            <button key={p.id} type="button" onClick={() => onChange(presetToSettings(p))}
              onPointerDown={() => startLongPress(p.id)} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress}
              className={`h-9 px-3 rounded-full text-xs flex items-center gap-1.5 border shrink-0 ${active ? "border-[#1e3a8a] ring-2 ring-[#1e3a8a]/30" : "border-slate-200"}`}>
              <span className="inline-block rounded-full" style={{ background: p.color, width: 14, height: p.tool === "highlighter" ? 10 : 14, borderRadius: p.tool === "highlighter" ? 3 : 999 }} />
              {p.label}
            </button>
          );
        })}
        <button type="button" onClick={addPreset} disabled={t === "none" || t === "eraser"}
          className="h-9 w-9 rounded-full border border-dashed border-slate-300 text-slate-500 shrink-0 disabled:opacity-30" aria-label="현재 펜을 즐겨찾기에 추가">＋</button>
      </div>

      {/* 3줄: 색상 + 굵기 (도구별) */}
      {t !== "none" && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          {(isPenLike || isHl) && (
            <div className="flex items-center gap-1.5">
              {colors.map((c) => (
                <button key={c.value} type="button" aria-label={c.name} onClick={() => setColor(c.value)}
                  className={`w-9 h-9 rounded-full border-2 ${color === c.value ? "border-[#1e3a8a] scale-110" : "border-white ring-1 ring-slate-200"}`}
                  style={{ background: c.value }} />
              ))}
              <label className="w-9 h-9 rounded-full border border-slate-300 overflow-hidden relative cursor-pointer" aria-label="사용자 지정 색"
                style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
          )}
          <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
            {t !== "eraser" && steps.map((s) => (
              <button key={s.name} type="button" onClick={() => setSize(s.value)}
                className={`h-9 px-2 rounded-lg text-xs border whitespace-nowrap shrink-0 ${size === s.value ? "border-[#1e3a8a] bg-blue-50" : "border-slate-200"}`}>{s.name}</button>
            ))}
            <input type="range" min={range.min} max={range.max} step={range.step} value={size}
              onChange={(e) => setSize(Number(e.target.value))} className="flex-1 min-w-[60px] h-9 accent-[#1e3a8a]" aria-label="굵기" />
            {/* 미리보기: 실제 선 모양 */}
            <div className="w-11 sm:w-14 shrink-0 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
              <div style={{
                width: 32, height: Math.max(2, Math.min(28, size * 0.9)),
                background: t === "eraser" ? "transparent" : color,
                border: t === "eraser" ? "2px dashed #94a3b8" : undefined,
                borderRadius: 999, mixBlendMode: isHl ? "multiply" : undefined,
              }} />
            </div>
            <span className="hidden sm:inline text-xs text-slate-500 w-7 shrink-0 text-right">{size}</span>
          </div>
          {t === "eraser" && onClearPage && (
            <button type="button" onClick={() => confirm("이 페이지의 필기를 모두 지울까요? (실행취소 가능)") && onClearPage()}
              className="h-9 px-3 rounded-lg text-xs border border-red-200 text-red-600">페이지 전체 지우기</button>
          )}
        </div>
      )}

      {/* 상세 설정 */}
      {showMore && (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 px-3 pb-3 text-sm text-slate-700 border-t border-slate-100 pt-2">
          <label className="flex items-center gap-2">필압 민감도
            <input type="range" min={0} max={0.9} step={0.05} value={settings.penThinning}
              onChange={(e) => onChange({ penThinning: Number(e.target.value) })} className="flex-1 accent-[#1e3a8a]" />
          </label>
          <label className="flex items-center gap-2">손떨림 보정
            <input type="range" min={0} max={0.9} step={0.05} value={settings.streamline}
              onChange={(e) => onChange({ streamline: Number(e.target.value) })} className="flex-1 accent-[#1e3a8a]" />
          </label>
          <Toggle label="S펜으로만 필기 (손가락은 스크롤·확대)" checked={settings.penOnly} onChange={(v) => onChange({ penOnly: v })} />
          <Toggle label="S펜 버튼 누르고 그리면 지우개" checked={settings.sideButtonEraser} onChange={(v) => onChange({ sideButtonEraser: v })} />
          <Toggle label="그은 뒤 잠시 멈추면 직선 보정" checked={settings.holdToStraighten} onChange={(v) => onChange({ holdToStraighten: v })} />
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 min-h-[40px]">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full relative transition ${checked ? "bg-[#1e3a8a]" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}
