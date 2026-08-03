import { useEffect, useRef, useState } from "react";

/**
 * The landing page is one argument: agent-scale pull requests are a storm of
 * diffstats, and balade is the clearing in it. A seeded field of badges churns
 * forever — a new one lands every beat — while the center stays calm.
 *
 * The field is a jittered grid: one badge per cell, so density stays even and
 * never clumps, and a churned replacement inherits its predecessor's cell.
 * Depth is three layers that drift, bob and answer the pointer at different
 * magnitudes — all composited transforms, no per-frame React work.
 */

interface Badge {
  readonly id: number;
  /** Grid cell, stable across churn so the field stays uniform. */
  readonly cell: number;
  /** Position, in percent of the field. */
  readonly x: number;
  readonly y: number;
  /** Depth: 0 is far and faint, 2 is near and legible. */
  readonly tier: 0 | 1 | 2;
  readonly additions: number;
  readonly deletions: number;
  /** Bob phase, seconds; the delay is negative so phases start scattered. */
  readonly bobDuration: number;
  readonly bobDelay: number;
  /** 0 while alive; a dying badge counts beats until its cell is refilled. */
  readonly dyingBeats: number;
}

/**
 * One layout question, asked once at load: a phone gets a sparser storm —
 * fewer cells, shorter numbers, a wider clearing — or the noise wins.
 */
const COMPACT = window.matchMedia("(max-width: 640px)").matches;

const COLS = COMPACT ? 4 : 13;
const ROWS = COMPACT ? 9 : 8;
const CLEARING_RX = COMPACT ? 46 : 33;
const CLEARING_RY = COMPACT ? 30 : 27;
const CHURN_MS = 375;
/** A fading badge survives this many beats, so the 700ms evaporation fits. */
const FADE_BEATS = 2;
/** Pointer parallax reach per tier, px: near layers answer the most. */
const PARALLAX_PX = [3, 7, 12] as const;

/** Deterministic layout: the same storm on every load and every screenshot. */
const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The calm ellipse at the center where no badge may land. */
const inClearing = (x: number, y: number): boolean => {
  const dx = (x - 50) / CLEARING_RX;
  const dy = (y - 50) / CLEARING_RY;
  return dx * dx + dy * dy < 1;
};

/** A jittered spot inside the cell, or `null` when the cell is all clearing. */
const placeInCell = (rng: () => number, cell: number): { x: number; y: number } | null => {
  const col = cell % COLS;
  const row = Math.floor(cell / COLS);
  for (let attempt = 0; attempt < 6; attempt++) {
    const x = ((col + 0.12 + rng() * 0.76) / COLS) * 100;
    const y = ((row + 0.15 + rng() * 0.7) / ROWS) * 100;
    if (!inClearing(x, y)) return { x, y };
  }
  return null;
};

const makeBadge = (rng: () => number, id: number, cell: number): Badge | null => {
  const spot = placeInCell(rng, cell);
  if (spot === null) return null;
  /* Agent-sized: four digits as the norm, five now and then — desktop only,
     where a wide badge has room. */
  const additions =
    rng() < (COMPACT ? 0 : 0.14)
      ? 5_000 + Math.floor(rng() * 18_000)
      : 500 + Math.floor(rng() * 4_500);
  const deletions = Math.floor(additions * (0.15 + rng() * 0.7));
  return {
    id,
    cell,
    ...spot,
    tier: Math.floor(rng() * 3) as 0 | 1 | 2,
    additions,
    deletions,
    bobDuration: 7 + rng() * 5,
    bobDelay: -rng() * 12,
    dyingBeats: 0,
  };
};

const initialField = (): readonly Badge[] => {
  const rng = mulberry32(96);
  return Array.from({ length: COLS * ROWS }, (_, cell) => makeBadge(rng, cell, cell)).filter(
    (badge): badge is Badge => badge !== null,
  );
};

/** GitHub's five-square meter, split by the add/delete ratio. */
const Squares = ({ additions, deletions }: Pick<Badge, "additions" | "deletions">) => {
  const green = Math.min(4, Math.max(1, Math.round((5 * additions) / (additions + deletions))));
  return (
    <span className="ml-[0.4em] inline-flex gap-[2px] align-middle">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`size-[0.55em] rounded-[1px] ${i < green ? "bg-added" : "bg-deleted"}`}
        />
      ))}
    </span>
  );
};

const TIER_STYLE = [
  "text-[10px] opacity-25 max-sm:hidden",
  "text-[12px] max-sm:text-[10px] opacity-45",
  "text-[14px] max-sm:text-[11px] opacity-75",
] as const;

const DiffBadge = ({ badge }: { badge: Badge }) => (
  <span
    className={`absolute whitespace-nowrap font-machine ${
      badge.dyingBeats > 0
        ? "animate-[fade_700ms_ease-in_forwards]"
        : "animate-[land_900ms_ease-out_backwards]"
    } ${TIER_STYLE[badge.tier]}`}
    style={{ left: `${badge.x}%`, top: `${badge.y}%`, translate: "-50% -50%" }}
  >
    {/* The bob lives on an inner span so it never fights the landing rise. */}
    <span
      className="inline-block"
      style={{
        animation: `bob ${badge.bobDuration}s ease-in-out ${badge.bobDelay}s infinite alternate`,
      }}
    >
      <span className="text-added">+{badge.additions.toLocaleString("en-US")}</span>{" "}
      <span className="text-deleted">−{badge.deletions.toLocaleString("en-US")}</span>
      <Squares additions={badge.additions} deletions={badge.deletions} />
    </span>
  </span>
);

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The churn: agents merge non-stop. Each beat, whatever finished fading is
 * replaced in its cell, and one more badge begins its own fade.
 */
const useChurn = (): readonly Badge[] => {
  const [field, setField] = useState(initialField);
  useEffect(() => {
    if (reducedMotion()) return;
    const rng = mulberry32(Date.now() >>> 0);
    let nextId = COLS * ROWS;
    const timer = setInterval(() => {
      setField((badges) => {
        const aged = badges.map((badge) => {
          if (badge.dyingBeats === 0) return badge;
          if (badge.dyingBeats >= FADE_BEATS) return makeBadge(rng, nextId++, badge.cell) ?? badge;
          return { ...badge, dyingBeats: badge.dyingBeats + 1 };
        });
        const slot = Math.floor(rng() * aged.length);
        const chosen = aged[slot];
        if (chosen === undefined || chosen.dyingBeats > 0) return aged;
        return aged.map((badge, i) => (i === slot ? { ...badge, dyingBeats: 1 } : badge));
      });
    }, CHURN_MS);
    return () => clearInterval(timer);
  }, []);
  return field;
};

/**
 * Pointer parallax: three direct style writes per frame through refs, eased
 * toward the pointer, and the loop stops once the layers settle.
 */
const useParallax = () => {
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (reducedMotion()) return;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame = 0;
    let running = false;

    const step = (): void => {
      x += (targetX - x) * 0.045;
      y += (targetY - y) * 0.045;
      for (const [tier, reach] of PARALLAX_PX.entries()) {
        const layer = layers.current[tier];
        if (layer !== null && layer !== undefined) {
          layer.style.transform = `translate3d(${-x * reach}px, ${-y * reach * 0.7}px, 0)`;
        }
      }
      if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.001) {
        running = false;
        return;
      }
      frame = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent): void => {
      targetX = (event.clientX / window.innerWidth) * 2 - 1;
      targetY = (event.clientY / window.innerHeight) * 2 - 1;
      if (!running) {
        running = true;
        frame = requestAnimationFrame(step);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return layers;
};

export const Landing = () => {
  const field = useChurn();
  const layers = useParallax();
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* The storm: three depth layers that drift, bob and answer the pointer. */}
      {([0, 1, 2] as const).map((tier) => (
        <div
          key={tier}
          aria-hidden
          ref={(el) => {
            layers.current[tier] = el;
          }}
          className="pointer-events-none absolute inset-0 will-change-transform"
        >
          <div
            className={`absolute inset-0 ${
              tier === 1
                ? "animate-[drift-a_90s_ease-in-out_infinite_alternate]"
                : "animate-[drift-b_120s_ease-in-out_infinite_alternate]"
            }`}
          >
            {field
              .filter((badge) => badge.tier === tier)
              .map((badge) => (
                <DiffBadge key={badge.id} badge={badge} />
              ))}
          </div>
        </div>
      ))}

      {/* The clearing: the storm fades before it reaches the words. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse ${
            COMPACT ? "88% 46%" : "62% 52%"
          } at 50% 50%, #0d1117 0%, #0d1117d9 34%, transparent 72%)`,
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-human text-[clamp(3.75rem,9vw,6rem)] leading-none tracking-tight italic">
          balade
        </h1>
        <p className="mt-7 font-human text-[clamp(1.125rem,2.4vw,1.5rem)] leading-snug text-balance">
          The diff is for agents; the&nbsp;walkthrough is for&nbsp;you.
        </p>
        <p className="mt-3 max-w-[44ch] font-human text-[15px] leading-relaxed text-muted-foreground">
          Narrated, validated walkthroughs for pull requests too large to scan.
        </p>
        <code className="mt-10 rounded-md border border-border bg-card px-4 py-2.5 font-machine text-sm">
          <span className="text-muted-foreground select-none">$ </span>
          npx balade open <span className="text-muted-foreground">&lt;pr-url&gt;</span>
        </code>
        <a
          href="https://github.com/basaltbytes/balade"
          className="mt-5 rounded-sm font-machine text-[13px] text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          github.com/basaltbytes/balade ↗
        </a>
      </div>
    </main>
  );
};
