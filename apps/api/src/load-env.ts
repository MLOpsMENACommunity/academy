// Loads apps/api/.env when present (local dev). In containers, env comes from the orchestrator.
try {
  process.loadEnvFile();
} catch {
  // no .env file: fine
}
