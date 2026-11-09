import { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './store';
import { Toast, BottomNav, PageTransition } from './components/ui';
import Splash from './screens/Splash';
import Onboarding from './screens/Onboarding';
import { Login, SignUp, ForgotPassword, ResetPassword } from './screens/Auth';
import Home from './screens/Home';
import { Chat, NewChat, Notifications } from './screens/Chat';
import ContactInfo from './screens/ContactInfo';
import Streaks from './screens/Streaks';
import Discover from './screens/Discover';
import Daily from './screens/Daily';
import Timeline from './screens/Timeline';
import PersonProfile from './screens/PersonProfile';
import Calls from './screens/Calls';
import { CreateChannel, StatusPrivacy, AdPreferences, ScheduledCalls } from './screens/DailyCallsMenu';
import PrivateSpace, { LockedChats, SavedLocations } from './screens/PrivateSpace';
import { Stories, StoryCreate } from './screens/Stories';
import { Couple, Journal, SharedGallery, Goals, Invite } from './screens/Couple';
import Calendar from './screens/Calendar';
import LiveLocation from './screens/LiveLocation';
import CoupleSync from './couple/CoupleSync';
import Memories from './screens/Memories';
import { PrivateGate } from './screens/PrivateLock';
import { Starred, Broadcasts, BroadcastNew, BroadcastView, Communities, CommunityNew, CommunityView, LinkedDevices, Payments } from './screens/MenuPages';
import { Profile, EditProfile, SettingsPage } from './screens/Profile';
import YouPage from './profile/YouPages';

function Protected() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return null;
  return user ? <><CoupleSync /><Outlet /></> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}

// Screens that show the bottom navigation
function WithNav() {
  return (<div className="with-nav"><PageTransition><Outlet /></PageTransition><BottomNav /></div>);
}

function Plain() {
  return <PageTransition><Outlet /></PageTransition>;
}

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const logout = useAuth((s) => s.logout);
  const nav = useNavigate();

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => {
    const onExpire = () => { logout(); nav('/login', { replace: true }); };
    window.addEventListener('smu:unauthorized', onExpire);
    return () => window.removeEventListener('smu:unauthorized', onExpire);
  }, [logout, nav]);

  return (
    <div className="shell">
      <div className="device">
        <Routes>
          <Route element={<Plain />}>
          <Route path="/" element={<Splash />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          </Route>

          <Route element={<Protected />}>
            <Route element={<WithNav />}>
              <Route path="/home" element={<Home />} />
              <Route path="/daily" element={<Daily />} />
              <Route path="/timeline" element={<Timeline />} />
              <Route path="/calls" element={<Calls />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
            <Route element={<Plain />}>
            <Route element={<PrivateGate />}>
              <Route path="/private" element={<PrivateSpace />} />
              <Route path="/private/locked" element={<LockedChats />} />
              <Route path="/private/locations" element={<SavedLocations />} />
              <Route path="/private/couple" element={<Couple />} />
              <Route path="/private/couple/journal" element={<Journal />} />
              <Route path="/private/couple/gallery" element={<SharedGallery />} />
              <Route path="/private/couple/goals" element={<Goals />} />
              <Route path="/private/couple/invite" element={<Invite />} />
              <Route path="/private/couple/location" element={<LiveLocation />} />
            </Route>
            <Route path="/channels/new" element={<CreateChannel />} />
            <Route path="/calls/scheduled" element={<ScheduledCalls />} />
            <Route path="/settings/status-privacy" element={<StatusPrivacy />} />
            <Route path="/settings/ads" element={<AdPreferences />} />
            <Route path="/you/:page" element={<YouPage />} />
            <Route path="/people/:id" element={<PersonProfile />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/memories" element={<Memories />} />
            <Route path="/chats/new" element={<NewChat />} />
            <Route path="/chats/:id" element={<Chat />} />
            <Route path="/streaks" element={<Streaks />} />
            <Route path="/chats/:id/info" element={<ContactInfo />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/starred" element={<Starred />} />
            <Route path="/broadcasts" element={<Broadcasts />} />
            <Route path="/broadcasts/new" element={<BroadcastNew />} />
            <Route path="/broadcasts/:id" element={<BroadcastView />} />
            <Route path="/communities" element={<Communities />} />
            <Route path="/communities/new" element={<CommunityNew />} />
            <Route path="/communities/:id" element={<CommunityView />} />
            <Route path="/devices" element={<LinkedDevices />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/stories" element={<Stories />} />
            <Route path="/stories/new" element={<StoryCreate />} />
            <Route path="/couple/*" element={<Navigate to="/private/couple" replace />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/profile/edit" element={<EditProfile />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toast />
      </div>
    </div>
  );
}
