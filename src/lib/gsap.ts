'use client';

import { useLayoutEffect, useEffect, type DependencyList, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * One place that touches GSAP's globals, so the plugin is registered exactly
 * once and every animation in the app shares the same defaults.
 *
 * The rules that keep this from breaking anything:
 *   - Only transform and opacity are ever animated. Nothing that lays out.
 *   - Nothing GSAP animates is an element dnd-kit also transforms. The
 *     sortable wrapper belongs to dnd-kit; GSAP only ever touches the card
 *     inside it, and clears its own inline styles when it is done.
 *   - Everything is created inside a gsap.context() scoped to a ref and
 *     reverted when the component unmounts or its trigger changes, so no
 *     tween or ScrollTrigger outlives the DOM it was made for.
 *   - Reduced motion means no animation at all — not a shorter one, none —
 *     and nothing is ever set hidden first, so nobody is left with an empty
 *     page because a reveal never fired.
 */
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'power2.out', duration: 0.5 });
}

export { gsap, ScrollTrigger };

/** True when the person has asked their OS for less motion. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Layout effect on the client (runs before paint, so an entrance never
// flashes), a plain effect during SSR where layout effects only warn.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Runs `build` inside a gsap.context scoped to `scope`, and reverts it when
 * `deps` change or the component unmounts. `build` is skipped entirely under
 * reduced motion. Selector strings inside `build` (e.g. gsap.from('.card'))
 * only match within `scope`.
 */
export function useGsap(
  build: (ctx: gsap.Context) => void,
  deps: DependencyList,
  scope: RefObject<HTMLElement | null>
) {
  useIsoLayoutEffect(() => {
    if (!scope.current || reducedMotion()) return;
    const ctx = gsap.context((self) => build(self), scope);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The inline properties an entrance leaves behind, and must clean up. */
export const ENTRANCE_PROPS = 'transform,opacity,visibility';
