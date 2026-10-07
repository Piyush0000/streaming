import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import InvitePage from './pages/InvitePage';
const ElonixHubPage = lazy(() => import('./pages/ElonixHubPage'));
const HubCommunityPage = lazy(() => import('./pages/HubCommunityPage'));
const HubPostPage = lazy(() => import('./pages/HubPostPage'));
const HubProfilePage = lazy(() => import('./pages/HubProfilePage'));
const HubSubmitPage = lazy(() => import('./pages/HubSubmitPage'));
const HubSearchPage = lazy(() => import('./pages/HubSearchPage'));
const HubNewsPage = lazy(() => import('./pages/HubNewsPage'));
const HubMarketsPage = lazy(() => import('./pages/HubMarketsPage'));
const TradePage = lazy(() => import('./pages/TradePage'));
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import { BlocksProvider } from './hooks/useBlocks';
import { UserCardProvider } from './components/UserCard';
import { ToastProvider } from './context/ToastContext';
import {
  clearPostLoginPath,
  DEFAULT_POST_LOGIN_PATH,
  rememberPostLoginPath,
  resolvePostLoginTarget,
  sanitizeInternalPath,
} from './lib/redirect';

/** Sends a signed-out visitor to /login, remembering where they were headed (in-app paths only). */
function RedirectToLogin() {
  const location = useLocation();
  const from = sanitizeInternalPath(location.pathname + location.search + location.hash);
  useEffect(() => {
    if (from) rememberPostLoginPath(from);
  }, [from]);
  return <Navigate to="/login" replace state={from ? { from } : undefined} />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, initializing } = useSession();
  if (initializing) {
    return (
      <div className="h-[100dvh] w-full bg-base">
        <FullPageSpinner label="Loading your session…" />
      </div>
    );
  }
  if (!session) return <RedirectToLogin />;
  return children;
}

/**
 * Bounces signed-in users away from public pages. With `returnToIntended` (the
 * /login route) they go back to the page they were originally trying to open.
 */
function RedirectIfAuthed({ children, returnToIntended = false }: { children: JSX.Element; returnToIntended?: boolean }) {
  const { session, initializing } = useSession();
  const location = useLocation();
  if (initializing) {
    return (
      <div className="h-[100dvh] w-full bg-base">
        <FullPageSpinner label="Loading…" />
      </div>
    );
  }
  if (session) {
    const target = returnToIntended
      ? resolvePostLoginTarget((location.state as { from?: unknown } | null)?.from)
      : DEFAULT_POST_LOGIN_PATH;
    return <ConsumeIntendedPath target={target} />;
  }
  return children;
}

/** Navigates to the post-login target, then drops the remembered one-shot path. */
function ConsumeIntendedPath({ target }: { target: string }) {
  useEffect(() => {
    clearPostLoginPath();
  }, []);
  return <Navigate to={target} replace />;
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
      {(
        [
          ['/elonixhub', ElonixHubPage],
          ['/elonixhub/c/:slug', HubCommunityPage],
          ['/elonixhub/post/:id', HubPostPage],
          ['/elonixhub/u/:username', HubProfilePage],
          ['/elonixhub/submit', HubSubmitPage],
          ['/elonixhub/search', HubSearchPage],
          ['/elonixhub/news', HubNewsPage],
          ['/elonixhub/markets', HubMarketsPage],
        ] as const
      ).map(([path, Page]) => (
        <Route
          key={path}
          path={path}
          element={
            <Suspense
              fallback={
                <div className="h-[100dvh] w-full bg-base">
                  <FullPageSpinner label="Loading�" />
                </div>
              }
            >
              <Page />
            </Suspense>
          }
        />
      ))}
      <Route
        path="/login"
        element={
          <RedirectIfAuthed returnToIntended>
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
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/live/:streamId" element={<StreamPage />} />
        <Route path="/guidelines" element={<GuidelinesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/trade"
          element={
            <Suspense fallback={<FullPageSpinner label="Loading…" />}>
              <TradePage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BlocksProvider>
          <UserCardProvider>
            <AppRoutes />
          </UserCardProvider>
        </BlocksProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
