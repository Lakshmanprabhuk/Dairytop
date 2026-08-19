import { useState, useRef, useEffect, useCallback } from "react";
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

const SUGGESTIONS = [
  'What was our best revenue month?',
  'Who is the top sales rep?',
  'Revenue by category?',
  'Direct sales vs webshop split?',
];

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
  position:fixed;right:22px;bottom:22px;z-index:400;
  width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
  background:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 100%);
  color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 6px 20px rgba(64,188,243,.45);
  transition:transform .18s,box-shadow .18s;
}
.cb-toggle:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 10px 26px rgba(64,188,243,.55);}
.cb-toggle .cb-dot{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:var(--green);border:2px solid #fff;}

.cb-panel{
  position:fixed;right:22px;bottom:86px;z-index:400;
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
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
}
.cb-head-title{font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px;}
.cb-head-sub{font-size:9.5px;color:rgba(255,255,255,.55);margin-top:1px;}
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

@media(max-width:480px){
  .cb-panel{right:12px;left:12px;width:auto;bottom:78px;}
  .cb-toggle{right:14px;bottom:14px;}
}
`;

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const send = useCallback(async (text) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    if (!CHAT_PROXY_URL) {
      setMessages(prev => [...prev, { role: 'user', text: trimmed }, { role: 'error', text: 'Chatbot is not configured (missing proxy URL at build time).' }]);
      setInput('');
      return;
    }

    const nextHistory = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt();
      const historyForApi = nextHistory
        .filter(m => m.role === 'user' || m.role === 'bot')
        .slice(0, -1);
      const reply = await callChatProxy(systemPrompt, historyForApi, trimmed);
      setMessages(prev => [...prev, { role: 'bot', text: reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'error', text: err.message || 'Something went wrong reaching Gemini.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <style>{chatCss}</style>

      <button className="cb-toggle" onClick={() => setOpen(v => !v)} aria-label="Open dashboard assistant">
        {open ? '✕' : '💬'}
        {!open && <span className="cb-dot" />}
      </button>

      {open && (
        <div className="cb-panel">
          <div className="cb-head">
            <div>
              <div className="cb-head-title">✨ Dashboard Assistant</div>
              <div className="cb-head-sub">Answers only from this dashboard's data</div>
            </div>
            <button className="cb-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <div className="cb-body" ref={bodyRef}>
            {messages.length === 0 ? (
              <div className="cb-empty">
                <div className="cb-empty-icon">📊</div>
                Ask me anything about the sales &amp; finance data in this dashboard.
                <div className="cb-suggestions">
                  {SUGGESTIONS.map(s => (
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
              placeholder="Ask about revenue, reps, customers…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button className="cb-send" onClick={() => send()} disabled={loading || !input.trim()} aria-label="Send">➤</button>
          </div>
        </div>
      )}
    </>
  );
}