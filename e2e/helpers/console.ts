import type { Page } from "@playwright/test";

/**
 * Attach error capture to a page. Console errors and uncaught page errors are collected so a test can
 * assert L0's "zero console errors" criterion. Warnings are tracked separately and not asserted —
 * third-party libraries occasionally warn on a cold load, and that isn't a product defect.
 */
export function captureConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") errors.push(`[error] ${m.text().slice(0, 200)}`);
    else if (t === "warning") warnings.push(`[warn] ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 200)}`));
  return { errors, warnings };
}
