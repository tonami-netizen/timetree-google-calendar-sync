import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

async function main(): Promise<void> {
  console.log("=== TimeTree → Google Calendar Sync ===\n");

  // 1. 設定読み込み
  const config = loadConfig();
  console.log("Config loaded.");

  // 2. timetree-exporter CLI で ICS エクスポート
  console.log("Exporting events from TimeTree...");
  exportFromTimeTree(config);

  if (!existsSync(config.icsFilePath)) {
    throw new Error(`ICS file not found: ${config.icsFilePath}`);
  }

  // 3. ICS パース
  console.log("Parsing ICS file...");
  //const events = parseIcsFile(config.icsFilePath);
  //console.log(`  Found ${events.length} events in ICS.`);

  const allEvents = parseIcsFile(config.icsFilePath);

  // Sync only events from 90 days ago through 1 year from today
  const now = new Date();

  const from = new Date(now);
  from.setDate(from.getDate() - 90);

  const until = new Date(now);
  until.setFullYear(until.getFullYear() + 1);

  const events = allEvents.filter(
    (event) => event.end >= from && event.start <= until
  );

  console.log(
    `  Found ${allEvents.length} events in ICS; ${events.length} within sync window.`
  );
  
  // 4. Google Calendar クライアント初期化
  const gcal = new GCalClient(config.googleCredentials, config.googleCalendarId);

  // 5. 同期済みイベント取得
  console.log("Fetching synced events from Google Calendar...");
  const syncedEvents = await gcal.listSyncedEvents();
  console.log(`  Found ${syncedEvents.length} synced events in Google Calendar.`);

  // 6. 差分計算
  const engine = new SyncEngine(gcal);
  const diff = engine.computeDiff(events, syncedEvents);
  console.log(
    `\nDiff: ${diff.toCreate.length} to create, ${diff.toUpdate.length} to update, ${diff.toDelete.length} to delete`
  );

  // 7. 差分適用
  if (
    diff.toCreate.length === 0 &&
    diff.toUpdate.length === 0 &&
    diff.toDelete.length === 0
  ) {
    console.log("\nNo changes to sync.");
    return;
  }

  console.log("\nApplying changes...");
  const result = await engine.applyDiff(diff);

  console.log(
    `\nSync complete: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, errors=${result.errors}`
  );

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

function exportFromTimeTree(config: {
  timetreeEmail: string;
  timetreePassword: string;
  timetreeCalendarCode: string;
  icsFilePath: string;
}): void {
  const cmd = [
    "timetree-exporter",
    "-e", config.timetreeEmail,
    "-c", config.timetreeCalendarCode,
    "-o", config.icsFilePath,
  ].join(" ");

  execSync(cmd, {
    env: {
      ...process.env,
      TIMETREE_PASSWORD: config.timetreePassword,
    },
    stdio: "inherit",
  });
}

main().catch((err) => {
  console.error("::error::Sync failed:", err);
  process.exitCode = 1;
});
