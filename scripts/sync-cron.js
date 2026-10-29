#!/usr/bin/env node
"use strict";

const apiBase = String(process.env.API_BASE_URL || "https://echo-air-group-api.onrender.com").replace(/\/$/, "");
const secret = String(process.env.SYNC_CRON_SECRET || "");

if (!secret || secret.length < 32) {
    console.error("SYNC_CRON_SECRET must be configured with at least 32 characters.");
    process.exit(1);
}

async function main() {
    const response = await fetch(apiBase + "/api/internal/cron/sync", {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Sync-Cron-Secret": secret
        },
        body: JSON.stringify({ source: "render-cron" }),
        signal: AbortSignal.timeout(15 * 60 * 1000)
    });

    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}

    if (!response.ok) {
        console.error("Background flight sync returned HTTP " + response.status + ".", payload.error || raw);
        process.exitCode = 1;
        return;
    }

    console.log(JSON.stringify({
        status: payload.status || "completed",
        mode: payload.mode || "unknown",
        linkedPilots: payload.linkedPilots ?? null,
        flightsReceived: payload.flightsReceived ?? null,
        flightsImported: payload.flightsImported ?? null,
        flightsUpdated: payload.flightsUpdated ?? null,
        fullHistorySync: Boolean(payload.fullHistorySync)
    }, null, 2));
}

main().catch((error) => {
    console.error("Could not call the Echo Air Group sync endpoint:", error && error.message || error);
    process.exitCode = 1;
});
