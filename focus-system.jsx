import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_FOCUS = [
  { label: "20m", mins: 20 },
  { label: "25m", mins: 25 },
  { label: "30m", mins: 30 },
  { label: "45m", mins: 45 },
];
const DEFAULT_BREAKS = [
  { label: "5m", mins: 5 },
  { label: "10m", mins: 10 },
  { label: "15m", mins: 15 },
];
const CIRC = 2 * Math.PI * 120;

function createAlarm(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  const oscs = [];

  function playBurst(time) {
    const freqs = [880, 1108.73, 1318.51];
    freqs.forEach(f => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, time);
      g.gain.linearRampToValueAtTime(0.3, time + 0.05);
      g.gain.setValueAtTime(0.3, time + 0.15);
      g.gain.linearRampToValueAtTime(0, time + 0.2);
      o.connect(g);
      g.connect(master);
      o.start(time);
      o.stop(time + 0.25);
      oscs.push(o);
    });
  }

  let t = ctx.currentTime;
  for (let cycle = 0; cycle < 200; cycle++) {
    playBurst(t);
    playBurst(t + 0.3);
    playBurst(t + 0.6);
    t += 1.2;
  }

  return { master, oscs, ctx };
}

const TECHNIQUES = [
  { name: "Brain dump", fit: "high", icon: "✦", desc: "Write out every thought before starting. Frees working memory and reduces mind-wandering by ~40%.", you: "Your #1 distractor is mental noise — this directly targets it." },
  { name: "Modified Pomodoro", fit: "high", icon: "◎", desc: "25–30 min focused sprint + short break. Trains sustained attention through structured intervals.", you: "Your 20–45 min window maps perfectly to 30-min sessions." },
  { name: "Implementation intentions", fit: "high", icon: "◈", desc: '"When I sit down after dinner, I will code for 30 min." Pre-set triggers boost follow-through 2–3×.', you: "No fixed schedule = you need pre-set triggers to start." },
  { name: "Single-tasking", fit: "high", icon: "◇", desc: "One named task per session, everything else closed. Task-switching costs up to 40% performance.", you: "Name a specific action, not a category — before every session." },
  { name: "Flow state priming", fit: "med", icon: "◉", desc: "Clear goal + immediate feedback + matching challenge. Lo-fi masks noise and signals work mode.", you: "You already use lo-fi — layer it with a specific goal each time." },
  { name: "Ultradian rest", fit: "med", icon: "◌", desc: "After 90 min (3 sessions), take a 15–20 min screen-free break. Walk, stretch, eat.", you: "After 3 sessions, take a real break — gym, walk, or tea." },
];

const CHECKLIST = [
  "Phone face-down or in another room",
  "Do Not Disturb on",
  "Lo-fi / ambient music playing",
  "Only the tab I need is open",
];

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function dayKey() { return new Date().toISOString().slice(0, 10); }
function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function isValidPreset(p) {
  return p && typeof p.label === "string" && Number.isInteger(p.mins) && p.mins > 0;
}

export default function FocusSystem() {
  const [view, setView] = useState("timer");
  const [focusPresets, setFocusPresets] = useState(DEFAULT_FOCUS);
  const [breakPresets, setBreakPresets] = useState(DEFAULT_BREAKS);
  const [selFocus, setSelFocus] = useState(2);
  const [selBreak, setSelBreak] = useState(0);
  const [remaining, setRemaining] = useState(DEFAULT_FOCUS[2].mins * 60);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [task, setTask] = useState("");
  const [dump, setDump] = useState("");
  const [intention, setIntention] = useState("");
  const [checks, setChecks] = useState([false, false, false, false]);
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState({ total: 0, mins: 0, bestDay: 0, streak: 0 });
  const [loaded, setLoaded] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [completionMessage, setCompletionMessage] = useState("Focus session complete");
  const [addingFocus, setAddingFocus] = useState(false);
  const [addingBreak, setAddingBreak] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const [editing, setEditing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1024 : window.innerWidth
  );
  const intervalRef = useRef(null);
  const customInputRef = useRef(null);
  const alarmRef = useRef(null);

  const currentFocus = focusPresets[selFocus] || focusPresets[0];
  const currentBreak = breakPresets[selBreak] || breakPresets[0];
  const totalSecs = phase === "break" ? currentBreak.mins * 60 : currentFocus.mins * 60;

  // FIXED: Replaced window.storage with standard localStorage
  useEffect(() => {
    try {
      const sRes = localStorage.getItem("focus-sessions");
      if (sRes) {
        const parsedSessions = safeParse(sRes, []);
        if (Array.isArray(parsedSessions)) setSessions(parsedSessions.filter(s => s && s.date && Number.isInteger(s.dur)));
      }

      const stRes = localStorage.getItem("focus-stats");
      if (stRes) {
        const parsedStats = safeParse(stRes, null);
        if (parsedStats && typeof parsedStats === "object") {
          setStats({
            total: Number.isFinite(parsedStats.total) ? parsedStats.total : 0,
            mins: Number.isFinite(parsedStats.mins) ? parsedStats.mins : 0,
            bestDay: Number.isFinite(parsedStats.bestDay) ? parsedStats.bestDay : 0,
            streak: Number.isFinite(parsedStats.streak) ? parsedStats.streak : 0,
          });
        }
      }

      const fpRes = localStorage.getItem("focus-presets");
      if (fpRes) {
        const d = safeParse(fpRes, {});
        const parsedFocus = Array.isArray(d.focus) ? d.focus.filter(isValidPreset) : [];
        const parsedBreaks = Array.isArray(d.breaks) ? d.breaks.filter(isValidPreset) : [];
        if (parsedFocus.length) setFocusPresets(parsedFocus);
        if (parsedBreaks.length) setBreakPresets(parsedBreaks);
        if (Number.isInteger(d.selFocus)) setSelFocus(d.selFocus);
        if (Number.isInteger(d.selBreak)) setSelBreak(d.selBreak);
        const sf = Number.isInteger(d.selFocus) ? d.selFocus : 2;
        const fp = parsedFocus.length ? parsedFocus : DEFAULT_FOCUS;
        if (fp[sf]) setRemaining(fp[sf].mins * 60);
      }
    } catch (e) {
        console.error("Failed to load state", e);
    }
    setLoaded(true);
  }, []);

  const savePresets = useCallback((fp, bp, sf, sb) => {
    try { 
        localStorage.setItem("focus-presets", JSON.stringify({ focus: fp, breaks: bp, selFocus: sf, selBreak: sb })); 
    } catch {}
  }, []);

  const save = useCallback((newSessions, newStats) => {
    try { 
        localStorage.setItem("focus-sessions", JSON.stringify(newSessions));
        localStorage.setItem("focus-stats", JSON.stringify(newStats));
    } catch {}
  }, []);

  const startAlarm = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      alarmRef.current = createAlarm(ctx);
    } catch {}
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmRef.current) {
      try {
        alarmRef.current.master.gain.setValueAtTime(0, alarmRef.current.ctx.currentTime);
        alarmRef.current.oscs.forEach(o => { try { o.stop(); } catch {} });
        alarmRef.current.ctx.close();
      } catch {}
      alarmRef.current = null;
    }
    setShowComplete(false);
  }, []);

  const completeSession = useCallback(() => {
    if (phase === "break") {
      setCompletionMessage("Break over");
      setPhase("idle");
      setRemaining(currentFocus.mins * 60);
      setShowComplete(true);
      startAlarm();
      return;
    }
    const dur = currentFocus.mins;
    const now = new Date();
    const entry = {
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      task: task || "Unnamed task", dur, date: dayKey(), id: Date.now(),
    };
    const newSessions = [entry, ...sessions].slice(0, 50);
    const today = dayKey();
    const uniqueDays = [...new Set(newSessions.map(s => s.date))].sort((a, b) => b.localeCompare(a));
    let streak = 0;
    const cursor = new Date(`${today}T00:00:00`);
    for (const d of uniqueDays) {
      const expected = cursor.toISOString().slice(0, 10);
      if (d !== expected) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const todayCount = newSessions.filter(s => s.date === today).length;
    const newStats = {
      total: stats.total + 1, mins: stats.mins + dur,
      bestDay: Math.max(stats.bestDay, todayCount), streak,
    };
    setSessions(newSessions);
    setStats(newStats);
    save(newSessions, newStats);
    setCompletionMessage("Focus session complete");
    setShowComplete(true);
    startAlarm();
    setPhase("idle");
    setRemaining(currentFocus.mins * 60);
  }, [phase, currentFocus, task, sessions, stats, save, startAlarm]);

  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) { clearInterval(intervalRef.current); setRunning(false); completeSession(); return 0; }
          return r - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, remaining, completeSession]);

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current);
      if (alarmRef.current) {
        try {
          alarmRef.current.ctx.close();
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleRun = () => { if (phase === "idle") setPhase("focus"); setRunning(r => !r); };
  const resetTimer = () => { clearInterval(intervalRef.current); setRunning(false); setPhase("idle"); setRemaining(currentFocus.mins * 60); };

  const startBreak = (idx) => {
    clearInterval(intervalRef.current); setRunning(false);
    const i = typeof idx === "number" ? idx : selBreak;
    setSelBreak(i);
    setPhase("break");
    setRemaining(breakPresets[i].mins * 60);
  };

  const selectFocus = (i) => {
    if (running) return;
    setSelFocus(i); setRemaining(focusPresets[i].mins * 60); setPhase("idle");
    savePresets(focusPresets, breakPresets, i, selBreak);
  };

  const addCustom = (type) => {
    const v = parseInt(customVal, 10);
    if (!v || v < 1 || v > (type === "focus" ? 180 : 60)) return;
    if (type === "focus") {
      if (focusPresets.some(p => p.mins === v)) { setAddingFocus(false); setCustomVal(""); return; }
      const np = [...focusPresets, { label: `${v}m`, mins: v }].sort((a, b) => a.mins - b.mins);
      const ni = np.findIndex(p => p.mins === v);
      setFocusPresets(np); setSelFocus(ni); setRemaining(v * 60); setPhase("idle");
      setAddingFocus(false); setCustomVal("");
      savePresets(np, breakPresets, ni, selBreak);
    } else {
      if (breakPresets.some(p => p.mins === v)) { setAddingBreak(false); setCustomVal(""); return; }
      const np = [...breakPresets, { label: `${v}m`, mins: v }].sort((a, b) => a.mins - b.mins);
      const ni = np.findIndex(p => p.mins === v);
      setBreakPresets(np); setSelBreak(ni);
      setAddingBreak(false); setCustomVal("");
      savePresets(focusPresets, np, selFocus, ni);
    }
  };

  const removePreset = (type, i) => {
    if (type === "focus") {
      if (focusPresets.length <= 1) return;
      const np = focusPresets.filter((_, idx) => idx !== i);
      const ns = selFocus >= np.length ? np.length - 1 : selFocus > i ? selFocus - 1 : selFocus;
      setFocusPresets(np); setSelFocus(ns);
      if (!running) setRemaining(np[ns].mins * 60);
      savePresets(np, breakPresets, ns, selBreak);
    } else {
      if (breakPresets.length <= 1) return;
      const np = breakPresets.filter((_, idx) => idx !== i);
      const ns = selBreak >= np.length ? np.length - 1 : selBreak > i ? selBreak - 1 : selBreak;
      setBreakPresets(np); setSelBreak(ns);
      savePresets(focusPresets, np, selFocus, ns);
    }
  };

  const resetPresets = () => {
    setFocusPresets(DEFAULT_FOCUS); setBreakPresets(DEFAULT_BREAKS);
    setSelFocus(2); setSelBreak(0);
    if (!running) setRemaining(DEFAULT_FOCUS[2].mins * 60);
    savePresets(DEFAULT_FOCUS, DEFAULT_BREAKS, 2, 0);
  };

  useEffect(() => {
    if ((addingFocus || addingBreak) && customInputRef.current) customInputRef.current.focus();
  }, [addingFocus, addingBreak]);

  const pct = totalSecs > 0 ? 1 - remaining / totalSecs : 0;
  const dashOff = CIRC * (1 - pct);
  const todaySessions = sessions.filter(s => s.date === dayKey());
  const todayMins = todaySessions.reduce((a, s) => a + s.dur, 0);
  const wordCount = dump.trim() ? dump.trim().split(/\s+/).length : 0;
  const ringColor = phase === "break" ? "#E8A838" : phase === "focus" || running ? "#4ECDC4" : "#555";
  const phaseLabel = phase === "break" ? "Break" : running ? "Focusing" : "Ready";
  const isPhone = viewportWidth <= 640;
  const timerSize = viewportWidth <= 380 ? 220 : viewportWidth <= 640 ? 236 : 260;

  const goToTimer = () => { if (intention) setTask(intention); setView("timer"); };

  const clearSessions = () => {
    setSessions([]); setStats({ total: 0, mins: 0, bestDay: 0, streak: 0 });
    try { 
        localStorage.removeItem("focus-sessions");
        localStorage.removeItem("focus-stats");
    } catch {}
  };

  if (!loaded) return <div style={S.loadWrap}><div style={S.loadPulse}>◎</div></div>;

  const renderPresetRow = (type) => {
    const presets = type === "focus" ? focusPresets : breakPresets;
    const sel = type === "focus" ? selFocus : selBreak;
    const isAdding = type === "focus" ? addingFocus : addingBreak;
    const isBreakPhase = phase === "break";

    return (
      <div style={S.pickerSection}>
        <div style={S.pickerLabel}>{type}</div>
        <div style={S.durRow}>
          {presets.map((d, i) => (
            <div key={`${type}-${d.mins}`} style={{ position: "relative" }}>
              <button onClick={() => type === "focus" ? selectFocus(i) : startBreak(i)}
                style={{
                  ...S.durBtn,
                  ...(type === "focus" && sel === i && !isBreakPhase ? S.durActiveTeal : {}),
                  ...(type === "break" && sel === i && isBreakPhase ? S.durActiveAmber : {}),
                }}>
                {d.label}
              </button>
              {editing && presets.length > 1 && (
                <button onClick={() => removePreset(type, i)} style={S.removeBtn} title="Remove">×</button>
              )}
            </div>
          ))}

          {isAdding ? (
            <div style={S.customWrap}>
              <input ref={customInputRef} value={customVal}
                onChange={e => setCustomVal(e.target.value.replace(/\D/g, ""))}
                placeholder="min" style={S.customInput}
                onKeyDown={e => { if (e.key === "Enter") addCustom(type); if (e.key === "Escape") { type === "focus" ? setAddingFocus(false) : setAddingBreak(false); setCustomVal(""); } }}
              />
              <button onClick={() => addCustom(type)} style={S.confirmBtn}>✓</button>
              <button onClick={() => { type === "focus" ? setAddingFocus(false) : setAddingBreak(false); setCustomVal(""); }} style={S.cancelBtn}>×</button>
            </div>
          ) : (
            <button onClick={() => { type === "focus" ? setAddingFocus(true) : setAddingBreak(true); type === "focus" ? setAddingBreak(false) : setAddingFocus(false); setCustomVal(""); }}
              style={S.addBtn} title={`Add custom ${type} time`}>+</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ ...S.header, ...(isPhone ? S.headerMobile : {}) }}>
        <div style={S.logo}><span style={S.logoIcon}>◎</span><span style={S.logoText}>Focus</span></div>
        <div style={S.headerStats}>
          <span style={S.hStat}>{todaySessions.length} sessions</span>
          <span style={S.hDot}>·</span>
          <span style={S.hStat}>{todayMins} min today</span>
        </div>
      </div>

      <div style={{ ...S.nav, ...(isPhone ? S.navMobile : {}) }}>
        {["timer", "prep", "techniques", "history"].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ ...S.navBtn, ...(view === v ? S.navActive : {}) }}>
            {v === "timer" ? "Timer" : v === "prep" ? "Pre-session" : v === "techniques" ? "Techniques" : "History"}
          </button>
        ))}
      </div>

      {showComplete && (
          <div style={S.alarmOverlay}>
            <div style={{ ...S.alarmBox, ...(isPhone ? S.alarmBoxMobile : {}) }}>
            <div style={S.alarmPulse}>⏰</div>
            <div style={S.alarmTitle}>Time's up!</div>
            <div style={S.alarmSub}>{completionMessage}</div>
            <button onClick={stopAlarm} style={S.stopBtn} aria-label="Stop alarm">
              ■&nbsp;&nbsp;Stop alarm
            </button>
          </div>
        </div>
      )}

      {/* ═══ TIMER ═══ */}
      {view === "timer" && (
        <div style={S.timerView}>
          <div style={{ ...S.statsRow, ...(isPhone ? S.statsRowMobile : {}) }}>
            {[
              { label: "Total sessions", val: stats.total },
              { label: "Focus hours", val: (stats.mins / 60).toFixed(1) },
              { label: "Best day", val: `${stats.bestDay} sess.` },
            ].map((s, i) => (
              <div key={i} style={S.statCard}><div style={S.statLabel}>{s.label}</div><div style={S.statVal}>{s.val}</div></div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ ...S.phaseBadge, background: phase === "break" ? "rgba(232,168,56,.15)" : running ? "rgba(78,205,196,.12)" : "rgba(255,255,255,.06)", color: phase === "break" ? "#E8A838" : running ? "#4ECDC4" : "#888" }}>
              {phaseLabel}
            </span>
          </div>

          <div style={S.timerCenter}>
            <svg width={timerSize} height={timerSize} viewBox="0 0 260 260" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="130" cy="130" r="120" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="5" />
              <circle cx="130" cy="130" r="120" fill="none" stroke={ringColor}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={dashOff}
                style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.4s" }} />
            </svg>
            <div style={S.timerOverlay}>
              <div style={{ ...S.timerNum, ...(isPhone ? S.timerNumMobile : {}) }}>{fmt(remaining)}</div>
              <div style={S.timerSub}>{phase === "break" ? "break" : "focus"}</div>
            </div>
          </div>

          {renderPresetRow("focus")}
          {renderPresetRow("break")}

          <div style={{ textAlign: "center", margin: "12px 0 18px" }}>
            <button onClick={() => setEditing(!editing)} style={{ ...S.tinyBtn, color: editing ? "#4ECDC4" : "#555", borderColor: editing ? "rgba(78,205,196,.25)" : "rgba(255,255,255,.06)" }}>
              {editing ? "⚙ Done editing" : "⚙ Edit presets"}
            </button>
            {editing && <button onClick={resetPresets} style={{ ...S.tinyBtn, marginLeft: 8 }}>↺ Reset defaults</button>}
          </div>

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <input value={task} onChange={e => setTask(e.target.value)}
              placeholder="What's your one task this session?"
              style={S.taskInput} disabled={running} aria-label="Focus task" />
          </div>

          <div style={{ ...S.btnRow, ...(isPhone ? S.btnRowMobile : {}) }}>
            <button onClick={toggleRun} style={S.primaryBtn}>
              {running ? "⏸  Pause" : "▶  Start session"}
            </button>
            <button onClick={resetTimer} style={S.secBtn}>↺  Reset</button>
          </div>
        </div>
      )}

      {/* ═══ PREP ═══ */}
      {view === "prep" && (
        <div style={S.prepView}>
          <div style={S.section}>
            <div style={S.secHead}><span style={S.secNum}>01</span>
              <div><div style={S.secTitle}>Brain dump</div><div style={S.secSub}>Offload everything swirling in your mind. 2–3 min. Proven to free working memory.</div></div>
            </div>
            <textarea value={dump} onChange={e => setDump(e.target.value)}
              placeholder="Deadlines, worries, random thoughts — dump it all here before you start..." style={S.dumpArea} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={S.wordCount}>{wordCount} word{wordCount !== 1 ? "s" : ""}</span>
              <button onClick={() => setDump("")} style={S.tinyBtn}>Clear</button>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secHead}><span style={S.secNum}>02</span>
              <div><div style={S.secTitle}>Set your intention</div><div style={S.secSub}>Be specific. Not "work on assignment" — "Write the intro of CS5002 report". Specificity = 2× follow-through.</div></div>
            </div>
            <input value={intention} onChange={e => setIntention(e.target.value)}
              placeholder='e.g. "Build the booking form for the beauty parlour app"' style={S.intentInput} />
          </div>

          <div style={S.section}>
            <div style={S.secHead}><span style={S.secNum}>03</span>
              <div><div style={S.secTitle}>Phone protocol</div><div style={S.secSub}>Physical removal reduces urge-to-check by 60%.</div></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {CHECKLIST.map((c, i) => (
                <label key={i} style={S.checkLabel}>
                  <div style={{ ...S.checkbox, ...(checks[i] ? S.checkboxChecked : {}) }}
                    onClick={() => { const n = [...checks]; n[i] = !n[i]; setChecks(n); }}>
                    {checks[i] && "✓"}
                  </div>
                  <span style={{ color: checks[i] ? "#ccc" : "#888", textDecoration: checks[i] ? "line-through" : "none", transition: "all .2s" }}>{c}</span>
                </label>
              ))}
            </div>
          </div>

          <button onClick={goToTimer} style={{ ...S.primaryBtn, width: "100%", marginTop: 8 }}>→  Ready — go to timer</button>
        </div>
      )}

      {/* ═══ TECHNIQUES ═══ */}
      {view === "techniques" && (
        <div style={S.techView}>
          <div style={S.techIntro}>The 6 most research-backed focus techniques, scored for your profile.</div>
          <div style={{ ...S.techGrid, ...(isPhone ? S.techGridMobile : {}) }}>
            {TECHNIQUES.map((t, i) => (
              <div key={i} style={S.techCard}>
                <div style={S.techTop}>
                  <span style={S.techIcon}>{t.icon}</span>
                  <span style={{ ...S.techFit, background: t.fit === "high" ? "rgba(78,205,196,.12)" : "rgba(232,168,56,.12)", color: t.fit === "high" ? "#4ECDC4" : "#E8A838" }}>
                    {t.fit === "high" ? "High fit" : "Medium fit"}
                  </span>
                </div>
                <div style={S.techName}>{t.name}</div>
                <div style={S.techDesc}>{t.desc}</div>
                <div style={S.techYou}>↳ {t.you}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ HISTORY ═══ */}
      {view === "history" && (
        <div style={S.histView}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.secTitle}>Session history</div>
            {sessions.length > 0 && <button onClick={clearSessions} style={S.tinyBtn}>Clear all</button>}
          </div>

          <div style={{ ...S.statsRow, ...(isPhone ? S.statsRowMobile : {}) }}>
            {[
              { label: "All-time sessions", val: stats.total },
              { label: "Total focus mins", val: stats.mins },
              { label: "Current streak", val: stats.streak },
            ].map((s, i) => (
              <div key={i} style={S.statCard}><div style={S.statLabel}>{s.label}</div><div style={S.statVal}>{s.val}</div></div>
            ))}
          </div>

          <div style={{ ...S.secTitle, fontSize: 12, marginBottom: 8, marginTop: 12, color: "#666" }}>Today</div>
          {todaySessions.length === 0 ? (
            <div style={S.emptyState}>No sessions today — start your first one.</div>
          ) : (
            todaySessions.map((s, i) => (
              <div key={s.id || i} style={{ ...S.logRow, ...(isPhone ? S.logRowMobile : {}) }}>
                <span style={S.logTime}>{s.time}</span><span style={S.logTask}>{s.task}</span>
                <span style={S.logDur}>{s.dur}m</span><span style={S.logCheck}>✓</span>
              </div>
            ))
          )}

          {sessions.filter(s => s.date !== dayKey()).length > 0 && (
            <>
              <div style={{ ...S.secTitle, fontSize: 12, marginBottom: 8, marginTop: 20, color: "#666" }}>Previous</div>
              {sessions.filter(s => s.date !== dayKey()).map((s, i) => (
                <div key={s.id || i} style={{ ...S.logRow, ...(isPhone ? S.logRowMobile : {}) }}>
                  <span style={{ ...S.logTime, minWidth: 80 }}>{s.date}</span>
                  <span style={S.logTime}>{s.time}</span><span style={S.logTask}>{s.task}</span>
                  <span style={S.logDur}>{s.dur}m</span><span style={S.logCheck}>✓</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div style={{ ...S.footer, ...(isPhone ? S.footerMobile : {}) }}>
        <span style={{ color: "#555" }}>Your loop:</span>{" "}
        <span style={{ color: "#4ECDC4" }}>Dump</span><span style={{ color: "#444" }}> → </span>
        <span style={{ color: "#4ECDC4" }}>Name task</span><span style={{ color: "#444" }}> → </span>
        <span style={{ color: "#4ECDC4" }}>Phone away</span><span style={{ color: "#444" }}> → </span>
        <span style={{ color: "#E8A838" }}>{currentFocus.mins} min</span><span style={{ color: "#444" }}> → </span>
        <span style={{ color: "#888" }}>{currentBreak.mins} min break</span><span style={{ color: "#444" }}> → </span>
        <span style={{ color: "#555" }}>repeat</span>
      </div>
    </div>
  );
}

const S = {
  root: {
    minHeight: "100vh", background: "linear-gradient(170deg, #0D0D0F 0%, #131318 40%, #0F1014 100%)",
    color: "#e0e0e0", fontFamily: "'Outfit', sans-serif", padding: "0 14px 40px", width: "100%", maxWidth: "100%", margin: 0,
  },
  loadWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" },
  loadPulse: { fontSize: 40, color: "#4ECDC4" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0 20px" },
  headerMobile: { flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "18px 0 14px" },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: { fontSize: 22, color: "#4ECDC4" },
  logoText: { fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" },
  headerStats: { display: "flex", alignItems: "center", gap: 8 },
  hStat: { fontSize: 12, color: "#666", fontFamily: "'JetBrains Mono', monospace" },
  hDot: { color: "#333" },
  nav: { display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid rgba(255,255,255,.06)", paddingBottom: 0 },
  navMobile: { overflowX: "auto", WebkitOverflowScrolling: "touch", gap: 2, marginBottom: 18 },
  navBtn: {
    background: "none", border: "none", padding: "12px 14px", fontSize: 13,
    color: "#555", cursor: "pointer", borderBottom: "2px solid transparent",
    marginBottom: -1, transition: "all .15s", fontFamily: "'Outfit', sans-serif", fontWeight: 400,
    minHeight: 44, whiteSpace: "nowrap",
  },
  navActive: { color: "#e0e0e0", borderBottom: "2px solid #4ECDC4", fontWeight: 500 },
  alarmOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,.85)", backdropFilter: "blur(8px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 200, 
  },
  alarmBox: {
    textAlign: "center", padding: "40px 48px", borderRadius: 20,
    background: "rgba(232,75,74,.08)", border: "1px solid rgba(232,75,74,.25)",
  },
  alarmBoxMobile: { width: "min(92vw, 380px)", padding: "28px 20px" },
  alarmPulse: { fontSize: 56, marginBottom: 16 },
  alarmTitle: { fontSize: 24, fontWeight: 500, color: "#eee", marginBottom: 6 },
  alarmSub: { fontSize: 14, color: "#888", marginBottom: 24 },
  stopBtn: {
    background: "rgba(232,75,74,.15)", border: "1px solid rgba(232,75,74,.4)",
    borderRadius: 12, padding: "14px 40px", fontSize: 16, color: "#E24B4A",
    cursor: "pointer", fontFamily: "'Outfit', sans-serif", fontWeight: 500,
    transition: "all .15s", letterSpacing: ".01em",
  },
  timerView: { },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 20 },
  statsRowMobile: { gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 },
  statCard: { background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,.04)" },
  statLabel: { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4, fontWeight: 500 },
  statVal: { fontSize: 22, fontWeight: 500, fontFamily: "'JetBrains Mono', monospace", color: "#ccc" },
  phaseBadge: { display: "inline-block", fontSize: 11, fontWeight: 500, padding: "4px 14px", borderRadius: 20, letterSpacing: ".04em", textTransform: "uppercase" },
  timerCenter: { position: "relative", display: "flex", alignItems: "center", justifyContent: "center", margin: "16px 0 20px" },
  timerOverlay: { position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  timerNum: { fontSize: 48, fontWeight: 400, fontFamily: "'JetBrains Mono', monospace", color: "#eee", letterSpacing: ".02em" },
  timerNumMobile: { fontSize: 42 },
  timerSub: { fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: ".1em", marginTop: 2 },

  // Preset pickers
  pickerSection: { marginBottom: 12 },
  pickerLabel: { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 500, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" },
  durRow: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  durBtn: {
    background: "none", borderStyle: "solid", borderWidth: 1, borderColor: "rgba(255,255,255,.08)", borderRadius: 8,
    padding: "10px 14px", fontSize: 12, color: "#555", cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace", transition: "all .15s",
    minHeight: 40,
  },
  durActiveTeal: { borderColor: "#4ECDC4", color: "#4ECDC4" },
  durActiveAmber: { borderColor: "#E8A838", color: "#E8A838" },
  addBtn: {
    background: "none", border: "1px dashed rgba(255,255,255,.12)", borderRadius: 8,
    width: 40, height: 40, fontSize: 16, color: "#444", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s", padding: 0,
  },
  removeBtn: {
    position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%",
    background: "rgba(226,75,74,.15)", border: "1px solid rgba(226,75,74,.35)",
    color: "#E24B4A", fontSize: 11, cursor: "pointer", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
  },
  customWrap: { display: "flex", alignItems: "center", gap: 4 },
  customInput: {
    width: 54, background: "rgba(255,255,255,.05)", border: "1px solid rgba(78,205,196,.3)",
    borderRadius: 8, padding: "7px 8px", fontSize: 12, color: "#ccc",
    fontFamily: "'JetBrains Mono', monospace", outline: "none", textAlign: "center",
  },
  confirmBtn: {
    background: "rgba(78,205,196,.12)", border: "1px solid rgba(78,205,196,.3)",
    borderRadius: 6, padding: "5px 10px", fontSize: 13, color: "#4ECDC4",
    cursor: "pointer", lineHeight: 1,
  },
  cancelBtn: {
    background: "none", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 6, padding: "5px 10px", fontSize: 13, color: "#666",
    cursor: "pointer", lineHeight: 1,
  },

  taskInput: {
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
    borderRadius: 10, padding: "10px 16px", fontSize: 14, color: "#ccc",
    fontFamily: "'Outfit', sans-serif", width: "100%", maxWidth: 380,
    textAlign: "center", outline: "none", transition: "border .2s",
  },
  btnRow: { display: "flex", gap: 10, justifyContent: "center" },
  btnRowMobile: { flexDirection: "column" },
  primaryBtn: {
    background: "rgba(78,205,196,.12)", border: "1px solid rgba(78,205,196,.25)",
    borderRadius: 10, padding: "12px 28px", fontSize: 14, color: "#4ECDC4",
    cursor: "pointer", fontFamily: "'Outfit', sans-serif", fontWeight: 500, transition: "all .15s", minHeight: 46,
  },
  secBtn: {
    background: "none", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 10, padding: "12px 20px", fontSize: 14, color: "#666",
    cursor: "pointer", fontFamily: "'Outfit', sans-serif", transition: "all .15s", minHeight: 46,
  },
  prepView: { },
  section: { marginBottom: 28 },
  secHead: { display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12 },
  secNum: { fontSize: 11, color: "#4ECDC4", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, marginTop: 2, minWidth: 20 },
  secTitle: { fontSize: 15, fontWeight: 500, color: "#ccc", marginBottom: 3 },
  secSub: { fontSize: 13, color: "#555", lineHeight: 1.5 },
  dumpArea: {
    width: "100%", minHeight: 110, resize: "vertical",
    background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)",
    borderRadius: 10, padding: "12px 14px", fontSize: 14, color: "#bbb",
    fontFamily: "'Outfit', sans-serif", lineHeight: 1.65, outline: "none",
    transition: "border .2s", marginBottom: 8,
  },
  wordCount: { fontSize: 11, color: "#444", fontFamily: "'JetBrains Mono', monospace" },
  tinyBtn: {
    background: "none", borderStyle: "solid", borderWidth: 1, borderColor: "rgba(255,255,255,.06)", borderRadius: 6,
    padding: "4px 12px", fontSize: 11, color: "#555", cursor: "pointer",
    fontFamily: "'Outfit', sans-serif", transition: "all .15s",
  },
  intentInput: {
    width: "100%", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)",
    borderRadius: 10, padding: "10px 14px", fontSize: 14, color: "#bbb",
    fontFamily: "'Outfit', sans-serif", outline: "none", transition: "border .2s",
  },
  checkLabel: { display: "flex", alignItems: "center", gap: 12, cursor: "pointer", fontSize: 13 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, border: "1px solid rgba(255,255,255,.12)",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
    color: "transparent", cursor: "pointer", transition: "all .2s", flexShrink: 0,
  },
  checkboxChecked: { background: "rgba(78,205,196,.15)", borderColor: "rgba(78,205,196,.4)", color: "#4ECDC4" },
  techView: { },
  techIntro: { fontSize: 13, color: "#555", marginBottom: 16 },
  techGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  techGridMobile: { gridTemplateColumns: "1fr" },
  techCard: { background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 12, padding: "16px 18px" },
  techTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  techIcon: { fontSize: 18, color: "#4ECDC4" },
  techFit: { fontSize: 10, padding: "3px 10px", borderRadius: 20, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".04em" },
  techName: { fontSize: 14, fontWeight: 500, color: "#ccc", marginBottom: 6 },
  techDesc: { fontSize: 12, color: "#666", lineHeight: 1.55, marginBottom: 8 },
  techYou: { fontSize: 11, color: "#555", borderLeft: "2px solid rgba(78,205,196,.3)", paddingLeft: 10, fontStyle: "italic", lineHeight: 1.5 },
  histView: { },
  emptyState: { textAlign: "center", padding: 40, color: "#444", fontSize: 14 },
  logRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.04)" },
  logRowMobile: { flexWrap: "wrap", gap: 6 },
  logTime: { fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#555", minWidth: 44 },
  logTask: { fontSize: 13, flex: 1, color: "#aaa" },
  logDur: { fontSize: 12, color: "#555", fontFamily: "'JetBrains Mono', monospace" },
  logCheck: { fontSize: 12, color: "#4ECDC4", fontWeight: 500 },
  footer: {
    marginTop: 36, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.04)",
    fontSize: 12, textAlign: "center", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.8,
  },
  footerMobile: { textAlign: "left", fontSize: 11, lineHeight: 1.7 },
};

// Simplified style injection for standard browsers
if (typeof document !== "undefined" && !document.getElementById("focus-system-styles")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "focus-system-styles";
    styleSheet.textContent = `
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
    @keyframes alarmPulse { from { transform: scale(1); } to { transform: scale(1.15); } }
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100%;
      background: #0D0D0F;
    }
    input:focus, textarea:focus { border-color: rgba(78,205,196,.35) !important; }
    button:hover { opacity: .85; }
    ::placeholder { color: #444; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 4px; }
    `;
    document.head.appendChild(styleSheet);
}
