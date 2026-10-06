import type { ReactNode } from 'react';
import AnimatedBackground from '../AnimatedBackground';
import HubNav from './HubNav';
import { HubSidebar, MobileCommunities } from './HubSidebar';
import { HubCommunitiesProvider } from './hubCommunities';

/** Shared page frame: aurora/particles background, sticky nav, content column + sidebar. */
export default function HubShell({ children, sidebar = true }: { children: ReactNode; sidebar?: boolean }) {
  return (
    <HubCommunitiesProvider>
      <div className="relative min-h-[100dvh] animate-page-in bg-base text-text-primary">
        <div className="pointer-events-none fixed inset-0 z-0">
          <AnimatedBackground variant="particles" subtle />
        </div>
        <div className="relative z-10">
          <HubNav />
          <div className={sidebar ? 'mx-auto grid max-w-5xl gap-5 px-3 py-5 sm:px-4 lg:grid-cols-[minmax(0,1fr)_19rem]' : 'mx-auto max-w-3xl px-3 py-5 sm:px-4'}>
            <main className="min-w-0 space-y-3">
              {sidebar && <MobileCommunities />}
              {children}
            </main>
            {sidebar && <HubSidebar />}
          </div>
        </div>
      </div>
    </HubCommunitiesProvider>
  );
}
