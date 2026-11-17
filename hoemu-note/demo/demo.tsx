/** S펜 필기 체험 페이지 (실제 앱과 동일한 엔진·도구막대 사용) */
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InkLayer, type InkLayerHandle } from "../src/ink/InkLayer";
import { PenToolbar } from "../src/ink/PenToolbar";
import { loadSettings, saveSettings } from "../src/ink/penSettings";
import type { InkSettings, PageInkData } from "../src/ink/inkEngine";

const PAGE_RATIO = 297 / 210; // A4

const SAMPLE = [
  "샘플 문서 — 필기 연습용",
  "",
  "제1조(목적) 이 규정은 회의 운영과 자료 관리에 필요한 사항을 정함을 목적으로 한다.",
  "제2조(구성) ① 회의는 위원장과 위원으로 구성한다.",
  "② 위원의 임기는 2년으로 하며 연임할 수 있다.",
  "제3조(소집) 정기회의는 분기마다 1회 소집하고, 임시회의는 필요할 때 소집한다.",
  "제4조(의결) 회의는 재적 과반수의 출석과 출석 과반수의 찬성으로 의결한다.",
  "",
  "【예산 요약】  수입 120,000천원 / 지출 118,500천원 / 예비비 1,500천원",
  "",
  "◆ 연습: 형광펜으로 제2조를 칠해 보세요.",
  "◆ 연습: 펜으로 제4조 아래에 밑줄을 긋고 잠시 멈추면 직선이 됩니다.",
  "◆ 연습: S펜 버튼을 누른 채 문지르면 지우개가 됩니다.",
  "◆ 연습: 손가락 한 개로 스크롤, 두 개로 확대해 보세요.",
];

function App() {
  const [settings, setSettings] = useState<InkSettings>(() => loadSettings());
  const [hist, setHist] = useState({ u: false, r: false });
  const [zoom, setZoom] = useState(1);
  const [log, setLog] = useState("");
  const [data, setData] = useState<PageInkData | null>(() => {
    try { const raw = localStorage.getItem("hoemu.demo.ink"); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const ink = useRef<InkLayerHandle>(null);

  const patch = useCallback((p: Partial<InkSettings>) => {
    setSettings((s) => { const n = { ...s, ...p }; saveSettings(n); return n; });
  }, []);

  const onChange = useCallback((d: PageInkData) => {
    setData(d);
    try { localStorage.setItem("hoemu.demo.ink", JSON.stringify(d)); } catch { /* noop */ }
    setLog(`저장됨 · 획 ${d.strokes.length}개 · ${(JSON.stringify(d).length / 1024).toFixed(1)}KB`);
  }, []);

  const baseW = useMemo(() => Math.min(900, window.innerWidth - 24), []);
  const w = Math.round(baseW * zoom);

  const exportPng = () => {
    const c = document.createElement("canvas");
    c.width = 1240; c.height = Math.round(1240 * PAGE_RATIO);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#111"; ctx.font = `${c.width / 45}px sans-serif`;
    SAMPLE.forEach((line, i) => ctx.fillText(line, c.width * 0.08, c.width * (0.1 + i * 0.045)));
    ink.current?.renderTo(ctx, c.width);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "필기-미리보기.png"; a.click();
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 bg-[#1e3a8a] text-white">
        <b className="whitespace-nowrap truncate">S펜 필기 체험</b>
        <div className="flex gap-1.5 text-sm whitespace-nowrap shrink-0">
          <button className="px-2 py-1 rounded bg-white/15" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>－</button>
          <span className="px-1 py-1">{Math.round(zoom * 100)}%</span>
          <button className="px-2 py-1 rounded bg-white/15" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>＋</button>
          <button className="px-2 py-1 rounded bg-white/15" onClick={exportPng}>저장</button>
        </div>
      </header>
      <PenToolbar settings={settings} onChange={patch} canUndo={hist.u} canRedo={hist.r}
        onUndo={() => ink.current?.undo()} onRedo={() => ink.current?.redo()} onClearPage={() => ink.current?.clear()} />
      <main id="scroller" className="flex-1 overflow-auto bg-slate-200 p-3">
        <div id="page" className="relative mx-auto bg-white shadow-lg" style={{ width: w, height: Math.round(w * PAGE_RATIO) }}>
          <div className="absolute inset-0 p-[8%] text-slate-900 leading-relaxed" style={{ fontSize: w / 45 }}>
            {SAMPLE.map((l, i) => <div key={i} style={{ minHeight: "1.6em", fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}
          </div>
          <InkLayer ref={ink} data={data} settings={settings} onChange={onChange}
            onHistoryChange={(u, r) => setHist({ u, r })}
            onPinch={(ratio) => setZoom((z) => Math.min(3, Math.max(0.5, z * ratio)))} />
        </div>
      </main>
      <footer className="text-xs text-slate-600 px-3 py-1 bg-white border-t">{log || "필기는 이 기기 브라우저에만 저장됩니다(체험용)."}</footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
