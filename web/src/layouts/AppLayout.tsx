import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { LiveStreamsProvider } from '../context/LiveStreamsContext';
import { ChannelsProvider } from '../context/ChannelsContext';

/**
 * Persistent shell shown for every authenticated route: sidebar (channel list +
 * user bar) plus whatever page is routed into the main content area.
 */
export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ChannelsProvider>
      <LiveStreamsProvider>
        <div className="flex h-[100dvh] w-full overflow-hidden bg-base text-text-primary">
          <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center border-b border-border px-3 md:hidden">
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded p-1.5 text-text-secondary hover:bg-hover hover:text-text-primary"
                aria-label="Open sidebar"
              >
                <Menu size={20} />
              </button>
              <span className="ml-2 text-sm font-semibold">
                ELON<span className="text-accent">IX</span>
              </span>
            </div>

            <div className="min-h-0 flex-1">
              <Outlet />
            </div>
          </div>
        </div>
      </LiveStreamsProvider>
    </ChannelsProvider>
  );
}
