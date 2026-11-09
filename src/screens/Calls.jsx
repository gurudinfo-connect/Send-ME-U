import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Video, ArrowUpRight, ArrowDownLeft, Search, Delete } from 'lucide-react';
import { BrandBar, DropMenu, PageTitle, Modal, Button, Empty, ListSkeleton, ErrorState, useAsync } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useUI } from '../store';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

// Calls tab — quick actions + recent call history
export default function Calls() {
  const nav = useNavigate();
  const notify = useUI((s) => s.notify);
  const calls = useAsync(() => api.calls(), []);
  const [sheet, setSheet] = useState(null); // 'call' | 'keypad'
  const [digits, setDigits] = useState('');
  const [menu, setMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const menuItems = [
    { key: 'clear', label: 'Clear call log', onSelect: () => setConfirmClear(true) },
    { key: 'sched', label: 'Scheduled calls', onSelect: () => nav('/calls/scheduled') },
  ];
  const list = (calls.data || []);

  const place = async (c, video) => {
    try { const k = await api.placeCall({ name: c.name, avatar: c.avatar, fav: !!c.fav, video: !!video }); calls.setData((d) => [k, ...(d || [])]); notify(`${video ? 'Video calling' : 'Calling'} ${c.name}…`); setSheet(null); }
    catch (e) { notify(errMsg(e)); }
  };
  const clear = async () => { try { await api.clearCalls(); calls.setData([]); setConfirmClear(false); notify('Call log cleared'); } catch (e) { notify(errMsg(e)); } };
  const unique = [...new Map((calls.data || []).map((c) => [c.name, c])).values()];
  const dialNow = () => { if (digits.length < 3) return notify('Enter a valid number'); place({ name: digits, avatar: '/assets/me.svg' }, false); setDigits(''); };

  const Dir = ({ d }) => d === 'missed' ? <span className="miss"><ArrowDownLeft size={20} strokeWidth={2.6} /></span> : d === 'in' ? <span className="inn"><ArrowDownLeft size={20} strokeWidth={2.6} /></span> : <span className="out"><ArrowUpRight size={20} strokeWidth={2.6} /></span>;

  return (
    <div className="screen">
      <BrandBar onSearch={() => setSheet('call')} onMore={() => setMenu((m) => !m)} moreOpen={menu} moreMenu={<DropMenu open={menu} onClose={() => setMenu(false)} items={menuItems} label="Calls menu" />} />
      <div className="scroll" style={{ padding: '0 0 120px' }}>
        <PageTitle title="Calls" sub="Make, schedule and manage your calls" />
        <div className="sec-head" style={{ margin: '20px 0 6px' }}>
          <h2>Recent</h2>
        </div>
        {calls.loading && <div style={{ padding: '0 18px' }}><ListSkeleton n={4} /></div>}
        {calls.error && <ErrorState message={calls.error} onRetry={calls.reload} />}
        {!calls.loading && !calls.error && list.length === 0 && <Empty icon={Phone} title="No recent calls" text="Calls you make or receive will show up here." />}
        {list.map((c) => (
          <div key={c.id} className={`call-row ${c.dir === 'missed' ? 'missed' : ''}`}>
            <span className="avr"><img src={c.avatar} alt="" /></span>
            <span className="meta">
              <span className="nm" style={{ display: 'block' }}>{c.name}</span>
              <span className="sub"><Dir d={c.dir} />{c.when}</span>
            </span>
            <span className="acts">
              {c.video
                ? <button aria-label={`Video call ${c.name}`} onClick={() => place(c, true)}><Video size={27} /></button>
                : <button aria-label={`Call ${c.name}`} onClick={() => place(c, false)}><Phone size={25} /></button>}
            </span>
          </div>
        ))}
      </div>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear call log?">
        <p className="muted" style={{ marginBottom: 14 }}>This removes every call from your Recent list. Scheduled calls are not affected.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button onClick={clear}>Clear</Button>
        </div>
      </Modal>

      <Modal open={sheet === 'call'} onClose={() => setSheet(null)} title="Who do you want to call?">
        {unique.length === 0 && <p className="muted">No contacts yet.</p>}
        {unique.map((c) => (
          <div key={c.id} className="call-row" style={{ padding: '8px 0' }}>
            <span className="avr"><img src={c.avatar} alt="" /></span>
            <span className="meta"><span className="nm" style={{ display: 'block' }}>{c.name}</span></span>
            <span className="acts">
              <button aria-label={`Call ${c.name}`} onClick={() => place(c, false)}><Phone size={24} /></button>
              <button aria-label={`Video call ${c.name}`} onClick={() => place(c, true)}><Video size={26} /></button>
            </span>
          </div>
        ))}
      </Modal>
      <Modal open={sheet === 'keypad'} onClose={() => setSheet(null)} title="Keypad">
        <div className="dial-out" aria-live="polite">{digits || '\u00A0'}</div>
        <div className="dial">
          {KEYS.map((k) => <button key={k} onClick={() => setDigits((d) => (d + k).slice(0, 15))}>{k}</button>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: 10 }}>
          <Button onClick={dialNow}><Phone size={18} /> Call</Button>
          <Button variant="outline" aria-label="Delete digit" onClick={() => setDigits((d) => d.slice(0, -1))}><Delete size={20} /></Button>
        </div>
      </Modal>
    </div>
  );
}
