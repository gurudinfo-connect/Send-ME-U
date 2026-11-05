// Everything the "You" hub shows: the main menu, plus the settings that live inside each page.
// Page items are plain data so the same definition drives the page, the search box and the stored value.
//
// Item types
//   toggle  { k, label, desc, def }                      on/off, stored in useUI.settings[k]
//   choice  { k, label, def, options:[{v,label,desc}] }  pick one in a sheet, stored in settings[k]
//   multi   { k, label, def:[], options:[{v,label}] }    pick several in a sheet, stored in settings[k]
//   link    { label, desc, to }                          opens another screen
//   action  { label, desc, id, danger }                  runs a handler from YouPages (download, clear cache ...)
//   info    { label, value }                             read-only
//   note    { text }                                     small helper text
// `desc` / `value` may be functions of ctx = { user, settings }.
import {
  IndianRupee, Gem, KeyRound, Lock, BookUser, MessageSquareText, Palette, Megaphone, Bell, Database,
  ShieldCheck, Accessibility, Globe, CircleHelp, UserPlus, RefreshCw, Heart, Image, Flame, Compass,
  CircleDot, Smartphone, Star, Sparkles,
} from 'lucide-react';

export const LANGUAGES = [
  ['en', 'English', "device's language"], ['ta', 'தமிழ்', 'Tamil'], ['te', 'తెలుగు', 'Telugu'], ['hi', 'हिन्दी', 'Hindi'],
  ['kn', 'ಕನ್ನಡ', 'Kannada'], ['ml', 'മലയാളം', 'Malayalam'], ['mr', 'मराठी', 'Marathi'], ['bn', 'বাংলা', 'Bengali'],
  ['gu', 'ગુજરાતી', 'Gujarati'], ['pa', 'ਪੰਜਾਬੀ', 'Punjabi'], ['ur', 'اردو', 'Urdu'], ['es', 'Español', 'Spanish'],
  ['fr', 'Français', 'French'], ['ar', 'العربية', 'Arabic'],
];
export const langLabel = (code = 'en') => {
  const l = LANGUAGES.find((x) => x[0] === code) || LANGUAGES[0];
  return code === 'en' ? "English (device's language)" : `${l[1]} (${l[2]})`;
};

const WHO = [{ v: 'everyone', label: 'Everyone' }, { v: 'contacts', label: 'My contacts' }, { v: 'nobody', label: 'Nobody' }];
const TONES = [{ v: 'default', label: 'Default' }, { v: 'chime', label: 'Chime' }, { v: 'bubble', label: 'Bubble' }, { v: 'pop', label: 'Pop' }, { v: 'silent', label: 'Silent' }];
const VIBES = [{ v: 'off', label: 'Off' }, { v: 'default', label: 'Default' }, { v: 'short', label: 'Short' }, { v: 'long', label: 'Long' }];
const MEDIA = [{ v: 'photos', label: 'Photos' }, { v: 'audio', label: 'Audio' }, { v: 'videos', label: 'Videos' }, { v: 'docs', label: 'Documents' }];

export const FAQS = [
  ['How do I link my partner?', 'Open Private Space → Couple Space → Invitations & linking and send an invite.'],
  ['Are my chats private?', 'Messages travel over HTTPS/WSS to your server. Turn on two-step verification in Account for extra safety.'],
  ['How do I delete a memory?', 'Open it in Memories and tap Delete, or long-press to select several.'],
  ['How do streaks work?', 'Send a snap every day to keep a streak alive. Miss a day and the streak resets.'],
  ['How do I hide a chat?', 'Lock it from the chat menu. Locked chats live in Private Space behind your PIN.'],
  ['How do I change my number?', 'Account → Change number. Your chats and contacts stay as they are.'],
  ['How do I block someone?', 'Open their chat → menu → Block. Manage the list in Privacy → Blocked contacts.'],
];

export const PAGES = {
  account: {
    title: 'Account',
    sections: [
      { items: [
        { t: 'toggle', k: 'secNotif', label: 'Security notifications', desc: 'Get notified when your security code changes or a new device signs in', def: true },
        { t: 'toggle', k: 'twoFactor', label: 'Two-step verification', desc: 'Ask for an extra code when you sign in on a new device', def: false },
        { t: 'info', label: 'Email address', value: ({ user }) => user?.email || 'Not set' },
        { t: 'link', label: 'Change number', desc: ({ user }) => user?.phone || 'Add your phone number', to: '/you/change-number' },
        { t: 'link', label: 'Change password', desc: 'Reset it by email', to: '/forgot-password' },
      ] },
      { items: [
        { t: 'action', id: 'exportData', label: 'Request account info', desc: 'Download a copy of your profile and settings' },
        { t: 'link', label: 'Delete account', desc: 'Permanently remove your account and data', to: '/you/delete-account', danger: true },
      ] },
    ],
  },
  privacy: {
    title: 'Privacy',
    sections: [
      { h: 'Who can see my personal info', items: [
        { t: 'choice', k: 'lastSeenWho', label: 'Last seen and online', def: 'everyone', options: WHO },
        { t: 'choice', k: 'photoWho', label: 'Profile photo', def: 'everyone', options: WHO },
        { t: 'choice', k: 'aboutWho', label: 'About', def: 'everyone', options: WHO },
        { t: 'link', label: 'Status privacy', desc: 'Choose who can see your daily status', to: '/settings/status-privacy' },
      ] },
      { items: [
        { t: 'toggle', k: 'readReceipts', label: 'Read receipts', desc: "If turned off, you won't send or receive read receipts. Receipts are always sent in group chats.", def: true },
      ] },
      { h: 'Disappearing messages', items: [
        { t: 'choice', k: 'defaultTimer', label: 'Default message timer', def: 'off', options: [{ v: 'off', label: 'Off' }, { v: '24h', label: '24 hours' }, { v: '7d', label: '7 days' }, { v: '90d', label: '90 days' }], note: 'Start new chats with disappearing messages set to your timer.' },
      ] },
      { h: 'Contacts and groups', items: [
        { t: 'choice', k: 'groupWho', label: 'Groups', desc: 'Who can add you to groups', def: 'everyone', options: WHO },
        { t: 'link', label: 'Blocked contacts', desc: 'See and unblock people', to: '/you/blocked' },
      ] },
      { h: 'Protection', items: [
        { t: 'link', label: 'Private Space lock', desc: 'PIN-protected chats and couple space', to: '/private' },
        { t: 'toggle', k: 'noLinkPreview', label: 'Disable link previews', desc: 'Stop previews from loading when someone sends a link', def: false },
      ] },
    ],
  },
  chats: {
    title: 'Chats',
    sections: [
      { h: 'Display', items: [
        { t: 'link', label: 'Theme', desc: ({ themeLabel }) => themeLabel, to: '/you/appearance' },
      ] },
      { h: 'Chat settings', items: [
        { t: 'toggle', k: 'enterSend', label: 'Enter is send', desc: 'Enter key will send your message', def: true },
        { t: 'toggle', k: 'mediaVis', label: 'Media visibility', desc: "Show newly downloaded media in your device's gallery", def: true },
        { t: 'toggle', k: 'keepArchived', label: 'Keep chats archived', desc: 'Archived chats will stay archived when you receive a new message', def: true },
      ] },
      { h: 'Chat history', items: [
        { t: 'toggle', k: 'autoBackup', label: 'Chat backup', desc: 'Back up your chats to your server when you are online', def: false },
        { t: 'choice', k: 'backupFreq', label: 'Back up frequency', def: 'weekly', options: [{ v: 'daily', label: 'Daily' }, { v: 'weekly', label: 'Weekly' }, { v: 'monthly', label: 'Monthly' }] },
        { t: 'action', id: 'exportChats', label: 'Export chat list', desc: 'Download your chats as a file' },
        { t: 'action', id: 'clearStars', label: 'Clear starred messages', desc: 'Remove the star from every message', danger: true },
      ] },
    ],
  },
  notifications: {
    title: 'Notifications',
    sections: [
      { items: [
        { t: 'toggle', k: 'convTones', label: 'Conversation tones', desc: 'Play sounds for incoming and outgoing messages', def: true },
        { t: 'action', id: 'askNotif', label: 'Browser notifications', desc: () => (typeof Notification === 'undefined' ? 'Not supported on this device' : { granted: 'Allowed on this device', denied: 'Blocked — enable in your browser settings', default: 'Tap to allow notifications' }[Notification.permission]) },
      ] },
      { h: 'Messages', items: [
        { t: 'toggle', k: 'notifications', label: 'Show notifications', desc: 'Notify me about new messages', def: true },
        { t: 'choice', k: 'msgTone', label: 'Notification tone', def: 'default', options: TONES },
        { t: 'choice', k: 'msgVibrate', label: 'Vibrate', def: 'default', options: VIBES },
        { t: 'toggle', k: 'previews', label: 'Show previews', desc: 'Show message text inside notifications', def: true },
      ] },
      { h: 'Groups', items: [
        { t: 'toggle', k: 'groupNotifs', label: 'Group notifications', desc: 'Notify me about new group messages', def: true },
        { t: 'choice', k: 'groupTone', label: 'Notification tone', def: 'default', options: TONES },
      ] },
      { h: 'Calls', items: [
        { t: 'choice', k: 'ringtone', label: 'Ringtone', def: 'default', options: [{ v: 'default', label: 'Default' }, { v: 'classic', label: 'Classic' }, { v: 'digital', label: 'Digital' }, { v: 'ripple', label: 'Ripple' }, { v: 'silent', label: 'Silent' }] },
        { t: 'choice', k: 'callVibrate', label: 'Vibrate', def: 'default', options: VIBES },
      ] },
      { h: 'More', items: [
        { t: 'toggle', k: 'reactionNotifs', label: 'Reaction notifications', desc: 'Notify me when someone reacts to my message', def: true },
        { t: 'toggle', k: 'streakAlerts', label: 'Streak alerts', desc: 'Remind me before a streak is about to end', def: true },
        { t: 'toggle', k: 'reminders', label: 'Reminders', desc: 'Occasional reminders about unread chats', def: false },
        { t: 'action', id: 'resetNotifs', label: 'Reset notification settings', desc: 'Reset all notification settings, including custom notification settings for your chats', danger: true },
      ] },
    ],
  },
  storage: {
    title: 'Storage and data',
    top: 'storageUsage',
    sections: [
      { h: 'Network', items: [
        { t: 'toggle', k: 'lessDataCalls', label: 'Use less data for calls', desc: 'Lower the call quality to save data', def: false },
      ] },
      { h: 'Media auto-download', items: [
        { t: 'multi', k: 'dlMobile', label: 'When using mobile data', def: ['photos'], options: MEDIA },
        { t: 'multi', k: 'dlWifi', label: 'When connected on Wi-Fi', def: ['photos', 'audio', 'videos', 'docs'], options: MEDIA },
        { t: 'multi', k: 'dlRoaming', label: 'When roaming', def: [], options: MEDIA },
        { t: 'choice', k: 'uploadQuality', label: 'Media upload quality', desc: 'Quality of photos and videos you send', def: 'auto', options: [{ v: 'auto', label: 'Auto (recommended)' }, { v: 'best', label: 'Best quality' }, { v: 'saver', label: 'Data saver' }] },
      ] },
      { items: [
        { t: 'action', id: 'clearCache', label: 'Clear cache', desc: 'Free up space used by temporary files. Your chats and settings are kept.', danger: true },
      ] },
    ],
  },
  accessibility: {
    title: 'Accessibility',
    sections: [
      { items: [
        { t: 'toggle', k: 'highContrast', label: 'Increase contrast', desc: 'Darker text and stronger outlines throughout the app', def: false },
        { t: 'toggle', k: 'reduceMotion', label: 'Reduce animation', desc: 'Turn off floating, sliding and bouncing effects', def: false },
        { t: 'toggle', k: 'boldText', label: 'Bold text', desc: 'Make text a little heavier so it is easier to read', def: false },
      ] },
      { items: [{ t: 'note', text: 'These changes apply instantly across the whole app.' }] },
    ],
  },
  help: {
    title: 'Help and feedback',
    sections: [
      { items: [
        { t: 'link', label: 'Help Center', desc: 'Get help, browse questions', to: '/you/help-center' },
        { t: 'link', label: 'Contact us', desc: 'Questions? Need help?', to: '/you/contact' },
        { t: 'link', label: 'Terms and Privacy Policy', desc: 'Read how we handle your data', to: '/you/terms' },
        { t: 'info', label: 'App info', value: () => `Send ME/U ${APP_VERSION}` },
      ] },
    ],
  },
  'help-center': { title: 'Help Center', custom: 'faq' },
  contact: { title: 'Contact us', custom: 'contact' },
  terms: { title: 'Terms and Privacy Policy', custom: 'terms' },
  'change-number': { title: 'Change number', custom: 'changeNumber' },
  'delete-account': { title: 'Delete account', custom: 'deleteAccount' },
  blocked: { title: 'Blocked contacts', custom: 'blocked' },
  lists: { title: 'Lists', custom: 'lists' },
  appearance: { title: 'Appearance', custom: 'appearance' },
  subscriptions: { title: 'Subscriptions', custom: 'subscriptions' },
  parental: { title: 'Parental controls', custom: 'parental' },
  language: { title: 'App language', custom: 'language' },
  invite: { title: 'Invite a friend', custom: 'invite' },
  updates: { title: 'App updates', custom: 'updates' },
};

export const APP_VERSION = '1.0.0';

// Main menu on the You hub, in the order people see it.
export const MENU = [
  { id: 'payments', icon: IndianRupee, title: 'Payments', sub: 'Send, request and see your history', to: '/payments' },
  { id: 'subscriptions', icon: Gem, title: 'Subscriptions', sub: ({ plan }) => (plan ? 'Send ME/U Plus is active' : 'Explore premium benefits'), to: '/you/subscriptions', badge: ({ plan }) => (plan ? 'Plus' : null) },
  { id: 'account', icon: KeyRound, title: 'Account', sub: 'Security notifications, change number', to: '/you/account' },
  { id: 'privacy', icon: Lock, title: 'Privacy', sub: 'Blocked contacts, disappearing messages', to: '/you/privacy' },
  { id: 'lists', icon: BookUser, title: 'Lists', sub: ({ lists }) => (lists.length ? `${lists.length} ${lists.length === 1 ? 'list' : 'lists'} · manage people and groups` : 'Manage people and groups'), to: '/you/lists' },
  { id: 'chats', icon: MessageSquareText, title: 'Chats', sub: 'Chat history, backup', to: '/you/chats' },
  { id: 'appearance', icon: Palette, title: 'Appearance', sub: 'Theme, light and dark mode', to: '/you/appearance' },
  { id: 'broadcasts', icon: Megaphone, title: 'Broadcasts', sub: 'Manage lists and send broadcasts', to: '/broadcasts' },
  { id: 'notifications', icon: Bell, title: 'Notifications', sub: 'Message, group & call tones', to: '/you/notifications' },
  { id: 'storage', icon: Database, title: 'Storage and data', sub: 'Network usage, auto-download', to: '/you/storage' },
  { id: 'parental', icon: ShieldCheck, title: 'Parental controls', sub: 'Settings for your family', to: '/you/parental' },
  { id: 'accessibility', icon: Accessibility, title: 'Accessibility', sub: 'Increase contrast, animation', to: '/you/accessibility' },
  { id: 'language', icon: Globe, title: 'App language', sub: ({ lang }) => langLabel(lang), to: '/you/language' },
  { id: 'help', icon: CircleHelp, title: 'Help and feedback', sub: 'Help Center, contact us, privacy policy', to: '/you/help' },
  { id: 'invite', icon: UserPlus, title: 'Invite a friend', to: '/you/invite' },
  { id: 'updates', icon: RefreshCw, title: 'App updates', to: '/you/updates' },
];

// "Also in Send ME/U" shortcuts to the rest of the app
export const SPACES = [
  { id: 'private', icon: Lock, label: 'Private Space', to: '/private', c: '#6d4cf0' },
  { id: 'couple', icon: Heart, label: 'Couple', to: '/private/couple', c: '#ff4d6d' },
  { id: 'memories', icon: Image, label: 'Memories', to: '/memories', c: '#ff8a00' },
  { id: 'streaks', icon: Flame, label: 'Streaks', to: '/streaks', c: '#f97316' },
  { id: 'stories', icon: CircleDot, label: 'Stories', to: '/stories', c: '#19a8ff' },
  { id: 'discover', icon: Compass, label: 'Discover', to: '/discover', c: '#14c8b0' },
  { id: 'starred', icon: Star, label: 'Starred', to: '/starred', c: '#eab308' },
  { id: 'devices', icon: Smartphone, label: 'Devices', to: '/devices', c: '#2f6bff' },
  { id: 'communities', icon: Sparkles, label: 'Communities', to: '/communities', c: '#a855f7' },
];

// Every searchable setting: top-level pages and the items inside them
export function buildIndex() {
  const out = MENU.map((m) => ({ label: m.title, trail: '', to: m.to, words: `${m.title} ${typeof m.sub === 'string' ? m.sub : ''}` }));
  Object.entries(PAGES).forEach(([key, pg]) => {
    (pg.sections || []).forEach((s) => (s.items || []).forEach((it) => {
      if (!it.label || it.t === 'note') return;
      out.push({ label: it.label, trail: pg.title, to: it.to || `/you/${key}`, words: `${it.label} ${typeof it.desc === 'string' ? it.desc : ''} ${pg.title}` });
    }));
  });
  out.push({ label: 'Mood', trail: 'Profile', to: '/profile', words: 'current mood status bubble' });
  return out;
}
