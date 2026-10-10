import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { LiveStreamsProvider } from '../context/LiveStreamsContext';
import { ChannelsProvider } from '../context/ChannelsContext';
import { useSession } from '../context/SessionContext';
import { TourProvider } from '../components/tour/ProductTour';
import PageTransition from '../components/PageTransition';
import ActivityNotifier from '../components/ActivityNotifier';

/**
 * Persistent shell shown for every authenticated route: sidebar (channel list +
 * user bar) plus whatever page is routed into the main content area.
 */
export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { session } = useSession();

  return (
    <ChannelsProvider>
      <LiveStreamsProvider>
        <TourProvider userId={session?.user.id} setSidebarOpen={setMobileOpen}>
        <ActivityNotifier />
        <div className="flex h-[100dvh] w-full overflow-hidden bg-base text-text-primary">
          <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="pt-safe box-content flex h-12 shrink-0 items-center border-b border-border px-3 md:hidden">
              <button
                onClick={() => setMobileOpen(true)}
                className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-hover hover:text-text-primary"
                aria-label="Open sidebar"
              >
                <Menu size={20} />
              </button>
              <span className="ml-2 text-sm font-semibold">
                ELON<span className="text-accent">IX</span>
              </span>
            </div>

            <div className="min-h-0 flex-1">
              <PageTransition>
                <Outlet />
              </PageTransition>
            </div>
          </div>
        </div>
        </TourProvider>
      </LiveStreamsProvider>
    </ChannelsProvider>
  );
}
