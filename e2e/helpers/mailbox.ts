// A REAL disposable inbox (mail.tm) I can read via API — so the Privy email-OTP flow can complete
// headlessly exactly as a human does it: receive the email, read the 6-digit code, enter it.

const API = "https://api.mail.tm";

export async function createMailbox(): Promise<{ address: string; token: string }> {
  const domains = (await (await fetch(`${API}/domains`)).json()) as {
    "hydra:member": { domain: string }[];
  };
  const domain = domains["hydra:member"][0].domain;
  const address = `knoleqa${Date.now()}@${domain}`;
  const password = "Test1234!Ab";
  await fetch(`${API}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  const tok = (await (
    await fetch(`${API}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password }),
    })
  ).json()) as { token?: string };
  if (!tok.token) throw new Error("mail.tm token failed");
  return { address, token: tok.token };
}

/** Poll the inbox until a 6-digit code arrives (Privy's OTP), or time out. */
export async function waitForOtp(token: string, timeoutMs = 75000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const auth = { Authorization: `Bearer ${token}` };
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${API}/messages`, { headers: auth })).json()) as {
      "hydra:member"?: { id: string }[];
    };
    for (const m of list["hydra:member"] ?? []) {
      const full = (await (await fetch(`${API}/messages/${m.id}`, { headers: auth })).json()) as {
        text?: string;
        subject?: string;
        html?: string[];
      };
      const blob = `${full.subject ?? ""} ${full.text ?? ""} ${(full.html ?? []).join(" ")}`;
      const code = blob.match(/\b(\d{6})\b/);
      if (code) return code[1];
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("OTP not received within timeout");
}
