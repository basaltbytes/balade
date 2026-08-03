import { useEffect, useState } from "react";

/**
 * The landing page is one argument: agent-scale pull requests are a storm of
 * diffstats, and balade is the clearing in it. A seeded field of badges churns
 * forever — a new one lands every beat — while the center stays calm.
 */

interface Badge {
  readonly id: number;
  /** Position, in percent of the field. */
  readonly x: number;
  readonly y: number;
  /** Depth: 0 is far and faint, 2 is near and legible. */
  readonly tier: 0 | 1 | 2;
  readonly additions: number;
  readonly deletions: number;
}

const FIELD_SIZE = 84;
const CHURN_MS = 750;

/** Deterministic layout: the same storm on every load and every screenshot. */
const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The calm ellipse at the center where no badge may land. */
const inClearing = (x: number, y: number): boolean => {
  const dx = (x - 50) / 33;
  const dy = (y - 50) / 27;
  return dx * dx + dy * dy < 1;
};

const makeBadge = (rng: () => number, id: number): Badge => {
  let x = 50;
  let y = 50;
  do {
    x = 2 + rng() * 94;
    y = 3 + rng() * 92;
  } while (inClearing(x, y));
  /* Everything is agent-sized: four digits as the norm, five now and then. */
  const additions =
    rng() < 0.14 ? 5_000 + Math.floor(rng() * 18_000) : 500 + Math.floor(rng() * 4_500);
  const deletions = Math.floor(additions * (0.15 + rng() * 0.7));
  return { id, x, y, tier: (id % 3) as 0 | 1 | 2, additions, deletions };
};

const initialField = (): readonly Badge[] => {
  const rng = mulberry32(96);
  return Array.from({ length: FIELD_SIZE }, (_, i) => makeBadge(rng, i));
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
  "text-[12px] opacity-45",
  "text-[14px] opacity-75",
] as const;

const DiffBadge = ({ badge }: { badge: Badge }) => (
  <span
    className={`absolute animate-[land_900ms_ease-out] whitespace-nowrap font-machine ${TIER_STYLE[badge.tier]}`}
    style={{ left: `${badge.x}%`, top: `${badge.y}%`, translate: "-50% -50%" }}
  >
    <span className="text-added">+{badge.additions.toLocaleString("en-US")}</span>{" "}
    <span className="text-deleted">−{badge.deletions.toLocaleString("en-US")}</span>
    <Squares additions={badge.additions} deletions={badge.deletions} />
  </span>
);

/** The churn: every beat, one badge is replaced — agents merge non-stop. */
const useChurn = (): readonly Badge[] => {
  const [field, setField] = useState(initialField);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rng = mulberry32(Date.now() >>> 0);
    let nextId = FIELD_SIZE;
    const timer = setInterval(() => {
      setField((badges) => {
        const slot = Math.floor(rng() * badges.length);
        return badges.map((badge, i) => (i === slot ? makeBadge(rng, nextId++) : badge));
      });
    }, CHURN_MS);
    return () => clearInterval(timer);
  }, []);
  return field;
};

export const Landing = () => {
  const field = useChurn();
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* The storm: three depth layers, each drifting on its own slow loop. */}
      {[0, 1, 2].map((tier) => (
        <div
          key={tier}
          aria-hidden
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
      ))}

      {/* The clearing: the storm fades before it reaches the words. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 62% 52% at 50% 50%, #0d1117 0%, #0d1117d9 34%, transparent 72%)",
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
