import { useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, UserPlus, MessageCircle, Users, MapPin, Heart, Sparkles } from 'lucide-react';
import { AppHeader, Button, ErrorState, Skeleton, useAsync, clearAsyncCache } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useAuth, useUI } from '../store';

const Row = ({ icon: I, label, value }) => (
  <div className="ci-row"><I size={22} /><span className="grow"><span className="ci-label">{label}</span><small>{value}</small></span></div>
);

// Another person's profile, loaded by their id from the URL (/people/:id)
export default function PersonProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const me = useAuth((s) => s.user);
  const busy = useRef(false);
  const prof = useAsync(() => api.userProfile(id), [id]);
  if (me && String(me.id) === String(id)) return <Navigate to="/profile" replace />;

  const p = prof.data;
  const toggle = async () => {
    if (!p || busy.current) return;
    busy.current = true;
    const was = !!p.isFollowing;
    prof.setData((d) => ({ ...d, isFollowing: !was }));
    try {
      const r = await (was ? api.unfollow(id) : api.follow(id));
      prof.setData((d) => ({ ...d, isFollowing: r.following, ...(r.followers != null ? { followers: r.followers } : {}) }));
      clearAsyncCache();
    } catch (e) { prof.setData((d) => ({ ...d, isFollowing: was })); notify(errMsg(e)); }
    finally { busy.current = false; }
  };
  const message = async () => {
    try { const c = await api.directChat(id); nav(`/chats/${c.id}`); } catch (e) { notify(errMsg(e)); }
  };

  return (
    <div className="screen">
      <AppHeader back fallback="/timeline" title="Profile" />
      <div className="scroll ci-scroll" style={{ paddingBottom: 40 }}>
        {prof.loading && !p && (
          <div style={{ padding: '24px 18px', display: 'grid', gap: 14, justifyItems: 'center' }} aria-busy="true" aria-label="Loading profile">
            <Skeleton h={120} w={120} r={60} /><Skeleton h={26} w="55%" /><Skeleton h={16} w="35%" /><Skeleton h={70} />
          </div>
        )}
        {!prof.loading && !p && <ErrorState message={prof.error || 'This profile could not be loaded'} onRetry={prof.reload} />}
        {p && (
          <>
            <section className="ci-hero">
              <span className="avr" style={{ width: 120, height: 120, padding: 4 }}><img src={p.avatar} alt={p.name} />{p.online && <i className="on" style={{ width: 16, height: 16 }} />}</span>
              <h1>{p.name}</h1>
              <div className="ci-sub">{p.handle}</div>
              {p.bio && <p className="ci-sub small" style={{ maxWidth: 300 }}>{p.bio}</p>}
              <div className="pp-stats">
                <div><b>{p.followers}</b><span>Followers</span></div>
                <div><b>{p.following}</b><span>Following</span></div>
                <div><b>{p.mutual}</b><span>Mutual</span></div>
              </div>
              <div className="pp-actions">
                <button className={`fbtn ${p.isFollowing ? 'on' : ''}`} onClick={toggle} aria-pressed={!!p.isFollowing}>
                  {p.isFollowing ? <><Check size={15} />Following</> : <><UserPlus size={14} />Follow</>}
                </button>
                <Button variant="outline" onClick={message}><MessageCircle size={17} /> Message</Button>
              </div>
            </section>
            <div className="ci-card">
              <Row icon={Users} label="Mutual friends" value={`${p.mutual} mutual friends`} />
              {p.distance && <Row icon={MapPin} label="Distance" value={p.distance} />}
              {p.interests?.length > 0 && <Row icon={Sparkles} label="Interests" value={p.interests.join(', ')} />}
              {(p.friend || p.follower) && <Row icon={Heart} label="Connection" value={[p.friend && 'Friend', p.follower && 'Follows you'].filter(Boolean).join(' · ')} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
