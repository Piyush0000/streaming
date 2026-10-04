import { useCallback, useEffect, useRef, useState } from 'react';

// One shared IntersectionObserver for every revealed element on the page.
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return null;
  try {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
  } catch {
    observer = null;
  }
  return observer;
}

/**
 * Returns a ref callback; the element fades/rises in once it scrolls into view.
 * Pair with the `.reveal` class. `delayMs` staggers siblings. Without
 * IntersectionObserver support the element is simply shown.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(delayMs = 0) {
  const elRef = useRef<T | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      const prev = elRef.current;
      if (prev && prev !== el) getObserver()?.unobserve(prev);
      elRef.current = el;
      if (!el) return;
      if (delayMs) el.style.setProperty('--reveal-delay', `${delayMs}ms`);
      const io = getObserver();
      if (io) io.observe(el);
      else el.classList.add('is-visible');
    },
    [delayMs]
  );

  useEffect(
    () => () => {
      if (elRef.current) getObserver()?.unobserve(elRef.current);
    },
    []
  );

  return ref;
}

/** One-shot "has this element entered the viewport" flag (e.g. to start a counter). */
export function useInView<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    ioRef.current?.disconnect();
    ioRef.current = null;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    try {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            io.disconnect();
          }
        },
        { threshold: 0.4 }
      );
      io.observe(el);
      ioRef.current = io;
    } catch {
      setSeen(true);
    }
  }, []);

  useEffect(() => () => ioRef.current?.disconnect(), []);
  return [ref, seen];
}
