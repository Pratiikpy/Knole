import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import {
  identityCapsuleFn,
  createIdentityGrantFn,
  listIdentityGrantsFn,
  revokeIdentityGrantFn,
} from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/identity")({
  head: () => ({
    meta: [
      { title: "Portable identity — Knole" },
      {
        name: "description",
        content: "Carry who you are to other 0G apps — with your permission.",
      },
    ],
  }),
  component: IdentityPage,
});

type Capsule = {
  values: string[];
  patterns: string[];
  relationships: string[];
  commitments: string[];
  preferences: string[];
};
type Grant = { gid: string; scope: string; exp: number; revoked: boolean };

function IdentityPage() {
  const getCapsule = useServerFn(identityCapsuleFn);
  const createGrant = useServerFn(createIdentityGrantFn);
  const listGrants = useServerFn(listIdentityGrantsFn);
  const revoke = useServerFn(revokeIdentityGrantFn);

  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshGrants = () =>
    listGrants()
      .then((r) => setGrants(r.grants))
      .catch(() => {});
  useEffect(() => {
    getCapsule()
      .then((r) => setCapsule(r.capsule))
      .catch(() => {});
    refreshGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mkGrant() {
    setCopied(false);
    try {
      const r = await createGrant({ data: { scope: "summary", ttlSec: 604800 } });
      setToken(r.token);
      refreshGrants();
    } catch {
      /* ignore */
    }
  }

  const sections: [string, string[]][] = capsule
    ? [
        ["Values", capsule.values],
        ["Patterns", capsule.patterns],
        ["Relationships", capsule.relationships],
        ["Commitments", capsule.commitments],
        ["Preferences", capsule.preferences],
      ]
    : [];
  const hasCapsule = sections.some(([, v]) => v.length);

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Portable identity</h1>
            <Link to="/the-index" className="text-[12px] text-muted-foreground hover:text-ink">
              your memory →
            </Link>
          </div>
          <p className="mb-8 max-w-[50ch] text-[15px] leading-relaxed text-muted-foreground">
            Your memory is yours to carry. Grant another 0G app or agent a read-only view of who you
            are — a scoped, expiring, revocable pass. It shares only these durable traits, never a
            single entry.
          </p>

          {/* The capsule */}
          {hasCapsule ? (
            <div className="mb-8 space-y-4">
              {sections
                .filter(([, v]) => v.length)
                .map(([label, items]) => (
                  <div key={label} className="rounded-2xl border border-rule bg-card/50 p-5">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                      {label}
                    </div>
                    <ul className="space-y-1 text-[14px] leading-relaxed text-ink-soft">
                      {items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mb-8 text-[14px] text-muted-foreground">
              Write for a while first — your identity fills in from your own words, then you can
              carry it.
            </p>
          )}

          {/* Grant */}
          {hasCapsule && (
            <div className="mb-8 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
              <p className="mb-3 text-[14px] text-ink-soft">
                Create a grant — a token another 0G app can present for 7 days, until you revoke it.
              </p>
              <button
                onClick={mkGrant}
                className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper"
              >
                Create a grant
              </button>
              {token && (
                <div className="mt-4">
                  <div className="break-all rounded-lg border border-rule bg-card/60 p-3 font-mono text-[11px] text-ink-soft">
                    {token}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(token);
                        setCopied(true);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="mt-2 text-[12px] text-tan hover:text-ink"
                  >
                    {copied ? "copied ✓" : "copy grant token"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Active grants */}
          {grants.length > 0 && (
            <div>
              <div className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Grants you've given
              </div>
              <div className="space-y-2">
                {grants.map((g) => (
                  <div
                    key={g.gid}
                    className="flex items-center justify-between rounded-xl border border-rule/60 px-4 py-3 text-[12px]"
                  >
                    <span className="text-muted-foreground">
                      {g.scope} · expires {new Date(g.exp * 1000).toLocaleDateString()}
                      {g.revoked ? " · revoked" : ""}
                    </span>
                    {!g.revoked && (
                      <button
                        onClick={() => revoke({ data: { gid: g.gid } }).then(refreshGrants)}
                        className="text-tan hover:text-ink"
                      >
                        revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
