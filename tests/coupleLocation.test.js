import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryFor, sessionActive, freshness, visibleLocation, validCoords, haversineKm, fmtDistance, ageLabel, timeLeftLabel, LIVE_MS, RECENT_MS, INACTIVITY_MS } from '../src/couple/location.js';
import { project, unproject, visibleTiles, fitPoints, panBy, pointOnScreen } from '../src/couple/geo.js';

const NOW = Date.UTC(2026, 10, 4, 10, 0);
const sess = (over = {}) => ({ is_active: true, started_at: new Date(NOW - 60e3).toISOString(), expires_at: new Date(NOW + 3600e3).toISOString(), stopped_at: null, ...over });
const loc = (ageMs) => ({ latitude: 12.97, longitude: 77.64, accuracy: 20, updated_at: new Date(NOW - ageMs).toISOString() });

test('expiry options', () => {
  assert.equal(expiryFor('15m', NOW), new Date(NOW + 15 * 60e3).toISOString());
  assert.equal(expiryFor('1h', NOW), new Date(NOW + 3600e3).toISOString());
  assert.equal(expiryFor('8h', NOW), new Date(NOW + 8 * 3600e3).toISOString());
  assert.equal(expiryFor('off', NOW), null);
  assert.equal(expiryFor('forever', NOW), undefined);
});

test('sessions expire, stop, and open-ended ones lapse when abandoned', () => {
  assert.equal(sessionActive(sess(), NOW), true);
  assert.equal(sessionActive(sess({ expires_at: new Date(NOW - 1).toISOString() }), NOW), false);
  assert.equal(sessionActive(sess({ stopped_at: new Date(NOW).toISOString() }), NOW), false);
  assert.equal(sessionActive(sess({ is_active: false }), NOW), false);
  assert.equal(sessionActive(null, NOW), false);
  const open = sess({ expires_at: null });
  assert.equal(sessionActive(open, NOW, NOW - 60e3), true);
  assert.equal(sessionActive(open, NOW, NOW - INACTIVITY_MS - 1), false);
});

test('freshness never calls old coordinates live', () => {
  assert.equal(freshness(new Date(NOW - 5e3).toISOString(), NOW), 'live');
  assert.equal(freshness(new Date(NOW - LIVE_MS - 1).toISOString(), NOW), 'recent');
  assert.equal(freshness(new Date(NOW - RECENT_MS - 1).toISOString(), NOW), 'stale');
  assert.equal(freshness(null, NOW), 'none');
});

test('visibleLocation hides everything without an active session', () => {
  assert.equal(visibleLocation({ session: null, location: loc(1000), now: NOW }), null);
  assert.equal(visibleLocation({ session: sess({ stopped_at: 'x' }), location: loc(1000), now: NOW }), null);
  assert.equal(visibleLocation({ session: sess(), location: null, now: NOW }), null);
  assert.equal(visibleLocation({ session: sess(), location: loc(1000), now: NOW }).freshness, 'live');
  assert.equal(visibleLocation({ session: sess(), location: loc(10 * 60e3), now: NOW }).freshness, 'stale'); // last known, flagged
  assert.equal(visibleLocation({ session: sess({ expires_at: new Date(NOW - 1).toISOString() }), location: loc(1000), now: NOW }), null);
});

test('coordinate validation', () => {
  assert.equal(validCoords(12.9, 77.6, 10), true);
  assert.equal(validCoords(91, 0), false);
  assert.equal(validCoords(0, 181), false);
  assert.equal(validCoords(NaN, 0), false);
  assert.equal(validCoords(1, 1, -5), false);
});

test('distance + labels', () => {
  const a = { latitude: 12.9716, longitude: 77.5946 }, b = { latitude: 12.9784, longitude: 77.6408 }; // MG Road -> Indiranagar ~ 5 km
  const d = haversineKm(a, b);
  assert.ok(d > 4.8 && d < 5.4, String(d));
  assert.equal(haversineKm(a, a), 0);
  assert.equal(fmtDistance(0.04), 'Very close');
  assert.equal(fmtDistance(0.43), '~450 m');
  assert.equal(fmtDistance(1.234), '~1.2 km');
  assert.equal(fmtDistance(12.6), '~13 km');
  assert.equal(ageLabel(new Date(NOW - 3000).toISOString(), NOW), 'just now');
  assert.equal(ageLabel(new Date(NOW - 125e3).toISOString(), NOW), '2 min ago');
  assert.equal(timeLeftLabel(new Date(NOW + 52 * 60e3).toISOString(), NOW), '52 min left');
  assert.equal(timeLeftLabel(null, NOW), 'until you stop');
});

test('map maths round-trips and tiles cover the viewport', () => {
  const p = project(12.9716, 77.5946, 14), q = unproject(p.x, p.y, 14);
  assert.ok(Math.abs(q.lat - 12.9716) < 1e-9 && Math.abs(q.lng - 77.5946) < 1e-9);
  const tiles = visibleTiles({ lat: 12.97, lng: 77.59, z: 14, width: 390, height: 300 });
  assert.ok(tiles.length >= 4 && tiles.length <= 12);
  assert.ok(tiles.every((t) => t.x >= 0 && t.x < 2 ** 14 && t.y >= 0));
  const fit = fitPoints([{ lat: 12.9716, lng: 77.5946 }, { lat: 12.9784, lng: 77.6408 }], 390, 300);
  for (const pt of [{ lat: 12.9716, lng: 77.5946 }, { lat: 12.9784, lng: 77.6408 }]) {
    const s = pointOnScreen({ ...pt, centre: fit, z: fit.z, width: 390, height: 300 });
    assert.ok(s.x > 0 && s.x < 390 && s.y > 0 && s.y < 300, JSON.stringify(s));
  }
  assert.equal(fitPoints([{ lat: 1, lng: 2 }], 300, 300).z, 15);
  const moved = panBy({ lat: 12.97, lng: 77.59 }, 14, 100, 0); // dragging right moves the centre west
  assert.ok(moved.lng < 77.59);
});
