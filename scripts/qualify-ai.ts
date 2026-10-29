import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AIService } from "../server/ai.js";
import { loadConfig } from "../server/config.js";
import { LocalStore } from "../server/store.js";
import { blankFacts, createPurchase } from "../server/reference.js";
import { hash } from "../server/evidence.js";
import { factKeys, type Proposal } from "../shared/model.js";
import {
  qualificationCorpus,
  qualificationRequirements,
} from "./qualification-corpus.js";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.argv.includes("--acknowledge-free-tier"))
  throw new Error(
    "Verify the card-free account and quotas first, then pass --acknowledge-free-tier. This runner makes up to 16 model requests; Astropods can use one repair per request.",
  );
const config = loadConfig();
if (config.AI_PROVIDER === "none")
  throw new Error("Configure one runtime provider before qualification.");
const store = new LocalStore(`${config.DATA_DIR}/qualification.sqlite`);
// Only this explicit diagnostic runner bypasses the production quality switch.
// Credit expiry, budget, strict schema, evidence and rate controls still apply.
const ai = new AIService({ ...config, AI_QUALIFIED: "true" }, store);
const purchase = createPurchase(randomUUID(), false);
purchase.rubric.requirements = qualificationRequirements;
const results: {
  caseId: string;
  repeat: number;
  pass: boolean;
  durationMs: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
}[] = [];
let requests = 0;
for (const test of qualificationCorpus) {
  const pages = [{ page: 1, text: test.text }];
  const proposal: Proposal = {
    id: randomUUID(),
    alias: "Proposal A",
    vendorId: "",
    identity: { name: "", email: "", filename: "" },
    pages,
    originalPages: pages,
    documentHash: hash(test.text),
    provenance: "uploaded",
    facts: blankFacts(),
    requirements: [],
    risks: [],
    status: "unanalysed",
    priorIdentityExposure: false,
  };
  for (let repeat = 1; repeat <= 2; repeat++) {
    if (requests++ > 0 && config.AI_PROVIDER === "groq") {
      console.log("Waiting for the bounded free inference lane…");
      await new Promise((resolve) => setTimeout(resolve, 60000));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const started = Date.now();
    try {
      const result = await ai.analyze(purchase, proposal);
      const pass =
        factKeys.every(
          (key) => result.extraction.facts[key].value === test.facts[key],
        ) &&
        result.extraction.requirements.find(
          (r) => r.requirementId === "migration",
        )?.status === "supported" &&
        result.extraction.requirements.find(
          (r) => r.requirementId === "rollback",
        )?.status === test.rollback &&
        (test.id !== "conflicting-deposit" ||
          result.extraction.risks.length > 0);
      results.push({
        caseId: test.id,
        repeat,
        pass,
        durationMs: Date.now() - started,
        inputTokens: result.analysis.inputTokens,
        outputTokens: result.analysis.outputTokens,
      });
    } catch (error) {
      results.push({
        caseId: test.id,
        repeat,
        pass: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : "Analysis failed",
      });
    }
    console.log(
      `${test.id} repeat ${repeat}: ${results.at(-1)!.pass ? "PASS" : "FAIL"}`,
    );
  }
}
const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
const passed = results.every((r) => r.pass);
const report = {
  at: new Date().toISOString(),
  provider: config.AI_PROVIDER,
  model: config.AI_MODEL,
  corpusHash: hash(qualificationCorpus),
  passed,
  note: "Synthetic regression corpus only. Account privacy, free credits, hosted topology and human explanation quality require separate review.",
  p95LatencyMs: durations[Math.ceil(durations.length * 0.95) - 1],
  results,
};
await mkdir(`${config.DATA_DIR}/qualification`, { recursive: true });
await writeFile(
  `${config.DATA_DIR}/qualification/report.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  `Qualification ${passed ? "passed" : "failed"}; report saved locally. AI_QUALIFIED was not changed.`,
);
store.db.close();
if (!passed) process.exitCode = 1;
