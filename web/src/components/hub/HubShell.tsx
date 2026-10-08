import type { ReactNode } from 'react';
import AnimatedBackground from '../AnimatedBackground';
import HubNav from './HubNav';
import TickerTape from './TickerTape';
import { HubSidebar, MobileCommunities } from './HubSidebar';
import { HubCommunitiesProvider } from './hubCommunities';
import { RouteErrorBoundary } from '../ErrorBoundary';

/** Shared page frame: aurora/particles background, sticky nav, content column + sidebar. */
export default function HubShell({ children, sidebar = true, wide = false }: { children: ReactNode; sidebar?: boolean; wide?: boolean }) {
  return (
    <HubCommunitiesProvider>
      <div className="relative min-h-[100dvh] animate-page-in bg-base text-text-primary">
        <div className="pointer-events-none fixed inset-0 z-0">
          <AnimatedBackground variant="particles" subtle />
        </div>
        <div className="relative z-10">
          <HubNav />
          <TickerTape />
          <RouteErrorBoundary variant="section" name="hub">
            <div className={sidebar ? 'mx-auto grid max-w-5xl gap-5 px-3 py-5 sm:px-4 lg:grid-cols-[minmax(0,1fr)_19rem]' : wide ? 'mx-auto max-w-5xl px-3 py-5 sm:px-4' : 'mx-auto max-w-3xl px-3 py-5 sm:px-4'}>
              <main className="min-w-0 space-y-3">
                {sidebar && <MobileCommunities />}
                {children}
              </main>
              {sidebar && <HubSidebar />}
            </div>
          </RouteErrorBoundary>
        </div>
      </div>
    </HubCommunitiesProvider>
  );
}
