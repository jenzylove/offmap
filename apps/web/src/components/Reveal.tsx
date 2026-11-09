"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fades a block up into place the first time it scrolls into view. */
export function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setIn(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={`reveal ${inView ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Which of a list of elements sits nearest the middle of the screen. One thing in focus at a time. */
export function useFocusIndex(count: number) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let raf = 0;
    const pick = () => {
      raf = 0;
      const mid = window.innerHeight * 0.5;
      let best = 0;
      let bestD = Infinity;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const c = r.top + Math.min(r.height, window.innerHeight) / 2;
        const d = Math.abs(c - mid);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setActive(best);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    pick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [count]);
  const bind = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
  return { active, bind };
}
