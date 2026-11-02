import type { Payload } from "../contract";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export interface NavigationProps {
  readonly section?: string;
  readonly onSectionChange?: (section: string) => void;
  /** The host's scrolling element. Omit to track the viewport. */
  readonly scrollRoot?: RefObject<HTMLElement | null>;
}

interface Navigation {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly scrollRoot: RefObject<HTMLElement | null> | undefined;
  readonly active: string;
  readonly sectionId: (id: string) => string;
  readonly jump: (id: string) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({
  children,
  section,
  onSectionChange,
  scrollRoot,
  content,
}: NavigationProps & { children: ReactNode; content: Payload }) {
  const root = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const [active, setActive] = useState(section ?? "");
  const lastReported = useRef("");
  const onChange = useRef(onSectionChange);
  onChange.current = onSectionChange;
  const frames = useRef(new Set<number>());
  const report = useCallback((id: string) => {
    setActive(id);
    if (lastReported.current === id) return;
    lastReported.current = id;
    onChange.current?.(id);
  }, []);
  const jump = useCallback(
    (id: string) => {
      const target = [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-balade-section]") ?? []),
      ].find((element) => element.dataset.baladeSection === id);
      if (target === undefined) return;
      const scroller = scrollRoot?.current;
      const scroll = (behavior: ScrollBehavior): void => {
        if (scroller)
          scroller.scrollTo({
            top:
              scroller.scrollTop +
              target.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top -
              24,
            behavior,
          });
        else target.scrollIntoView({ behavior, block: "start" });
      };
      const before = target.getBoundingClientRect().top;
      scroll("smooth");
      report(id);
      const frame = requestAnimationFrame(() => {
        frames.current.delete(frame);
        const settle = requestAnimationFrame(() => {
          frames.current.delete(settle);
          if (target.getBoundingClientRect().top === before) scroll("instant");
        });
        frames.current.add(settle);
      });
      frames.current.add(frame);
    },
    [report, scrollRoot],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries.find((entry) => entry.isIntersecting);
        if (
          first?.target instanceof HTMLElement &&
          first.target.dataset.baladeSection !== undefined
        )
          report(first.target.dataset.baladeSection);
      },
      { root: scrollRoot?.current ?? null, rootMargin: "0px 0px -70% 0px" },
    );
    root.current
      ?.querySelectorAll("[data-balade-section]")
      .forEach((element) => observer.observe(element));
    const pending = frames.current;
    return () => {
      observer.disconnect();
      pending.forEach(cancelAnimationFrame);
      pending.clear();
    };
  }, [content, report, scrollRoot]);

  useEffect(() => {
    if (section !== undefined && section !== "" && section !== lastReported.current) {
      jump(section);
      const settle = setTimeout(() => jump(section), 500);
      return () => clearTimeout(settle);
    }
  }, [section, jump]);

  const value = useMemo<Navigation>(
    () => ({
      root,
      scrollRoot,
      active: section ?? active,
      sectionId: (id) => `${prefix}-${id}`,
      jump,
    }),
    [active, jump, prefix, section, scrollRoot],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (value === null) throw new Error("Navigation requires Walkthrough.Root");
  return value;
}
