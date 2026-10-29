import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { loadConfig } from "../server/config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig();
const gateNames = ["paypal", "ai", "hosting", "naming", "submission"] as const;
const entry = z
  .object({
    verified: z.boolean(),
    reviewedBy: z.string(),
    at: z.string(),
    artifacts: z.array(z.string()).max(30),
    note: z.string(),
  })
  .strict();
const schema = z.record(z.enum(gateNames), entry);
const filename = resolve("release-evidence.local.json");
const evidence = existsSync(filename)
  ? schema.parse(JSON.parse(readFileSync(filename, "utf8")))
  : null;
function artifactExists(path: string) {
  const local = relative(process.cwd(), resolve(path));
  return (
    !isAbsolute(local) &&
    !local.startsWith("..") &&
    /^docs[\\/]evidence[\\/]/.test(local) &&
    existsSync(resolve(local))
  );
}
const configured: Record<(typeof gateNames)[number], boolean> = {
  paypal:
    Object.values(config.vendors).length === 3 &&
    Object.values(config.vendors).every((v) => Boolean(v.webhookId)),
  ai:
    config.AI_PROVIDER !== "none" &&
    config.AI_QUALIFIED === "true" &&
    (config.AI_PROVIDER === "groq"
      ? Boolean(config.GROQ_API_KEY)
      : Boolean(
          config.ASTRO_GATEWAY_API_KEY &&
            config.ASTRO_GATEWAY_URL &&
            Date.parse(config.AI_CREDIT_EXPIRES_AT) >=
              Date.parse("2026-12-16T00:00:00Z"),
        )),
  hosting:
    config.STORAGE_MODE === "supabase" &&
    config.APP_ORIGIN.startsWith("https://"),
  naming: true,
  submission: true,
};
const checks = gateNames.map((name) => {
  const record = evidence?.[name];
  const recorded = Boolean(
    record?.verified &&
      record.reviewedBy.trim() &&
      Number.isFinite(Date.parse(record.at)) &&
      Date.parse(record.at) <= Date.now() &&
      record.artifacts.length &&
      record.artifacts.every(artifactExists),
  );
  return {
    name,
    configured: configured[name],
    evidenceRecorded: recorded,
    passed: configured[name] && recorded,
  };
});
const ready = checks.every((c) => c.passed);
console.log(
  JSON.stringify(
    {
      project: "Bidcairn",
      at: new Date().toISOString(),
      submissionReady: ready,
      verification:
        "Checks configuration and reviewed evidence records; it does not independently certify upstream account terms, video content or payment settlement.",
      checks,
    },
    null,
    2,
  ),
);
process.exitCode = ready ? 0 : 1;
