// Pure rules for profiles, privacy and follow state. Used by the demo API and covered by tests/relations.test.js.
// The real backend (backend/src/people/routes.js) enforces the same rules in SQL.

// Can the viewer see this account's posts, followers and following?
export const canViewContent = ({ isOwner = false, isPrivate = false, isFollowing = false }) => !!isOwner || !isPrivate || !!isFollowing;

// What tapping the Follow button does, given the current relationship
export const followAction = ({ isPrivate = false, isFollowing = false, requested = false }) =>
  isFollowing ? 'unfollow' : requested ? 'cancel' : isPrivate ? 'request' : 'follow';

export const followLabel = ({ isFollowing = false, requested = false, isPrivate = false }) =>
  isFollowing ? 'Following' : requested ? 'Requested' : isPrivate ? 'Follow request' : 'Follow';

export const fmtCount = (n) => {
  n = Math.max(0, Number(n) || 0);
  if (n >= 1e6) return `${(Math.round(n / 1e5) / 10).toString().replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}K`;
  return String(n);
};

// Which posts belong to which profile tab. `canSee(ownerId)` says whether the viewer may see that owner's posts,
// so a tagged post from a private account the viewer doesn't follow never leaks into someone else's Tagged tab.
export function selectTab(posts, tab, userId, canSee = () => true) {
  const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const pick = {
    posts: (p) => p.userId === userId && p.type !== 'video',
    reels: (p) => p.userId === userId && p.type === 'video',
    tagged: (p) => p.userId !== userId && (p.tagged || []).includes(userId) && canSee(p.userId),
  }[tab];
  return pick ? posts.filter(pick).sort(byNewest) : [];
}

export const timeAgo = (iso, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - new Date(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
};
