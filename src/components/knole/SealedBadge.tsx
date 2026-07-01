import { useServerFn } from "@tanstack/react-start";
import { sealedStatusFn } from "@/server/fns";
import { useEffect, useState } from "react";

/**
 * The honest "sealed inference" badge: it renders ONLY once the 0G Sealed Inference (TEE) path is
 * actually active (a pc.0g.ai key set + OG_SEALED_INFERENCE=on). Until then it shows nothing — so the
 * "composed where even we can't read it" claim is never made unless the inference genuinely runs in
 * the enclave. This is the difference between Knole and the rivals that assert privacy they don't
 * deliver.
 */
export function SealedBadge({ className = "" }: { className?: string }) {
  const getStatus = useServerFn(sealedStatusFn);
  const [active, setActive] = useState(false);
  useEffect(() => {
    let alive = true;
    getStatus()
      .then((s) => alive && setActive(!!s.active))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [getStatus]);

  if (!active) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] text-tan ${className}`}
      title="Composed inside a 0G Sealed Inference enclave (TEE), verified by hardware attestation — the operator physically cannot read your words."
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 11V7a5 5 0 0110 0v4M5 11h14v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z"
        />
      </svg>
      Sealed in 0G TEE
    </span>
  );
}
