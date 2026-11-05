import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, ChevronRight, SlidersHorizontal, UserPlus, Check, Users } from 'lucide-react';
import { BrandBar, GlassTabs, PageTitle, ListSkeleton, Empty, ErrorState, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const FILTERS = [['all', 'All'], ['friends', 'Friends'], ['followers', 'Followers'], ['following', 'Following'], ['groups', 'Groups']];

const Ring = ({ src, online, size }) => (
  <span className="avr" style={size ? { width: size, height: size } : undefined}>
    <img src={src} alt="" />{online && <i className="on" />}
  </span>
);

function PersonCard({ p, following, onToggle }) {
  return (
    <article className="pcard glass">
      <div className="top">
        <Ring src={p.avatar} online={p.online} />
        <div style={{ minWidth: 0, paddingRight: 14 }}>
          <div className="nm">{p.name}</div>
          <div className="hd">{p.handle}</div>
        </div>
        <button className="more" aria-label={`More about ${p.name}`}><MoreVertical size={18} /></button>
      </div>
      <p className="bio">{p.bio}</p>
      <div className="mut"><Users size={14} />{p.mutual} mutual friends</div>
      <div className="foot">
        <div className="st">
          <div><b>{p.followers}</b><span>Followers</span></div><i />
          <div><b>{p.following}</b><span>Following</span></div>
        </div>
        <button className={`fbtn ${following ? 'on' : ''}`} onClick={onToggle} aria-pressed={following}>
          {following ? <><Check size={15} />Following</> : <><UserPlus size={14} />Follow</>}
        </button>
      </div>
    </article>
  );
}

// Timeline tab — people you know and their recent activity
export default function Timeline() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState({});
  const [all, setAll] = useState(false);
  const people = useAsync(() => api.people({}), []);
  const activity = useAsync(() => api.activity(), []);
  useEffect(() => { if (people.data) setFollow(Object.fromEntries(people.data.map((p) => [p.id, !!p.isFollowing]))); }, [people.data]);

  const toggle = async (p) => {
    const next = !follow[p.id];
    setFollow((f) => ({ ...f, [p.id]: next }));
    try { await api.follow(p.id); } catch (e) { setFollow((f) => ({ ...f, [p.id]: !next })); notify(errMsg(e)); }
  };
  const match = (p) => filter === 'all' || (filter === 'friends' && p.friend) || (filter === 'followers' && p.follower) || (filter === 'following' && follow[p.id]);
  const list = (people.data || []).filter(match);
  const shown = all ? list : list.slice(0, 6);

  return (
    <div className="screen">
      <BrandBar bell onSearch={() => nav('/discover')} onMore={() => nav('/private')} />
      <div className="scroll" style={{ padding: '0 0 120px' }}>
        <PageTitle title="Timeline" sub="Your people, their moments" />
        <div className="filter-row" style={{ marginTop: 14 }}>
          <GlassTabs label="Filter people" items={FILTERS} value={filter} onChange={setFilter} />
          <button className="fchip round" aria-label="Filter options" onClick={() => nav('/discover')}><SlidersHorizontal size={20} /></button>
        </div>

        <div className="sec-head" style={{ margin: '16px 0 8px' }}>
          <h2 style={{ fontSize: 19 }}>People you know</h2>
          <button className="link-blue" onClick={() => setAll(!all)}>{all ? 'Show less' : 'See All'} <ChevronRight size={16} /></button>
        </div>
        {people.loading && <div style={{ padding: '0 14px' }}><ListSkeleton n={3} /></div>}
        {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
        {!people.loading && !people.error && list.length === 0 && <Empty icon={Users} title="No one here yet" text="People who match this filter will show up here." />}
        <div className="pgrid" key={filter}>{shown.map((p) => <PersonCard key={p.id} p={p} following={!!follow[p.id]} onToggle={() => toggle(p)} />)}</div>

        <div className="sec-head" style={{ margin: '18px 0 8px' }}>
          <h2 style={{ fontSize: 19 }}>Recent Activity</h2>
          <button className="link-blue" onClick={() => notify('You’re all caught up')}>View All <ChevronRight size={16} /></button>
        </div>
        {activity.loading && <div style={{ padding: '0 14px' }}><ListSkeleton n={2} /></div>}
        {activity.error && <ErrorState message={activity.error} onRetry={activity.reload} />}
        {(activity.data || []).map((a) => (
          <div key={a.id} className="act glass">
            <Ring src={a.avatar} size={46} />
            <div className="meta"><b>{a.name}</b><small>· {a.ago}</small><p>{a.text}</p></div>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <img className="th" src={a.thumb} alt="" />
              {a.more && <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 34, borderRadius: '0 10px 10px 0', background: 'rgba(30,30,40,.6)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15 }}>{a.more}</span>}
            </span>
            <button className="more" aria-label="More"><MoreVertical size={18} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
