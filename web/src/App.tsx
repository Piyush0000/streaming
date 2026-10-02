import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './context/SessionContext';
import { FullPageSpinner } from './components/Spinner';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import ChannelsPage from './pages/ChannelsPage';
import ChannelPage from './pages/ChannelPage';
import AppLayout from './layouts/AppLayout';
import LivePage from './pages/LivePage';
import StreamPage from './pages/StreamPage';
import GuidelinesPage from './pages/GuidelinesPage';
import { ToastProvider } from './context/ToastContext';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, initializing } = useSession();
  if (initializing) {
    return (
      <div className="h-[100dvh] w-full bg-base">
        <FullPageSpinner label="Loading your session…" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const { session, initializing } = useSession();
  if (initializing) {
    return (
      <div className="h-[100dvh] w-full bg-base">
        <FullPageSpinner label="Loading…" />
      </div>
    );
  }
  if (session) return <Navigate to="/channels" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RedirectIfAuthed>
            <LandingPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <AuthPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/live/:streamId" element={<StreamPage />} />
        <Route path="/guidelines" element={<GuidelinesPage />} />
      </Route>
      <Route
        path="*"
        element={
          <RedirectIfAuthed>
            <LandingPage />
          </RedirectIfAuthed>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
      <AppRoutes />
      </ToastProvider>
    </SessionProvider>
  );
}
