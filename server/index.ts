import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const { loadConfig } = await import("./config.js");
const { createApp } = await import("./app.js");
const config = loadConfig();
const { app, cleanupDocuments } = createApp(config);
const cleanup = () =>
  cleanupDocuments().catch(() =>
    console.warn("Private document cleanup will retry."),
  );
void cleanup();
const cleanupTimer = setInterval(() => void cleanup(), 60000);
cleanupTimer.unref();
const server = app.listen(
  config.PORT,
  config.production ? "0.0.0.0" : "127.0.0.1",
  () =>
    console.log(
      `Bidcairn: http://localhost:${config.PORT} (${config.STORAGE_MODE}; runtime AI: ${config.AI_PROVIDER})`,
    ),
);
const stop = () => {
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
