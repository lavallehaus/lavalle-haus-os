// LAVALLE HAUS OS — voice (read aloud + spoken command)
//
// Browser speech, kept in one place so the boards only deal with "speak this
// text" and "tell me what she said". Everything here degrades to nothing when
// the browser has no Web Speech support — the caller checks ttsSupported() /
// srSupported() and simply doesn't render the control.
//
// The two rules that make this work on her iPhone:
//   1. speak() MUST be reached synchronously from the tap handler. No await,
//      no setTimeout before it, or iOS silently drops the utterance. Every
//      exported function here is synchronous for that reason.
//   2. Recognition and synthesis never run together — the mic hears the
//      spoken output and loops. listen() cancels any speech first.

import { useCallback, useEffect, useRef, useState } from "react";

const synth = () => (typeof window === "undefined" ? null : window.speechSynthesis || null);
const SR = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

export const ttsSupported = () => !!synth();
// Recognition is unreliable-to-absent inside an installed iOS PWA, so this is
// a real check, not a formality: when it's false the mic button is not drawn
// at all rather than shipped dead.
export const srSupported = () => !!SR();

// Long utterances get truncated by some browsers partway through and can't be
// skipped mid-way, so everything is spoken as sentence-sized pieces. No
// lookbehind in the split — older iOS Safari throws on it.
export function speechChunks(text, max = 180) {
  const clean = String(text || "")
    .replace(/https?:\/\/\S+/g, " ")                 // never read a URL out loud
    .replace(/[•·▸▷◦⟳✓✦◫▦⊞≡✎⏱✗⇪←⏭■↗]/g, " ")
    .replace(/[—–]/g, ", ")                          // an em dash is a beat, not a word
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  const sentences = [];
  let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    buf += ch;
    if (ch === "!" || ch === "?") { if (buf.trim()) sentences.push(buf.trim()); buf = ""; continue; }
    if (ch !== ".") continue;
    // A full stop between two digits is a decimal, not the end of a sentence —
    // splitting there turns "34.8 million" into "thirty-four. eight million".
    if (/\d/.test(clean[i - 1] || "") && /\d/.test(clean[i + 1] || "")) continue;
    if (buf.trim()) sentences.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) sentences.push(buf.trim());
  const out = [];
  let cur = "";
  for (let s of sentences) {
    while (s.length > max) {                          // a long clause with no full stop
      let cut = s.lastIndexOf(",", max);
      if (cut < max * 0.4) cut = s.lastIndexOf(" ", max);
      if (cut <= 0) cut = max;
      const head = s.slice(0, cut + 1).trim();
      if (head) out.push(head);
      s = s.slice(cut + 1).trim();
    }
    if (!s) continue;
    if (!cur) cur = s;
    else if ((cur + " " + s).length <= max) cur = cur + " " + s;
    else { out.push(cur); cur = s; }
  }
  if (cur) out.push(cur);
  return out;
}

// What a card sounds like: its title, then its notes.
export function cardSpeech(card) {
  const name = String((card && card.name) || "").replace(/^—\s*|\s*—$/g, "").trim();
  const desc = String((card && card.desc) || "").trim();
  if (!name && !desc) return "";
  if (!desc) return name.replace(/[.!?]$/, "") + ".";
  return name.replace(/[.!?]$/, "") + ". " + desc;
}

const STOPWORDS = new Set(["read","me","the","my","a","an","to","out","loud","please","go","show","open","what","is","it","are","our","we","us","do","does","did","how","card","cards","column","list","board","tell","about","you","i","and","of","on","for","again","now","that","this","one","say"]);
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOPWORDS.has(w));

// Map a spoken phrase onto one of the board's columns. Scored on the column
// name's own distinctive words, so "read the backlog" finds "Re-cut Backlog"
// and "how do we compare" finds "How We Compare".
export function matchList(transcript, lists) {
  const tw = words(transcript);
  if (!tw.length) return null;
  let best = null, bestHits = 0, bestFrac = 0;
  for (const l of lists || []) {
    const lw = words(l && l.name);
    if (!lw.length) continue;
    let hits = 0;
    for (const w of lw) {
      if (w.length < 4) continue;
      const stem = w.slice(0, 4);
      // The reverse prefix test needs a real word on the spoken side too: the
      // stray "s" out of "what's" otherwise prefix-matches Summary, Standard
      // and anything else beginning with it.
      if (tw.some((t) => t === w || t.startsWith(stem) || (t.length >= 4 && w.startsWith(t.slice(0, 4))))) hits++;
    }
    const frac = hits / lw.length;
    if (hits > bestHits || (hits === bestHits && hits > 0 && frac > bestFrac)) { best = l; bestHits = hits; bestFrac = frac; }
  }
  return bestHits > 0 ? best : null;
}

export const isStopCommand = (t) => /\b(stop|quiet|silence|shut up|be quiet|cancel|enough)\b/.test(String(t || ""));
export const isNextCommand = (t) => /\b(next|skip|move on|carry on|keep going)\b/.test(String(t || ""));

export function useVoice() {
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(() => { try { return localStorage.getItem("lh_tts_voice") || ""; } catch { return ""; } });
  const [rate, setRate] = useState(() => { try { const n = parseFloat(localStorage.getItem("lh_tts_rate")); return n >= 0.5 && n <= 2 ? n : 1; } catch { return 1; } });
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);   // stopped mid-readout, resumable from where it got to
  const [listening, setListening] = useState(false);
  const [nowReading, setNowReading] = useState("");

  const queue = useRef([]);     // the chunks of the current readout
  const at = useRef(0);         // which chunk is being spoken
  // Cancelling fires the queued utterances' end handlers asynchronously, so a
  // generation counter keeps a dead readout's events from clearing the flags
  // of the one that replaced it.
  const gen = useRef(0);
  const recRef = useRef(null);
  const voicesRef = useRef([]); voicesRef.current = voices;
  const uriRef = useRef(voiceURI); uriRef.current = voiceURI;
  const rateRef = useRef(rate); rateRef.current = rate;

  // getVoices() is async and Safari never fires voiceschanged, so the list is
  // polled for a few seconds as well as listened for. Populating on first
  // render alone leaves the picker empty.
  useEffect(() => {
    const s = synth();
    if (!s) return undefined;
    let iv = null;
    const load = () => { const v = s.getVoices() || []; if (v.length) { setVoices(Array.from(v)); return true; } return false; };
    if (!load()) {
      let tries = 0;
      iv = setInterval(() => { if (load() || ++tries > 24) { clearInterval(iv); iv = null; } }, 250);
    }
    try { s.addEventListener("voiceschanged", load); } catch { s.onvoiceschanged = load; }
    return () => {
      if (iv) clearInterval(iv);
      try { s.removeEventListener("voiceschanged", load); } catch {}
      try { if (s.onvoiceschanged === load) s.onvoiceschanged = null; } catch {}
    };
  }, []);

  // Leaving the screen must not leave a voice talking over the app.
  useEffect(() => () => {
    gen.current++;
    try { const s = synth(); if (s) s.cancel(); } catch {}
    try { if (recRef.current) recRef.current.abort(); } catch {}
  }, []);

  const pickVoice = () => {
    const v = voicesRef.current || [];
    return v.find((x) => x.voiceURI === uriRef.current)
      || v.find((x) => x.default && /^en/i.test(x.lang))
      || v.find((x) => /^en/i.test(x.lang))
      || v[0] || null;
  };

  const pushFrom = (startAt, g) => {
    const s = synth();
    if (!s) return;
    const items = queue.current;
    const vo = pickVoice();
    for (let k = startAt; k < items.length; k++) {
      const u = new window.SpeechSynthesisUtterance(items[k]);
      if (vo) { u.voice = vo; u.lang = vo.lang; }
      u.rate = rateRef.current;
      u.onstart = () => { if (g !== gen.current) return; at.current = k; setSpeaking(true); };
      const done = () => { if (g !== gen.current) return; if (k >= items.length - 1) { setSpeaking(false); setNowReading(""); } };
      u.onend = done; u.onerror = done;
      s.speak(u);                                     // synchronous: keeps the iOS gesture alive
    }
  };

  // Chrome swallows a speak() issued in the same tick as a cancel(), so a
  // readout that interrupts another one waits a beat. That wait is safe on
  // iOS precisely because something is already speaking — the synthesis is
  // unlocked. When nothing is speaking we must stay synchronous instead, or
  // iOS drops the utterance for leaving the tap gesture.
  const startAfterCancel = (s, startAt, g) => { try { s.cancel(); } catch {} setTimeout(() => { if (g === gen.current) pushFrom(startAt, g); }, 140); };

  // text: a string, or an array of strings read one after another.
  const speak = useCallback((text, label = "") => {
    const s = synth();
    if (!s) return;
    const list = (Array.isArray(text) ? text : [text]).filter(Boolean);
    const chunks = list.reduce((acc, t) => acc.concat(speechChunks(t)), []);
    if (!chunks.length) return;
    const g = ++gen.current;
    const busy = s.speaking || s.pending;
    queue.current = chunks; at.current = 0;
    setNowReading(label); setSpeaking(true); setPaused(false);
    if (busy) { startAfterCancel(s, 0, g); return; }
    try { s.resume(); } catch {}
    pushFrom(0, g);                                   // synchronous: keeps the iOS gesture alive
  }, []);

  const stop = useCallback(() => {
    gen.current++;
    try { const s = synth(); if (s) s.cancel(); } catch {}
    queue.current = []; at.current = 0;
    setSpeaking(false); setPaused(false); setNowReading("");
  }, []);

  // Pause/resume is done by dropping the queue and re-speaking from the chunk
  // we had reached, NOT by speechSynthesis.pause() — that call is ignored or
  // left stuck on iOS Safari, and a readout you can't restart is worse than
  // none. Chunking already gives us the position for free.
  const pause = useCallback(() => {
    const s = synth();
    if (!s || !queue.current.length) return;
    gen.current++;
    try { s.cancel(); } catch {}
    setSpeaking(false); setPaused(true);
  }, []);

  const play = useCallback(() => {
    const s = synth();
    if (!s || !queue.current.length) return;
    const g = ++gen.current;
    setPaused(false); setSpeaking(true);
    try { s.resume(); } catch {}
    pushFrom(Math.min(at.current, queue.current.length - 1), g);  // synchronous: iOS gesture
  }, []);

  const next = useCallback(() => {
    const s = synth();
    if (!s || !queue.current.length) return;
    const i = at.current + 1;
    if (i >= queue.current.length) { stop(); return; }
    const g = ++gen.current;
    at.current = i;
    setSpeaking(true); setPaused(false);
    startAfterCancel(s, i, g);
  }, [stop]);

  // One shot per tap. Continuous mode drains the battery and fights the
  // synthesis; this cancels any speech first so the mic can't hear itself.
  const listen = useCallback((onCommand) => {
    const C = SR();
    if (!C) return;
    gen.current++;
    try { const s = synth(); if (s) s.cancel(); } catch {}
    setSpeaking(false); setPaused(false); setNowReading("");
    try { if (recRef.current) recRef.current.abort(); } catch {}
    recRef.current = null;
    let rec;
    try { rec = new C(); } catch { return; }
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let txt = "";
      try { txt = (e.results[0][0].transcript || "").toLowerCase().trim(); } catch {}
      if (txt) { try { onCommand(txt); } catch {} }
    };
    rec.onerror = () => { setListening(false); };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); recRef.current = null; }
  }, []);

  const stopListening = useCallback(() => {
    try { if (recRef.current) recRef.current.abort(); } catch {}
    recRef.current = null;
    setListening(false);
  }, []);

  const chooseVoice = useCallback((uri) => { setVoiceURI(uri); try { localStorage.setItem("lh_tts_voice", uri || ""); } catch {} }, []);
  const chooseRate = useCallback((r) => { const n = Math.min(2, Math.max(0.5, Number(r) || 1)); setRate(n); try { localStorage.setItem("lh_tts_rate", String(n)); } catch {} }, []);

  return { voices, voiceURI, chooseVoice, rate, chooseRate, speak, stop, next, pause, play, speaking, paused, nowReading, listen, stopListening, listening };
}
