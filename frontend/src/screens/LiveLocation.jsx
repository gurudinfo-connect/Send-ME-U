import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Navigation, ShieldCheck, ShieldAlert, Heart, BellRing, ExternalLink } from 'lucide-react';
import { Avatar, AppHeader, Button, Modal, Empty, ErrorState, Skeleton, Toggle, useAsync } from '../components/ui';
import SlippyMap from '../couple/SlippyMap';
import { api, errMsg, USE_MOCK } from '../services/api';
import { subscribeCouple } from '../services/socket';
import { useDemoPartnerSim } from '../services/coupleService';
import { useAuth, useUI } from '../store';
import { DURATION_LABELS, freshness, haversineKm, fmtDistance, ageLabel, timeLeftLabel, sessionActive } from '../couple/location';
import { ms } from '../couple/scheduling';

// Also used as the Location page (/private/locations) with its own title, back target, header button and a taller map.
export default function LiveLocation({ title = null, back = true, fallback = '/private/couple', headerRight = null, mapHeight = 300, extraMarkers = [], onExtraMarker = null, children = null }) {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const notify = useUI((s) => s.notify);
  const couple = useAsync(() => api.couple(), []);
  const partner = couple.data?.partner;
  const first = (partner?.name || 'your partner').split(' ')[0];

  const [st, setSt] = useState(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loadErr, setLoadErr] = useState('');
  const [picker, setPicker] = useState(false);
  const [starting, setStarting] = useState(false);
  const [perm, setPerm] = useState('prompt');          // granted | denied | prompt | unsupported
  const [problem, setProblem] = useState('');          // permission / GPS problem shown inline
  const [pickId, setPickId] = useState(null);
  const [here, setHere] = useState(null);           // my position on THIS device only, never sent anywhere

  const refresh = useCallback(async () => {
    try { const s = await api.locationState(); setSt(s); setSkew(s.serverTime ? ms(s.serverTime) - Date.now() : 0); setLoadErr(''); }
    catch (e) { setLoadErr(errMsg(e)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => subscribeCouple((n) => { if (n.startsWith('location:') || n === 'socket:reconnected') refresh(); }), [refresh]);
  useEffect(() => useDemoPartnerSim(USE_MOCK), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!navigator.permissions?.query) { setPerm(navigator.geolocation ? 'prompt' : 'unsupported'); return undefined; }
    let status;
    navigator.permissions.query({ name: 'geolocation' }).then((p) => { status = p; setPerm(p.state); p.onchange = () => setPerm(p.state); }).catch(() => setPerm('prompt'));
    return () => { if (status) status.onchange = null; };
  }, []);

  const t = now + skew;                               // server-aligned clock
  const mySession = st?.session && sessionActive(st.session, t, st.me?.updated_at) ? st.session : null;
  const sharing = !!mySession;
  const meLoc = sharing ? st?.me : null;
  const partnerLoc = st?.partner && !(st.partner.expires_at && ms(st.partner.expires_at) <= t) ? { ...st.partner, freshness: freshness(st.partner.updated_at, t) } : null;
  const partnerSharing = !!st?.partnerSharing && !(st?.partner?.expires_at && ms(st.partner.expires_at) <= t);
  const dist = meLoc && partnerLoc ? haversineKm(meLoc, partnerLoc) : null;
  const myFresh = meLoc ? freshness(meLoc.updated_at, t) : 'none';

  const markers = useMemo(() => {
    const out = [];
    if (meLoc) out.push({ id: 'me', lat: meLoc.latitude, lng: meLoc.longitude, avatar: user?.avatar, name: 'You', accuracy: meLoc.accuracy, live: myFresh === 'live', dim: myFresh === 'stale' });
    if (!meLoc && here) out.push({ id: 'here', lat: here.latitude, lng: here.longitude, avatar: user?.avatar, name: 'You', accuracy: here.accuracy, live: true, dim: false });
    if (partnerLoc) out.push({ id: 'partner', lat: partnerLoc.latitude, lng: partnerLoc.longitude, avatar: partner?.avatar, name: first, accuracy: partnerLoc.accuracy, live: partnerLoc.freshness === 'live', dim: partnerLoc.freshness === 'stale' });
    return [...out, ...extraMarkers];
  }, [meLoc, partnerLoc, here, myFresh, user?.avatar, partner?.avatar, first, extraMarkers]);

  const begin = async (duration) => {
    setProblem('');
    if (!navigator.geolocation) { setPicker(false); return setProblem('unsupported'); }
    setStarting(true);
    // Ask for permission and get a first fix BEFORE a session exists, so nothing is shared if the person says no.
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await api.startLocation({ duration });
        await api.pushLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setPicker(false); await refresh(); notify(`Sharing with ${first}`);
      } catch (e) { setProblem(errMsg(e)); } finally { setStarting(false); }
    }, (err) => {
      setStarting(false); setPicker(false);
      setProblem(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable');
      if (err.code === 1) setPerm('denied');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  // Shows where I am on the map without sharing it. Only runs when the person taps the button, so the browser asks for permission then.
  const locateMe = () => {
    setProblem('');
    if (!navigator.geolocation) return setProblem('unsupported');
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => { setProblem(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'); if (err.code === 1) setPerm('denied'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };
  const stop = async () => { try { await api.stopLocation(); await refresh(); notify('Stopped sharing. Your location was removed.'); } catch (e) { notify(errMsg(e)); } };
  const ask = async () => { try { await api.requestLocation(); notify(`Asked ${first} to share`); } catch (e) { notify(errMsg(e)); } };
  const onToggle = (on) => (on ? (setProblem(''), setPicker(true)) : stop());

  const picked = pickId === 'me' ? { who: 'You', loc: meLoc, fresh: myFresh } : pickId === 'partner' ? { who: first, loc: partnerLoc, fresh: partnerLoc?.freshness } : null;

  return (
    <div className="screen ll-screen">
      <AppHeader back={back} fallback={fallback} right={headerRight} title={title || <>Live Location <MapPin size={18} color="#7a5af0" /></>} />
      <div className="scroll">
        {(couple.loading || (partner && !st && !loadErr)) && <><Skeleton h={300} r={20} /><div style={{ height: 12 }} /><Skeleton h={120} r={18} /></>}
        {couple.error && <ErrorState message={couple.error} onRetry={couple.reload} />}
        {loadErr && !st && partner && <ErrorState message={loadErr} onRetry={refresh} />}

        {couple.data && (!partner || st) && (
          <div className="ll-mapbox">
            <SlippyMap markers={markers} selectedId={pickId} onMarker={(id) => (String(id).startsWith('place:') ? onExtraMarker?.(id) : id !== 'here' && setPickId(id))} height={mapHeight} />
            {markers.length === 0 && <div className="ll-empty-map"><MapPin size={22} /><b>{partner ? 'No one is sharing right now' : 'Where are you?'}</b><small>{partner ? `Turn on sharing below, or ask ${first} to share.` : 'Tap "Show my location" to see yourself on the map.'}</small></div>}
            {sharing && <div className="ll-pill" role="status"><i className="ll-pulse" aria-hidden /> Sharing live · {timeLeftLabel(mySession.expires_at, t)}</div>}
          </div>
        )}
        {couple.data && (!partner || st) && !meLoc && (
          <Button variant="outline" className="btn-sm ll-here" onClick={locateMe}><Navigation size={15} /> {here ? 'Update my location' : 'Show my location'}</Button>
        )}
        {couple.data && !partner && problem && <Problem kind={problem} onRetry={locateMe} />}

        {couple.data && !partner && <Empty icon={Heart} title="Link your partner to share" text="Live location can only be shared with the person you are linked to. You can still see yourself on the map." action={<Button className="btn-sm" onClick={() => nav('/private/couple/invite')}>Invite partner</Button>} />}

        {partner && st && (<>

          <div className="ll-card">
            <div className="ll-row">
              <span className="ll-ic"><Navigation size={20} /></span>
              <span className="grow"><b>Share my live location</b><small>{sharing ? `Only ${first} can see it` : 'Off. Nobody can see where you are.'}</small></span>
              <Toggle on={sharing} onChange={onToggle} label="Share my live location" />
            </div>
            {sharing && (
              <div className="ll-status">
                <span className={`ll-fresh ${myFresh}`}>{myFresh === 'live' ? 'Live' : myFresh === 'recent' ? 'Updating' : 'Not updating'}</span>
                <span>Last updated {meLoc ? ageLabel(meLoc.updated_at, t) : 'never'}</span>
                {myFresh === 'stale' && <small>Keep Send ME/U open so {first} sees where you are now.</small>}
                <Button variant="outline" className="btn-sm" onClick={stop}>Stop sharing now</Button>
              </div>
            )}
            {problem && <Problem kind={problem} onRetry={() => setPicker(true)} />}
            {perm === 'denied' && !problem && !sharing && <p className="ll-warn"><ShieldAlert size={15} /> Location access is blocked for this site. Allow it in your browser or phone settings to share.</p>}
          </div>

          <div className="ll-card">
            <div className="ll-row">
              <Avatar src={partner.avatar} size={44} />
              <span className="grow"><b>{partner.name}</b><small>{partnerText(partnerLoc, partnerSharing, t)}</small></span>
              {partnerLoc && <span className={`ll-fresh ${partnerLoc.freshness}`}>{partnerLoc.freshness === 'live' ? 'Live' : partnerLoc.freshness === 'recent' ? 'Recent' : 'Last known'}</span>}
            </div>
            {dist != null && <p className="ll-dist"><MapPin size={15} /> About {fmtDistance(dist).replace('~', '')} away{partnerLoc.freshness === 'stale' ? ' (from their last known spot)' : ''}</p>}
            {!partnerSharing && <Button variant="outline" className="btn-sm" style={{ marginTop: 10 }} onClick={ask}><BellRing size={15} /> Ask {first} to share</Button>}
            {partnerLoc && <Button variant="outline" className="btn-sm" style={{ marginTop: 10 }} onClick={() => setPickId('partner')}>View details</Button>}
          </div>

          <p className="ll-privacy"><ShieldCheck size={15} /> You each choose whether to share. Sharing ends automatically, no location history is kept, and only your linked partner can ever see it.</p>
        </>)}
        {children}
      </div>

      <Modal open={picker} onClose={() => !starting && setPicker(false)} title="Share for how long?">
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>{first} will see where you are on the map. You can stop at any time.</p>
        {DURATION_LABELS.map(([k, l]) => <button key={k} className="menu-row" disabled={starting} onClick={() => begin(k)}><span className="grow">{l}</span></button>)}
        {starting && <p className="muted center" role="status">Getting your location…</p>}
      </Modal>

      <Modal open={!!picked && !!picked.loc} onClose={() => setPickId(null)} title={picked?.who === 'You' ? 'Your shared location' : `${picked?.who}'s shared location`}>
        {picked?.loc && (<div className="ll-detail">
          <p><b>{picked.fresh === 'live' ? 'Live' : picked.fresh === 'recent' ? 'Recently updated' : 'Last known location, not live'}</b></p>
          <p>Updated {ageLabel(picked.loc.updated_at, t)}</p>
          {picked.loc.accuracy != null && <p>Accuracy about {Math.round(picked.loc.accuracy)} m</p>}
          {dist != null && picked.who !== 'You' && <p>About {fmtDistance(dist).replace('~', '')} from you</p>}
          <p>{picked.loc.expires_at ? timeLeftLabel(picked.loc.expires_at, t) : picked.who === 'You' ? timeLeftLabel(mySession?.expires_at, t) : 'Sharing until they stop'}</p>
          <a className="btn btn-outline btn-sm" href={`https://www.google.com/maps?q=${picked.loc.latitude},${picked.loc.longitude}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open in Maps</a>
        </div>)}
      </Modal>
    </div>
  );
}

function partnerText(loc, sharing, t) {
  if (loc) return loc.freshness === 'live' ? `Live · updated ${ageLabel(loc.updated_at, t)}` : loc.freshness === 'recent' ? `Updated ${ageLabel(loc.updated_at, t)}` : `Last seen ${ageLabel(loc.updated_at, t)}. Not live.`;
  return sharing ? 'Sharing started. Waiting for their first location.' : 'Not sharing their location';
}

function Problem({ kind, onRetry }) {
  const msg = {
    denied: 'Location access was denied, so nothing is being shared. Allow location for this site in your browser or phone settings, then try again.',
    unsupported: 'This device or browser cannot share location.',
    timeout: 'Your location took too long to load. Move somewhere with a better signal and try again.',
    unavailable: 'Your location is not available right now. Check that location services are on.',
  }[kind];
  return (
    <div className="ll-problem" role="alert">
      <ShieldAlert size={18} /><span>{msg || kind}</span>
      {kind !== 'unsupported' && <Button variant="outline" className="btn-sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
