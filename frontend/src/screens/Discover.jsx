import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plane, Music, Clapperboard, Dumbbell, Utensils, BookOpen, Plus, Check, X, Heart } from 'lucide-react';
import { Avatar, Modal, Button, ErrorState, Empty, Skeleton, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const CATS = [
  ['Travel', Plane, '#ffe1ec', '#ff8a00'], ['Music', Music, '#dff3ff', '#2f6bff'], ['Movies', Clapperboard, '#e9e2ff', '#1236c9'],
  ['Fitness', Dumbbell, '#ffe1ec', '#ff8a00'], ['Food', Utensils, '#ffeccf', '#f59e0b'], ['Books', BookOpen, '#dce6ff', '#2f6bff'],
];

export default function Discover() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [all, setAll] = useState(false);
  const [added, setAdded] = useState({});
  const [profile, setProfile] = useState(null);
  const people = useAsync(() => api.people({ interest: cat, q }), [cat, q]);
  const list = (people.data || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const shown = all || cat || q ? list : list.slice(0, 2);

  const act = async (kind, p) => {
    try {
      kind === 'follow' ? await api.follow(p.id) : await api.addFriend(p.id);
      setAdded((a) => ({ ...a, [`${kind}${p.id}`]: true })); notify(kind === 'follow' ? `Following ${p.name}` : `Request sent to ${p.name}`);
    } catch (e) { notify(errMsg(e)); }
  };

  return (
    <div className="screen">
      <header className="app-header">
        {searching ? (
          <label className="input" style={{ flex: 1, height: 42, borderRadius: 999 }}><Search size={16} /><input autoFocus placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /><button aria-label="Close search" onClick={() => { setSearching(false); setQ(''); }}><X size={16} /></button></label>
        ) : (<><div className="title">Discover</div><button className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Search size={22} /></button></>)}
      </header>
      <div className="scroll">
        <div className="hero-card" role="button" tabIndex={0} onClick={() => { setAll(true); setCat(null); notify('Showing people with similar interests'); }}>
          <Heart className="heart-art" size={78} color="#ff5c9a" fill="#ff5c9a" aria-hidden />
          <h2 className="h2" style={{ fontSize: 19 }}>Find People</h2>
          <p style={{ fontSize: 13, opacity: .95 }}>with Similar Interests</p>
        </div>
        <div className="cat-grid">
          {CATS.map(([n, I, bg, fg]) => (
            <button key={n} className={`cat ${cat === n ? 'sel' : ''}`} onClick={() => setCat(cat === n ? null : n)} aria-pressed={cat === n}>
              <span className="ic" style={{ background: bg, color: fg }}><I size={28} /></span>{n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px' }}>
          <h3 className="h2" style={{ fontSize: 17 }}>Trending People</h3>
          <button className="link" style={{ fontSize: 13 }} onClick={() => setAll(!all)}>{all ? 'Show less' : 'View All'}</button>
        </div>
        {people.loading && <div className="people-grid"><Skeleton h={190} /><Skeleton h={190} /></div>}
        {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
        {!people.loading && !people.error && shown.length === 0 && <Empty title="No one found" text="Try another interest or search." />}
        <div className="people-grid">
          {shown.map((p) => (
            <div key={p.id} className="card person">
              <button onClick={() => setProfile(p)} aria-label={`Open ${p.name}'s profile`}><Avatar src={p.avatar} size={72} /></button>
              <b>{p.name}</b><span className="muted" style={{ fontSize: 12 }}>{p.distance}</span>
              <button className={`add-btn ${added[`follow${p.id}`] ? 'done' : ''}`} onClick={() => act('follow', p)} aria-label={`Follow ${p.name}`}>
                {added[`follow${p.id}`] ? <Check size={18} /> : <Plus size={18} />}
              </button>
            </div>
          ))}
        </div>
      </div>
      <Modal open={!!profile} onClose={() => setProfile(null)}>
        {profile && (
          <div className="center">
            <Avatar src={profile.avatar} size={96} ring />
            <h3 className="h2" style={{ marginTop: 10 }}>{profile.name}</h3>
            <p className="muted">{profile.distance} · {profile.interests.join(', ')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              <Button onClick={() => act('follow', profile)}>{added[`follow${profile.id}`] ? 'Following' : 'Follow'}</Button>
              <Button variant="outline" onClick={() => act('friend', profile)}>{added[`friend${profile.id}`] ? 'Requested' : 'Add friend'}</Button>
            </div>
            <Button variant="login" style={{ marginTop: 10 }} onClick={async () => { const c = await api.createConversation({ name: profile.name, avatar: profile.avatar, userId: profile.id }); setProfile(null); nav(`/chats/${c.id}`); }}>Message</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
