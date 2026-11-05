import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTERS, getFilter, fitSize, coverCrop } from '../src/streaks/filters.js';

test('filters: unique ids, names and a valid default', () => {
  const ids = FILTERS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(FILTERS[0].id, 'normal');
  assert.equal(getFilter('does-not-exist').id, 'normal');
  FILTERS.forEach((f) => { assert.ok(f.name && f.css && f.swatch); if (f.overlay) assert.equal(typeof f.overlay, 'function'); });
});

test('fitSize keeps aspect ratio and never upscales', () => {
  assert.deepEqual(fitSize(720, 1280), [720, 1280]);
  const [w, h] = fitSize(4000, 3000); assert.equal(Math.max(w, h), 1440); assert.ok(Math.abs(w / h - 4 / 3) < 0.01);
});

test('coverCrop matches what an object-fit:cover viewfinder shows', () => {
  // wide video in a tall box: crop the sides
  const a = coverCrop(1280, 720, 390, 600); assert.equal(a.sh, 720); assert.equal(a.sx + a.sw / 2, 640); assert.ok(Math.abs(a.sw / a.sh - 390 / 600) < 0.01);
  // tall video in a wide box: crop top and bottom
  const b = coverCrop(720, 1280, 600, 390); assert.equal(b.sw, 720); assert.ok(Math.abs(b.sw / b.sh - 600 / 390) < 0.01);
  // same aspect: no crop
  assert.deepEqual(coverCrop(800, 600, 400, 300), { sx: 0, sy: 0, sw: 800, sh: 600 });
});
