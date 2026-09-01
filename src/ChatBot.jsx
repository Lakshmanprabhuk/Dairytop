import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { buildSystemPrompt } from "./utils/chatContext.js";

/* ── CHAT PROXY CONFIG ─────────────────────────────────────────
   The Gemini API key is never present on the client. The browser
   calls our own serverless proxy (deployed on Vercel — see
   api/chat.js), which holds the key server-side and forwards the
   request to Gemini. Set the proxy's URL at build time via
   VITE_CHAT_PROXY_URL (a GitHub Actions repo variable or secret is
   fine — this value is not sensitive, it's just a public endpoint
   URL). ------------------------------------------------------- */
const CHAT_PROXY_URL = import.meta.env.VITE_CHAT_PROXY_URL;

/* ── i18n ─────────────────────────────────────────────────────
   Only two languages, so a flat dictionary is simpler than pulling
   in an i18n library for this. The system prompt sent to Gemini
   also receives the current lang (see buildSystemPrompt(lang)) so
   the model's actual replies come back in the right language too —
   this dictionary only covers the static UI strings + suggestions. */
const STRINGS = {
  en: {
    title: 'Dashboard Assistant',
    subtitle: "Answers only from this dashboard's data",
    emptyTitle: 'Ask me anything about the sales & finance data in this dashboard.',
    placeholder: 'Ask about revenue, reps, customers…',
    notConfigured: 'Chatbot is not configured (missing proxy URL at build time).',
    genericError: 'Something went wrong reaching the assistant.',
    toggleOpenLabel: 'Open dashboard assistant',
    closeLabel: 'Close',
    sendLabel: 'Send',
    greeting: "Hi! I'm your dashboard assistant 🐮 Ask me anything about your sales & finance data.",
    suggestions: [
      'What was our best revenue month?',
      'Who is the top sales rep?',
      'Revenue by category?',
      'Direct sales vs webshop split?',
    ],
  },
  nl: {
    title: 'Dashboard-assistent',
    subtitle: 'Antwoordt alleen op basis van de gegevens in dit dashboard',
    emptyTitle: 'Stel me een vraag over de verkoop- en financiële gegevens in dit dashboard.',
    placeholder: 'Vraag naar omzet, verkopers, klanten…',
    notConfigured: 'De chatbot is niet geconfigureerd (proxy-URL ontbreekt bij het bouwen).',
    genericError: 'Er ging iets mis bij het bereiken van de assistent.',
    toggleOpenLabel: 'Open dashboard-assistent',
    closeLabel: 'Sluiten',
    sendLabel: 'Verzenden',
    greeting: 'Hoi! Ik ben je dashboard-assistent 🐮 Vraag me gerust iets over je verkoop- en financiële gegevens.',
    suggestions: [
      'Wat was onze beste omzetmaand?',
      'Wie is de beste verkoper?',
      'Omzet per categorie?',
      'Verdeling directe verkoop vs webshop?',
    ],
  },
};

// ── Layout constants for the draggable widget ──────────────────
const BTN_SIZE = 58;
const EDGE_PAD = 10;
const PANEL_GAP = 12;
const BUBBLE_GAP = 10; // back to the original tight spacing near the button —
                        // the moo puffs now avoid it via a curved path instead
                        // of needing extra empty space
const MOO_RISE = 40;
const POS_STORAGE_KEY = 'dairytop-chatbot-pos';

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Figures out where to anchor a floating element (panel / bubble) relative
// to the button's current position, flipping above/below and left/right
// so it always opens into the screen instead of off the edge.
function anchorNear(pos, elW, elH, gap) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btnCenterX = pos.x + BTN_SIZE / 2;
  const btnCenterY = pos.y + BTN_SIZE / 2;
  const isRight = btnCenterX > vw / 2;
  const isBottom = btnCenterY > vh / 2;

  let left = isRight ? pos.x + BTN_SIZE - elW : pos.x;
  let top = isBottom ? pos.y - gap - elH : pos.y + BTN_SIZE + gap;

  left = clamp(left, EDGE_PAD, Math.max(EDGE_PAD, vw - elW - EDGE_PAD));
  top = clamp(top, EDGE_PAD, Math.max(EDGE_PAD, vh - elH - EDGE_PAD));

  return { left, top, isBottom };
}

function defaultPos() {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.innerWidth - BTN_SIZE - 22,
    y: window.innerHeight - BTN_SIZE - 22,
  };
}

// Turns "**bold**" into real <strong> emphasis. Built by hand (no
// dangerouslySetInnerHTML, no markdown lib) so untrusted model output
// is always rendered as text nodes, never as HTML.
function renderFormatted(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

async function callChatProxy(systemPrompt, history, userMessage) {
  const response = await fetch(CHAT_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt,
      history: history.map(h => ({ role: h.role, text: h.text })),
      message: userMessage,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `API error ${response.status}`);
  }
  if (!data?.text) {
    throw new Error('No response from Gemini.');
  }
  return data.text;
}

const chatCss = `
.cb-toggle{
  position:fixed;z-index:9998;
  width:${BTN_SIZE}px;height:${BTN_SIZE}px;border-radius:50%;border:2px solid rgba(255,255,255,0.6);cursor:grab;
  background:radial-gradient(circle at 32% 28%, var(--surface2, #E8F7FD) 0%, var(--accent, #40BCF3) 65%, var(--accent2, #35A9DE) 100%);
  color:#fff;font-size:26px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 6px 20px rgba(64,188,243,.45);
  transition:box-shadow .18s;
  padding:0;touch-action:none;user-select:none;
}
.cb-toggle:active{cursor:grabbing;}
.cb-toggle:hover{box-shadow:0 10px 26px rgba(64,188,243,.55);}
.cb-toggle .cb-dot{position:absolute;top:4px;right:4px;width:9px;height:9px;border-radius:50%;background:var(--green);border:2px solid #fff;z-index:9999;}
.cb-cow{display:inline-block;transform-origin:50% 62%;animation:cbCowShake 4.6s ease-in-out infinite;filter:drop-shadow(0 1px 1px rgba(31,55,65,.25));pointer-events:none;}
.cb-toggle:hover .cb-cow{animation-duration:1.1s;}
.cb-toggle.open .cb-cow{animation:none;}
@keyframes cbCowShake{
  0%{transform:rotate(0deg);}
  4%{transform:rotate(-9deg);}
  8%{transform:rotate(8deg);}
  12%{transform:rotate(-6deg);}
  16%{transform:rotate(4deg);}
  20%{transform:rotate(0deg);}
  100%{transform:rotate(0deg);}
}
.cb-close-x{font-size:20px;color:#fff;pointer-events:none;}

.cb-panel{
  position:fixed;z-index:9998;
  width:360px;max-width:calc(100vw - 32px);
  height:520px;max-height:calc(100vh - 130px);
  background:var(--surface);border:1px solid var(--border);border-radius:16px;
  box-shadow:0 16px 48px rgba(31,55,65,.28);
  display:flex;flex-direction:column;overflow:hidden;
  animation:cbSlideUp .18s cubic-bezier(.4,0,.2,1);
}
@keyframes cbSlideUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}

.cb-head{
  background:var(--accent3);color:#fff;padding:14px 16px;
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:8px;
}
.cb-head-title{font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px;}
.cb-head-sub{font-size:9.5px;color:rgba(255,255,255,.55);margin-top:1px;}
.cb-head-context{font-size:9px;color:rgba(255,255,255,.75);margin-top:3px;display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.1);padding:1px 7px;border-radius:20px;font-weight:600;}
.cb-head-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}

.cb-lang{display:flex;border:1px solid rgba(255,255,255,.35);border-radius:7px;overflow:hidden;flex-shrink:0;}
.cb-lang button{
  border:none;background:transparent;color:rgba(255,255,255,.65);
  font-size:10px;font-weight:700;font-family:inherit;padding:4px 7px;cursor:pointer;
  letter-spacing:.3px;transition:background .14s,color .14s;
}
.cb-lang button.active{background:rgba(255,255,255,.92);color:var(--accent3,#1f3741);}
.cb-lang button:not(.active):hover{background:rgba(255,255,255,.15);color:#fff;}

.cb-close{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:16px;padding:4px;line-height:1;}
.cb-close:hover{color:#fff;}

.cb-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0;}
.cb-body::-webkit-scrollbar{width:4px;}
.cb-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

.cb-msg{max-width:86%;font-size:12px;line-height:1.5;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;}
.cb-msg.user{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:3px;}
.cb-msg.bot{align-self:flex-start;background:var(--surface3);color:var(--text);border:1px solid var(--border);border-bottom-left-radius:3px;}
.cb-msg.error{align-self:flex-start;background:rgba(217,92,92,.08);color:#B53939;border:1px solid rgba(217,92,92,.25);}

.cb-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px;}
.cb-typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);opacity:.4;animation:cbBlink 1.1s ease-in-out infinite;}
.cb-typing span:nth-child(2){animation-delay:.15s;}
.cb-typing span:nth-child(3){animation-delay:.3s;}
@keyframes cbBlink{0%,60%,100%{opacity:.25;}30%{opacity:.9;}}

.cb-empty{color:var(--muted);font-size:11.5px;text-align:center;margin:auto 0;padding:0 8px;}
.cb-empty-icon{font-size:26px;margin-bottom:8px;}

.cb-suggestions{display:flex;flex-direction:column;gap:6px;margin-top:12px;}
.cb-sugg-btn{
  text-align:left;padding:7px 10px;border:1px solid var(--border);border-radius:8px;
  background:var(--surface3);color:var(--muted2);font-size:11px;font-family:inherit;cursor:pointer;
  transition:all .14s;
}
.cb-sugg-btn:hover{border-color:var(--accent);color:var(--accent2);background:rgba(64,188,243,.06);}

.cb-inputrow{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);flex-shrink:0;background:var(--surface);}
.cb-input{
  flex:1;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;
  background:var(--surface3);color:var(--text);font-size:12px;font-family:inherit;outline:none;
  transition:border-color .15s;resize:none;
}
.cb-input:focus{border-color:var(--accent);}
.cb-send{
  width:36px;height:36px;flex-shrink:0;border:none;border-radius:10px;cursor:pointer;
  background:var(--accent);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;
  transition:opacity .14s;
}
.cb-send:disabled{opacity:.4;cursor:not-allowed;}

.cb-greet{
  position:fixed;z-index:9997;
  width:225px;max-width:calc(100vw - 40px);
  background:var(--surface,#fff);border:1px solid var(--border,#DDE6E9);
  border-radius:14px;padding:10px 30px 10px 13px;box-shadow:var(--shadow-md,0 4px 16px rgba(31,55,65,.09));
  font-size:11.5px;line-height:1.5;color:var(--text,#1F3741);cursor:pointer;
  animation:cbGreetIn .22s cubic-bezier(.4,0,.2,1);
}
.cb-greet-close{
  position:absolute;top:6px;right:7px;background:none;border:none;
  color:var(--muted,#5F7078);font-size:11px;cursor:pointer;padding:3px;line-height:1;
}
.cb-greet-close:hover{color:var(--text,#1F3741);}
@keyframes cbGreetIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}

.cb-moo-wrap{position:fixed;z-index:9996;pointer-events:none;width:1px;height:1px;}
.cb-moo{
  position:absolute;left:0;bottom:0;white-space:nowrap;
  font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;
  color:var(--accent2,#35A9DE);text-shadow:0 1px 2px rgba(255,255,255,.7);
  opacity:0;animation:cbMooFloat 2.4s cubic-bezier(.33,.6,.4,1) forwards;
}
/* A wavy, flame-like rise — zigzags side to side while climbing well
   above the button, instead of a single smooth curve toward the
   greeting bubble's side. */
@keyframes cbMooFloat{
  0%  {opacity:0;   transform:translate(0px,0px)     scale(.7)  rotate(-4deg);}
  10% {opacity:1;   transform:translate(6px,-10px)    scale(.95) rotate(4deg);}
  25% {opacity:1;   transform:translate(-9px,-26px)   scale(1)   rotate(-6deg);}
  40% {opacity:1;   transform:translate(10px,-44px)    scale(1)   rotate(5deg);}
  55% {opacity:.95; transform:translate(-7px,-62px)   scale(1)   rotate(-5deg);}
  70% {opacity:.85; transform:translate(9px,-80px)    scale(.97) rotate(4deg);}
  85% {opacity:.55; transform:translate(-3px,-96px)   scale(.92) rotate(-3deg);}
  100%{opacity:0;   transform:translate(4px,-110px)   scale(.85) rotate(2deg);}
}
.cb-moo-0{animation-delay:0s;}
.cb-moo-1{animation-delay:.55s;left:3px;}
.cb-moo-2{animation-delay:1.1s;left:-3px;}
.cb-moo-3{animation-delay:1.65s;left:5px;}
.cb-moo-4{animation-delay:2.2s;left:-2px;}
`;

export default function ChatBot({ context, suggestedQuestions } = {}) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState('en');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showMoo, setShowMoo] = useState(false);
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(POS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
      }
    } catch { /* ignore bad/blocked storage */ }
    return defaultPos();
  });
  const [, forceRecalc] = useState(0);
  const bodyRef = useRef(null);
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const t = STRINGS[lang];

  // Page-aware suggestion chips: prefer the ones the dashboard passed in for
  // whatever page is currently open (see App.jsx's SUGGESTED_QUESTIONS), and
  // fall back to the static translated defaults otherwise. The passed-in
  // list is English-only today, so it's only swapped in for the EN tab —
  // the NL tab always shows the maintained Dutch defaults rather than a
  // mixed-language list.
  const suggestions = (lang === 'en' && suggestedQuestions && suggestedQuestions.length)
    ? suggestedQuestions
    : t.suggestions;

  // On first mount: show a greeting speech bubble for 10s, and a few
  // "Moo~" text puffs drifting up from behind the button for 4s.
  useEffect(() => {
    setShowGreeting(true);
    setShowMoo(true);
    const greetTimer = setTimeout(() => setShowGreeting(false), 10000);
    const mooTimer = setTimeout(() => setShowMoo(false), 4900);
    return () => {
      clearTimeout(greetTimer);
      clearTimeout(mooTimer);
    };
  }, []);

  // Keep the button on-screen if the window is resized, and re-anchor
  // the panel/bubble accordingly.
  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: clamp(p.x, EDGE_PAD, Math.max(EDGE_PAD, window.innerWidth - BTN_SIZE - EDGE_PAD)),
        y: clamp(p.y, EDGE_PAD, Math.max(EDGE_PAD, window.innerHeight - BTN_SIZE - EDGE_PAD)),
      }));
      forceRecalc(n => n + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
    } catch { /* ignore blocked storage (private browsing etc.) */ }
  }, [pos]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const nx = clamp(dragRef.current.origX + dx, EDGE_PAD, Math.max(EDGE_PAD, window.innerWidth - BTN_SIZE - EDGE_PAD));
    const ny = clamp(dragRef.current.origY + dy, EDGE_PAD, Math.max(EDGE_PAD, window.innerHeight - BTN_SIZE - EDGE_PAD));
    setPos({ x: nx, y: ny });
  };

  const handlePointerUp = () => {
    dragRef.current.dragging = false;
  };

  const handleToggleClick = () => {
    // A drag that moved the button shouldn't also count as a click-to-open.
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setOpen(v => !v);
    setShowGreeting(false);
  };

  const send = useCallback(async (text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    if (!CHAT_PROXY_URL) {
      setMessages(prev => [...prev, { role: 'user', text: trimmed }, { role: 'error', text: t.notConfigured }]);
      setInput('');
      return;
    }

    const nextHistory = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      // buildSystemPrompt(lang) already gives the model the full dashboard
      // dataset; this appends a short, plain-text note about what the user
      // is actually looking at right now (page + active date filter) so
      // answers can be scoped to their current view when that's relevant,
      // without needing to touch utils/chatContext.js itself.
      const basePrompt = buildSystemPrompt(lang);
      const contextNote = context
        ? (lang === 'nl'
            ? `\n\nContext: de gebruiker bekijkt op dit moment de pagina "${context.pageName}"` +
              (context.filterLabel ? ` met periodefilter "${context.filterLabel}"${context.dateRange ? ` (${context.dateRange})` : ''}.` : '.') +
              ' Stem je antwoord hierop af wanneer dat relevant is, maar je mag ook de volledige dataset gebruiken.'
            : `\n\nContext: the user is currently viewing the "${context.pageName}" page` +
              (context.filterLabel ? ` with the date filter set to "${context.filterLabel}"${context.dateRange ? ` (${context.dateRange})` : ''}.` : '.') +
              ' Tailor your answer to what they can currently see when that\'s relevant, but you may still draw on the full dataset.')
        : '';
      const systemPrompt = basePrompt + contextNote;
      const historyForApi = nextHistory
        .filter(m => m.role === 'user' || m.role === 'bot')
        .slice(0, -1);
      const reply = await callChatProxy(systemPrompt, historyForApi, trimmed);
      setMessages(prev => [...prev, { role: 'bot', text: reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'error', text: err.message || t.genericError }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, lang, t, context]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Recomputed on every render (cheap: a handful of arithmetic ops) so
  // dragging, resizing, and opening/closing all stay in sync without
  // needing separate effects to keep a mirrored "anchor" state.
  const panelAnchor = useMemo(() => {
    const w = Math.min(360, window.innerWidth - 32);
    const h = Math.min(520, window.innerHeight - 130);
    return { ...anchorNear(pos, w, h, PANEL_GAP), w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, open]);

  const bubbleAnchor = useMemo(() => {
    const w = Math.min(225, window.innerWidth - 40);
    const h = 92; // approximate rendered height, good enough for anchoring
    return { ...anchorNear(pos, w, h, BUBBLE_GAP), w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, showGreeting]);

  // Moo puffs always emerge from directly behind the button and rise
  // upward — kept simple on purpose. The large BUBBLE_GAP above is what
  // actually prevents them from ever being covered by the greeting bubble.
  const mooStyle = {
    left: `${pos.x + BTN_SIZE - 91}px`,
    top: `${pos.y + BTN_SIZE - 10}px`,
  };

  return createPortal(
    <>
      <style>{chatCss}</style>

      {!open && showMoo && (
        <div className="cb-moo-wrap" style={mooStyle} aria-hidden="true">
          <span className="cb-moo cb-moo-0">Moo~</span>
          <span className="cb-moo cb-moo-1">Mooo~</span>
          <span className="cb-moo cb-moo-2">Moo!</span>
          <span className="cb-moo cb-moo-3">Moooo~</span>
          <span className="cb-moo cb-moo-4">Moo moo~</span>
        </div>
      )}

      {!open && showGreeting && (
        <div
          className="cb-greet"
          style={{ left: `${bubbleAnchor.left}px`, top: `${bubbleAnchor.top}px` }}
          onClick={() => { setOpen(true); setShowGreeting(false); }}
          role="button"
          tabIndex={0}
        >
          <button
            className="cb-greet-close"
            onClick={(e) => { e.stopPropagation(); setShowGreeting(false); }}
            aria-label={t.closeLabel}
          >
            ✕
          </button>
          {t.greeting}
        </div>
      )}

      <button
        className={`cb-toggle${open ? ' open' : ''}`}
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleToggleClick}
        aria-label={open ? t.closeLabel : t.toggleOpenLabel}
        title={t.toggleOpenLabel}
      >
        {open ? <span className="cb-close-x">✕</span> : <span className="cb-cow">🐮</span>}
        {!open && <span className="cb-dot" />}
      </button>

      {open && (
        <div
          className="cb-panel"
          style={{ left: `${panelAnchor.left}px`, top: `${panelAnchor.top}px`, width: `${panelAnchor.w}px`, height: `${panelAnchor.h}px` }}
        >
          <div className="cb-head">
            <div>
              <div className="cb-head-title">🐄 {t.title}</div>
              <div className="cb-head-sub">{t.subtitle}</div>
              {context?.pageName && (
                <div className="cb-head-context">{lang === 'nl' ? 'Bekijkt: ' : 'Viewing: '}{context.pageName}</div>
              )}
            </div>
            <div className="cb-head-right">
              <div className="cb-lang" role="group" aria-label="Language">
                <button
                  className={lang === 'en' ? 'active' : ''}
                  onClick={() => setLang('en')}
                  aria-pressed={lang === 'en'}
                >
                  EN
                </button>
                <button
                  className={lang === 'nl' ? 'active' : ''}
                  onClick={() => setLang('nl')}
                  aria-pressed={lang === 'nl'}
                >
                  NL
                </button>
              </div>
              <button className="cb-close" onClick={() => setOpen(false)} aria-label={t.closeLabel}>✕</button>
            </div>
          </div>

          <div className="cb-body" ref={bodyRef}>
            {messages.length === 0 ? (
              <div className="cb-empty">
                <div className="cb-empty-icon">📊</div>
                {t.emptyTitle}
                <div className="cb-suggestions">
                  {suggestions.map(s => (
                    <button key={s} className="cb-sugg-btn" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`cb-msg ${m.role}`}>{renderFormatted(m.text)}</div>
              ))
            )}
            {loading && (
              <div className="cb-typing"><span/><span/><span/></div>
            )}
          </div>
          <div className="cb-inputrow">
            <textarea
              className="cb-input"
              rows={1}
              placeholder={t.placeholder}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button className="cb-send" onClick={() => send()} disabled={loading || !input.trim()} aria-label={t.sendLabel}>➤</button>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}