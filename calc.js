// Pure calculation logic — no DOM, no storage. Entries: { ts: epoch ms, m3: number }.

export const KWH_PER_M3 = 11.4; // współczynnik konwersji z faktury PSG
export const MAX_SANE_KW = 30;

const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export function parseReading(text) {
  const s = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => a.ts - b.ts);
}

export function intervals(entries) {
  const sorted = sortEntries(entries);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const dm3 = b.m3 - a.m3;
    const hours = (b.ts - a.ts) / HOUR;
    const kwh = dm3 * KWH_PER_M3;
    out.push({ from: a.ts, to: b.ts, dm3, hours, kwh, kw: kwh / hours });
  }
  return out;
}

// Time-weighted average power over [from, to], assuming constant power within each interval.
export function windowStats(entries, from, to) {
  let kwh = 0, hours = 0;
  for (const iv of intervals(entries)) {
    const start = Math.max(iv.from, from), end = Math.min(iv.to, to);
    if (end <= start) continue;
    const share = (end - start) / (iv.to - iv.from);
    kwh += iv.kwh * share;
    hours += (end - start) / HOUR;
  }
  return { kwh, hours, kw: hours > 0 ? kwh / hours : NaN };
}

export function summary(entries) {
  const ivs = intervals(entries);
  if (ivs.length === 0) return null;
  const sorted = sortEntries(entries);
  const first = sorted[0].ts, last = sorted[sorted.length - 1].ts;
  return {
    lastKw: ivs[ivs.length - 1].kw,
    week: windowStats(entries, last - 7 * DAY, last),
    season: windowStats(entries, first, last),
  };
}

// Returns { error } to block, { warning } to require confirmation, or {} if fine.
export function validateEntry(entries, entry) {
  if (!Number.isFinite(entry.m3)) return { error: 'Nieprawidłowa liczba.' };
  if (!Number.isFinite(entry.ts)) return { error: 'Nieprawidłowa data.' };
  const sorted = sortEntries(entries);
  if (sorted.some(e => e.ts === entry.ts)) return { error: 'Odczyt z tym samym czasem już istnieje.' };
  const prev = sorted.filter(e => e.ts < entry.ts).at(-1);
  const next = sorted.find(e => e.ts > entry.ts);
  if (prev && entry.m3 < prev.m3) return { error: `Odczyt niższy niż poprzedni (${prev.m3.toLocaleString("pl-PL")}).` };
  if (next && entry.m3 > next.m3) return { error: `Odczyt wyższy niż następny (${next.m3.toLocaleString("pl-PL")}).` };
  const kws = [];
  if (prev) kws.push(intervals([prev, entry])[0].kw);
  if (next) kws.push(intervals([entry, next])[0].kw);
  const max = Math.max(...kws, 0);
  if (max > MAX_SANE_KW) return { warning: `Wychodzi ${max.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} kW — na pewno dobry odczyt?` };
  return {};
}

// "2d 3h", "12h", "2d" (rounded to the hour); minutes/seconds only for intervals under an hour: "45min", "1min 30s", "40s".
export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const totalH = Math.round(ms / HOUR);
  const parts = ms >= HOUR
    ? [Math.floor(totalH / 24) && `${Math.floor(totalH / 24)}d`, totalH % 24 && `${totalH % 24}h`]
    : [Math.floor(s / 60) && `${Math.floor(s / 60)}min`, s % 60 && `${s % 60}s`];
  return parts.filter(Boolean).join(' ') || '0s';
}

// Chart viewport: { start, end } in epoch ms, kept within [first, last] and never narrower than MIN_VIEW.
export const MIN_VIEW = 5 * DAY;

function clampSpan(span, first, last) {
  const total = last - first;
  return Math.min(Math.max(span, Math.min(MIN_VIEW, total)), total);
}

export function clampView(start, end, first, last) {
  const span = clampSpan(end - start, first, last);
  const s = Math.min(Math.max(start, first), last - span);
  return { start: s, end: s + span };
}

// factor > 1 zooms out, < 1 zooms in; the time under `anchor` stays put.
export function zoomView(view, factor, anchor, first, last) {
  const oldSpan = view.end - view.start;
  const span = clampSpan(oldSpan * factor, first, last);
  const start = anchor - (anchor - view.start) / oldSpan * span;
  return clampView(start, start + span, first, last);
}
