import { chatSealed } from "./sealed";
async function once(i: number): Promise<boolean> {
  try {
    const r = await chatSealed(
      [
        { role: "system", content: "Reply in ONE warm sentence." },
        { role: "user", content: "I had a hard day." },
      ],
      { maxTokens: 120 },
    );
    console.log(
      `#${i} OK  sealed=${r.sealed} model=${r.model}:`,
      JSON.stringify(r.content.slice(0, 140)),
    );
    return true;
  } catch (e) {
    console.log(`#${i} ERR:`, (e as Error).message);
    return false;
  }
}
async function main() {
  for (let i = 1; i <= 3; i++) {
    if (await once(i)) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
