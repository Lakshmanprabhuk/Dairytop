import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { resolve as resolveLocal, buildSystemPrompt, buildFallbackAnswer, compactHistory } from "./utils/chatContext.js";
import { QUESTION_NL, CONTEXT_SUGGESTIONS, followupsFor, topicFromText } from "./utils/chatSuggestions.js";
import { getChatData } from "./utils/chatData.js";
import { requestWithDeadline } from "./utils/chatRequest.js";
import heroChatbotImg from "./assets/hero-chatbot.png";
import dairytopLogoImg from "./assets/dairytop-logo.png";
import dairytopFabImg from "./assets/dairytop-fab.png";
import dairytopCloseImg from "./assets/dairytop-close.png";

const CHAT_PROXY_URL = import.meta.env.VITE_CHAT_PROXY_URL;

// ── Localised strings ────────────────────────────────────────────────────────
const STRINGS = {
  en: {
    title: 'DairyTop Assistant',
    subtitle: 'AI · Sales & Finance',
    emptyTitle: 'What would you like to explore?',
    emptySubtitle: "Ask about your DairyTop sales and finance data.",
    placeholder: 'Ask a question…',
    notConfigured: 'Chatbot is not configured (missing proxy URL at build time).',
    genericError: 'Something went wrong reaching the assistant.',
    toggleOpenLabel: 'Open dashboard assistant',
    closeLabel: 'Close',
    newChat: 'New conversation',
    sendLabel: 'Send message',
    stopLabel: 'Stop response',
    you: 'You',
    assistant: 'DairyTop Assistant',
    copied: 'Copied!',
    trust: 'Uses dashboard data only',
    timeGreetings: { night: 'Good night', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    greetingBody: "I'm your dashboard assistant 🐮 Ask me anything about your sales & finance data.",
    contexts: { overview: 'Overview', sales: 'Sales', finance: 'Finance', orders: 'Orders', reps: 'Reps' },
    contextItems: [
      { key: 'overview', label: 'Overview Dashboard' },
      { key: 'sales',    label: 'Sales Dashboard' },
      { key: 'finance',  label: 'Finance Dashboard' },
      { key: 'orders',   label: 'Open Orders' },
      { key: 'reps',     label: 'Sales Reps' },
    ],
  },
  nl: {
    title: 'DairyTop Assistent',
    subtitle: 'AI · Verkoop & Financiën',
    emptyTitle: 'Wat wil je ontdekken?',
    emptySubtitle: 'Stel vragen over je DairyTop verkoop- en financiële gegevens.',
    placeholder: 'Stel een vraag…',
    notConfigured: 'De chatbot is niet geconfigureerd (proxy-URL ontbreekt bij het bouwen).',
    genericError: 'Er ging iets mis bij het bereiken van de assistent.',
    toggleOpenLabel: 'Open dashboard-assistent',
    closeLabel: 'Sluiten',
    newChat: 'Nieuw gesprek',
    sendLabel: 'Bericht verzenden',
    stopLabel: 'Stoppen',
    you: 'Jij',
    assistant: 'DairyTop Assistent',
    copied: 'Gekopieerd!',
    trust: 'Gebruikt alleen dashboardgegevens',
    timeGreetings: { night: 'Goedenacht', morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond' },
    greetingBody: 'Ik ben je dashboard-assistent 🐮 Vraag me gerust iets over je verkoop- en financiële gegevens.',
    contexts: { overview: 'Overzicht', sales: 'Verkoop', finance: 'Financiën', orders: 'Orders', reps: 'Vertegenwoordigers' },
    contextItems: [
      { key: 'overview', label: 'Overzicht Dashboard' },
      { key: 'sales',    label: 'Verkoop Dashboard' },
      { key: 'finance',  label: 'Financiën Dashboard' },
      { key: 'orders',   label: 'Open Orders' },
      { key: 'reps',     label: 'Vertegenwoordigers' },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function getTimeGreeting(lang) {
  const hour = new Date().getHours();
  const g = (STRINGS[lang] || STRINGS.en).timeGreetings;
  if (hour < 5)  return g.night;
  if (hour < 12) return g.morning;
  if (hour < 18) return g.afternoon;
  if (hour < 22) return g.evening;
  return g.night;
}

function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderFormatted(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

async function callChatProxy(systemPrompt, history, userMessage, signal) {
  const response = await fetch(CHAT_PROXY_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt,
      history: history.map(h => ({ role: h.role, text: h.text })),
      message: userMessage,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `API error ${response.status}`);
  if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error('No response from the AI service.');
  return { text: data.text, model: data.model || 'unknown', tried: data.tried || [data.model].filter(Boolean) };
}

// ── Layout constants ─────────────────────────────────────────────────────────
const BTN_SIZE = 68;
const EDGE_PAD = 10;
const PANEL_GAP = 10;
const BUBBLE_GAP = 10;
const CHAR_LIMIT = 4000;
const POS_STORAGE_KEY = 'dairytop-chatbot-pos';

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth <= 900;
}
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function anchorNear(pos, elW, elH, gap) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isRight  = pos.x + BTN_SIZE / 2 > vw / 2;
  const isBottom = pos.y + BTN_SIZE / 2 > vh / 2;
  let left = isRight  ? pos.x + BTN_SIZE - elW : pos.x;
  let top  = isBottom ? pos.y - gap - elH : pos.y + BTN_SIZE + gap;
  left = clamp(left, EDGE_PAD, Math.max(EDGE_PAD, vw - elW - EDGE_PAD));
  top  = clamp(top,  EDGE_PAD, Math.max(EDGE_PAD, vh - elH - EDGE_PAD));
  return { left, top };
}
function defaultPos() {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.innerWidth  - BTN_SIZE - (isMobile() ? 14 : 22),
    y: window.innerHeight - BTN_SIZE - (isMobile() ? 72 : 22),
  };
}
function getPanelDims() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (isMobile()) return { w: Math.min(vw - 16, 420), h: Math.min(vh * 0.86, 600) };
  return { w: Math.min(400, vw - 32), h: Math.min(600, vh - 100) };
}
function mobilePanelPos(dims) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return { left: Math.max(8, (vw - dims.w) / 2), top: Math.max(8, vh - dims.h - BTN_SIZE - 16) };
}

// ── Inline SVG icons ─────────────────────────────────────────────────────────
const ICON_PATHS = {
  trend:   "M2 19 9 11l6 5L26 4M18 4h8v8",
  people:  "M11 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 23v-3a9 9 0 0 1 18 0v3M20 2a4 4 0 0 1 0 8m3 4a7 7 0 0 1 4 7v2",
  box:     "m12 1 10 5v14l-10 5-10-5V6Zm0 10L2 6m10 5 10-5M12 11v14M7 3.5l10 5v6",
  grid:    "",  // rects below
  copy:    "M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  thumbUp: "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14ZM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3",
  thumbDown:"M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10ZM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17",
  send:    "M12 20V4m-7 7 7-7 7 7",
  chevron: "m6 9 6 6 6-6",
  eye:     "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  plus:    "M12 5v14M5 12h14",
  close:   "m5 5 14 14M19 5 5 19",
  stop:    "",  // rect below
};

function Svg({ name, size = 15, strokeWidth = 1.7, fill = 'none', style }) {
  const isGrid = name === 'grid';
  const isStop = name === 'stop';
  const isRoundedCopy = name === 'copy';

  let inner = null;
  if (isGrid) {
    inner = (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
      </>
    );
  } else if (isStop) {
    inner = <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>;
  } else if (isRoundedCopy) {
    inner = (
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth={strokeWidth} fill="none"/>
      </>
    );
  } else {
    inner = <path d={ICON_PATHS[name] || ''} stroke="currentColor" strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round"/>;
  }

  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={fill} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0, ...style }}
    >
      {inner}
    </svg>
  );
}

// ── Hero illustration ─────────────────────────────────────────────────────────
function HeroIllustration() {
  return (
    <img
      src={heroChatbotImg}
      alt=""
      aria-hidden="true"
      width={210}
      height={140}
      style={{ display: 'block', objectFit: 'contain', width: '210px', height: 'auto', maxWidth: '100%' }}
    />
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const chatCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.cb-toggle {
  position: fixed; z-index: 9998;
  width: ${BTN_SIZE}px; height: ${BTN_SIZE}px; border-radius: 50%;
  border: none; cursor: grab;
  background: transparent;
  color: #fff; font-size: 20px; display: flex; align-items: center; justify-content: center;
  box-shadow: none;
  transition: transform .18s, filter .18s; padding: 0; touch-action: none; user-select: none;
  overflow: visible;
}
.cb-toggle:active { cursor: grabbing; transform: scale(0.93); }
.cb-toggle:hover  { filter: brightness(1.08); transform: scale(1.05); }
.cb-toggle.open   { background: transparent; border-radius: 50%; box-shadow: none; }
/* Ripple rings behind the FAB — only when closed */
.cb-toggle::before,
.cb-toggle::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: transparent;
  border: 3px solid rgba(64,188,243,0.75);
  pointer-events: none;
  z-index: -1;
  opacity: 0;
}
.cb-toggle::before { animation: cbRipple 3.2s ease-out infinite; }
.cb-toggle::after  { animation: cbRipple 3.2s ease-out infinite 1.0s; }
.cb-toggle.open::before,
.cb-toggle.open::after { animation: none; opacity: 0; }
@keyframes cbRipple {
  0%   { transform: scale(1);    opacity: 0.85; }
  70%  { transform: scale(2.1);  opacity: 0;    }
  100% { transform: scale(2.1);  opacity: 0;    }
}
.cb-fab-img { width: ${BTN_SIZE}px; height: ${BTN_SIZE}px; object-fit: contain; display: block; pointer-events: none; }
.cb-dot { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; background: #2E9B62; border: 2px solid #fff; z-index: 1; }
.cb-cow { display: inline-block; transform-origin: 50% 62%; animation: cbCowShake 4.6s ease-in-out infinite; filter: drop-shadow(0 1px 1px rgba(31,55,65,.25)); pointer-events: none; }
.cb-toggle:hover .cb-cow { animation-duration: 1.1s; }
.cb-toggle.open .cb-cow { animation: none; }
@keyframes cbCowShake {
  0%,20%,100% { transform: rotate(0deg); }
  4% { transform: rotate(-9deg); } 8% { transform: rotate(8deg); }
  12% { transform: rotate(-6deg); } 16% { transform: rotate(4deg); }
}
.cb-close-x { font-size: 20px; color: #fff; pointer-events: none; }

/* Click-outside backdrop */
.cb-backdrop {
  position: fixed; inset: 0; z-index: 9997;
  background: transparent;
  cursor: default;
}

/* Panel */
.cb-panel {
  position: fixed; z-index: 9998; border-radius: 20px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(16,42,55,.28), 0 0 0 1px rgba(0,0,0,.07);
  animation: cbSlideUp .18s cubic-bezier(.4,0,.2,1);
  max-height: calc(100dvh - 20px);
  font-family: 'Inter', system-ui, -apple-system, Arial, sans-serif;
  -webkit-font-smoothing: antialiased; background: #F3F7FA;
}
@keyframes cbSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }

/* Header */
.cb-head {
  background: #111E25; color: #fff; padding: 11px 13px;
  display: flex; align-items: center; flex-shrink: 0; gap: 9px; position: relative;
}
.cb-head::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(64,188,243,.08) 0%, transparent 60%);
  pointer-events: none;
}
.cb-head-logo {
  display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 32px;
  border-radius: 8px; overflow: hidden; background: transparent;
}
.cb-head-logo img { width: 32px; height: 32px; object-fit: contain; display: block; }
.cb-head-titles { flex: 1; min-width: 0; }
.cb-head-title { font-size: 13.5px; font-weight: 600; color: #fff; letter-spacing: -.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-head-sub   { font-size: 10px; color: #9BB5C0; margin-top: 1px; }
.cb-head-right { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

.cb-lang { display: flex; border: 1px solid rgba(255,255,255,.12); border-radius: 20px; background: rgba(255,255,255,.06); }
.cb-lang button {
  min-width: 32px; min-height: 24px; padding: 2px 7px; border: none; border-radius: 20px;
  background: transparent; color: #9BB5C0; font-size: 11px; font-weight: 600;
  letter-spacing: .03em; cursor: pointer; transition: background .18s, color .18s; font-family: inherit;
}
.cb-lang button.active { background: rgba(64,188,243,.22); color: #40BCF3; }
.cb-lang button:not(.active):hover { background: rgba(255,255,255,.1); color: #fff; }

.cb-hdr-btn {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  background: transparent; border: none; color: #9BB5C0; cursor: pointer;
  transition: background .15s, color .15s;
}
.cb-hdr-btn:hover { background: rgba(255,255,255,.1); color: #fff; }

/* Body */
.cb-body {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; padding: 14px 13px 0;
  display: flex; flex-direction: column; min-height: 0;
  scrollbar-width: thin; scrollbar-color: #C8D8DE transparent;
  background: radial-gradient(ellipse at 50% 20%, #EBF6FE 0%, #F3F7FA 70%);
}
.cb-body::-webkit-scrollbar { width: 4px; }
.cb-body::-webkit-scrollbar-thumb { background: #C8D8DE; border-radius: 4px; }

/* Body — zero padding when welcome fills edge-to-edge */
.cb-body:has(.cb-empty) { padding: 0; background: transparent; }

/* Welcome / empty — light blue hero */
.cb-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  flex: 1; padding: 20px 18px 20px; position: relative; overflow: hidden;
  background: radial-gradient(ellipse at 50% 0%, #C4E7F8 0%, #DCF0FD 42%, #EEF7FC 70%, #F5F9FD 100%);
}
.cb-empty::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at 15% 85%, rgba(64,188,243,.14) 0%, transparent 50%),
              radial-gradient(circle at 85% 20%, rgba(64,188,243,.10) 0%, transparent 45%);
}

/* Illustration wrapper */
.cb-hero-illus { margin-bottom: 10px; position: relative; z-index: 1; }

.cb-empty-title {
  font-size: 18px; font-weight: 800; letter-spacing: -.5px;
  color: #0D1C29; margin-bottom: 5px; position: relative; z-index: 1; line-height: 1.25;
}
.cb-empty-sub {
  font-size: 13px; color: #5B7482; line-height: 1.55;
  margin-bottom: 16px; position: relative; z-index: 1;
}

/* Pill-badge suggestion chips — only for locally answerable questions */
.cb-suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; width: 100%; max-width: 320px; position: relative; z-index: 1; }
.cb-sugg-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 15px; border-radius: 18px; white-space: normal; text-align: left; line-height: 1.3; max-width: 100%;
  font-family: inherit; cursor: pointer; font-size: 12px; font-weight: 500;
  background: rgba(255,255,255,.78);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(100,185,235,.4); color: #0D3D5C;
  box-shadow: 0 2px 10px rgba(0,100,180,.09), inset 0 1px 0 rgba(255,255,255,.95);
  transition: background .18s, border-color .18s, transform .12s, box-shadow .18s;
}
.cb-sugg-btn:hover {
  background: #fff; border-color: #40BCF3;
  box-shadow: 0 3px 14px rgba(0,100,180,.14), 0 0 0 1.5px rgba(64,188,243,.4);
  transform: translateY(-1px);
}
.cb-sugg-btn svg { color: #35A9DE; flex-shrink: 0; }

.cb-trust {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  color: #8AAAB8; font-size: 11px; margin: 12px 0 0; padding-bottom: 8px; position: relative; z-index: 1;
}
.cb-trust-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #2E9B62;
  box-shadow: 0 0 0 2px rgba(46,155,98,.2); animation: cbPulse 2.5s ease infinite;
}
@keyframes cbPulse { 0%,100%{box-shadow:0 0 0 2px rgba(46,155,98,.2);}50%{box-shadow:0 0 0 5px rgba(46,155,98,.1);} }

/* Messages list */
.cb-msgs { display: flex; flex-direction: column; }

.cb-msg-wrap {
  display: flex; flex-direction: column; margin-bottom: 12px;
  animation: cbMsgIn .2s ease both; position: relative;
}
@keyframes cbMsgIn { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }

.cb-msg-hdr { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; padding: 0 3px; }
.cb-msg-label { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #8A9EA6; }
.cb-msg-time  { font-size: 10px; color: #8A9EA6; opacity: .7; margin-left: auto; font-variant-numeric: tabular-nums; }

.cb-msg-wrap.user .cb-msg-hdr { flex-direction: row-reverse; }
.cb-msg-wrap.user .cb-msg-time { margin-left: 0; margin-right: auto; }

/* Bot bubble */
.cb-msg-wrap.bot .cb-msg-text {
  background: #fff; border: 1px solid #DDE6E9; border-radius: 4px 16px 16px 16px;
  box-shadow: 0 1px 3px rgba(16,42,55,.06); padding: 10px 13px;
  font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  color: #1A2F38; max-width: 94%;
}
/* User bubble */
.cb-msg-wrap.user { align-items: flex-end; }
.cb-msg-wrap.user .cb-msg-text {
  background: linear-gradient(135deg, #2491C8 0%, #1A6E9A 100%); color: #fff;
  border-radius: 16px 4px 16px 16px; padding: 10px 13px;
  font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  max-width: 86%; box-shadow: 0 2px 10px rgba(26,110,154,.3);
}
/* Error bubble */
.cb-msg-wrap.error .cb-msg-text {
  background: rgba(217,92,92,.06); color: #B53939; border: 1px solid rgba(217,92,92,.2);
  border-radius: 4px 16px 16px 16px; padding: 10px 13px;
  font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 94%;
}

/* Message actions – hover reveal */
.cb-msg-actions {
  display: flex; align-items: center; gap: 4px;
  margin-top: 5px; padding-left: 3px;
  opacity: 0; transition: opacity .15s;
}
.cb-msg-wrap:hover .cb-msg-actions { opacity: 1; }
.cb-msg-wrap.user .cb-msg-actions { padding-left: 0; padding-right: 3px; justify-content: flex-end; }

.cb-act-btn {
  display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
  border-radius: 12px; border: 1px solid #DDE6E9; background: #fff; color: #5B6F78;
  font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: border-color .12s, color .12s, background .12s;
}
.cb-act-btn:hover   { border-color: #40BCF3; color: #35A9DE; background: #E8F5FD; }
.cb-act-btn.liked   { color: #2E9B62; border-color: #2E9B62; background: rgba(46,155,98,.06); }
.cb-act-btn.disliked{ color: #D95C5C; border-color: #D95C5C; background: rgba(217,92,92,.05); }

.cb-copy-toast {
  position: absolute; top: -26px; left: 3px; z-index: 10;
  background: #1A2F38; color: #fff; font-size: 11px; font-weight: 500;
  padding: 3px 10px; border-radius: 7px; pointer-events: none; white-space: nowrap;
  animation: cbMsgIn .15s ease both;
}
.cb-msg-wrap.user .cb-copy-toast { left: auto; right: 3px; }

/* Typing indicator */
.cb-typing {
  display: flex; align-items: center; gap: 4px; padding: 11px 14px;
  background: #fff; border: 1px solid #DDE6E9; border-radius: 4px 16px 16px 16px;
  box-shadow: 0 1px 3px rgba(16,42,55,.06);
  width: fit-content; margin-bottom: 12px; animation: cbMsgIn .2s ease both;
}
.cb-typing span {
  width: 7px; height: 7px; border-radius: 50%; background: #8A9EA6;
  animation: cbTyping .9s ease infinite;
}
.cb-typing span:nth-child(2){ animation-delay: .15s; }
.cb-typing span:nth-child(3){ animation-delay: .3s; }
@keyframes cbTyping { 0%,80%,100%{transform:translateY(0);opacity:.4;}40%{transform:translateY(-5px);opacity:1;} }

/* Follow-up chips */
.cb-followups {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-top: 7px; padding-left: 3px;
  animation: cbMsgIn .25s ease .05s both;
}
.cb-fu-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 27px; padding: 0 10px;
  border-radius: 13px; border: 1px solid #C8D8DE; background: #E8F5FD;
  color: #1A2F38; font-size: 11.5px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: border-color .15s, background .15s, transform .1s;
}
.cb-fu-chip:hover { border-color: #40BCF3; background: #fff; transform: translateY(-1px); }
.cb-fu-chip svg { color: #35A9DE; }

/* Composer area */
.cb-composer-wrap { flex-shrink: 0; padding: 10px 11px 11px; background: #F3F7FA; }
.cb-composer {
  border: 1.5px solid #C8D8DE; border-radius: 16px; overflow: hidden;
  background: #fff; box-shadow: 0 2px 8px rgba(16,42,55,.09);
  transition: border-color .2s, box-shadow .2s;
}
.cb-composer:focus-within {
  border-color: #35A9DE;
  box-shadow: 0 2px 8px rgba(16,42,55,.09), 0 0 0 3px rgba(64,188,243,.18);
}
.cb-textarea-row { position: relative; }
.cb-input {
  display: block; width: 100%; min-height: 48px; padding: 12px 13px 5px;
  border: none; resize: none; background: transparent;
  color: #1A2F38; font-size: 14px; line-height: 1.4; font-family: inherit; outline: none;
}
.cb-input::placeholder { color: #8A9EA6; }
.cb-char-counter {
  position: absolute; bottom: 5px; right: 11px; font-size: 10px; color: #8A9EA6;
  pointer-events: none; font-variant-numeric: tabular-nums; transition: color .15s;
}
.cb-char-counter.warn   { color: #E5A93D; }
.cb-char-counter.danger { color: #D95C5C; }

.cb-toolbar {
  display: flex; align-items: center; min-height: 46px;
  border-top: 1px solid #DDE6E9; padding: 5px 10px 7px; gap: 6px;
  background: #F7FAFB;
}
.cb-ctx-pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
  border-radius: 18px; background: #E8F5FD; border: 1px solid #DDE6E9;
  font-size: 11px; font-weight: 500; color: #5B6F78; font-family: inherit;
  white-space: nowrap; cursor: pointer; position: relative;
  transition: border-color .15s, background .15s;
}
.cb-ctx-pill:hover { border-color: #35A9DE; background: #fff; }
.cb-ctx-pill svg { color: #35A9DE; }

.cb-ctx-menu {
  position: fixed; min-width: 180px;
  background: #fff; border: 1px solid #C8D8DE; border-radius: 13px;
  box-shadow: 0 8px 32px rgba(16,42,55,.18), 0 0 0 1px rgba(0,0,0,.04); padding: 5px; z-index: 99999;
  animation: cbMsgIn .15s ease;
}
.cb-ctx-menu button {
  display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 9px;
  border-radius: 7px; background: transparent; border: none; color: #1A2F38;
  font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer; text-align: left;
  transition: background .12s;
}
.cb-ctx-menu button:hover  { background: #E8F5FD; }
.cb-ctx-menu button.active { color: #35A9DE; font-weight: 600; }
.cb-ctx-menu button svg { color: #35A9DE; }

.cb-toolbar-right { display: flex; align-items: center; gap: 5px; margin-left: auto; }
.cb-stop-btn {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
  background: #fff; border: 1.5px solid #C8D8DE; color: #5B6F78; cursor: pointer;
  box-shadow: 0 1px 3px rgba(16,42,55,.06); transition: border-color .15s, color .15s;
}
.cb-stop-btn:hover { border-color: #D95C5C; color: #D95C5C; }
.cb-send {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #40BCF3 0%, #1A88C0 100%);
  color: #fff; border: none; cursor: pointer;
  box-shadow: 0 2px 8px rgba(64,188,243,.4);
  transition: transform .15s, box-shadow .15s;
}
.cb-send:hover:not(:disabled) { transform: translateY(-1px) scale(1.04); box-shadow: 0 4px 14px rgba(64,188,243,.5); }
.cb-send:active:not(:disabled){ transform: scale(.97); }
.cb-send:disabled { opacity: .4; cursor: not-allowed; }

/* Greeting bubble */
.cb-greet {
  position: fixed; z-index: 9997; max-width: calc(100vw - 40px);
  background: #fff; border: 1px solid #DDE6E9; border-radius: 14px;
  padding: 10px 30px 10px 13px; box-shadow: 0 4px 16px rgba(31,55,65,.09);
  font-size: 11.5px; line-height: 1.5; color: #1A2F38; cursor: pointer;
  animation: cbMsgIn .22s cubic-bezier(.4,0,.2,1);
  font-family: 'Inter', system-ui, Arial, sans-serif;
}
.cb-greet-close {
  position: absolute; top: 6px; right: 7px; background: none; border: none;
  color: #5B6F78; font-size: 11px; cursor: pointer; padding: 3px; line-height: 1;
}
.cb-greet-close:hover { color: #1A2F38; }

/* Moo puffs */
.cb-moo-wrap { position: fixed; z-index: 9996; pointer-events: none; width: 1px; height: 1px; }
.cb-moo {
  position: absolute; left: 0; bottom: 0; white-space: nowrap;
  font-weight: 700; font-size: 12px; color: #35A9DE;
  text-shadow: 0 1px 2px rgba(255,255,255,.7);
  opacity: 0; animation: cbMooFloat 2.4s cubic-bezier(.33,.6,.4,1) forwards;
}
@keyframes cbMooFloat {
  0%  {opacity:0;  transform:translate(0,0)      scale(.7)  rotate(-4deg);}
  10% {opacity:1;  transform:translate(6px,-10px) scale(.95) rotate(4deg);}
  40% {opacity:1;  transform:translate(10px,-44px)scale(1)   rotate(5deg);}
  85% {opacity:.55;transform:translate(-3px,-96px)scale(.92) rotate(-3deg);}
  100%{opacity:0;  transform:translate(4px,-110px)scale(.85) rotate(2deg);}
}
.cb-moo-0{animation-delay:0s;}   .cb-moo-1{animation-delay:.55s;left:3px;}
.cb-moo-2{animation-delay:1.1s;left:-3px;}.cb-moo-3{animation-delay:1.65s;left:5px;}
.cb-moo-4{animation-delay:2.2s;left:-2px;}

/* ── Responsive chatbot breakpoints ───────────────────────────────────────── */

/* Shared mobile chrome tweaks ≤ 900px */
@media (max-width: 900px) {
  .cb-toggle-fixed {
    position: fixed !important; right: 14px !important;
    bottom: calc(14px + env(safe-area-inset-bottom)) !important;
    left: auto !important; top: auto !important;
    cursor: pointer !important; touch-action: manipulation;
  }
  .cb-greet   { display: none !important; }
  .cb-moo-wrap{ display: none; }
  .cb-send, .cb-stop-btn { width: 40px; height: 40px; }
  .cb-input { font-size: 16px; }
}

/* 1 ── Small tablets / wide phones  769–900px — corner floating panel */
@media (min-width: 769px) and (max-width: 900px) {
  .cb-panel {
    border-radius: 20px !important;
    right: 20px !important; left: auto !important;
    bottom: 80px !important; top: auto !important;
    width: 440px !important; max-width: 440px !important;
    height: 560px !important; max-height: 560px !important;
  }
}

/* 2 ── Large phones  601–768px — full-width bottom sheet */
@media (min-width: 601px) and (max-width: 768px) {
  .cb-panel {
    border-radius: 20px 20px 0 0 !important;
    left: 0 !important; right: 0 !important;
    bottom: 0 !important; top: auto !important;
    width: 100% !important; max-width: 100% !important;
    height: 68dvh !important; max-height: 68dvh !important;
  }
}

/* 3 ── Mid phones  481–600px — full-width bottom sheet */
@media (min-width: 481px) and (max-width: 600px) {
  .cb-panel {
    border-radius: 18px 18px 0 0 !important;
    left: 0 !important; right: 0 !important;
    bottom: 0 !important; top: auto !important;
    width: 100% !important; max-width: 100% !important;
    height: 72dvh !important; max-height: 72dvh !important;
  }
}

/* 4 ── Standard phones  361–480px — full-width bottom sheet */
@media (min-width: 361px) and (max-width: 480px) {
  .cb-panel {
    border-radius: 16px 16px 0 0 !important;
    left: 0 !important; right: 0 !important;
    bottom: 0 !important; top: auto !important;
    width: 100% !important; max-width: 100% !important;
    height: 76dvh !important; max-height: 76dvh !important;
  }
}

/* 5 ── Very small phones  ≤ 360px — full-width bottom sheet */
@media (max-width: 360px) {
  .cb-panel {
    border-radius: 14px 14px 0 0 !important;
    left: 0 !important; right: 0 !important;
    bottom: 0 !important; top: auto !important;
    width: 100% !important; max-width: 100% !important;
    height: 80dvh !important; max-height: 80dvh !important;
  }
}
`;

// ── Component ────────────────────────────────────────────────────────────────
// liveData (optional): Supabase snapshot from App.jsx. Without it the static data.js module is used.
export default function ChatBot({ context, suggestedQuestions, userName, liveData } = {}) {
  const [open,         setOpen]         = useState(false);
  const [lang,         setLang]         = useState('en');
  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showMoo,      setShowMoo]      = useState(false);
  const [currentCtx,   setCurrentCtx]   = useState('overview');
  const [ctxMenuOpen,  setCtxMenuOpen]  = useState(false);
  const [ctxMenuPos,   setCtxMenuPos]   = useState({ left: 0, bottom: 0 });
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(POS_STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          const vw = window.innerWidth, vh = window.innerHeight;
          if (p.x >= 0 && p.x < vw - BTN_SIZE && p.y >= 0 && p.y < vh - BTN_SIZE) return p;
        }
      }
    } catch { /* ignore */ }
    return defaultPos();
  });
  const [, forceRecalc] = useState(0);

  const bodyRef    = useRef(null);
  const requestRef = useRef(null);
  const ctxPillRef = useRef(null);
  const ctxMenuRef = useRef(null);
  const dragRef    = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const lastSubjectRef = useRef([]);   // what the previous question was about → lets "top 5" / "compare to last month" follow on
  const data = useMemo(() => getChatData(liveData), [liveData]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const t = STRINGS[lang] || STRINGS.en;
  const timeGreeting    = getTimeGreeting(lang);
  const personalGreeting = userName ? `${timeGreeting}, ${userName}` : timeGreeting;

  const charRemaining    = CHAR_LIMIT - input.length;
  const charCounterClass = 'cb-char-counter' + (charRemaining < 100 ? ' danger' : charRemaining < 300 ? ' warn' : '');
  const showCharCounter  = charRemaining <= 3800;

  const ctxLabel = t.contexts[currentCtx] || t.contexts.overview;

  // ── Effects ──────────────────────────────────────────────────────────────
  // Clock tick (not needed for messages but kept for compatibility)
  useEffect(() => { const iv = setInterval(() => {}, 5 * 60 * 1000); return () => clearInterval(iv); }, []);

  // Greeting + moo on mount (desktop only)
  useEffect(() => {
    if (isMobile()) return;
    const t1 = setTimeout(() => { setShowGreeting(true); setShowMoo(true); }, 800);
    const t2 = setTimeout(() => setShowGreeting(false), 11000);
    const t3 = setTimeout(() => setShowMoo(false), 5700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Keep button on-screen on resize
  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: clamp(p.x, EDGE_PAD, Math.max(EDGE_PAD, window.innerWidth  - BTN_SIZE - EDGE_PAD)),
        y: clamp(p.y, EDGE_PAD, Math.max(EDGE_PAD, window.innerHeight - BTN_SIZE - EDGE_PAD)),
      }));
      forceRecalc(n => n + 1);
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  // Persist button position
  useEffect(() => { try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ } }, [pos]);

  // Auto-scroll
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [messages, loading, open]);

  // Lock body scroll on mobile when panel open
  useEffect(() => {
    if (isMobile()) document.documentElement.classList.toggle('no-scroll', open);
    return () => { if (isMobile()) document.documentElement.classList.remove('no-scroll'); };
  }, [open]);

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => {
      const inPill = ctxPillRef.current && ctxPillRef.current.contains(e.target);
      const inMenu = ctxMenuRef.current && ctxMenuRef.current.contains(e.target);
      if (!inPill && !inMenu) setCtxMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Drag ─────────────────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  const handlePointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const nx = clamp(dragRef.current.origX + dx, EDGE_PAD, Math.max(EDGE_PAD, window.innerWidth - BTN_SIZE - EDGE_PAD));
    const ny = clamp(dragRef.current.origY + dy, EDGE_PAD, Math.max(EDGE_PAD, window.innerHeight - BTN_SIZE - (isMobile() ? 72 : EDGE_PAD)));
    setPos({ x: nx, y: ny });
  };
  const handlePointerUp    = () => { dragRef.current.dragging = false; };
  const handleToggleClick  = () => { if (dragRef.current.moved) { dragRef.current.moved = false; return; } setOpen(v => !v); setShowGreeting(false); };

  // ── Actions ───────────────────────────────────────────────────────────────
  const stopRequest = useCallback(() => {
    if (requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      setLoading(false);
    }
  }, []);

  const resetChat = useCallback(() => {
    stopRequest();
    setMessages([]);
    setInput('');
    lastSubjectRef.current = [];
  }, [stopRequest]);

  const setFeedback = useCallback((idx, type) => {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, feedback: m.feedback === type ? null : type } : m));
  }, []);

  const copyMessage = useCallback((idx, text) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: select the text so user can manually copy
    });
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, showCopyToast: true } : m));
    setTimeout(() => {
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, showCopyToast: false } : m));
    }, 1800);
  }, []);

  // ── Send ─────────────────────────────────────────────────────────────────
  // 1. Local engine first: instant, no network, no tokens.
  // 2. AI only for "why / predict / recommend" questions or wording the engine
  //    does not understand — and then only with the slice of data that question needs.
  const send = useCallback(async (text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading || requestRef.current) return;

    const nextHistory = [...messages, { role: 'user', text: trimmed, time: nowTime() }];
    setMessages(nextHistory);
    setInput('');

    let local = null;
    try {
      local = resolveLocal(trimmed, { lang, context, prev: lastSubjectRef.current }, data);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[DairyTop] local engine error', err);
    }
    if (local?.subject?.length) lastSubjectRef.current = local.subject;
    if (import.meta.env.DEV) console.log(`[DairyTop] "${trimmed}" → ${local?.answer ? 'LOCAL' : 'AI'}`, local?.parsed);
    if (local?.answer) {
      setMessages(prev => [...prev, { role: 'bot', text: local.answer, time: nowTime(), source: 'local', followups: followupsFor(local.topic, lang, trimmed) }]);
      return;
    }

    setLoading(true);
    const request = new AbortController();
    requestRef.current = request;
    try {
      if (!CHAT_PROXY_URL) throw new Error('Missing proxy URL');
      const aiResult = await requestWithDeadline(async signal => {
        const recentTurns  = nextHistory.filter(m => m.role === 'user').slice(-2).map(m => m.text).join(' ');
        const systemPrompt = buildSystemPrompt(lang, recentTurns, data, { context, ctxKey: currentCtx, prev: lastSubjectRef.current });
        return callChatProxy(systemPrompt, compactHistory(nextHistory.slice(0, -1)), trimmed, signal);
      }, { signal: request.signal });
      if (request.signal.aborted) return;
      setMessages(prev => [...prev, { role: 'bot', text: aiResult.text, time: nowTime(), source: 'ai', followups: followupsFor(topicFromText(`${trimmed} ${aiResult.text}`), lang, trimmed) }]);
    } catch {
      if (request.signal.aborted) return;
      // AI unreachable → still give the user real numbers instead of an error.
      const reply = buildFallbackAnswer(trimmed, { lang, context }, data);
      setMessages(prev => [...prev, { role: 'bot', text: reply, time: nowTime(), source: 'local', followups: followupsFor('general', lang, trimmed) }]);
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      if (!request.signal.aborted) setLoading(false);
    }
  }, [input, loading, messages, lang, context, data, currentCtx]);

  // ── Suggested questions ──────────────────────────────────────────────────
  // Default context → the questions App.jsx defines for the page the user is on.
  // Another context picked in the chat → that context's chips.
  // Every chip is checked against the local engine, so a chip can never lead to AI or a dead end.
  const chips = useMemo(() => {
    const list = currentCtx === 'overview' && suggestedQuestions?.length
      ? suggestedQuestions.map(en => { const text = lang === 'nl' ? (QUESTION_NL[en] || en) : en; return { icon: 'grid', label: text, prompt: text }; })
      : (CONTEXT_SUGGESTIONS[currentCtx] || CONTEXT_SUGGESTIONS.overview).map(c => ({ icon: c.icon, label: c.label[lang] || c.label.en, prompt: c.prompt[lang] || c.prompt.en }));
    return list.filter(c => { try { return !!resolveLocal(c.prompt, { lang, context }, data).answer; } catch { return false; } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCtx, suggestedQuestions, lang, context?.page, context?.dateRange, data]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setOpen(false);
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panelDims = useMemo(() => getPanelDims(), [open, pos]);
  const panelPos  = useMemo(() => {
    if (isMobile()) return mobilePanelPos(panelDims);
    return anchorNear(pos, panelDims.w, panelDims.h, PANEL_GAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, open]);

  const bubbleAnchor = useMemo(() => {
    const w = Math.min(225, window.innerWidth - 40);
    const h = 92;
    if (isMobile()) {
      return { left: clamp(pos.x + BTN_SIZE / 2 - w / 2, EDGE_PAD, window.innerWidth - w - EDGE_PAD), top: clamp(pos.y - h - BUBBLE_GAP, EDGE_PAD, pos.y - h - 4) };
    }
    return anchorNear(pos, w, h, BUBBLE_GAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, showGreeting]);

  const mooStyle = { left: `${pos.x + BTN_SIZE - 91}px`, top: `${pos.y + BTN_SIZE - 10}px` };

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <>
      <style>{chatCss}</style>

      {/* Moo puffs */}
      {!open && showMoo && (
        <div className="cb-moo-wrap" style={mooStyle} aria-hidden="true">
          {['Moo~','Mooo~','Moo!','Moooo~','Moo moo~'].map((m, i) => (
            <span key={i} className={`cb-moo cb-moo-${i}`}>{m}</span>
          ))}
        </div>
      )}

      {/* Greeting bubble */}
      {!open && showGreeting && (
        <div
          className="cb-greet"
          style={{ left: `${bubbleAnchor.left}px`, top: `${bubbleAnchor.top}px`, width: `${Math.min(225, window.innerWidth - 40)}px` }}
          onClick={() => { setOpen(true); setShowGreeting(false); }}
          role="button" tabIndex={0}
        >
          <button className="cb-greet-close" onClick={e => { e.stopPropagation(); setShowGreeting(false); }} aria-label={t.closeLabel}>✕</button>
          {personalGreeting}! {t.greetingBody}
        </div>
      )}

      {/* Floating toggle button */}
      <button
        className={`cb-toggle${open ? ' open' : ''}${isMobile() ? ' cb-toggle-fixed' : ''}`}
        style={isMobile() ? {} : { left: `${pos.x}px`, top: `${pos.y}px` }}
        onPointerDown={isMobile() ? undefined : handlePointerDown}
        onPointerMove={isMobile() ? undefined : handlePointerMove}
        onPointerUp={isMobile() ? undefined : handlePointerUp}
        onPointerCancel={isMobile() ? undefined : handlePointerUp}
        onClick={handleToggleClick}
        aria-label={open ? t.closeLabel : t.toggleOpenLabel}
        title={open ? t.closeLabel : t.toggleOpenLabel}
      >
        {open
          ? <img src={dairytopCloseImg} alt="" className="cb-fab-img" aria-hidden="true" />
          : <img src={dairytopFabImg}   alt="" className="cb-fab-img" aria-hidden="true" />
        }
        {!open && <span className="cb-dot" />}
      </button>

      {/* Click-outside backdrop — closes panel when user taps outside */}
      {open && (
        <div
          className="cb-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="cb-panel"
          style={isMobile() ? {} : { left: `${panelPos.left}px`, top: `${panelPos.top}px`, width: `${panelDims.w}px`, height: `${panelDims.h}px` }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="cb-head">
            <div className="cb-head-logo" aria-hidden="true">
              <img src={dairytopLogoImg} alt="DairyTop" width={32} height={32} />
            </div>
            <div className="cb-head-titles">
              <div className="cb-head-title">{t.title}</div>
              <div className="cb-head-sub">{t.subtitle}</div>
            </div>
            <div className="cb-head-right">
              <div className="cb-lang" role="group" aria-label="Language">
                <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>EN</button>
                <button className={lang === 'nl' ? 'active' : ''} onClick={() => setLang('nl')} aria-pressed={lang === 'nl'}>NL</button>
              </div>
              <button className="cb-hdr-btn" onClick={resetChat} title={t.newChat} aria-label={t.newChat}>
                <Svg name="plus" size={15} />
              </button>
              <button className="cb-hdr-btn" onClick={() => setOpen(false)} aria-label={t.closeLabel}>
                <Svg name="close" size={15} />
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="cb-body" ref={bodyRef}>
            {messages.length === 0 ? (
              /* Welcome state */
              <div className="cb-empty">
                <div className="cb-hero-illus"><HeroIllustration /></div>
                <div className="cb-empty-title">{t.emptyTitle}</div>
                <div className="cb-empty-sub">{t.emptySubtitle}</div>
                <div className="cb-suggestions">
                  {chips.map(s => (
                    <button key={s.prompt} className="cb-sugg-btn" onClick={() => send(s.prompt)}>
                      <Svg name={s.icon} size={13} />
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="cb-trust">
                  <span className="cb-trust-dot" />
                  {t.trust}
                </div>
              </div>
            ) : (
              /* Messages */
              <div className="cb-msgs">
                {messages.map((m, i) => {
                  const isBot  = m.role === 'bot';
                  const isUser = m.role === 'user';
                  const wrapClass = `cb-msg-wrap ${isBot ? 'bot' : isUser ? 'user' : 'error'}`;
                  const isLastBot = isBot && messages.slice(i + 1).every(mm => mm.role !== 'bot');
                  const fuChips = isLastBot && !loading ? (m.followups || []) : [];

                  return (
                    <div key={i} className={wrapClass}>
                      {m.showCopyToast && <div className="cb-copy-toast">{t.copied}</div>}

                      {/* Message header: label + time */}
                      <div className="cb-msg-hdr">
                        <span className="cb-msg-label">{isUser ? t.you : t.assistant}</span>
                        {m.time && <span className="cb-msg-time">{m.time}</span>}
                      </div>

                      {/* Bubble */}
                      <div className="cb-msg-text">{renderFormatted(m.text)}</div>

                      {/* Actions: copy + thumbs (bot only) */}
                      {isBot && (
                        <div className="cb-msg-actions">
                          <button className="cb-act-btn" onClick={() => copyMessage(i, m.text)} aria-label="Copy" title="Copy">
                            <Svg name="copy" size={12} /> Copy
                          </button>
                          <button
                            className={`cb-act-btn${m.feedback === 'up' ? ' liked' : ''}`}
                            onClick={() => setFeedback(i, 'up')}
                            aria-label="Helpful" title="Helpful"
                          >
                            <Svg name="thumbUp" size={12} />
                          </button>
                          <button
                            className={`cb-act-btn${m.feedback === 'down' ? ' disliked' : ''}`}
                            onClick={() => setFeedback(i, 'down')}
                            aria-label="Not helpful" title="Not helpful"
                          >
                            <Svg name="thumbDown" size={12} />
                          </button>
                        </div>
                      )}

                      {/* Follow-up chips (last bot message only) */}
                      {fuChips.length > 0 && (
                        <div className="cb-followups">
                          {fuChips.map(chip => (
                            <button key={chip} className="cb-fu-chip" onClick={() => send(chip)}>
                              <Svg name="send" size={11} />
                              {chip}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Typing indicator */}
                {loading && (
                  <div className="cb-typing" aria-label="Assistant is typing">
                    <span /><span /><span />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Composer ── */}
          <div className="cb-composer-wrap">
            <form className="cb-composer" onSubmit={e => { e.preventDefault(); send(); }}>
              <div className="cb-textarea-row">
                <textarea
                  className="cb-input"
                  rows={1}
                  maxLength={CHAR_LIMIT}
                  placeholder={t.placeholder}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  onTouchMove={e => e.stopPropagation()}
                  aria-label={t.placeholder}
                />
                {showCharCounter && (
                  <span className={charCounterClass} aria-hidden="true">{charRemaining}</span>
                )}
              </div>

              <div className="cb-toolbar">
                {/* Context switcher pill */}
                <button
                  type="button"
                  className="cb-ctx-pill"
                  ref={ctxPillRef}
                  onClick={e => {
                    e.stopPropagation();
                    if (ctxPillRef.current) {
                      const r = ctxPillRef.current.getBoundingClientRect();
                      setCtxMenuPos({ left: r.left, bottom: window.innerHeight - r.top + 7 });
                    }
                    setCtxMenuOpen(v => !v);
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={ctxMenuOpen}
                  aria-label="Switch dashboard context"
                >
                  <Svg name="eye" size={12} />
                  {ctxLabel}
                  <Svg name="chevron" size={10} strokeWidth={2.2} />
                </button>

                <div className="cb-toolbar-right">
                  {loading ? (
                    <button type="button" className="cb-stop-btn" onClick={stopRequest} aria-label={t.stopLabel} title={t.stopLabel}>
                      <Svg name="stop" size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button type="submit" className="cb-send" disabled={!input.trim()} aria-label={t.sendLabel}>
                      <Svg name="send" size={15} strokeWidth={2.2} />
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Context menu — fixed-position portal, escapes panel overflow */}
      {open && ctxMenuOpen && (
        <div
          className="cb-ctx-menu"
          role="listbox"
          ref={ctxMenuRef}
          style={{ left: ctxMenuPos.left, bottom: ctxMenuPos.bottom }}
        >
          {t.contextItems.map(item => (
            <button
              key={item.key} type="button" role="option"
              aria-selected={currentCtx === item.key}
              className={currentCtx === item.key ? 'active' : ''}
              onClick={e => { e.stopPropagation(); setCurrentCtx(item.key); setCtxMenuOpen(false); }}
            >
              <Svg name="eye" size={13} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>,
    document.body
  );
}
