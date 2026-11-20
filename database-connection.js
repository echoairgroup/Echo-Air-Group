"use strict";

/**
 * Convert a standard Neon endpoint URL into its PgBouncer endpoint URL.
 * Non-Neon URLs and URLs already using the pooler are returned unchanged.
 */
function getDatabaseConnectionString(connectionString, usePooler = true) {
    if (!usePooler || typeof connectionString !== "string" || !connectionString.trim()) {
        return connectionString;
    }

    try {
        const parsed = new URL(connectionString);
        const hostname = parsed.hostname;

        if (
            hostname.endsWith(".neon.tech") &&
            /^ep-[^.]+\./i.test(hostname) &&
            !/-pooler\./i.test(hostname)
        ) {
            parsed.hostname = hostname.replace(/^(ep-[^.]+)\./i, "$1-pooler.");
        }

        return parsed.toString();
    } catch {
        // Preserve the original URL; the PostgreSQL client will report a
        // useful connection error if the supplied URL is invalid.
        return connectionString;
    }
}

module.exports = { getDatabaseConnectionString };
