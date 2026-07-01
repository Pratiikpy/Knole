/** The breathing tan dot — Knole's signature "alive" motif, in one place. Size-override via className. */
export function Pulse({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 animate-breathe rounded-full bg-tan ${className}`}
    />
  );
}
