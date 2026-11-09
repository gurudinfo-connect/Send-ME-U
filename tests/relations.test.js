import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewContent, followAction, followLabel, fmtCount, selectTab, timeAgo } from '../src/profile/relations.js';

test('public accounts are visible to everyone, private ones only to the owner and followers', () => {
  assert.equal(canViewContent({ isPrivate: false }), true);
  assert.equal(canViewContent({ isPrivate: true }), false);
  assert.equal(canViewContent({ isPrivate: true, isFollowing: true }), true);
  assert.equal(canViewContent({ isPrivate: true, isOwner: true }), true);
  // a pending request does not unlock anything
  assert.equal(canViewContent({ isPrivate: true, requested: true }), false);
});

test('follow button: follow, request, cancel the request, unfollow', () => {
  assert.equal(followAction({}), 'follow');
  assert.equal(followAction({ isPrivate: true }), 'request');
  assert.equal(followAction({ isPrivate: true, requested: true }), 'cancel');
  assert.equal(followAction({ isFollowing: true }), 'unfollow');
  assert.equal(followLabel({ isFollowing: true }), 'Following');
  assert.equal(followLabel({ requested: true, isPrivate: true }), 'Requested');
  assert.equal(followLabel({ isPrivate: true }), 'Follow request');
  assert.equal(followLabel({}), 'Follow');
});

test('counts are abbreviated like the rest of the app', () => {
  assert.deepEqual([0, 999, 1000, 1234, 1250, 15400, 2500000].map(fmtCount), ['0', '999', '1K', '1.2K', '1.3K', '15.4K', '2.5M']);
  assert.equal(fmtCount(undefined), '0');
});

const posts = [
  { id: 'a', userId: 'u1', type: 'image', createdAt: '2026-01-01', tagged: ['u2'] },
  { id: 'b', userId: 'u1', type: 'video', createdAt: '2026-01-03', tagged: [] },
  { id: 'c', userId: 'u1', type: 'image', createdAt: '2026-01-05', tagged: [] },
  { id: 'd', userId: 'u3', type: 'image', createdAt: '2026-01-04', tagged: ['u1'] },
  { id: 'e', userId: 'u2', type: 'video', createdAt: '2026-01-02', tagged: ['u1'] },
];

test('tabs split posts, reels and tagged, newest first', () => {
  assert.deepEqual(selectTab(posts, 'posts', 'u1').map((p) => p.id), ['c', 'a']);
  assert.deepEqual(selectTab(posts, 'reels', 'u1').map((p) => p.id), ['b']);
  assert.deepEqual(selectTab(posts, 'tagged', 'u1').map((p) => p.id), ['d', 'e']);
  assert.deepEqual(selectTab(posts, 'nope', 'u1'), []);
});

test('tagged only shows posts the viewer is allowed to see', () => {
  const canSee = (owner) => owner !== 'u3'; // u3 is private and not followed
  assert.deepEqual(selectTab(posts, 'tagged', 'u1', canSee).map((p) => p.id), ['e']);
});

test('timeAgo', () => {
  const now = Date.parse('2026-03-10T12:00:00Z');
  assert.equal(timeAgo('2026-03-10T11:59:50Z', now), 'just now');
  assert.equal(timeAgo('2026-03-10T11:30:00Z', now), '30m ago');
  assert.equal(timeAgo('2026-03-10T09:00:00Z', now), '3h ago');
  assert.equal(timeAgo('2026-03-07T12:00:00Z', now), '3d ago');
});
