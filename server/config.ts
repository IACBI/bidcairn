import { randomBytes } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  STORAGE_MODE: z.enum(["local", "supabase"]).default("local"),
  DATA_DIR: z.string().default(".data"),
  SESSION_SECRET: z.string().default(""),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().default("proposals"),
  AI_PROVIDER: z.enum(["none", "groq", "astropods"]).default("none"),
  AI_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_API_KEY: z.string().default(""),
  ASTRO_GATEWAY_API_KEY: z.string().default(""),
  ASTRO_GATEWAY_URL: z.string().default(""),
  AI_QUALIFIED: z.string().default("false"),
  AI_FREE_CREDIT_USD: z.coerce.number().nonnegative().default(0),
  AI_CREDIT_EXPIRES_AT: z.string().default(""),
  AI_EVENT_BUDGET_USD: z.coerce.number().nonnegative().default(0),
  AI_JUDGING_RESERVE_USD: z.coerce.number().nonnegative().default(2),
  AI_DAILY_TOKEN_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(200000)
    .default(100000),
  AI_MAX_INPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .max(16000)
    .default(6000),
  AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .max(3000)
    .default(1800),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.15),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.6),
});
export type Config = z.infer<typeof envSchema> & {
  production: boolean;
  vendors: Record<
    string,
    { clientId: string; secret: string; webhookId: string; email: string }
  >;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  const production = env.NODE_ENV === "production";
  if (
    production &&
    (config.STORAGE_MODE !== "supabase" ||
      config.SESSION_SECRET.length < 32 ||
      !config.APP_ORIGIN.startsWith("https://"))
  )
    throw new Error(
      "Hosted mode requires Supabase, HTTPS APP_ORIGIN and a 32-character SESSION_SECRET.",
    );
  if (
    config.STORAGE_MODE === "supabase" &&
    (!config.SUPABASE_URL ||
      !config.SUPABASE_SERVICE_ROLE_KEY ||
      !config.SUPABASE_ANON_KEY)
  )
    throw new Error("Supabase configuration is incomplete.");
  if (
    config.AI_PROVIDER === "astropods" &&
    config.ASTRO_GATEWAY_URL &&
    !config.ASTRO_GATEWAY_URL.startsWith("https://")
  )
    throw new Error("The AI Gateway must use HTTPS.");
  const vendors: Config["vendors"] = {};
  for (const id of ["A", "B", "C"]) {
    const prefix = `PAYPAL_VENDOR_${id}_`;
    if (
      env[prefix + "CLIENT_ID"] &&
      env[prefix + "CLIENT_SECRET"] &&
      env[prefix + "EMAIL"]
    )
      vendors[id] = {
        clientId: env[prefix + "CLIENT_ID"]!,
        secret: env[prefix + "CLIENT_SECRET"]!,
        webhookId: env[prefix + "WEBHOOK_ID"] || "",
        email: env[prefix + "EMAIL"]!,
      };
  }
  return {
    ...config,
    SESSION_SECRET: config.SESSION_SECRET || randomBytes(32).toString("hex"),
    production,
    vendors,
  };
}
