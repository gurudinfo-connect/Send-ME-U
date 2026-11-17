import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Smile, Cat, Apple, Volleyball, Car, Lightbulb, Search, Delete, Camera, Plus, Check, Images, MapPin, User, FileText, AlignLeft, IndianRupee, CalendarDays, Sparkles, ChevronLeft } from 'lucide-react';

/* ------------------------------------------------------------------ *
 *  Emoji panel — category strip, search, 8-column grid, and a floating
 *  Emoji / GIFs / Stickers switch with a backspace button.
 *  Entries are "emoji keyword keyword…" so search can match by name.
 * ------------------------------------------------------------------ */
const SMILEYS = ['😀 grin happy', '😃 smile happy', '😄 smile laugh', '😁 grin beam', '😆 laugh', '😅 sweat laugh', '😂 joy tears laugh lol', '🤣 rofl laugh', '😊 blush smile', '😇 angel halo', '🙂 smile', '🙃 upside down', '😉 wink', '😌 relieved', '😍 heart eyes love', '🥰 love hearts', '😘 kiss', '😗 kiss', '😚 kiss', '😋 yum tongue', '😛 tongue', '😜 wink tongue', '🤪 crazy', '😝 tongue', '🤑 money', '🤗 hug', '🤭 oops giggle', '🤫 shush', '🤔 think', '😐 neutral', '😑 expressionless', '😶 silent', '😏 smirk', '😒 unamused', '🙄 eyeroll', '😬 grimace', '🤥 lie', '😔 sad pensive', '😪 sleepy', '😴 sleep', '😷 mask sick', '🤒 fever', '🤕 hurt', '🤢 nausea', '🥵 hot', '🥶 cold', '😵 dizzy', '🤯 mind blown', '🥳 party', '😎 cool sunglasses', '🤓 nerd', '😕 confused', '😟 worried', '😮 surprised wow', '😲 astonished', '😳 flushed', '🥺 pleading', '😢 cry sad', '😭 sob cry', '😱 scream fear', '😖 confounded', '😞 disappointed', '😓 sweat', '😩 weary', '😫 tired', '🥱 yawn', '😤 triumph', '😡 angry', '😠 mad', '🤬 swearing', '😈 devil', '💀 skull', '💩 poop', '🤡 clown', '👻 ghost', '👽 alien', '🤖 robot', '🙈 see no evil monkey', '🙉 hear no evil', '🙊 speak no evil', '💋 kiss lips', '❤️ heart love red', '🧡 orange heart', '💛 yellow heart', '💚 green heart', '💙 blue heart', '💜 purple heart', '🖤 black heart', '💔 broken heart', '💕 two hearts', '💞 revolving hearts', '💖 sparkling heart', '👍 thumbs up like', '👎 thumbs down', '👌 ok', '✌️ victory peace', '🤞 fingers crossed', '🤟 love you', '🤘 rock', '🤙 call me', '👋 wave hi', '👏 clap', '🙌 raised hands', '🙏 pray thanks please', '💪 strong muscle', '🤝 handshake', '✨ sparkles', '🔥 fire hot', '💯 hundred', '🎉 party tada'];
const ANIMALS = ['🐶 dog', '🐱 cat', '🐭 mouse', '🐹 hamster', '🐰 rabbit', '🦊 fox', '🐻 bear', '🐼 panda', '🐨 koala', '🐯 tiger', '🦁 lion', '🐮 cow', '🐷 pig', '🐸 frog', '🐵 monkey', '🐔 chicken', '🐧 penguin', '🐦 bird', '🦆 duck', '🦅 eagle', '🦉 owl', '🦇 bat', '🐺 wolf', '🐗 boar', '🐴 horse', '🦄 unicorn', '🐝 bee', '🐛 bug', '🦋 butterfly', '🐌 snail', '🐞 ladybug', '🐜 ant', '🐢 turtle', '🐍 snake', '🦎 lizard', '🐙 octopus', '🦑 squid', '🦀 crab', '🐠 fish', '🐬 dolphin', '🐳 whale', '🦈 shark', '🐘 elephant', '🦒 giraffe', '🐪 camel', '🌸 blossom flower', '🌹 rose', '🌻 sunflower', '🌷 tulip', '🌲 tree', '🌴 palm', '🌵 cactus', '🍀 clover luck', '🍁 leaf maple', '🌈 rainbow', '⭐ star', '🌙 moon', '☀️ sun', '⛅ cloud', '❄️ snow', '⚡ lightning', '🌊 wave ocean'];
const FOOD = ['🍎 apple', '🍐 pear', '🍊 orange', '🍋 lemon', '🍌 banana', '🍉 watermelon', '🍇 grapes', '🍓 strawberry', '🍒 cherries', '🍑 peach', '🥭 mango', '🍍 pineapple', '🥥 coconut', '🥝 kiwi', '🍅 tomato', '🥑 avocado', '🍆 eggplant', '🥕 carrot', '🌽 corn', '🌶️ chilli pepper', '🥔 potato', '🍞 bread', '🧀 cheese', '🍳 egg', '🥞 pancakes', '🍗 chicken leg', '🍖 meat', '🍔 burger', '🍟 fries', '🍕 pizza', '🌭 hotdog', '🌮 taco', '🌯 burrito', '🍜 noodles ramen', '🍝 pasta', '🍛 curry rice', '🍚 rice', '🍣 sushi', '🍤 shrimp', '🥟 dumpling', '🍦 ice cream', '🍩 donut', '🍪 cookie', '🎂 cake birthday', '🍰 cake', '🍫 chocolate', '🍬 candy', '🍿 popcorn', '☕ coffee tea', '🍵 green tea', '🥤 drink', '🍺 beer', '🍷 wine', '🥂 cheers', '🍹 cocktail'];
const ACTIVITY = ['⚽ football soccer', '🏀 basketball', '🏈 american football', '⚾ baseball', '🎾 tennis', '🏐 volleyball', '🏏 cricket', '🏓 ping pong', '🏸 badminton', '🥊 boxing', '🎯 dart target', '🎱 pool', '🎳 bowling', '⛳ golf', '🏆 trophy win', '🥇 gold medal', '🥈 silver medal', '🥉 bronze medal', '🎮 game controller', '🕹️ joystick', '🎲 dice', '♟️ chess', '🎨 art paint', '🎬 movie clapper', '🎤 microphone sing', '🎧 headphones music', '🎸 guitar', '🎹 piano', '🥁 drum', '🎺 trumpet', '🎻 violin', '🎭 theatre drama', '🧩 puzzle', '🏋️ gym weights', '🚴 cycling', '🏊 swim', '🧘 yoga', '🏃 run', '🎈 balloon', '🎁 gift present', '🎀 ribbon', '🎊 confetti'];
const TRAVEL = ['🚗 car', '🚕 taxi', '🚌 bus', '🚎 trolley', '🏎️ race car', '🚓 police', '🚑 ambulance', '🚒 fire engine', '🚚 truck', '🚜 tractor', '🏍️ motorbike', '🛵 scooter', '🚲 bicycle', '🚂 train', '🚆 train', '🚇 metro', '✈️ plane flight', '🚀 rocket', '🚁 helicopter', '⛵ boat sail', '🚢 ship', '⚓ anchor', '🗺️ map', '🧭 compass', '🏖️ beach', '🏝️ island', '⛰️ mountain', '🏕️ camping', '🏠 home house', '🏢 office building', '🏥 hospital', '🏫 school', '🏰 castle', '🗼 tower', '🗽 statue liberty', '⛪ church', '🕌 mosque', '🛕 temple', '🎡 ferris wheel', '🎢 roller coaster', '🌆 city', '🌃 night', '🌅 sunrise', '🌍 earth world'];
const OBJECTS = ['⌚ watch', '📱 phone mobile', '💻 laptop', '🖥️ computer', '⌨️ keyboard', '🖨️ printer', '📷 camera', '📹 video camera', '🎥 movie camera', '📞 telephone call', '📺 tv', '📻 radio', '⏰ alarm clock', '🔋 battery', '🔌 plug', '💡 idea bulb light', '🔦 flashlight', '💰 money bag', '💵 dollar cash', '💳 card', '💎 gem diamond', '🔧 wrench tool', '🔨 hammer', '⚙️ gear settings', '🧲 magnet', '💣 bomb', '🔒 lock', '🔑 key', '📦 package box', '✉️ envelope mail', '📧 email', '📝 memo note', '📁 folder', '📅 calendar', '📌 pin', '📎 paperclip', '✂️ scissors', '🖊️ pen', '📚 books', '📖 book', '🔍 search magnifier', '🎓 graduation', '👑 crown', '👓 glasses', '👜 bag', '👟 sneaker shoe', '👗 dress', '🧢 cap', '💄 lipstick', '🧸 teddy', '🛒 cart shopping', '🚿 shower', '🧼 soap', '💊 pill medicine', '🏳️‍🌈 pride flag', '🚩 flag', '❓ question', '❗ exclamation', '✅ check done', '❌ cross wrong', '⚠️ warning', '♻️ recycle'];

const parse = (arr) => arr.map((s) => { const i = s.indexOf(' '); return { e: s.slice(0, i), q: s.slice(i + 1) }; });
const CATS = [
  { k: 'recent', label: 'Recent', Icon: Clock },
  { k: 'smileys', label: 'Smileys and people', Icon: Smile, list: parse(SMILEYS) },
  { k: 'animals', label: 'Animals and nature', Icon: Cat, list: parse(ANIMALS) },
  { k: 'food', label: 'Food and drink', Icon: Apple, list: parse(FOOD) },
  { k: 'activity', label: 'Activities', Icon: Volleyball, list: parse(ACTIVITY) },
  { k: 'travel', label: 'Travel and places', Icon: Car, list: parse(TRAVEL) },
  { k: 'objects', label: 'Objects and symbols', Icon: Lightbulb, list: parse(OBJECTS) },
];
const ALL = CATS.flatMap((c) => c.list || []);
const DEFAULT_RECENT = ['😂', '😘', '❤️', '😍', '😊', '😁', '👍', '☺️', '😔', '😄', '😭', '💋', '😒', '😳', '😜', '🙈', '😉', '😃', '😢', '😝', '😱', '😡', '😏', '😞', '😅', '😚', '🙊', '😌', '😀', '😋', '😆', '👌', '😐', '😕'];
const RECENT_KEY = 'smu.recentEmoji';
const loadRecent = () => { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY)); if (Array.isArray(r) && r.length) return r; } catch { /* storage unavailable */ } return DEFAULT_RECENT; };

export function EmojiPanel({ onPick, onBackspace, notify }) {
  const [cat, setCat] = useState('recent');
  const [seg, setSeg] = useState('emoji');
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const gridRef = useRef(null);

  const pick = (e) => {
    onPick(e);
    setRecent((r) => {
      const next = [e, ...r.filter((x) => x !== e)].slice(0, 40);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };
  const needle = q.trim().toLowerCase();
  const items = useMemo(() => {
    if (needle) return ALL.filter((x) => x.q.includes(needle)).map((x) => x.e);
    if (cat === 'recent') return recent;
    return (CATS.find((c) => c.k === cat)?.list || []).map((x) => x.e);
  }, [needle, cat, recent]);
  useEffect(() => { gridRef.current?.scrollTo({ top: 0 }); }, [cat, needle, seg]);

  return (
    <div className="cv-panel" role="region" aria-label="Emoji, GIFs and stickers">
      {seg === 'emoji' && (
        <>
          <div className="cv-cats" role="tablist" aria-label="Emoji categories">
            {CATS.map(({ k, label, Icon }) => (
              <button key={k} type="button" role="tab" aria-selected={!needle && cat === k} aria-label={label} className={`cv-cat ${!needle && cat === k ? 'on' : ''}`} onClick={() => { setQ(''); setCat(k); }}><Icon size={26} strokeWidth={1.8} /></button>
            ))}
          </div>
          <label className="cv-search"><Search size={22} aria-hidden /><input placeholder="Search" aria-label="Search emoji" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="cv-grid" ref={gridRef} role="list">
            {items.map((e) => <button key={e} type="button" role="listitem" aria-label={`Emoji ${e}`} onClick={() => pick(e)}>{e}</button>)}
            {needle && items.length === 0 && <p className="cv-none">No emoji found</p>}
          </div>
        </>
      )}
      {seg !== 'emoji' && (
        <div className="cv-grid cv-soon">
          <p className="cv-none">{seg === 'gif' ? 'GIFs' : 'Stickers'} are coming soon</p>
        </div>
      )}
      <div className="cv-foot">
        <div className="cv-seg" role="tablist" aria-label="Panel">
          {[['emoji', 'Emoji'], ['gif', 'GIFs'], ['stk', 'Stickers']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={seg === k} className={seg === k ? 'on' : ''} onClick={() => { setSeg(k); if (k !== 'emoji') notify?.(`${l} are coming soon`); }}>{l}</button>
          ))}
        </div>
        <button type="button" className="cv-del" aria-label="Delete last character" onClick={onBackspace}><Delete size={28} strokeWidth={1.8} /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Attachment sheet — drag handle, 4x2 action grid (Gallery, Location,
 *  Contact, Document, Poll, Payment, Event, AI images) and a photo grid
 *  that starts with a Camera tile. Photos you pick show up as tiles with
 *  selection circles; "Send" sends the selected ones.
 * ------------------------------------------------------------------ */
export function AttachSheet({ onClose, onSend, onCamera, onLocation, onContact, notify }) {
  const [view, setView] = useState('home'); // home | contact
  const [picked, setPicked] = useState([]); // {id, url, file, video, on}
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const galleryRef = useRef(null);
  const docRef = useRef(null);
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addPicked = (list) => {
    const all = Array.from(list || []);
    const next = all.filter((f) => f.type.startsWith('image') || f.type.startsWith('video')).map((file) => {
      const url = URL.createObjectURL(file); urls.current.push(url);
      return { id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, url, file, video: file.type.startsWith('video'), on: true };
    });
    if (next.length !== all.length) notify?.('Only photos and videos can be sent for now');
    setPicked((p) => [...next, ...p]);
  };
  const toggle = (id) => setPicked((p) => p.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
  const sel = picked.filter((x) => x.on);
  const soon = (l) => () => notify?.(`${l} is coming soon`);
  const ACTIONS = [
    ['Gallery', Images, '#2f7bff', () => galleryRef.current?.click()],
    ['Location', MapPin, '#1fc99a', onLocation],
    ['Contact', User, '#2fa8ff', () => setView('contact')],
    ['Document', FileText, '#7a63ff', () => docRef.current?.click()],
    ['Poll', AlignLeft, '#ffb02e', soon('Poll')],
    ['Payment', IndianRupee, '#17b39a', soon('Payment')],
    ['Event', CalendarDays, '#ff3d8b', soon('Event')],
    ['AI images', Sparkles, '#2f7bff', soon('AI images')],
  ];

  return (
    <>
      <div className="as-scrim" onClick={onClose} />
      <div className="as-sheet" role="dialog" aria-modal="true" aria-label="Attach">
        <button type="button" className="as-handle" aria-label="Close attachments" onClick={onClose}><i /></button>
        <div className="as-body">
          {view === 'home' && (
            <>
              <div className="as-actions">
                {ACTIONS.map(([l, I, color, fn]) => (
                  <button key={l} type="button" className="as-act" onClick={fn}>
                    <span className="as-actic"><I size={30} color={color} strokeWidth={2.2} /></span>
                    <span>{l}</span>
                  </button>
                ))}
              </div>
              <div className="as-grid">
                <button type="button" className="as-tile as-cam" aria-label="Take a photo" onClick={onCamera}><Camera size={42} strokeWidth={1.8} /><span>Camera</span></button>
                {picked.map((x) => (
                  <button key={x.id} type="button" className="as-tile" aria-pressed={x.on} aria-label={`${x.video ? 'Video' : 'Photo'} ${x.on ? 'selected' : 'not selected'}`} onClick={() => toggle(x.id)}>
                    {x.video ? <video src={x.url} muted playsInline /> : <img src={x.url} alt="" />}
                    <span className={`as-circ ${x.on ? 'on' : ''}`}>{x.on && <Check size={18} strokeWidth={3.2} />}</span>
                  </button>
                ))}
                <button type="button" className="as-tile as-add" aria-label="Choose photos and videos" onClick={() => galleryRef.current?.click()}><Plus size={36} strokeWidth={1.8} /><span>{picked.length ? 'Add more' : 'Choose photos'}</span></button>
              </div>
            </>
          )}
          {view === 'contact' && (
            <div className="as-card as-form">
              <button type="button" className="as-back" onClick={() => setView('home')}><ChevronLeft size={22} /> Back</button>
              <span className="as-bigic"><User size={34} /></span>
              <b>Share a contact</b>
              <input placeholder="Name" aria-label="Contact name" maxLength={40} value={cName} onChange={(e) => setCName(e.target.value)} />
              <input placeholder="Phone number" aria-label="Contact phone" inputMode="tel" maxLength={20} value={cPhone} onChange={(e) => setCPhone(e.target.value.replace(/[^0-9+\- ]/g, ''))} />
              <button type="button" className="as-cta" disabled={!cName.trim()} onClick={() => onContact(cName.trim(), cPhone.trim())}>Send contact</button>
            </div>
          )}
        </div>
        {view === 'home' && sel.length > 0 && <button type="button" className="as-send" onClick={() => onSend(sel.map((x) => x.file))}>Send {sel.length} {sel.length === 1 ? 'photo' : 'photos'}</button>}
        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addPicked(e.target.files); e.target.value = ''; }} />
        <input ref={docRef} type="file" hidden onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) onSend(f); }} />
      </div>
    </>
  );
}
