import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Fade + slight rise whenever the route path changes. Remounting on path change
 * is what retriggers the CSS animation; the keyframe uses fill-mode "backwards"
 * so no transform is left behind after it finishes.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="h-full page-premium">
      {children}
    </div>
  );
}
