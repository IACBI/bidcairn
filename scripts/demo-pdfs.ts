import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createPurchase } from "../server/reference.js";
import { referencePDF } from "../server/app.js";

const folder = resolve(".data/demo-proposals");
await mkdir(folder, { recursive: true });
for (const proposal of createPurchase(randomUUID()).proposals) {
  const filename = `${proposal.identity.name.toLowerCase().replaceAll(" ", "-")}.pdf`;
  await writeFile(
    resolve(folder, filename),
    referencePDF(proposal.originalPages),
  );
  console.log(`${proposal.identity.name}: ${resolve(folder, filename)}`);
}
console.log(
  "Original synthetic PDFs only. No inference or PayPal requests were made.",
);
