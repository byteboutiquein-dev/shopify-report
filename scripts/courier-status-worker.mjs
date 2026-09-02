#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_LOG_POLL_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_LOG_POLL_INTERVAL_MS = 10_000;

let isStopping = false;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.COURIER_WORKER_BASE_URL ?? DEFAULT_BASE_URL,
    intervalMinutes: Number(process.env.COURIER_WORKER_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES),
    loop: false,
    pollLogs: true
  };

  for (const arg of argv) {
    if (arg === "--loop") {
      options.loop = true;
      continue;
    }

    if (arg === "--no-poll") {
      options.pollLogs = false;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg.startsWith("--interval-minutes=")) {
      options.intervalMinutes = Number(arg.slice("--interval-minutes=".length));
    }
  }

  if (!Number.isFinite(options.intervalMinutes) || options.intervalMinutes <= 0) {
    throw new Error("interval-minutes must be a positive number.");
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function fetchSupabase(pathname) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase read failed with HTTP ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function readLatestScheduledLog(startedAfterIso) {
  const query = new URLSearchParams({
    check_source: "eq.Scheduled",
    limit: "1",
    order: "started_at.desc",
    select: "id,started_at,finished_at,status,orders_checked,orders_updated,orders_failed,orders_skipped,error_message",
    started_at: `gte.${startedAfterIso}`
  });

  const rows = await fetchSupabase(`tracking_check_logs?${query.toString()}`);
  return rows[0] ?? null;
}

async function waitForScheduledLog(startedAfterIso) {
  const startedAt = Date.now();
  let lastLog = null;

  while (!isStopping && Date.now() - startedAt < DEFAULT_LOG_POLL_TIMEOUT_MS) {
    lastLog = await readLatestScheduledLog(startedAfterIso);

    if (lastLog?.finished_at) {
      return lastLog;
    }

    await sleep(DEFAULT_LOG_POLL_INTERVAL_MS);
  }

  return lastLog;
}

async function triggerCourierSync(baseUrl) {
  const cronSecret = requireEnv("CRON_SECRET");
  const triggerStartedAt = new Date().toISOString();
  const url = new URL("/api/cron/courier-status", baseUrl);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${cronSecret}`
    }
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    throw new Error(`Courier sync trigger failed with HTTP ${response.status}: ${text}`);
  }

  return {
    payload,
    triggerStartedAt
  };
}

async function runOnce(options) {
  const startedAt = new Date();
  console.log(`[${formatDateTime(startedAt.toISOString())}] Triggering courier status sync at ${options.baseUrl}`);

  const result = await triggerCourierSync(options.baseUrl);
  console.log(result.payload.message ?? "Courier sync accepted.");

  if (!options.pollLogs) {
    return;
  }

  const log = await waitForScheduledLog(result.triggerStartedAt);

  if (!log) {
    console.log("No tracking log appeared yet. The app may still be running the background task.");
    return;
  }

  if (!log.finished_at) {
    console.log(
      `Latest tracking log is still running: started ${formatDateTime(log.started_at)}, checked ${log.orders_checked ?? 0}.`
    );
    return;
  }

  console.log(
    [
      `Finished ${formatDateTime(log.finished_at)}`,
      `status=${log.status}`,
      `checked=${log.orders_checked ?? 0}`,
      `updated=${log.orders_updated ?? 0}`,
      `failed=${log.orders_failed ?? 0}`,
      `skipped=${log.orders_skipped ?? 0}`
    ].join(" | ")
  );

  if (log.error_message) {
    console.log(`Error: ${log.error_message}`);
  }
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));

  const options = parseArgs(process.argv.slice(2));

  process.on("SIGINT", () => {
    isStopping = true;
    console.log("\nStopping courier worker after the current wait.");
  });
  process.on("SIGTERM", () => {
    isStopping = true;
    console.log("\nStopping courier worker after the current wait.");
  });

  do {
    try {
      await runOnce(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }

    if (!options.loop || isStopping) {
      break;
    }

    const waitMs = options.intervalMinutes * 60 * 1000;
    console.log(`Waiting ${options.intervalMinutes} minutes before the next courier batch...`);
    await sleep(waitMs);
  } while (!isStopping);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
