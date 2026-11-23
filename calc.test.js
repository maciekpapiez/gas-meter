import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReading, intervals, windowStats, summary, validateEntry, formatDuration, KWH_PER_M3, DAY } from './calc.js';

const H = 3600 * 1000;
const t0 = Date.UTC(2026, 10, 1);

test('parseReading accepts comma, dot, spaces', () => {
  assert.equal(parseReading('01234,567'), 1234.567);
  assert.equal(parseReading(' 1234.5 '), 1234.5);
  assert.equal(parseReading('1 234,5'), 1234.5);
  assert.ok(Number.isNaN(parseReading('12a')));
  assert.ok(Number.isNaN(parseReading('')));
  assert.ok(Number.isNaN(parseReading('-1')));
});

test('intervals compute kWh and kW, sorted by time', () => {
  const ivs = intervals([{ ts: t0 + 10 * H, m3: 101 }, { ts: t0, m3: 100 }]);
  assert.equal(ivs.length, 1);
  assert.equal(ivs[0].kwh, KWH_PER_M3);
  assert.equal(ivs[0].kw, KWH_PER_M3 / 10);
});

test('windowStats is time-weighted, not interval-weighted', () => {
  // 1h at high power, then 99h at low power
  const entries = [
    { ts: t0, m3: 0 },
    { ts: t0 + 1 * H, m3: 1 },     // 11.4 kW
    { ts: t0 + 100 * H, m3: 2 },   // ~0.115 kW
  ];
  const s = windowStats(entries, t0, t0 + 100 * H);
  assert.equal(s.hours, 100);
  assert.ok(Math.abs(s.kw - 2 * KWH_PER_M3 / 100) < 1e-9);
});

test('windowStats prorates partially overlapping interval', () => {
  const entries = [{ ts: t0, m3: 0 }, { ts: t0 + 10 * H, m3: 10 }];
  const s = windowStats(entries, t0 + 5 * H, t0 + 10 * H);
  assert.equal(s.hours, 5);
  assert.ok(Math.abs(s.kwh - 5 * KWH_PER_M3) < 1e-9);
});

test('summary week window clipped to last 7 days', () => {
  const entries = [{ ts: t0, m3: 0 }, { ts: t0 + 14 * DAY, m3: 14 }];
  const s = summary(entries);
  assert.ok(Math.abs(s.week.hours - 7 * 24) < 1e-9);
  assert.ok(Math.abs(s.season.hours - 14 * 24) < 1e-9);
  assert.equal(summary([{ ts: t0, m3: 0 }]), null);
});

test('validateEntry blocks decreasing readings against both neighbours', () => {
  const entries = [{ ts: t0, m3: 100 }, { ts: t0 + 48 * H, m3: 110 }];
  assert.match(validateEntry(entries, { ts: t0 + 24 * H, m3: 99 }).error, /niższy/);
  assert.match(validateEntry(entries, { ts: t0 + 24 * H, m3: 111 }).error, /wyższy/);
  assert.deepEqual(validateEntry(entries, { ts: t0 + 24 * H, m3: 105 }), {});
  assert.match(validateEntry(entries, { ts: t0, m3: 100 }).error, /istnieje/);
});

test('validateEntry warns on implausible power', () => {
  const entries = [{ ts: t0, m3: 100 }];
  assert.ok(validateEntry(entries, { ts: t0 + 1 * H, m3: 110 }).warning); // 114 kW
  assert.deepEqual(validateEntry(entries, { ts: t0 + 12 * H, m3: 101 }), {});
});

test('formatDuration shows d/h, falls back to min/s under an hour', () => {
  assert.equal(formatDuration(12 * H), '12h');
  assert.equal(formatDuration(51 * H + 20 * 60e3), '2d 3h');
  assert.equal(formatDuration(11 * H + 50 * 60e3), '12h');
  assert.equal(formatDuration(23 * H + 40 * 60e3), '1d');
  assert.equal(formatDuration(59 * 60e3), '59min');
  assert.equal(formatDuration(2 * DAY), '2d');
  assert.equal(formatDuration(45 * 60e3), '45min');
  assert.equal(formatDuration(90e3), '1min 30s');
  assert.equal(formatDuration(40e3), '40s');
});
