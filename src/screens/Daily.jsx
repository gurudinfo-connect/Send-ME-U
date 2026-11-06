import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Camera, Pencil, ArrowRight, Image as Img, Link2, CircleHelp, Search } from 'lucide-react';
import { BrandBar, DropMenu, PageTitle, ListSkeleton, ErrorState, useAsync } from '../components/ui';
import { api } from '../services/api';
import { useUI } from '../store';
import { StoryMedia } from '../stories/StoryMedia';

const PV = { image: Img, link: Link2, poll: CircleHelp };

// Daily tab — stories from your connections + channels you follow
export default function Daily() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const stories = useAsync(() => api.stories(), []);
  const channels = useAsync(() => api.channels(), []);
  const [menu, setMenu] = useState(false);
  const menuItems = [
    { key: 'channel', label: 'Create channel', onSelect: () => nav('/channels/new') },
    { key: 'status', label: 'Status privacy', onSelect: () => nav('/settings/status-privacy') },
    { key: 'starred', label: 'Starred', onSelect: () => nav('/starred') },
    { key: 'ads', label: 'Ad preferences', onSelect: () => nav('/settings/ads') },
  ];
  const mine = (stories.data || []).find((s) => s.mine);
  const others = (stories.data || []).filter((s) => !s.mine);

  return (
    <div className="screen">
      <BrandBar onSearch={() => notify('Search is coming soon')} onMore={() => setMenu((m) => !m)} moreOpen={menu} moreMenu={<DropMenu open={menu} onClose={() => setMenu(false)} items={menuItems} label="Daily menu" />} />
      <div className="scroll" style={{ padding: '0 0 120px' }}>
        <PageTitle title="Daily" sub="Stories & Updates from your connections" />

        {(() => {
          // my own uploaded stories (the built-in demo item doesn't count)
          const own = (mine?.items || []).filter((i) => !i.seed);
          const latest = own[own.length - 1];
          const open = () => nav(latest ? '/stories?u=s0&new=1' : '/stories/new');
          return (
            <div className={`my-story ${latest ? 'has' : ''}`} role="button" tabIndex={0} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
              aria-label={latest ? 'View my story' : 'Add to My Story'}>
              {latest
                ? <span className="ms-thumb"><StoryMedia item={{ ...latest, transform: { rot: latest.transform?.rot || 0, flip: latest.transform?.flip, fit: 'cover' } }} /></span>
                : mine?.cover && <img src={mine.cover} alt="" />}
              <span className="txt">
                <b>My Story</b>
                {latest
                  ? <span><Eye size={13} style={{ verticalAlign: '-2px' }} /> {own.length} {own.length === 1 ? 'update' : 'updates'} · {latest.ago}<br />Tap to view</span>
                  : <span>Add a story, share a moment with your connections</span>}
              </span>
              <button className="plus" aria-label="Add to my story" onClick={(e) => { e.stopPropagation(); nav('/stories/new'); }}><Plus size={30} /></button>
            </div>
          );
        })()}

        <div className="dstories" aria-label="Stories">
          {stories.loading && <ListSkeleton n={1} />}
          {others.map((s) => (
            <button key={s.id} className="dcard" onClick={() => nav(`/stories?u=${s.id}`)} aria-label={`Open ${s.name}'s story`}>
              <img className="bg" src={s.bg} alt="" />
              <span className="shade" />
              <span className="ring"><img src={s.avatar} alt="" /></span>
              <span className="lb">{s.name}</span>
            </button>
          ))}
        </div>
        {stories.error && <ErrorState message={stories.error} onRetry={stories.reload} />}

        <div className="sec-head">
          <div><h2>Channels</h2><p>Follow updates, news &amp; more</p></div>
          <button className="pill-cta" onClick={() => notify('Channel directory is coming soon')}>Explore <ArrowRight size={17} /></button>
        </div>
        {channels.loading && <div style={{ padding: '0 14px' }}><ListSkeleton n={3} /></div>}
        {channels.error && <ErrorState message={channels.error} onRetry={channels.reload} />}
        {(channels.data || []).map((c) => {
          const I = PV[c.icon];
          return (
            <button key={c.id} className="chan glass" onClick={() => notify(`${c.name} channel`)}>
              <img className="logo" src={c.logo} alt="" />
              <span className="meta">
                <span className="nm" style={{ display: 'block' }}>{c.name}</span>
                <span className="pv">{I && <I size={16} />}{c.last}</span>
              </span>
              <span className="rt"><span>{c.time}</span>{c.unread > 0 && <span className="ub">{c.unread}</span>}</span>
            </button>
          );
        })}
      </div>
      <div className="fab-stack">
        <button className="fab-mini glass" aria-label="Write a post" onClick={() => nav('/stories/new')}><Pencil size={22} /></button>
        <button className="fab-main" aria-label="New story" onClick={() => nav('/stories/new')}><Camera size={28} /><i>+</i></button>
      </div>
    </div>
  );
}
