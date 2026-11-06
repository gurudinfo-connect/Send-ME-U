import { sceneArt } from './art';

const A = (n, ext = 'png') => `/assets/${n}.${ext}`;
const now = Date.now();
const mins = (m) => new Date(now - m * 60000).toISOString();

export const me = { id: 'u0', name: 'Mr_Dgs', handle: 'mr__dgs', email: 'guru@example.com', phone: '+91 9987456321', about: '', links: 'Instagram', avatar: A('me', 'svg'), posts: 128, friends: 256, albums: 18, partnerId: 'u1' };

export const people = [
  { id: 'u1', name: 'Priya Sharma', handle: '@priya.sharma', bio: 'Tech Enthusiast | Traveler | Reader', mutual: 12, followers: '548', following: '312', avatar: A('tl-priya'), online: true, isFollowing: false, friend: true, follower: true, distance: '2 km away', interests: ['Travel'] },
  { id: 'u2', name: 'Rahul Verma', handle: '@rahul.verma', bio: 'Developer | AI & Data | Fitness', mutual: 8, followers: '1.2K', following: '460', avatar: A('tl-rahul'), online: true, isFollowing: true, friend: true, follower: true, distance: '3 km away', interests: ['Fitness'] },
  { id: 'u3', name: 'Anu Reddy', handle: '@anu.reddy', bio: 'UI/UX Designer | Creative Mind', mutual: 6, followers: '724', following: '398', avatar: A('tl-anu'), online: false, isFollowing: false, friend: false, follower: true, distance: '1 km away', interests: ['Music'] },
  { id: 'u4', name: 'Muthu Kumar', handle: '@muthu.kumar', bio: 'Product Analyst | Cricket | Travel', mutual: 15, followers: '986', following: '721', avatar: A('tl-muthu'), online: true, isFollowing: true, friend: true, follower: false, distance: '2 km away', interests: ['Food'] },
  { id: 'u5', name: 'Karthik', handle: '@karthik.s', bio: 'Programmer | Biker | Photography', mutual: 9, followers: '642', following: '380', avatar: A('tl-karthik'), online: false, isFollowing: false, friend: false, follower: false, distance: '4 km away', interests: ['Movies'] },
  { id: 'u6', name: 'Neha', handle: '@neha.j', bio: 'Data Analyst | Books | Music', mutual: 11, followers: '1.1K', following: '504', avatar: A('tl-neha'), online: false, isFollowing: false, friend: false, follower: true, distance: '5 km away', interests: ['Books'] },
];

export const conversations = [
  { id: 'c1', friendId: 'u1', type: 'direct', name: 'Priya', fullName: 'Priya Sharma', handle: '@priya.sharma', phone: '+91 98765 43210', about: 'Tech Enthusiast | Traveler | Reader', location: 'Bengaluru, India', joined: 'March 2024', heart: true, favorite: true, avatar: A('priya'), last: 'Hey! Are you free tonight? 😊', time: '10:42', unread: 2, online: true, kind: 'messages' },
  { id: 'c2', friendId: 'u2', type: 'direct', name: 'Rahul', fullName: 'Rahul Verma', handle: '@rahul.verma', phone: '+91 90123 45678', about: 'Developer | AI & Data | Fitness', location: 'Chennai, India', joined: 'June 2024', avatar: A('rahul'), last: 'Shared a photo 📸', time: '10:20', unread: 1, kind: 'messages' },
  { id: 'c5', friendId: 'u3', type: 'direct', name: 'Anu', fullName: 'Anu Reddy', handle: '@anu.reddy', about: 'UI/UX Designer | Creative Mind', avatar: A('tl-anu'), last: 'Sent you a sticker', time: 'Mon', unread: 0, kind: 'messages' },
  { id: 'c3', type: 'couple', name: 'Our Couple Space', heart: true, favorite: true, avatar: A('couple'), last: 'Anniversary in 12 days', time: 'Yesterday', unread: 0, kind: 'messages' },
  { id: 'c4', type: 'group', name: 'Friends Group', about: 'Weekend plans, memes and everything in between', created: 'Created by Mr_Dgs · 12 Jan 2025', memberIds: ['u0', 'u1', 'u2', 'u4'], avatar: A('friends'), last: "Let's plan this weekend!", time: 'Yesterday', unread: 0, kind: 'groups' },
];

// Daily: story cards (avatar ring + backdrop) — `items` feed the story viewer
export const stories = [
  { id: 's0', userId: 'u0', name: 'My Story', avatar: A('me', 'svg'), seen: false, mine: true, cover: A('mystory', 'jpg'), items: [{ id: 'm0', src: sceneArt('lake'), ago: '1h ago' }] },
  { id: 's1', userId: 'u7', name: 'Aanya 🎤', avatar: A('st-singer'), bg: A('stbg-singer', 'jpg'), items: [{ id: 'm1', src: sceneArt('sunset'), ago: '2h ago' }, { id: 'm2', src: sceneArt('mountain'), ago: '1h ago' }] },
  { id: 's2', userId: 'u8', name: 'Vikram', avatar: A('st-vinay'), bg: A('stbg-vinay', 'jpg'), items: [{ id: 'm3', src: sceneArt('lake'), ago: '3h ago' }] },
  { id: 's3', userId: 'u9', name: 'Chetan', avatar: A('st-chenna'), bg: A('stbg-chenna', 'jpg'), items: [{ id: 'm4', src: sceneArt('city'), ago: '5h ago' }] },
  { id: 's4', userId: 'u4', name: 'Muthu', avatar: A('st-muthu'), bg: A('stbg-muthu', 'jpg'), items: [{ id: 'm5', src: sceneArt('mountain'), ago: '6h ago' }] },
  { id: 's5', userId: 'u5', name: 'Karthik', avatar: A('st-karthik'), bg: A('stbg-karthik', 'jpg'), items: [{ id: 'm6', src: sceneArt('sunset'), ago: '8h ago' }] },
];

export const channels = [
  { id: 'ch1', name: 'Daily Smiles', logo: A('ch-nooneCares'), icon: 'image', last: 'Today’s good-news roundup 🌞', time: '9:07 AM', unread: 24, about: 'Small good things, every morning.', category: 'Entertainment' },
  { id: 'ch2', name: 'Campus Hiring Alerts', logo: A('ch-freshers'), icon: 'link', last: '👷 Graduate trainee roles open this week', time: '9:12 AM', unread: 58, about: 'Fresher and internship openings.', category: 'Jobs' },
  { id: 'ch3', name: 'Singing', logo: A('ch-singing', 'svg'), icon: 'image', last: '🎤 New cover song uploaded today', time: '8:35 AM', unread: 120, about: 'Vocals, covers and singing tips.', category: 'Entertainment' },
  { id: 'ch4', name: 'Classical Dance', logo: A('ch-dance', 'svg'), icon: 'image', last: '💃 Bharatanatyam practice clips', time: '8:30 AM', unread: 7, about: 'Classical dance forms, performances and practice.', category: 'Entertainment' },
  { id: 'ch5', name: 'Action', logo: A('ch-action', 'svg'), icon: 'link', last: '🔥 Best action scenes this week', time: '8:12 AM', unread: 0, about: 'Action movies, stunts and fight scenes.', category: 'Entertainment' },
  { id: 'ch6', name: 'Direction', logo: A('ch-direction', 'svg'), icon: 'poll', last: 'Poll: your favourite director?', time: '8:05 AM', unread: 3, about: 'Filmmaking, direction and storytelling.', category: 'Entertainment' },
];

export const activity = [
  { id: 'a1', userId: 'u1', name: 'Priya Sharma', avatar: A('tl-priya'), ago: '32 mins ago', text: 'Shared 4 photos from her weekend trip to Coorg 🌿', thumb: A('act-coorg', 'jpg'), more: '+3' },
  { id: 'a2', userId: 'u2', name: 'Rahul Verma', avatar: A('tl-rahul'), ago: '1 hour ago', text: 'Started a new project on Generative AI. 🚀', thumb: A('act-code', 'jpg') },
  { id: 'a3', userId: 'u3', name: 'Anu Reddy', avatar: A('tl-anu'), ago: '2 hours ago', text: 'Completed the UI redesign for our app! ✨', thumb: A('act-ui', 'jpg') },
];

// Demo call log (dates are relative to today so it always looks recent)
const dayLabel = (n, t) => `${n === 0 ? 'Today' : n === 1 ? 'Yesterday' : new Date(now - n * 864e5).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, ${t}`;
export const calls = [
  { id: 'k1', name: 'Meera Iyer', avatar: A('call-a1'), dir: 'out', when: dayLabel(0, '9:12 AM'), fav: false },
  { id: 'k2', name: 'Kabir Singh', avatar: A('venky'), dir: 'missed', when: dayLabel(0, '8:05 AM'), fav: true },
  { id: 'k3', name: 'Diya Nair', avatar: A('call-a2'), dir: 'in', when: dayLabel(1, '9:47 PM'), fav: false, video: true },
  { id: 'k4', name: 'Dad 🤍', avatar: A('daddy'), dir: 'out', when: dayLabel(1, '7:30 PM'), fav: true },
  { id: 'k5', name: 'Aarav Mehta', avatar: A('anil'), dir: 'in', when: dayLabel(2, '6:18 PM'), fav: false },
  { id: 'k6', name: 'Sana Khan', avatar: A('hr'), dir: 'missed', when: dayLabel(2, '1:02 PM'), fav: false, video: true },
  { id: 'k7', name: 'Priya Sharma', avatar: A('priya'), dir: 'out', when: dayLabel(3, '10:15 PM'), fav: true, video: true },
  { id: 'k8', name: 'Rohan Das', avatar: A('call-a3'), dir: 'in', when: dayLabel(4, '5:40 PM'), fav: false },
  { id: 'k9', name: 'Rahul Verma', avatar: A('rahul'), dir: 'out', when: dayLabel(5, '8:00 PM'), fav: false },
  { id: 'k10', name: 'Neha', avatar: A('tl-neha'), dir: 'missed', when: dayLabel(6, '11:20 AM'), fav: false },
];

const inDays = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
export const scheduledCalls = [
  { id: 'sc1', name: 'Priya Sharma', avatar: A('priya'), video: true, at: inDays(1, 19, 30), note: 'Movie night plan' },
  { id: 'sc2', name: 'Dad 🤍', avatar: A('daddy'), video: false, at: inDays(2, 9, 0), note: '' },
];

export const savedPlaces = [
  { id: 'l1', name: 'Home', address: 'Saved from your current location' },
  { id: 'l2', name: 'Our first date café', address: 'Indiranagar, Bengaluru' },
];

export const messagesFor = (cid) => [
  { id: 'm1', from: 'them', type: 'text', text: 'Hey! Are you free tonight? 😊', at: '2026-11-03T10:20:00', status: 'read' },
  { id: 'm2', from: 'me', type: 'text', text: 'Yes! I am. What’s the plan? 🤔', at: '2026-11-03T10:24:00', status: 'read' },
  { id: 'm3', from: 'them', type: 'text', text: 'How about a movie and dinner? 🍿🍽️', at: '2026-11-03T10:26:00', status: 'read' },
  { id: 'm4', from: 'me', type: 'text', text: 'Sounds perfect! 🎬 Which movie?', at: '2026-11-03T10:27:00', status: 'read' },
  { id: 'm5', from: 'them', type: 'video', src: A('vid-city', 'jpg'), hasPlay: true, duration: '2:18', at: '2026-11-03T10:29:00', status: 'read' },
  { id: 'm6', from: 'me', type: 'text', text: 'Wow! Let’s go for this one. 🔥', at: '2026-11-03T10:32:00', status: 'read' },
  { id: 'm7', from: 'them', type: 'text', text: 'Great! I’ll book the tickets. 🎟️', at: '2026-11-03T10:34:00', status: 'read' },
  { id: 'm8', from: 'me', type: 'text', text: 'Thanks! ❤️', at: '2026-11-03T10:35:00', status: 'read' },
];

export const events = [
  { id: 'e1', title: 'Our Anniversary', date: '2026-11-12', time: '19:00', kind: 'love', reminder: '1 day before', note: 'Dinner at our favourite place' },
  { id: 'e2', title: 'Birthday Celebration', date: '2026-11-18', time: '18:00', kind: 'cake', reminder: '2 hours before', note: "Rahul's birthday party" },
  { id: 'e3', title: 'Weekend Trip', date: '2026-11-22', time: '07:00', kind: 'trip', reminder: '1 day before', note: 'Coorg road trip' },
];

export const media = [
  { id: 'p1', type: 'video', album: 'Trips', src: sceneArt('sunset', 400, 300), duration: '0:45', date: '2026-10-20' },
  { id: 'p2', type: 'photo', album: 'Trips', src: sceneArt('mountain', 400, 320), date: '2026-10-12' },
  { id: 'p3', type: 'photo', album: 'Nature', src: sceneArt('flower', 400, 400), date: '2026-10-02' },
  { id: 'p4', type: 'photo', album: 'City', src: sceneArt('city', 400, 520), date: '2026-09-27' },
  { id: 'p5', type: 'photo', album: 'Couple', src: sceneArt('couple', 400, 520), date: '2026-09-14' },
  { id: 'p6', type: 'photo', album: 'Trips', src: sceneArt('lake', 400, 300), date: '2026-09-01' },
];
export const albums = ['Trips', 'Nature', 'City', 'Couple', 'Family'];

export const journal = [
  { id: 'j1', title: 'First trip together', body: 'Sunrise at the hills. Best morning ever.', date: '2026-08-14' },
];
export const goals = [
  { id: 'g1', title: 'Trip to Goa', done: false },
  { id: 'g2', title: 'Learn to cook together', done: true },
  { id: 'g3', title: 'Save for our first home', done: false },
];
export const couple = { startDate: '2026-02-20', anniversary: '2026-11-12', partner: people[0] };

export const notifications = [
  { id: 'n1', text: 'Priya liked your story', ago: '5m' },
  { id: 'n2', text: 'Rahul sent you a photo', ago: '1h' },
  { id: 'n3', text: 'Anniversary in 12 days ❤️', ago: '1d' },
];

// Who has seen / liked / replied to my story items (keyed by story item id).
// `liked` and `reply` are also mirrored into that person's chat (see api.js seedStoryChats).
export const storyViewers = {
  m0: [
    { userId: 'u1', name: 'Priya Sharma', avatar: A('tl-priya'), liked: true, reaction: '❤️', reply: 'Wow, what a view! 😍', ago: '12m ago' },
    { userId: 'u2', name: 'Rahul Verma', avatar: A('tl-rahul'), liked: true, reaction: '🔥', reply: null, ago: '25m ago' },
    { userId: 'u3', name: 'Anu Reddy', avatar: A('tl-anu'), liked: false, reaction: null, reply: 'Where is this place? 📍', ago: '40m ago' },
    { userId: 'u4', name: 'Muthu Kumar', avatar: A('tl-muthu'), liked: true, reaction: '❤️', reply: null, ago: '48m ago' },
    { userId: 'u5', name: 'Karthik', avatar: A('tl-karthik'), liked: false, reaction: null, reply: null, ago: '55m ago' },
  ],
};
