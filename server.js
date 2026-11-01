const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { initializePlatformSchema, registerPlatformRoutes } = require("./platform-extension");
const { initializeOperationsSchema, registerOperationsRoutes } = require("./platform-operations");
const {
    buildNewSkyDateRanges,
    getNewSkyEndDateExclusive,
    getRecentNewSkyDateWindow
} = require("./newsky-date-ranges");

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

dotenv.config();

const app = express();

let databaseReady = false;
let cookieConsentRetentionTimer = null;
let databaseInitError = null;

// Render runs behind a reverse proxy; trust one hop so per-IP application limits use the visitor address.
app.set("trust proxy", 1);

// ============================================================
// BASIC CONFIGURATION
// ============================================================

app.use(cors());
app.use(express.json({ limit: "4mb" }));

// Keep the HTTP listener available even while Neon is warming up. API routes
// return a fast 503 until the schema has been initialized instead of causing
// Render to time out while waiting for an open port.
app.use((req, res, next) => {
    if (req.path === "/api/health" || req.path === "/") return next();
    if (databaseReady) return next();

    return res.status(503).json({
        error: "Echo Air Group backend is starting. Please retry shortly.",
        database: "initializing"
    });
});

const PORT =
    process.env.PORT || 3000;

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "CHANGE_THIS_SECRET";

const DATABASE_URL =
    process.env.DATABASE_URL;

// ============================================================
// ENVIRONMENT CHECKS
// ============================================================

if (!DATABASE_URL) {
    console.error(
        "ERROR: DATABASE_URL is missing."
    );

    process.exit(1);
}

if (!process.env.NEWSKY_API_KEY) {
    console.warn(
        "WARNING: NEWSKY_API_KEY is missing."
    );
}

if (!process.env.JWT_SECRET) {
    console.warn(
        "WARNING: JWT_SECRET is missing. Please set it in Render."
    );
}

// ============================================================
// POSTGRESQL / NEON
// ============================================================

const pool = new Pool({
    connectionString: DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    },

    max: 5,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
});

async function query(text, params = []) {
    return pool.query(text, params);
}

// Record successful administrative mutations without storing submitted form
// contents or other applicant/pilot personal data in the audit log.
app.use("/api", (req, res, next) => {
    const path = String(req.path || "");
    if (!path.startsWith("/admin/") || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    res.once("finish", () => {
        if (res.statusCode < 200 || res.statusCode >= 400 || !req.user) return;
        void query(
            "INSERT INTO platform_audit_log (actor_id, actor_username, action, target_type, details) VALUES ($1,$2,$3,$4,$5::jsonb)",
            [req.user.id, req.user.username || "unknown", req.method.toLowerCase() + " " + path.slice(0, 160), "admin_api",
                JSON.stringify({ method: req.method, path, status: res.statusCode })]
        ).catch(error => console.error("Admin audit event failed:", error.message));
    });
    next();
});

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,

            username TEXT UNIQUE NOT NULL,

            password TEXT NOT NULL,

            display_name TEXT,

            newsky_pilot_id TEXT,

            discord_user_id TEXT,

            created_at TIMESTAMPTZ
                DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Latest cookie-consent preference per browser identifier. No IP address or
    // raw device fingerprint is stored. A user account is linked only when the
    // visitor submits the choice while signed in.
    await query(`
        CREATE TABLE IF NOT EXISTS cookie_consent_records (
            visitor_id UUID PRIMARY KEY,
            choice TEXT NOT NULL CHECK (choice IN ('accepted', 'rejected', 'custom')),
            analytics_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            policy_version TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS cookie_consent_updated_idx
        ON cookie_consent_records (updated_at DESC);
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS flights (
            id SERIAL PRIMARY KEY,

            user_id INTEGER NOT NULL,

            newsky_id TEXT NOT NULL,

            dep_icao TEXT,

            arr_icao TEXT,

            aircraft TEXT,

            rating DOUBLE PRECISION
                DEFAULT 0,

            duration DOUBLE PRECISION
                DEFAULT 0,

            distance DOUBLE PRECISION
                DEFAULT 0,

            stars DOUBLE PRECISION
                DEFAULT 0,

            dep_time TEXT,

            synced_at TIMESTAMPTZ
                DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT flights_user_fk
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            CONSTRAINT unique_user_flight
                UNIQUE (
                    user_id,
                    newsky_id
                )
        );
    `);

    // --------------------------------------------------------
    // USER MIGRATIONS
    // --------------------------------------------------------

    await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS display_name TEXT;
    `);

    await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS newsky_pilot_id TEXT;
    `);

    await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS discord_user_id TEXT;
    `);

    // --------------------------------------------------------
    // FLIGHT MIGRATIONS
    // --------------------------------------------------------

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS dep_icao TEXT;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS arr_icao TEXT;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS aircraft TEXT;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION
        DEFAULT 0;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS duration DOUBLE PRECISION
        DEFAULT 0;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS distance DOUBLE PRECISION
        DEFAULT 0;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS stars DOUBLE PRECISION
        DEFAULT 0;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS dep_time TEXT;
    `);

    await query(`
        ALTER TABLE flights
        ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ
        DEFAULT CURRENT_TIMESTAMP;
    `);


    // WEBSITE CONTENT TABLES
    await query("CREATE TABLE IF NOT EXISTS site_items (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'announcement', target_page TEXT NOT NULL DEFAULT 'all', link_url TEXT, image_data BYTEA, image_mime TEXT, image_url TEXT, published BOOLEAN NOT NULL DEFAULT TRUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await query("CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await query(
        "INSERT INTO site_settings (setting_key, setting_value) VALUES ('discord_invite', $1) ON CONFLICT (setting_key) DO NOTHING",
        [process.env.DISCORD_INVITE_URL || "https://discord.gg/e7ePxYA24"]
    );

    await query(
        "UPDATE site_items SET target_page = 'index.html', updated_at = CURRENT_TIMESTAMP WHERE LOWER(category) = 'news' AND target_page <> 'index.html'"
    );

    // APPLICATION MANAGEMENT: captures new pilot and manager applications
    // while the public forms continue to submit to FormSubmit for email delivery.
    await query(`
        CREATE TABLE IF NOT EXISTS applications (
            id BIGSERIAL PRIMARY KEY,
            application_type TEXT NOT NULL CHECK (application_type IN ('pilot', 'manager')),
            full_name TEXT NOT NULL,
            email TEXT NOT NULL,
            discord_username TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'reviewing', 'shortlisted', 'accepted', 'rejected')),
            answers JSONB NOT NULL DEFAULT '{}'::jsonb,
            admin_notes TEXT NOT NULL DEFAULT '',
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await query("CREATE INDEX IF NOT EXISTS applications_submitted_at_idx ON applications (submitted_at DESC)");
    await query("CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status, application_type)");
    
    // Background flight-sync state. Stores only operational metadata, not flight payloads.
    await query(
        "CREATE TABLE IF NOT EXISTS flight_sync_state (" +
        "sync_key TEXT PRIMARY KEY, " +
        "status TEXT NOT NULL DEFAULT 'idle', " +
        "last_started_at TIMESTAMPTZ, " +
        "last_completed_at TIMESTAMPTZ, " +
        "last_full_sync_at TIMESTAMPTZ, " +
        "last_error TEXT, " +
        "linked_pilots INTEGER NOT NULL DEFAULT 0, " +
        "flights_received INTEGER NOT NULL DEFAULT 0, " +
        "flights_imported INTEGER NOT NULL DEFAULT 0, " +
        "flights_updated INTEGER NOT NULL DEFAULT 0)"
    );

    await query("ALTER TABLE flight_sync_state ADD COLUMN IF NOT EXISTS distance_parser_version INTEGER NOT NULL DEFAULT 0");



    console.log(
        "PostgreSQL / Neon database ready."
    );
}

// ============================================================
// DISCORD ENVIRONMENT
// ============================================================

const DISCORD_BOT_TOKEN =
    process.env.DISCORD_BOT_TOKEN || "";

const DISCORD_CLIENT_ID =
    process.env.DISCORD_CLIENT_ID || "";

const DISCORD_CLIENT_SECRET =
    process.env.DISCORD_CLIENT_SECRET || "";

const DISCORD_GUILD_ID =
    process.env.DISCORD_GUILD_ID || "";

const DISCORD_REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI || "";

// ============================================================
// DISCORD ROLE IDS
// ============================================================

const DISCORD_ROLE_IDS = {

    "Cadet":
        process.env.DISCORD_ROLE_CADET || "",

    "First Officer":
        process.env.DISCORD_ROLE_FIRST_OFFICER || "",

    "Senior First Officer":
        process.env.DISCORD_ROLE_SENIOR_FIRST_OFFICER || "",

    "Captain":
        process.env.DISCORD_ROLE_CAPTAIN || "",

    "Senior Captain":
        process.env.DISCORD_ROLE_SENIOR_CAPTAIN || "",

    "Commander":
        process.env.DISCORD_ROLE_COMMANDER || ""
};

// ============================================================
// RANK SYSTEM
// ============================================================

const RANKS = [

    {
        name: "Cadet",
        stars: 0
    },

    {
        name: "First Officer",
        stars: 1000
    },

    {
        name: "Senior First Officer",
        stars: 2500
    },

    {
        name: "Captain",
        stars: 5000
    },

    {
        name: "Senior Captain",
        stars: 7500
    },

    {
        name: "Commander",
        stars: 10000
    }
];

function getRank(stars) {

    const value =
        Number(stars) || 0;

    let current =
        RANKS[0];

    let next = null;

    for (const rank of RANKS) {

        if (value >= rank.stars) {

            current = rank;

        } else {

            next = rank;

            break;
        }
    }

    return {
        current,
        next
    };
}

// ============================================================
// HELPERS
// ============================================================

function toNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function round(
    value,
    decimals = 2
) {

    const factor =
        Math.pow(
            10,
            decimals
        );

    return (
        Math.round(
            value * factor
        ) / factor
    );
}

function firstValue(
    object,
    keys
) {

    if (
        !object ||
        typeof object !== "object"
    ) {
        return null;
    }

    for (const key of keys) {

        if (
            object[key] !== undefined &&
            object[key] !== null &&
            object[key] !== ""
        ) {

            return object[key];
        }
    }

    return null;
}

// ============================================================
// NEWSKY PILOT ID
// ============================================================

function getPilotId(flight) {

    if (
        !flight ||
        typeof flight !== "object"
    ) {
        return "";
    }

    const direct =
        firstValue(
            flight,
            [
                "pilotId",
                "pilotID",
                "pilot_id",
                "newskyPilotId",
                "newsky_pilot_id"
            ]
        );

    if (direct !== null) {

        return String(
            direct
        ).trim();
    }

    if (
        flight.pilot &&
        typeof flight.pilot === "object"
    ) {

        const nested =
            firstValue(
                flight.pilot,
                [
                    "_id",
                    "id",
                    "pilotId",
                    "pilotID",
                    "newskyPilotId",
                    "newsky_pilot_id"
                ]
            );

        if (nested !== null) {

            return String(
                nested
            ).trim();
        }
    }

    if (
        flight.user &&
        typeof flight.user === "object"
    ) {

        const nested =
            firstValue(
                flight.user,
                [
                    "_id",
                    "id",
                    "pilotId",
                    "pilotID",
                    "pilot_id"
                ]
            );

        if (nested !== null) {

            return String(
                nested
            ).trim();
        }
    }

    if (
        flight.pilotProfile &&
        typeof flight.pilotProfile === "object"
    ) {

        const nested =
            firstValue(
                flight.pilotProfile,
                [
                    "_id",
                    "id",
                    "pilotId",
                    "pilotID",
                    "pilot_id"
                ]
            );

        if (nested !== null) {

            return String(
                nested
            ).trim();
        }
    }

    return "";
}

// ============================================================
// NEWSKY FLIGHT ID
// ============================================================

function getNewSkyFlightId(flight) {

    const value =
        firstValue(
            flight,
            [
                "_id",
                "id",
                "flightId",
                "flightID",
                "flight_id",
                "uuid"
            ]
        );

    if (value === null) {

        return null;
    }

    return String(value);
}

// ============================================================
// AIRPORT CODE
// ============================================================

function extractAirportCode(
    value,
    depth = 0
) {

    if (
        value === null ||
        value === undefined ||
        depth > 6
    ) {
        return null;
    }

    if (
        typeof value === "string"
    ) {

        const text =
            value.trim();

        return text || null;
    }

    if (
        typeof value === "number"
    ) {

        return String(value);
    }

    if (
        typeof value === "object" &&
        !Array.isArray(value)
    ) {

        const directCode =
            firstValue(
                value,
                [
                    "icao",
                    "ICAO",
                    "icaoCode",
                    "ICAOCode",
                    "icao_code",
                    "iata",
                    "IATA",
                    "iataCode",
                    "IATACode",
                    "iata_code",
                    "airportCode",
                    "airport_code",
                    "code",
                    "identifier"
                ]
            );

        if (
            directCode !== null &&
            typeof directCode !== "object"
        ) {

            const code =
                String(
                    directCode
                ).trim();

            if (code) {

                return code;
            }
        }

        const nestedAirport =
            firstValue(
                value,
                [
                    "airport",
                    "Airport",
                    "airportData",
                    "airportInfo",
                    "location"
                ]
            );

        if (
            nestedAirport !== null
        ) {

            const nestedCode =
                extractAirportCode(
                    nestedAirport,
                    depth + 1
                );

            if (nestedCode) {

                return nestedCode;
            }
        }

        for (
            const key of Object.keys(value)
        ) {

            const nestedValue =
                value[key];

            if (
                nestedValue === null ||
                nestedValue === undefined
            ) {
                continue;
            }

            if (
                typeof nestedValue === "object"
            ) {

                const nestedCode =
                    extractAirportCode(
                        nestedValue,
                        depth + 1
                    );

                if (nestedCode) {

                    return nestedCode;
                }
            }
        }
    }

    return null;
}

// ============================================================
// DEPARTURE
// ============================================================

function getDeparture(flight) {

    const raw =
        firstValue(
            flight,
            [
                "depIcao",
                "departureIcao",
                "departureICAO",
                "dep_icao",
                "departure",
                "origin",
                "from",
                "dep"
            ]
        );

    return extractAirportCode(raw);
}

// ============================================================
// ARRIVAL
// ============================================================

function getArrival(flight) {

    const raw =
        firstValue(
            flight,
            [
                "arrIcao",
                "arrivalIcao",
                "arrivalICAO",
                "arr_icao",
                "arrival",
                "destination",
                "to",
                "arr"
            ]
        );

    return extractAirportCode(raw);
}

// ============================================================
// AIRCRAFT
// ============================================================

function getAircraft(flight) {

    const aircraft =
        firstValue(
            flight,
            [
                "aircraft",
                "aircraftName",
                "aircraftType",
                "aircraftModel",
                "plane",
                "planeName",
                "equipment",
                "aircraftIcao",
                "aircraftICAO",
                "type"
            ]
        );

    if (
        aircraft &&
        typeof aircraft === "object"
    ) {

        return (
            aircraft.name ||
            aircraft.model ||
            aircraft.icao ||
            aircraft.type ||
            "Unknown aircraft"
        );
    }

    return (
        aircraft ||
        "Unknown aircraft"
    );
}

function getAircraftRegistration(flight) {
    const aircraftObject = flight && flight.aircraft && typeof flight.aircraft === "object"
        ? flight.aircraft
        : null;
    const explicit = firstValue(flight, ["registration", "aircraftRegistration", "aircraft_registration", "tailNumber", "tail_number", "reg"]) ||
        firstValue(aircraftObject, ["registration", "tailNumber", "tail_number", "reg"]);
    const raw = String(explicit || getAircraft(flight) || "").trim().toUpperCase();
    const match = raw.match(/^(?:([A-Z0-9]{1,2}-[A-Z0-9]{3,5})|(N[1-9][0-9]{0,4}[A-Z]{0,2}))/);
    return match ? (match[1] || match[2]) : null;
}

function getAircraftType(flight) {
    const aircraftObject = flight && flight.aircraft && typeof flight.aircraft === "object"
        ? flight.aircraft
        : null;
    const direct = firstValue(flight, ["aircraftType", "aircraft_type", "aircraftModel", "aircraft_model", "icaoType", "icao_type", "equipmentType"]) ||
        firstValue(aircraftObject, ["model", "type", "icaoType", "icao_type", "icao"]);
    if (direct !== null && direct !== undefined && String(direct).trim()) {
        return String(direct).trim().slice(0, 120);
    }
    const raw = String(getAircraft(flight) || "").trim();
    if (!raw || getAircraftRegistration(flight)) return null;
    const model = raw.match(/^((?:Airbus|Boeing|Embraer|ATR|Bombardier|Cessna|Piper|Diamond|Fokker|De Havilland|McDonnell Douglas|Dassault|Beechcraft)\s+[A-Za-z0-9-]{2,20})/i);
    return model ? model[1] : null;
}

// ============================================================
// RATING
// ============================================================

function getRating(flight) {

    const rating =
        firstValue(
            flight,
            [
                "rating",
                "flightRating",
                "score",
                "grade",
                "performanceRating"
            ]
        );

    return toNumber(rating);
}

// ============================================================
// DURATION
// ============================================================

function getDurationMinutes(flight) {

    const value =
        firstValue(
            flight,
            [
                "duration",
                "durationMinutes",
                "flightDuration",
                "minutes",
                "flightTime"
            ]
        );

    if (value === null) {

        return 0;
    }

    if (
        typeof value === "string" &&
        value.includes(":")
    ) {

        const parts =
            value
                .split(":")
                .map(Number);

        if (parts.length === 2) {

            return (
                parts[0] * 60 +
                parts[1]
            );
        }

        if (parts.length === 3) {

            return (
                parts[0] * 60 +
                parts[1] +
                parts[2] / 60
            );
        }
    }

    return toNumber(value);
}

// ============================================================
// DISTANCE
// ============================================================

function getDistance(flight) {
    if (!flight || typeof flight !== "object") return 0;

    // NewSky can nest flight fields differently across API versions.
    // Prefer fields with explicit units and convert distance to kilometres.
    const seen = new Set();
    const candidates = [];
    const unitKeys = new Set(["distanceunit", "distanceunits", "unitdistance", "unitsdistance"]);
    const generalUnitKeys = new Set(["unit", "units", "measureunit", "measurementunit"]);

    function scalar(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? { amount: value, suffix: "" } : null;
        if (typeof value !== "string") return null;
        const match = value.trim().replace(/,/g, "").match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z ]*)$/);
        if (!match) return null;
        const amount = Number(match[1]);
        return Number.isFinite(amount) ? { amount, suffix: String(match[2] || "").trim().toLowerCase() } : null;
    }

    function readUnit(node) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return "";
        for (const [rawKey, value] of Object.entries(node)) {
            const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (unitKeys.has(key) || generalUnitKeys.has(key)) {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                    const inner = value.unit || value.units || value.name || value.label;
                    if (inner) return String(inner);
                }
            }
        }
        return "";
    }

    function factorFor(unit, key) {
        const u = String(unit || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const k = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (/nauticalmile|nauticalmiles|nmi/.test(k) || /^(nm|nmi|nauticalmile|nauticalmiles)$/.test(u) || /nautical/.test(u)) return 1.852;
        if (/distancemi|distancemiles|distanceinmiles|distanceinmi/.test(k) || /^(mi|mile|miles|statutemile|statutemiles)$/.test(u)) return 1.609344;
        // The existing stored-distance convention is kilometres when NewSky
        // does not provide a unit.
        return 1;
    }

    function walk(node, depth, inheritedUnit) {
        if (!node || typeof node !== "object" || Array.isArray(node) || depth > 6 || seen.has(node)) return;
        seen.add(node);
        const parentUnit = readUnit(node) || inheritedUnit || "";

        for (const [rawKey, rawValue] of Object.entries(node)) {
            const key = String(rawKey);
            const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
                const objectDistanceValue = rawValue.value ?? rawValue.amount ?? rawValue.distance ?? rawValue.total ?? rawValue.actual ?? rawValue.flown ?? rawValue.km ?? rawValue.nm ?? rawValue.miles;
                if (normalized.includes("distance") && objectDistanceValue !== undefined && objectDistanceValue !== null) {
                    const parsed = scalar(objectDistanceValue);
                    if (parsed && parsed.amount > 0) {
                        const unit = parsed.suffix || readUnit(rawValue) || parentUnit;
                        const explicit = /km|kilomet|nautical|miles?|distancemi|distancenm|distancenmi/.test(normalized) ? 30 : 10;
                        candidates.push({ value: parsed.amount * factorFor(unit, key), priority: explicit - depth / 10 });
                    }
                }
                walk(rawValue, depth + 1, readUnit(rawValue) || parentUnit);
                continue;
            }

            // Exclude distances of individual airport/runway/taxi components.
            if (/distance(from|to|until|remaining|taxi|gate|runway|threshold|horizontal|vertical|departureairport|arrivalairport)/.test(normalized)) continue;
            if (!normalized.includes("distance") && !["nauticalmiles", "milesflown", "nmflown"].includes(normalized)) continue;

            const parsed = scalar(rawValue);
            if (!parsed || parsed.amount <= 0) continue;
            const explicit = /km|kilomet|nautical|miles?|distancemi|distancenm|distancenmi/.test(normalized) ? 30 : 10;
            const converted = parsed.amount * factorFor(parsed.suffix || parentUnit, key);
            if (Number.isFinite(converted) && converted > 0) {
                candidates.push({ value: converted, priority: explicit - depth / 10 });
            }
        }
    }

    walk(flight, 0, "");
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates.length ? round(candidates[0].value, 2) : 0;
}

// ============================================================
// DATE
// ============================================================

function getFlightDate(flight) {

    return firstValue(
        flight,
        [
            "depTimeAct",
            "depTime",
            "departureTime",
            "departureDate",
            "date",
            "createdAt",
            "flightDate"
        ]
    );
}

// ============================================================
// STAR CALCULATION
// ============================================================

function calculateFlightStars(
    duration,
    distance,
    rating
) {

    const minutes =
        toNumber(duration);

    const km =
        toNumber(distance);

    const flightRating =
        toNumber(rating);

    return round(
        minutes +
        km / 10 +
        flightRating,
        2
    );
}

// ============================================================
// FORMAT FLIGHT
// ============================================================

function formatFlight(flight) {

    return {

        id:
            flight.id,

        newskyId:
            flight.newsky_id,

        depIcao:
            flight.dep_icao,

        arrIcao:
            flight.arr_icao,

        aircraft:
            flight.aircraft,

        rating:
            round(
                toNumber(
                    flight.rating
                ),
                2
            ),

        duration:
            round(
                toNumber(
                    flight.duration
                ),
                2
            ),

        distance:
            round(
                toNumber(
                    flight.distance
                ),
                2
            ),

        stars:
            round(
                toNumber(
                    flight.stars
                ),
                2
            ),

        depTime:
            flight.dep_time,

        syncedAt:
            flight.synced_at
    };
}

// ============================================================
// ACHIEVEMENTS
// ============================================================

function getAchievements(stats) {

    return [

        {
            id: "first-flight",
            name: "First Flight",
            description:
                "Complete your first flight.",
            icon: "🛫",
            unlocked:
                stats.flightCount >= 1
        },

        {
            id: "airborne",
            name: "Airborne",
            description:
                "Complete 10 flights.",
            icon: "✈️",
            unlocked:
                stats.flightCount >= 10
        },

        {
            id: "pilot",
            name: "Experienced Pilot",
            description:
                "Complete 50 flights.",
            icon: "👨‍✈️",
            unlocked:
                stats.flightCount >= 50
        },

        {
            id: "veteran",
            name: "Veteran Pilot",
            description:
                "Complete 100 flights.",
            icon: "🎖️",
            unlocked:
                stats.flightCount >= 100
        },

        {
            id: "globetrotter",
            name: "Globetrotter",
            description:
                "Fly 10,000 km.",
            icon: "🌍",
            unlocked:
                stats.distance >= 10000
        },

        {
            id: "world-traveler",
            name: "World Traveler",
            description:
                "Fly 50,000 km.",
            icon: "🌎",
            unlocked:
                stats.distance >= 50000
        },

        {
            id: "explorer",
            name: "Explorer",
            description:
                "Fly 100,000 km.",
            icon: "🧭",
            unlocked:
                stats.distance >= 100000
        },

        {
            id: "long-haul",
            name: "Long Hauler",
            description:
                "Fly 100 flight hours.",
            icon: "⏱️",
            unlocked:
                stats.flightHours >= 100
        },

        {
            id: "sky-master",
            name: "Sky Master",
            description:
                "Fly 250 flight hours.",
            icon: "☁️",
            unlocked:
                stats.flightHours >= 250
        },

        {
            id: "five-star",
            name: "Five Star Pilot",
            description:
                "Achieve an average rating of 5.00.",
            icon: "⭐",
            unlocked:
                stats.flightCount > 0 &&
                stats.averageRating >= 5
        },

        {
            id: "first-officer",
            name: "First Officer",
            description:
                "Reach 1,000 stars.",
            icon: "🥇",
            unlocked:
                stats.stars >= 1000
        },

        {
            id: "captain",
            name: "Captain",
            description:
                "Reach 5,000 stars.",
            icon: "🏆",
            unlocked:
                stats.stars >= 5000
        },

        {
            id: "senior-captain",
            name: "Senior Captain",
            description:
                "Reach 7,500 stars.",
            icon: "👑",
            unlocked:
                stats.stars >= 7500
        },

        {
            id: "commander",
            name: "Commander",
            description:
                "Reach 10,000 stars.",
            icon: "🚀",
            unlocked:
                stats.stars >= 10000
        }
    ];
}

// ============================================================
// USER STATS
// ============================================================

async function getUserStats(userId) {

    const result =
        await query(
            `
            SELECT *
            FROM flights
            WHERE user_id = $1
            ORDER BY
                dep_time DESC NULLS LAST,
                id DESC
            `,
            [userId]
        );

    const flights =
        result.rows;

    const flightCount =
        flights.length;

    const stars =
        flights.reduce(
            (
                total,
                flight
            ) =>
                total +
                toNumber(
                    flight.stars
                ),
            0
        );

    const knownDistances =
        flights
            .map(flight => toNumber(flight.distance))
            .filter(value => Number.isFinite(value) && value > 0);

    const distance =
        knownDistances.length
            ? knownDistances.reduce((total, value) => total + value, 0)
            : null;

    const duration =
        flights.reduce(
            (
                total,
                flight
            ) =>
                total +
                toNumber(
                    flight.duration
                ),
            0
        );

    const ratingTotal =
        flights.reduce(
            (
                total,
                flight
            ) =>
                total +
                toNumber(
                    flight.rating
                ),
            0
        );

    const averageRating =
        flightCount > 0
            ? ratingTotal / flightCount
            : 0;

    const flightHours =
        duration / 60;

    const rankData =
        getRank(stars);

    let progress = 100;

    if (rankData.next) {

        progress =
            (
                (
                    stars -
                    rankData.current.stars
                ) /
                (
                    rankData.next.stars -
                    rankData.current.stars
                )
            ) * 100;

        progress =
            Math.max(
                0,
                Math.min(
                    100,
                    progress
                )
            );
    }

    return {

        flights,

        flightCount,

        stars:
            round(
                stars,
                2
            ),

        distance:
            distance === null
                ? null
                : round(distance, 2),

        duration:
            round(
                duration,
                2
            ),

        flightHours:
            round(
                flightHours,
                1
            ),

        averageRating:
            round(
                averageRating,
                2
            ),

        rank:
            rankData.current,

        nextRank:
            rankData.next,

        progress:
            round(
                progress,
                1
            )
    };
}

// ============================================================
// AUTHENTICATION
// ============================================================

function createToken(user) {

    return jwt.sign(
        {
            id:
                user.id,

            username:
                user.username
        },

        JWT_SECRET,

        {
            expiresIn:
                "30d"
        }
    );
}

async function authenticate(
    req,
    res,
    next
) {

    const header =
        req.headers.authorization;

    if (
        !header ||
        !header.startsWith("Bearer ")
    ) {

        return res.status(401).json({
            error:
                "Authentication required"
        });
    }

    const token =
        header.substring(7);

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        const result =
            await query(
                `
                SELECT *
                FROM users
                WHERE id = $1
                `,
                [decoded.id]
            );

        const user =
            result.rows[0];

        if (!user) {

            return res.status(401).json({
                error:
                    "User not found"
            });
        }

        req.user =
            user;

        next();

    } catch (error) {

        return res.status(401).json({
            error:
                "Invalid or expired token"
        });
    }
}



// WEBSITE ADMIN ACCESS
// Root administrators are controlled by ADMIN_USERNAMES. Delegated "admin"
// accounts are existing pilot accounts with an explicit Neon role assignment.
function authenticateAdmin(req, res, next) {
    const allowedUsernames = String(process.env.ADMIN_USERNAMES || "")
        .split(",")
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);

    return authenticate(req, res, async () => {
        const username = String(req.user && req.user.username || "")
            .trim()
            .toLowerCase();

        if (allowedUsernames.includes(username)) return next();

        try {
            const result = await query(
                "SELECT role FROM platform_admin_roles WHERE user_id = $1",
                [req.user.id]
            );
            if (result.rows[0] && result.rows[0].role === "admin") return next();
            return res.status(403).json({
                error: "This account is not authorized to manage website content or applications."
            });
        } catch (error) {
            console.error("Delegated admin access check failed:", error.message);
            return res.status(503).json({ error: "Administrator access is temporarily unavailable." });
        }
    });
}


// ============================================================
// DISCORD BOT
// ============================================================

let discordClient = null;
let discordReady = false;
let discordStartPromise = null;
let discordReconnectTimer = null;
let discordReconnectAttempt = 0;
let discordPublicGatewayProbeStarted = false;

function clearDiscordReconnectTimer() {
    if (discordReconnectTimer) {
        clearTimeout(discordReconnectTimer);
        discordReconnectTimer = null;
    }
}

function scheduleDiscordReconnect(reason) {
    discordReady = false;

    if (!DISCORD_BOT_TOKEN || discordReconnectTimer) {
        return;
    }

    const delayMs = Math.min(
        60_000,
        5_000 * (2 ** Math.min(discordReconnectAttempt, 4))
    );
    discordReconnectAttempt += 1;

    console.warn(
        `[Discord] Bot is offline. Retrying in ${Math.round(delayMs / 1000)}s. Reason: ${reason}`
    );

    discordReconnectTimer = setTimeout(() => {
        discordReconnectTimer = null;
        void startDiscordBot().catch(error => {
            console.error("[Discord] Reconnect attempt failed:", error.message);
            scheduleDiscordReconnect("reconnect attempt failed");
        });
    }, delayMs);

    if (typeof discordReconnectTimer.unref === "function") {
        discordReconnectTimer.unref();
    }
}

function markDiscordReady(client, source) {
    if (discordClient !== client) {
        return;
    }

    discordReady = true;
    discordReconnectAttempt = 0;
    clearDiscordReconnectTimer();

    console.log(
        `[Discord] Gateway connected (${source}) as ${client.user?.tag || "bot"}`
    );
}

async function startDiscordBot() {
    if (!DISCORD_BOT_TOKEN) {
        discordReady = false;
        console.warn("[Discord] Bot disabled: DISCORD_BOT_TOKEN is missing.");
        return;
    }

    if (!DISCORD_GUILD_ID) {
        console.warn("[Discord] DISCORD_GUILD_ID is missing; role synchronization cannot access a server.");
    }

    if (discordReady && discordClient) {
        return;
    }

    if (discordStartPromise) {
        return discordStartPromise;
    }

    discordStartPromise = Promise.resolve().then(() => {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds
            ]
        });

        discordClient = client;

        const onReadyTimeout = () => {
            readyTimeout = null;

            if (discordClient !== client || discordReady) {
                return;
            }

            console.error("[Discord] Gateway did not become ready before its current connection deadline.");

            try {
                client.destroy();
            } catch (error) {
                console.warn("[Discord] Error closing timed-out client:", error.message);
            }

            discordClient = null;
            discordReady = false;
            scheduleDiscordReconnect("gateway ready timeout");
        };

        let readyTimeout = setTimeout(onReadyTimeout, 180_000);

        if (typeof readyTimeout.unref === "function") {
            readyTimeout.unref();
        }

        client.once("ready", async () => {
            if (readyTimeout) {
                clearTimeout(readyTimeout);
                readyTimeout = null;
            }

            markDiscordReady(client, "ready event");

            if (!DISCORD_GUILD_ID) {
                return;
            }

            try {
                const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
                console.log(`[Discord] Connected to server: ${guild.name}`);
            } catch (error) {
                console.error("[Discord] Could not access configured server:", error.message);
            }
        });

        client.on("shardDisconnect", (closeEvent, shardId) => {
            discordReady = false;
            console.warn(
                `[Discord] Gateway disconnected (shard ${shardId}, code ${closeEvent?.code ?? "unknown"}).`
            );
        });

        client.on("shardReconnecting", shardId => {
            discordReady = false;
            console.warn(`[Discord] Gateway reconnecting (shard ${shardId}).`);
        });

        client.on("shardResume", shardId => {
            markDiscordReady(client, `shard ${shardId} resumed`);
        });

        client.on("shardError", error => {
            console.error("[Discord] Gateway shard error:", error.message);
        });

        client.on("error", error => {
            console.error("[Discord] Client error:", error.message);
        });

        client.on("invalidated", () => {
            discordReady = false;
            console.error("[Discord] Gateway session invalidated; restarting the client.");

            if (discordClient === client) {
                try {
                    client.destroy();
                } catch (error) {
                    console.warn("[Discord] Error closing invalidated client:", error.message);
                }
                discordClient = null;
            }

            scheduleDiscordReconnect("gateway session invalidated");
        });

        client.on("debug", message => {
            if (/WebSocket|gateway|READY|IDENTIFY|heartbeat|error|reconnect/i.test(message)) {
                console.log(`[Discord:debug] ${String(message).slice(0, 300)}`);
            }
        });

        client.rest.on("rateLimited", rateLimitInfo => {
            const retryAfterMs = Math.max(
                0,
                Number(rateLimitInfo.retryAfter || 0),
                Number(rateLimitInfo.timeToReset || 0),
                Number(rateLimitInfo.sublimitTimeout || 0)
            );

            console.warn(
                `[Discord] REST rate limit on ${rateLimitInfo.method} ${rateLimitInfo.route}; scope=${rateLimitInfo.scope}; global=${Boolean(rateLimitInfo.global)}; retryAfterMs=${retryAfterMs}.`
            );

            // discord.js queues 429 responses and retries them automatically.
            // Keep the gateway attempt alive until after that retry window instead
            // of destroying the client while its /gateway/bot request is queued.
            if (readyTimeout && retryAfterMs > 0) {
                clearTimeout(readyTimeout);
                const extendedWaitMs = Math.min(
                    2_147_000_000,
                    Math.max(180_000, retryAfterMs + 30_000)
                );
                readyTimeout = setTimeout(onReadyTimeout, extendedWaitMs);

                if (typeof readyTimeout.unref === "function") {
                    readyTimeout.unref();
                }

                console.warn(
                    `[Discord] Gateway READY deadline extended to allow the REST retry window (${Math.ceil(extendedWaitMs / 1000)}s).`
                );
            }
        });

        client.rest.on("restDebug", message => {
            const safeMessage = String(message)
                .replaceAll(DISCORD_BOT_TOKEN, "[REDACTED]")
                .replace(/(Authorization\s*:\s*(?:Bot|Bearer)\s+)\S+/gi, "$1[REDACTED]");
            console.log(`[Discord:REST:debug] ${safeMessage.slice(0, 300)}`);
        });

        console.log(
            `[Discord] Starting gateway connection (token configured; server ID configured: ${Boolean(DISCORD_GUILD_ID)}).`
        );

        // One public, unauthenticated probe distinguishes basic Render-to-Discord
        // reachability from bot-token or /gateway/bot rate-limit problems.
        if (!discordPublicGatewayProbeStarted) {
            discordPublicGatewayProbeStarted = true;
            const probeController = new AbortController();
            const probeTimeout = setTimeout(() => probeController.abort(), 10_000);

            void fetch("https://discord.com/api/v10/gateway", {
                signal: probeController.signal
            }).then(async response => {
                const payload = await response.json().catch(() => ({}));
                const retryAfterHeader = response.headers.get("retry-after");
                const retryAfterSeconds = Number(payload.retry_after ?? retryAfterHeader ?? 0);
                const rateLimitScope = response.headers.get("x-ratelimit-scope") || "unknown";
                const globalRateLimit =
                    response.headers.get("x-ratelimit-global") === "true" ||
                    payload.global === true;

                console.log(
                    `[Discord] Public gateway reachability: HTTP ${response.status}; gatewayUrlPresent=${Boolean(payload.url)}; retryAfterSeconds=${retryAfterSeconds || "none"}; scope=${rateLimitScope}; global=${globalRateLimit}.`
                );

                // An unauthenticated /gateway 429 is IP-scoped. Honour its
                // Retry-After (Discord specifies seconds) so the login promise
                // is not destroyed while Discord is still blocking this route.
                if (
                    response.status === 429 &&
                    Number.isFinite(retryAfterSeconds) &&
                    retryAfterSeconds > 0 &&
                    readyTimeout
                ) {
                    clearTimeout(readyTimeout);
                    const cooldownWaitMs = Math.min(
                        2_147_000_000,
                        Math.max(180_000, retryAfterSeconds * 1000 + 30_000)
                    );
                    readyTimeout = setTimeout(onReadyTimeout, cooldownWaitMs);

                    if (typeof readyTimeout.unref === "function") {
                        readyTimeout.unref();
                    }

                    console.warn(
                        `[Discord] Keeping the gateway login alive through the IP rate-limit cooldown (${Math.ceil(cooldownWaitMs / 1000)} seconds).`
                    );
                }
            }).catch(error => {
                console.error("[Discord] Public gateway reachability failed:", error.message);
            }).finally(() => {
                clearTimeout(probeTimeout);
            });
        }

        // Let discord.js manage Discord's own API rate limits. An extra
        // /users/@me probe can consume the same REST budget and does not prove
        // gateway availability, so keep diagnostics on the gateway connection.
        void client.login(DISCORD_BOT_TOKEN).catch(error => {
            if (readyTimeout) {
                clearTimeout(readyTimeout);
                readyTimeout = null;
            }

            if (discordClient !== client) {
                return;
            }

            discordReady = false;
            console.error(
                `[Discord] Login failed (code ${error.code ?? "unknown"}): ${error.message}`
            );

            try {
                client.destroy();
            } catch (destroyError) {
                console.warn("[Discord] Error closing failed client:", destroyError.message);
            }

            discordClient = null;
            scheduleDiscordReconnect("login failed");
        });
    }).finally(() => {
        discordStartPromise = null;
    });

    return discordStartPromise;
}

// ============================================================
// DISCORD ROLE SYNC
// ============================================================

async function syncDiscordRank(userId) {

    if (!discordClient) {

        return {
            success: false,
            reason:
                "Discord bot is not configured."
        };
    }

    if (!discordReady) {

        return {
            success: false,
            reason:
                "Discord bot is not ready."
        };
    }

    if (!DISCORD_GUILD_ID) {

        return {
            success: false,
            reason:
                "DISCORD_GUILD_ID is missing."
        };
    }

    const userResult =
        await query(
            `
            SELECT *
            FROM users
            WHERE id = $1
            `,
            [userId]
        );

    const user =
        userResult.rows[0];

    if (!user) {

        return {
            success: false,
            reason:
                "Website user not found."
        };
    }

    if (!user.discord_user_id) {

        return {
            success: false,
            reason:
                "Discord account is not linked."
        };
    }

    const stats =
        await getUserStats(
            user.id
        );

    const rankName =
        stats.rank.name;

    const targetRoleId =
        DISCORD_ROLE_IDS[
            rankName
        ];

    if (!targetRoleId) {

        return {
            success: false,
            reason:
                `No Discord role configured for ${rankName}.`
        };
    }

    try {

        const guild =
            await discordClient.guilds.fetch(
                DISCORD_GUILD_ID
            );

        let member;

        try {

            member =
                await guild.members.fetch(
                    user.discord_user_id
                );

        } catch {

            return {
                success: false,
                reason:
                    "Discord user is not a member of the server."
            };
        }

        const rankRoleIds =
            Object.values(
                DISCORD_ROLE_IDS
            ).filter(Boolean);

        for (
            const roleId of rankRoleIds
        ) {

            if (
                member.roles.cache.has(roleId) &&
                roleId !== targetRoleId
            ) {

                try {

                    await member.roles.remove(
                        roleId,
                        "Echo Air Group website rank synchronization"
                    );

                } catch (error) {

                    console.error(
                        `Could not remove Discord role ${roleId}:`,
                        error.message
                    );
                }
            }
        }

        if (
            !member.roles.cache.has(
                targetRoleId
            )
        ) {

            await member.roles.add(
                targetRoleId,
                "Echo Air Group website rank synchronization"
            );
        }

        return {

            success: true,

            rank:
                rankName,

            discordUserId:
                user.discord_user_id,

            roleId:
                targetRoleId
        };

    } catch (error) {

        console.error(
            `Discord role sync error for ${user.username}:`,
            error
        );

        return {

            success: false,

            reason:
                error.message
        };
    }
}

// ============================================================
// SYNC ALL DISCORD RANKS
// ============================================================

async function syncAllDiscordRanks() {

    const result =
        await query(
            `
            SELECT id
            FROM users
            WHERE
                discord_user_id IS NOT NULL
                AND TRIM(discord_user_id) != ''
            `
        );

    const users =
        result.rows;

    let success = 0;

    let failed = 0;

    for (
        const user of users
    ) {

        const syncResult =
            await syncDiscordRank(
                user.id
            );

        if (syncResult.success) {

            success++;

        } else {

            failed++;
        }

        await sleep(500);
    }

    return {

        total:
            users.length,

        success,

        failed
    };
}

// ============================================================
// ROOT
// ============================================================

app.get(
    "/",
    async (req, res) => {

        res.json({

            message:
                "Echo Air Group backend is running!",

            database:
                "PostgreSQL / Neon",

            discordBot:
                discordReady
                    ? "connected"
                    : "not connected",

            time:
                new Date().toISOString()
        });
    }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/api/health",
    async (req, res) => {
        if (!databaseReady) {
            return res.status(503).json({
                status: "starting",
                database: "initializing",
                discordBot: discordReady ? "connected" : "not connected",
                retrying: Boolean(databaseInitError),
                time: new Date().toISOString()
            });
        }

        try {
            await query("SELECT 1");
            return res.json({
                status: "ok",
                database: "connected",
                discordBot: discordReady ? "connected" : "not connected",
                automaticFlightSync: true,
                time: new Date().toISOString()
            });
        } catch (error) {
            console.error("Health check database query failed:", error.message);
            return res.status(503).json({
                status: "degraded",
                database: "disconnected",
                discordBot: discordReady ? "connected" : "not connected",
                time: new Date().toISOString()
            });
        }
    }
);

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            let {
                username,
                password
            } = req.body;

            username =
                String(
                    username || ""
                ).trim();

            password =
                String(
                    password || ""
                );

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Username and password are required"
                });
            }

            if (
                username.length < 3
            ) {

                return res.status(400).json({
                    error:
                        "Username must be at least 3 characters"
                });
            }

            if (
                password.length < 8
            ) {

                return res.status(400).json({
                    error:
                        "Password must be at least 8 characters"
                });
            }

            const existing =
                await query(
                    `
                    SELECT id
                    FROM users
                    WHERE LOWER(username) =
                        LOWER($1)
                    `,
                    [username]
                );

            if (
                existing.rows.length
            ) {

                return res.status(409).json({
                    error:
                        "Username already exists. Please choose another username."
                });
            }

            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );

            const result =
                await query(
                    `
                    INSERT INTO users
                    (
                        username,
                        password,
                        display_name
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3
                    )
                    RETURNING id, username
                    `,
                    [
                        username,
                        passwordHash,
                        username
                    ]
                );

            const user =
                result.rows[0];

            const token =
                createToken(user);

            res.status(201).json({

                message:
                    "Account created",

                token
            });

        } catch (error) {

            console.error(
                "Register error:",
                error
            );

            res.status(500).json({
                error:
                    "Could not create account"
            });
        }
    }
);

// ============================================================
// LOGIN
// ============================================================

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const password =
                String(
                    req.body.password || ""
                );

            const result =
                await query(
                    `
                    SELECT *
                    FROM users
                    WHERE LOWER(username) =
                        LOWER($1)
                    `,
                    [username]
                );

            const user =
                result.rows[0];

            if (!user) {

                return res.status(401).json({
                    error:
                        "Invalid username or password"
                });
            }

            const valid =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!valid) {

                return res.status(401).json({
                    error:
                        "Invalid username or password"
                });
            }

            const token =
                createToken(user);

            res.json({

                message:
                    "Login successful",

                token
            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({
                error:
                    "Could not login"
            });
        }
    }
);

// ============================================================
// MY PROFILE
// ============================================================

app.get(
    "/api/me",
    authenticate,
    async (req, res) => {

        try {

            const stats =
                await getUserStats(
                    req.user.id
                );

            res.json({

                user: {

                    id:
                        req.user.id,

                    username:
                        req.user.username,

                    displayName:
                        req.user.display_name ||
                        req.user.username,

                    newskyPilotId:
                        req.user.newsky_pilot_id ||
                        "",

                    discordUserId:
                        req.user.discord_user_id ||
                        "",

                    discordLinked:
                        Boolean(
                            req.user.discord_user_id
                        )
                },

                stats: {

                    stars:
                        stats.stars,

                    rank:
                        stats.rank.name,

                    rankMin:
                        stats.rank.stars,

                    nextRank:
                        stats.nextRank,

                    progress:
                        stats.progress,

                    flightCount:
                        stats.flightCount,

                    distance:
                        stats.distance,

                    flightHours:
                        stats.flightHours,

                    averageRating:
                        stats.averageRating
                },

                achievements:
                    getAchievements(stats),

                /*
                 * IMPORTANT:
                 *
                 * Do NOT use .slice(0, 100) here.
                 *
                 * This endpoint now returns every flight
                 * stored for the logged-in pilot.
                 */
                flights:
                    stats.flights
                        .map(formatFlight)
            });

        } catch (error) {

            console.error(
                "Profile error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to load profile."
            });
        }
    }
);

// ============================================================
// DISCORD OAUTH2 - START
// ============================================================

app.get(
    "/api/discord/login",
    async (req, res) => {

        try {

            if (
                !DISCORD_CLIENT_ID ||
                !DISCORD_CLIENT_SECRET ||
                !DISCORD_REDIRECT_URI
            ) {

                return res.status(500).json({
                    error:
                        "Discord OAuth2 is not configured on the server."
                });
            }

            const token =
                String(
                    req.query.token || ""
                );

            if (!token) {

                return res.status(401).json({
                    error:
                        "Website login token is required."
                });
            }

            let decoded;

            try {

                decoded =
                    jwt.verify(
                        token,
                        JWT_SECRET
                    );

            } catch {

                return res.status(401).json({
                    error:
                        "Invalid or expired website login token."
                });
            }

            const result =
                await query(
                    `
                    SELECT *
                    FROM users
                    WHERE id = $1
                    `,
                    [decoded.id]
                );

            const user =
                result.rows[0];

            if (!user) {

                return res.status(404).json({
                    error:
                        "Website user not found."
                });
            }

            const state =
                jwt.sign(
                    {
                        userId:
                            user.id,

                        purpose:
                            "discord-oauth"
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "10m"
                    }
                );

            const params =
                new URLSearchParams({

                    client_id:
                        DISCORD_CLIENT_ID,

                    redirect_uri:
                        DISCORD_REDIRECT_URI,

                    response_type:
                        "code",

                    scope:
                        "identify",

                    state
                });

            const discordUrl =
                `https://discord.com/oauth2/authorize?${params.toString()}`;

            res.redirect(
                discordUrl
            );

        } catch (error) {

            console.error(
                "Discord OAuth start error:",
                error
            );

            res.status(500).json({
                error:
                    "Could not start Discord connection."
            });
        }
    }
);

// ============================================================
// DISCORD OAUTH2 - CALLBACK
// ============================================================

app.get(
    "/api/discord/callback",
    async (req, res) => {

        try {

            const {
                code,
                state,
                error
            } = req.query;

            if (error) {

                return res.status(400).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord connection cancelled</h2>
                        <p>You can close this window and return to Echo Air Group.</p>
                    </body>
                    </html>
                `);
            }

            if (
                !code ||
                !state
            ) {

                return res.status(400).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord connection failed</h2>
                        <p>Missing OAuth information.</p>
                    </body>
                    </html>
                `);
            }

            let decoded;

            try {

                decoded =
                    jwt.verify(
                        state,
                        JWT_SECRET
                    );

            } catch {

                return res.status(400).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord connection expired</h2>
                        <p>Please try connecting Discord again.</p>
                    </body>
                    </html>
                `);
            }

            if (
                decoded.purpose !==
                "discord-oauth"
            ) {

                return res.status(400).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Invalid Discord connection</h2>
                    </body>
                    </html>
                `);
            }

            const userResult =
                await query(
                    `
                    SELECT *
                    FROM users
                    WHERE id = $1
                    `,
                    [decoded.userId]
                );

            const user =
                userResult.rows[0];

            if (!user) {

                return res.status(404).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Website account not found</h2>
                    </body>
                    </html>
                `);
            }

            // ------------------------------------------------
            // EXCHANGE CODE
            // ------------------------------------------------

            const tokenResponse =
                await fetch(
                    "https://discord.com/api/oauth2/token",
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            new URLSearchParams({

                                client_id:
                                    DISCORD_CLIENT_ID,

                                client_secret:
                                    DISCORD_CLIENT_SECRET,

                                grant_type:
                                    "authorization_code",

                                code:
                                    String(code),

                                redirect_uri:
                                    DISCORD_REDIRECT_URI
                            })
                    }
                );

            const tokenText =
                await tokenResponse.text();

            let tokenData;

            try {

                tokenData =
                    JSON.parse(
                        tokenText
                    );

            } catch {

                tokenData = {};
            }

            if (
                !tokenResponse.ok ||
                !tokenData.access_token
            ) {

                console.error(
                    "Discord OAuth token error:",
                    tokenData
                );

                return res.status(500).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord connection failed</h2>
                        <p>Could not authenticate with Discord.</p>
                    </body>
                    </html>
                `);
            }

            // ------------------------------------------------
            // GET DISCORD USER
            // ------------------------------------------------

            const discordUserResponse =
                await fetch(
                    "https://discord.com/api/users/@me",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${tokenData.access_token}`
                        }
                    }
                );

            const discordUser =
                await discordUserResponse.json();

            if (
                !discordUserResponse.ok ||
                !discordUser.id
            ) {

                console.error(
                    "Discord user lookup failed:",
                    discordUser
                );

                return res.status(500).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord connection failed</h2>
                        <p>Could not retrieve your Discord account.</p>
                    </body>
                    </html>
                `);
            }

            // ------------------------------------------------
            // CHECK EXISTING DISCORD LINK
            // ------------------------------------------------

            const existingUserResult =
                await query(
                    `
                    SELECT id, username
                    FROM users
                    WHERE discord_user_id = $1
                    AND id != $2
                    `,
                    [
                        String(
                            discordUser.id
                        ),

                        user.id
                    ]
                );

            if (
                existingUserResult.rows.length
            ) {

                return res.status(409).send(`
                    <html>
                    <body style="font-family:Arial;padding:40px">
                        <h2>Discord account already linked</h2>
                        <p>This Discord account is already connected to another Echo Air Group account.</p>
                    </body>
                    </html>
                `);
            }

            // ------------------------------------------------
            // SAVE DISCORD ID
            // ------------------------------------------------

            await query(
                `
                UPDATE users
                SET discord_user_id = $1
                WHERE id = $2
                `,
                [
                    String(
                        discordUser.id
                    ),

                    user.id
                ]
            );

            console.log(
                `Discord account ${discordUser.username} (${discordUser.id}) linked to website user ${user.username}.`
            );

            // ------------------------------------------------
            // INITIAL RANK SYNC
            // ------------------------------------------------

            const roleSync =
                await syncDiscordRank(
                    user.id
                );

            console.log(
                "Initial Discord rank sync:",
                roleSync
            );

            const stats =
                await getUserStats(
                    user.id
                );

            const rank =
                stats.rank.name;

            const discordName =
                discordUser.global_name ||
                discordUser.username;

            res.send(`
                <!DOCTYPE html>

                <html>

                <head>
                    <meta charset="UTF-8">
                    <title>Discord Connected</title>
                </head>

                <body style="
                    margin:0;
                    min-height:100vh;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    background:#f4f7f1;
                    font-family:Arial,sans-serif;
                ">

                    <div style="
                        background:white;
                        padding:40px;
                        border-radius:18px;
                        max-width:500px;
                        text-align:center;
                        box-shadow:0 10px 40px rgba(0,0,0,.08);
                    ">

                        <div style="
                            font-size:55px;
                            margin-bottom:15px;
                        ">✓</div>

                        <h1 style="
                            margin-bottom:10px;
                        ">
                            Discord connected!
                        </h1>

                        <p>
                            Your Echo Air Group account is now connected to
                            <strong>${escapeHtml(discordName)}</strong>.
                        </p>

                        <p>
                            Current rank:
                            <strong>${escapeHtml(rank)}</strong>
                        </p>

                        <p style="
                            color:#667;
                            font-size:14px;
                        ">
                            Your Discord rank role will now be synchronized
                            automatically.
                        </p>

                        <button
                            onclick="window.close()"
                            style="
                                border:0;
                                padding:12px 22px;
                                border-radius:10px;
                                cursor:pointer;
                                background:#ace336;
                                color:#18210f;
                                font-weight:bold;
                            "
                        >
                            Close
                        </button>

                    </div>

                </body>

                </html>
            `);

        } catch (error) {

            console.error(
                "Discord OAuth callback error:",
                error
            );

            res.status(500).send(`
                <html>
                <body style="font-family:Arial;padding:40px">
                    <h2>Discord connection failed</h2>
                    <p>An unexpected error occurred.</p>
                </body>
                </html>
            `);
        }
    }
);

// ============================================================
// DISCORD STATUS
// ============================================================

app.get(
    "/api/discord/status",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT discord_user_id
                    FROM users
                    WHERE id = $1
                    `,
                    [req.user.id]
                );

            const user =
                result.rows[0];

            res.json({

                connected:
                    Boolean(
                        user &&
                        user.discord_user_id
                    ),

                discordUserId:
                    user?.discord_user_id ||
                    null,

                botReady:
                    discordReady
            });

        } catch (error) {

            res.status(500).json({
                error:
                    "Unable to read Discord status."
            });
        }
    }
);

// ============================================================
// MANUAL DISCORD RANK SYNC
// ============================================================

app.post(
    "/api/discord/sync",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await syncDiscordRank(
                    req.user.id
                );

            if (!result.success) {

                return res.status(400).json(
                    result
                );
            }

            res.json({

                message:
                    "Discord rank synchronized.",

                ...result
            });

        } catch (error) {

            console.error(
                "Manual Discord sync error:",
                error
            );

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// LINK NEWSKY ACCOUNT
// ============================================================

app.post(
    "/api/account/link",
    authenticate,
    async (req, res) => {

        const cleanId =
            String(
                req.body.newskyPilotId ||
                ""
            ).trim();

        if (!cleanId) {

            return res.status(400).json({
                error:
                    "NewSky Pilot ID is required"
            });
        }

        try {

            await query(
                `
                UPDATE users
                SET newsky_pilot_id = $1
                WHERE id = $2
                `,
                [
                    cleanId,
                    req.user.id
                ]
            );

            res.json({

                message:
                    "NewSky Pilot ID linked successfully.",

                newskyPilotId:
                    cleanId
            });

        } catch (error) {

            console.error(
                "NewSky linking error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to link NewSky Pilot ID."
            });
        }
    }
);

// ============================================================
// NEWSKY CONFIGURATION
// ============================================================

const NEWSKY_AIRLINE_ID =
    process.env.NEWSKY_AIRLINE_ID ||
    "6671c567ed19d758f72965d4";

// Keep the airline history import aligned with the agreed reporting period.
// This is intentionally fixed so an old Render env var cannot silently move it.
const NEWSKY_MIN_DATE = "2024-01-01";

/*
 * NewSky allows pagination.
 *
 * 100 is NOT the total number of flights.
 * It is simply the number of flights requested per page.
 */
const NEWSKY_PAGE_SIZE =
    100;

const NEWSKY_RATE_LIMIT_DELAY =
    3500;

const NEWSKY_MAX_RETRIES =
    5;

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

// ============================================================
// DATE HELPERS
// ============================================================

function toDateOnly(value) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            `Invalid date: ${value}`
        );
    }

    return date
        .toISOString()
        .slice(0, 10);
}

function addDays(
    dateString,
    days
) {

    const date =
        new Date(
            `${dateString}T00:00:00.000Z`
        );

    date.setUTCDate(
        date.getUTCDate() +
        days
    );

    return date
        .toISOString()
        .slice(0, 10);
}

function minDate(a, b) {

    return a < b
        ? a
        : b;
}

// ============================================================
// NEWSKY BYDATE REQUEST
// ============================================================

async function getNewSkyFlightPage(
    start,
    end,
    skip = 0,
    count = NEWSKY_PAGE_SIZE
) {

    if (!process.env.NEWSKY_API_KEY) {

        throw new Error(
            "NEWSKY_API_KEY is not configured."
        );
    }

    const url =
        "https://newsky.app/api/airline-api/flights/bydate";

    console.log("");
    console.log("NewSky request:");
    console.log("URL:", url);
    console.log("Start:", start);
    console.log("End:", end);
    console.log("Skip:", skip);
    console.log("Count:", count);

    let response;

    let text = "";

    for (
        let attempt = 1;
        attempt <= NEWSKY_MAX_RETRIES;
        attempt++
    ) {

        try {
            response =
                await fetch(
                    url,
                    {
                        method:
                            "POST",

                        headers: {

                            Authorization:
                                `Bearer ${process.env.NEWSKY_API_KEY}`,

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                skip,

                                count,

                                start,

                                end,

                                includeDeleted:
                                    false
                            }),

                        // Never let a stalled NewSky request block the entire
                        // airline history import indefinitely.
                        signal: AbortSignal.timeout(30000)
                    }
                );

            text = await response.text();
        } catch (error) {
            console.warn(
                `NewSky request failed on attempt ${attempt}/${NEWSKY_MAX_RETRIES} for ${start} -> ${end}: ${error.message}`
            );

            if (attempt >= NEWSKY_MAX_RETRIES) {
                throw new Error(
                    `NewSky request failed after ${NEWSKY_MAX_RETRIES} attempts for ${start} -> ${end}: ${error.message}`
                );
            }

            const waitTime = Math.min(3000 * attempt, 15000);
            console.log(`Retrying failed NewSky request in ${Math.ceil(waitTime / 1000)} seconds...`);
            await sleep(waitTime);
            continue;
        }

        console.log(
            `NewSky HTTP status: ${response.status}`
        );

        if (response.status === 429 && attempt < NEWSKY_MAX_RETRIES) {
            console.warn(
                `NewSky rate limit reached. Attempt ${attempt}/${NEWSKY_MAX_RETRIES}.`
            );

            const retryAfter = response.headers.get("retry-after");
            let waitTime = 10000;

            if (retryAfter) {
                const retrySeconds = Number(retryAfter);
                if (Number.isFinite(retrySeconds)) {
                    waitTime = Math.max(retrySeconds * 1000, 10000);
                }
            }

            console.log(
                `Waiting ${Math.round(waitTime / 1000)} seconds before retry...`
            );
            await sleep(waitTime);
            continue;
        }

        if (
            (response.status === 408 || response.status >= 500) &&
            attempt < NEWSKY_MAX_RETRIES
        ) {
            const waitTime = Math.min(3000 * attempt, 15000);
            console.warn(
                `NewSky returned HTTP ${response.status}. Retrying in ${Math.ceil(waitTime / 1000)} seconds...`
            );
            await sleep(waitTime);
            continue;
        }

        break;
    }

    let data;

    try {

        data =
            JSON.parse(text);

    } catch {

        console.error(
            "Invalid JSON received from NewSky:",
            text
        );

        throw new Error(
            "NewSky returned an invalid JSON response."
        );
    }

    if (!response.ok) {

        console.error(
            "NewSky API error:",
            response.status,
            data
        );

        throw new Error(
            data.error ||
            data.message ||
            `NewSky API returned HTTP ${response.status}`
        );
    }

    return data;
}

// ============================================================
// EXTRACT FLIGHTS
// ============================================================

function extractFlights(data) {

    if (Array.isArray(data)) {

        return data;
    }

    if (
        data &&
        Array.isArray(data.results)
    ) {

        return data.results;
    }

    if (
        data &&
        Array.isArray(data.flights)
    ) {

        return data.flights;
    }

    if (
        data &&
        data.data &&
        Array.isArray(data.data)
    ) {

        return data.data;
    }

    if (
        data &&
        data.data &&
        Array.isArray(data.data.results)
    ) {

        return data.data.results;
    }

    if (
        data &&
        data.data &&
        Array.isArray(data.data.flights)
    ) {

        return data.data.flights;
    }

    return [];
}

// ============================================================
// GET TOTAL RESULT COUNT FROM NEWSKY RESPONSE
// ============================================================

function getTotalResultCount(data) {

    const possibleValues = [

        firstValue(
            data,
            [
                "totalResults",
                "totalCount",
                "total",
                "count"
            ]
        ),

        data?.data
            ? firstValue(
                data.data,
                [
                    "totalResults",
                    "totalCount",
                    "total",
                    "count"
                ]
            )
            : null,

        data?.meta
            ? firstValue(
                data.meta,
                [
                    "totalResults",
                    "totalCount",
                    "total",
                    "count"
                ]
            )
            : null,

        data?.pagination
            ? firstValue(
                data.pagination,
                [
                    "totalResults",
                    "totalCount",
                    "total"
                ]
            )
            : null
    ];

    for (
        const value of possibleValues
    ) {

        if (
            value !== null &&
            value !== undefined &&
            value !== ""
        ) {

            const number =
                Number(value);

            if (
                Number.isFinite(number) &&
                number >= 0
            ) {

                return number;
            }
        }
    }

    return null;
}

// ============================================================
// GET ALL ECHO AIR GROUP FLIGHTS
// ============================================================

async function getAllNewSkyFlights() {

    const allFlights =
        [];

    const today =
        toDateOnly(
            new Date()
        );

    const endDateExclusive =
        getNewSkyEndDateExclusive();

    const rangeStart =
        NEWSKY_MIN_DATE;

    let rangeNumber =
        0;

    // Count requests, not returned flights: empty date windows still consume
    // NewSky rate-limit budget and must not cause rapid-fire follow-up calls.
    let requestCount = 0;

    if (
        rangeStart >=
        endDateExclusive
    ) {

        throw new Error(
            `NEWSKY_HISTORY_START (${rangeStart}) must be before today's end boundary (${endDateExclusive}).`
        );
    }

    const dateRanges =
        buildNewSkyDateRanges(
            rangeStart,
            endDateExclusive,
            30
        );

    console.log("");
    console.log(
        "============================================================"
    );
    console.log(
        "STARTING FULL ECHO AIR GROUP NEWSKY SYNC"
    );
    console.log(
        "============================================================"
    );
    console.log(
        `Airline ID: ${NEWSKY_AIRLINE_ID}`
    );
    console.log(
        `History start: ${rangeStart}`
    );
    console.log(
        `History through (UTC): ${today}`
    );
    console.log(
        `History query end boundary (exclusive): ${endDateExclusive}`
    );
    console.log(
        `Page size: ${NEWSKY_PAGE_SIZE}`
    );
    console.log(
        "============================================================"
    );
    console.log("");

    for (const dateRange of dateRanges) {

        rangeNumber++;

        const rangeStart = dateRange.startDate;
        const rangeEnd = dateRange.endDateExclusive;

        console.log("");
        console.log(
            "------------------------------------------------------------"
        );
        console.log(
            `DATE RANGE ${rangeNumber}: ${rangeStart} -> ${rangeEnd}`
        );
        console.log(
            "------------------------------------------------------------"
        );

        let skip = 0;

        let page = 0;

        let rangeFlights = 0;

        while (true) {

            page++;

            /*
             * Respect the NewSky rate limit between every request in the
             * whole sync, including ranges that return zero flights.
             */
            if (requestCount > 0) {
                await sleep(NEWSKY_RATE_LIMIT_DELAY);
            }
            requestCount++;

            console.log(
                `Fetching page ${page} | skip=${skip} | count=${NEWSKY_PAGE_SIZE}`
            );

            const data =
                await getNewSkyFlightPage(
                    rangeStart,
                    rangeEnd,
                    skip,
                    NEWSKY_PAGE_SIZE
                );

            const flights =
                extractFlights(data);

            const totalResults =
                getTotalResultCount(data);

            console.log(
                `Received ${flights.length} flight(s)` +
                (
                    totalResults !== null
                        ? ` | total in range: ${totalResults}`
                        : ""
                )
            );

            /*
             * No results means there are no more pages.
             */
            if (
                flights.length === 0
            ) {

                console.log(
                    "No more flights in this date range."
                );

                break;
            }

            allFlights.push(
                ...flights
            );

            rangeFlights +=
                flights.length;

            /*
             * If NewSky tells us the total number of flights
             * and we have reached it, stop.
             */
            if (
                totalResults !== null &&
                skip + flights.length >=
                    totalResults
            ) {

                console.log(
                    `Reached NewSky total of ${totalResults} flight(s).`
                );

                break;
            }

            /*
             * If fewer than PAGE_SIZE flights were returned,
             * this is the final page.
             */
            if (
                flights.length <
                NEWSKY_PAGE_SIZE
            ) {

                console.log(
                    "Final partial page received."
                );

                break;
            }

            /*
             * IMPORTANT:
             *
             * If exactly 100 flights are returned, that does NOT
             * mean there are only 100 flights.
             *
             * Move to the next page.
             */
            skip +=
                flights.length;

            /*
             * Safety protection.
             *
             * Prevent an unexpected API response from causing
             * an infinite pagination loop.
             */
            if (
                page > 10000
            ) {

                throw new Error(
                    `Pagination safety limit reached for ${rangeStart} -> ${rangeEnd}.`
                );
            }
        }

        console.log(
            `Date range complete: ${rangeFlights} flight(s) received.`
        );

    }

    /*
     * NewSky data can theoretically contain the same flight
     * more than once across pages/date ranges.
     *
     * Deduplicate by NewSky flight ID.
     */
    const unique =
        new Map();

    let flightsWithoutId =
        0;

    for (
        const flight of allFlights
    ) {

        const id =
            getNewSkyFlightId(
                flight
            );

        if (id) {

            unique.set(
                String(id),
                flight
            );

        } else {

            flightsWithoutId++;
        }
    }

    const result =
        Array.from(
            unique.values()
        );

    console.log("");
    console.log(
        "============================================================"
    );
    console.log(
        "NEWSKY SYNC FINISHED"
    );
    console.log(
        `Raw flights received: ${allFlights.length}`
    );
    console.log(
        `Flights without an ID: ${flightsWithoutId}`
    );
    console.log(
        `Unique flights: ${result.length}`
    );
    console.log(
        "============================================================"
    );
    console.log("");

    return result;
}


// ============================================================
// RECENT NEWSKY FLIGHTS (bounded incremental sync)
// ============================================================

async function getRecentNewSkyFlights(days = 7) {
    // NewSky's end date is used as an exclusive boundary. Asking through
    // tomorrow therefore includes every flight recorded today (UTC).
    const { startDate, endDateExclusive } = getRecentNewSkyDateWindow(days);
    const allFlights = [];
    let skip = 0;
    let page = 0;

    while (true) {
        if (page > 0) await sleep(NEWSKY_RATE_LIMIT_DELAY);
        page++;

        const data = await getNewSkyFlightPage(startDate, endDateExclusive, skip, NEWSKY_PAGE_SIZE);
        const flights = extractFlights(data);
        const total = getTotalResultCount(data);

        if (!flights.length) break;
        allFlights.push(...flights);

        if (total !== null && skip + flights.length >= total) break;
        if (flights.length < NEWSKY_PAGE_SIZE) break;

        skip += flights.length;
        if (page > 10000) {
            throw new Error("Recent NewSky pagination safety limit reached.");
        }
    }

    const unique = new Map();
    for (const flight of allFlights) {
        const id = getNewSkyFlightId(flight);
        if (id) unique.set(String(id), flight);
    }
    return Array.from(unique.values());
}

// ============================================================
// USER MAP
// ============================================================

async function getLinkedPilotMap() {

    const result =
        await query(
            `
            SELECT
                id,
                username,
                display_name,
                newsky_pilot_id
            FROM users
            WHERE
                newsky_pilot_id IS NOT NULL
                AND TRIM(newsky_pilot_id) != ''
            `
        );

    const users =
        result.rows;

    const map =
        new Map();

    for (
        const user of users
    ) {

        map.set(
            String(
                user.newsky_pilot_id
            ).trim(),

            user
        );
    }

    return map;
}

// ============================================================
// SAVE FLIGHT
// ============================================================

async function saveFlight(
    client,
    data
) {

    const result =
        await client.query(
            `
            INSERT INTO flights
            (
                user_id,
                newsky_id,
                dep_icao,
                arr_icao,
                aircraft,
                aircraft_registration,
                aircraft_type,
                rating,
                duration,
                distance,
                stars,
                dep_time,
                synced_at
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                CURRENT_TIMESTAMP
            )

            ON CONFLICT
            (
                user_id,
                newsky_id
            )

            DO UPDATE SET

                dep_icao =
                    EXCLUDED.dep_icao,

                arr_icao =
                    EXCLUDED.arr_icao,

                aircraft =
                    EXCLUDED.aircraft,

                aircraft_registration =
                    EXCLUDED.aircraft_registration,

                aircraft_type =
                    EXCLUDED.aircraft_type,

                rating =
                    EXCLUDED.rating,

                duration =
                    EXCLUDED.duration,

                distance =
                    EXCLUDED.distance,

                stars =
                    EXCLUDED.stars,

                dep_time =
                    EXCLUDED.dep_time,

                synced_at =
                    CURRENT_TIMESTAMP

            RETURNING
                (xmax = 0) AS inserted
            `,

            [
                data.userId,
                data.newskyId,
                data.depIcao,
                data.arrIcao,
                data.aircraft,
                data.aircraftRegistration || null,
                data.aircraftType || null,
                data.rating,
                data.duration,
                data.distance,
                data.stars,
                data.depTime
            ]
        );

    return result.rows[0];
}

// ============================================================
// IMPORT ALL FLIGHTS
// ============================================================

async function importAllFlights(
    allFlights
) {

    const pilotMap =
        await getLinkedPilotMap();

    let imported = 0;

    let updated = 0;

    let skipped = 0;

    let unmatched = 0;

    const matchedPilots =
        new Set();

    const client =
        await pool.connect();

    try {

        await client.query(
            "BEGIN"
        );

        for (
            const flight of allFlights
        ) {

            const pilotId =
                getPilotId(flight);

            if (!pilotId) {

                skipped++;

                continue;
            }

            const user =
                pilotMap.get(
                    String(
                        pilotId
                    ).trim()
                );

            if (!user) {

                unmatched++;

                continue;
            }

            matchedPilots.add(
                user.id
            );

            const newskyId =
                getNewSkyFlightId(
                    flight
                );

            if (!newskyId) {

                skipped++;

                continue;
            }

            const departure =
                getDeparture(
                    flight
                );

            const arrival =
                getArrival(
                    flight
                );

            const aircraft =
                getAircraft(
                    flight
                );

            const aircraftRegistration =
                getAircraftRegistration(flight);

            const aircraftType =
                getAircraftType(flight);

            const rating =
                getRating(
                    flight
                );

            const duration =
                getDurationMinutes(
                    flight
                );

            const distance =
                getDistance(
                    flight
                );

            const depTime =
                getFlightDate(
                    flight
                );

            const stars =
                calculateFlightStars(
                    duration,
                    distance,
                    rating
                );

            const saveResult =
                await saveFlight(
                    client,
                    {

                        userId:
                            user.id,

                        newskyId,

                        depIcao:
                            departure ||
                            null,

                        arrIcao:
                            arrival ||
                            null,

                        aircraft:
                            aircraft
                                ? String(
                                    aircraft
                                )
                                : null,

                        aircraftRegistration,

                        aircraftType,

                        rating,

                        duration,

                        distance,

                        stars,

                        depTime:
                            depTime
                                ? String(
                                    depTime
                                )
                                : null
                    }
                );

            if (
                saveResult.inserted
            ) {

                imported++;

            } else {

                updated++;
            }
        }

        await client.query(
            "COMMIT"
        );

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();
    }

    return {

        imported,

        updated,

        skipped,

        unmatched,

        matchedPilots:
            matchedPilots.size
    };
}


// ============================================================
// SERVER-SIDE AUTOMATIC FLIGHT SYNC
// ============================================================

let automaticFlightSyncInProgress = false;
let automaticFlightSyncTimer = null;

async function runAutomaticFlightSync(mode = "recent") {
    if (automaticFlightSyncInProgress) {
        return { skipped: true, reason: "A flight sync is already running." };
    }
    if (!process.env.NEWSKY_API_KEY) {
        return { skipped: true, reason: "NEWSKY_API_KEY is not configured." };
    }

    automaticFlightSyncInProgress = true;
    const fullHistory = mode === "full";
    let received = 0;
    let result = { imported: 0, updated: 0, skipped: 0, unmatched: 0, matchedPilots: 0 };
    let linkedPilots = 0;

    try {
        await query(
            "INSERT INTO flight_sync_state (sync_key, status, last_started_at, last_error) " +
            "VALUES ('global', 'running', CURRENT_TIMESTAMP, NULL) " +
            "ON CONFLICT (sync_key) DO UPDATE SET status = 'running', " +
            "last_started_at = CURRENT_TIMESTAMP, last_error = NULL"
        );

        const linked = await query(
            "SELECT COUNT(*)::INTEGER AS count FROM users " +
            "WHERE newsky_pilot_id IS NOT NULL AND TRIM(newsky_pilot_id) <> ''"
        );
        linkedPilots = Number(linked.rows[0] && linked.rows[0].count || 0);

        if (!linkedPilots) {
            await query(
                "UPDATE flight_sync_state SET status = 'idle', last_completed_at = CURRENT_TIMESTAMP, " +
                "linked_pilots = 0, flights_received = 0, flights_imported = 0, flights_updated = 0, " +
                "last_error = 'No pilots have linked a NewSky Pilot ID yet.' WHERE sync_key = 'global'"
            );
            return { skipped: true, reason: "No linked NewSky pilots." };
        }

        console.log(
            fullHistory
                ? "Starting first full background NewSky sync."
                : "Starting incremental background NewSky sync."
        );

        const externalFlights = fullHistory
            ? await getAllNewSkyFlights()
            : await getRecentNewSkyFlights(7);

        received = externalFlights.length;
        result = await importAllFlights(externalFlights);

        if (fullHistory || result.imported > 0) {
            console.log("Synchronizing Discord roles after flight sync.");
            await syncAllDiscordRanks();
        }

        await query(
            "UPDATE flight_sync_state SET status = 'completed', " +
            "last_completed_at = CURRENT_TIMESTAMP, " +
            "last_full_sync_at = CASE WHEN $1::BOOLEAN THEN CURRENT_TIMESTAMP ELSE last_full_sync_at END, " +
            "distance_parser_version = CASE WHEN $1::BOOLEAN THEN 2 ELSE distance_parser_version END, " +
            "last_error = NULL, linked_pilots = $2, flights_received = $3, " +
            "flights_imported = $4, flights_updated = $5 WHERE sync_key = 'global'",
            [fullHistory, linkedPilots, received, result.imported, result.updated]
        );

        console.log(
            "Background NewSky sync complete. Mode: " + mode +
            "; received: " + received +
            "; imported: " + result.imported +
            "; updated: " + result.updated
        );

        return {
            mode,
            linkedPilots,
            flightsReceived: received,
            flightsImported: result.imported,
            flightsUpdated: result.updated,
            flightsSkipped: result.skipped,
            flightsWithoutMatchingPilot: result.unmatched,
            pilotsWithFlights: result.matchedPilots
        };
    } catch (error) {
        console.error("Background flight sync failed:", error && error.message ? error.message : error);
        try {
            await query(
                "UPDATE flight_sync_state SET status = 'error', last_completed_at = CURRENT_TIMESTAMP, " +
                "last_error = $1, linked_pilots = $2, flights_received = $3, " +
                "flights_imported = $4, flights_updated = $5 WHERE sync_key = 'global'",
                [String(error && error.message || "Unknown sync error").slice(0, 1000), linkedPilots, received, result.imported, result.updated]
            );
        } catch (stateError) {
            console.error("Unable to store background sync error:", stateError.message);
        }
        throw error;
    } finally {
        automaticFlightSyncInProgress = false;
    }
}

async function startAutomaticFlightSync() {
    if (automaticFlightSyncTimer) return;

    const syncOnce = async () => {
        if (automaticFlightSyncInProgress) return;
        try {
            const state = await query(
                "SELECT last_full_sync_at, distance_parser_version FROM flight_sync_state WHERE sync_key = 'global'"
            );
            const row = state.rows[0] || {};
            // Re-import all existing flights once after distance parsing changes,
            // then return to the normal incremental 7-day sync.
            const currentDataVersion = Boolean(row.last_full_sync_at) &&
                Number(row.distance_parser_version || 0) >= 2;
            await runAutomaticFlightSync(currentDataVersion ? "recent" : "full");
        } catch (error) {
            console.error("Scheduled flight sync did not finish:", error.message);
        }
    };

    // Leave the health endpoint and normal API requests time to become available first.
    setTimeout(() => { void syncOnce(); }, 15000);

    // Incremental sync every 15 minutes while the Render web process is awake.
    automaticFlightSyncTimer = setInterval(() => { void syncOnce(); }, 15 * 60 * 1000);
    if (automaticFlightSyncTimer && typeof automaticFlightSyncTimer.unref === "function") {
        automaticFlightSyncTimer.unref();
    }
}

app.get("/api/sync/status", async (req, res) => {
    try {
        const result = await query(
            "SELECT status, last_started_at, last_completed_at, last_full_sync_at, " +
            "last_error, linked_pilots, flights_received, flights_imported, flights_updated " +
            "FROM flight_sync_state WHERE sync_key = 'global'"
        );
        const state = result.rows[0] || null;
        res.set("Cache-Control", "no-store");
        return res.json({
            automatic: true,
            intervalMinutes: 5,
            scheduler: "GitHub Actions",
            inProgress: automaticFlightSyncInProgress,
            lastSync: state
                ? {
                    status: state.status,
                    startedAt: state.last_started_at,
                    completedAt: state.last_completed_at,
                    fullHistoryCompletedAt: state.last_full_sync_at,
                    lastError: state.last_error
                        ? "The latest background sync encountered an error. The backend will retry automatically."
                        : null,
                    linkedPilots: Number(state.linked_pilots || 0),
                    flightsReceived: Number(state.flights_received || 0),
                    flightsImported: Number(state.flights_imported || 0),
                    flightsUpdated: Number(state.flights_updated || 0)
                }
                : null
        });
    } catch (error) {
        console.error("Flight sync status error:", error);
        return res.status(500).json({ error: "Unable to load flight sync status." });
    }
});

// ============================================================
// EXTERNAL LIVE NEWSKY SCHEDULER
// ============================================================

// GitHub Actions calls this endpoint every five minutes. The short-lived
// GITHUB_TOKEN is validated against this repository's Actions API before
// an incremental import is allowed. No permanent scheduler secret is stored
// in the public repository or exposed to website visitors.
app.post("/api/sync/scheduled", async (req, res) => {
    const authorization = String(req.headers.authorization || "");
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    const githubToken = tokenMatch ? tokenMatch[1].trim() : "";

    if (!githubToken) {
        return res.status(401).json({ error: "A valid GitHub Actions token is required." });
    }

    if (!databaseReady) {
        res.set("Retry-After", "15");
        return res.status(503).json({ error: "The backend database is still starting." });
    }

    try {
        const verification = await fetch(
            "https://api.github.com/repos/echoairgroup/Echo-Air-Group/actions/runs?per_page=1",
            {
                method: "GET",
                headers: {
                    Authorization: "Bearer " + githubToken,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "Echo-Air-Group-NewSky-Scheduler"
                },
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!verification.ok) {
            console.warn("Rejected scheduled NewSky sync: GitHub token validation returned HTTP " + verification.status + ".");
            return res.status(401).json({ error: "GitHub Actions token validation failed." });
        }
    } catch (error) {
        console.error("Unable to validate scheduled NewSky runner:", error.message);
        res.set("Retry-After", "15");
        return res.status(503).json({ error: "Unable to validate the scheduled sync runner." });
    }

    if (automaticFlightSyncInProgress) {
        return res.status(202).json({
            ok: true,
            skipped: true,
            reason: "A NewSky sync is already running."
        });
    }

    try {
        const result = await runAutomaticFlightSync("recent");

        if (result.skipped) {
            return res.status(202).json({
                ok: true,
                skipped: true,
                reason: result.reason
            });
        }

        return res.json({
            ok: true,
            scheduler: "github-actions",
            intervalMinutes: 5,
            mode: result.mode,
            linkedPilots: result.linkedPilots,
            flightsReceived: result.flightsReceived,
            flightsImported: result.flightsImported,
            flightsUpdated: result.flightsUpdated,
            flightsSkipped: result.flightsSkipped
        });
    } catch (error) {
        console.error("Scheduled NewSky sync failed:", error && error.message ? error.message : error);
        return res.status(500).json({ error: "Scheduled NewSky synchronization failed." });
    }
});


// ============================================================
// SYNC ALL ECHO AIR GROUP FLIGHTS
// ============================================================

app.post(
    "/api/sync/all",
    authenticate,
    async (req, res) => {

        try {

            console.log(
                `Global Echo Air Group flight sync started by user ${req.user.username}`
            );

            const linkedResult =
                await query(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    WHERE
                        newsky_pilot_id IS NOT NULL
                        AND TRIM(newsky_pilot_id) != ''
                    `
                );

            const linkedPilots =
                Number(
                    linkedResult.rows[0].count
                );

            if (
                linkedPilots === 0
            ) {

                return res.status(400).json({
                    error:
                        "No Echo Air Group pilots have linked their NewSky Pilot ID yet."
                });
            }

            const allFlights =
                await getAllNewSkyFlights();

            const result =
                await importAllFlights(
                    allFlights
                );

            console.log(
                "Starting automatic Discord rank synchronization..."
            );

            const discordResult =
                await syncAllDiscordRanks();

            const totalResult =
                await query(
                    `
                    SELECT COUNT(*) AS count
                    FROM flights
                    `
                );

            const totalDatabaseFlights =
                Number(
                    totalResult.rows[0].count
                );

            res.json({

                message:
                    "Echo Air Group flight synchronization completed.",

                newskyFlightsReceived:
                    allFlights.length,

                linkedPilots,

                flightsImported:
                    result.imported,

                flightsUpdated:
                    result.updated,

                flightsSkipped:
                    result.skipped,

                flightsWithoutMatchingPilot:
                    result.unmatched,

                pilotsWithFlights:
                    result.matchedPilots,

                totalFlightsInDatabase:
                    totalDatabaseFlights,

                discordRankSync:
                    discordResult
            });

        } catch (error) {

            console.error(
                "Global sync error:",
                error
            );

            res.status(500).json({

                error:
                    error.message ||
                    "Unable to synchronize Echo Air Group flights."
            });
        }
    }
);

// ============================================================
// SYNC MY FLIGHTS
// ============================================================

app.post(
    "/api/sync/me",
    authenticate,
    async (req, res) => {
        try {
            const pilotId = String(req.user.newsky_pilot_id || "").trim();
            if (!pilotId) {
                return res.status(400).json({
                    error: "Please link your NewSky Pilot ID first."
                });
            }

            // Use the same sync runner as the scheduled importer so manual
            // full-history scans also update flight_sync_state and health status.
            const result = await runAutomaticFlightSync("full");

            if (result.skipped) {
                const cachedStats = await getUserStats(req.user.id);
                return res.json({
                    message: "A NewSky sync is already running. Showing your latest saved statistics.",
                    syncInProgress: true,
                    flightsImported: 0,
                    flightsUpdated: 0,
                    stats: {
                        stars: cachedStats.stars,
                        rank: cachedStats.rank.name,
                        flightCount: cachedStats.flightCount,
                        averageRating: cachedStats.averageRating,
                        flightHours: cachedStats.flightHours,
                        distance: cachedStats.distance
                    }
                });
            }

            const stats = await getUserStats(req.user.id);
            return res.json({
                message: "Full airline history sync completed: " + result.flightsReceived +
                    " NewSky flight(s) checked, " + result.flightsImported + " imported and " +
                    result.flightsUpdated + " updated.",
                historyWindow: "full",
                newskyFlightsReceived: result.flightsReceived,
                flightsImported: result.flightsImported,
                flightsUpdated: result.flightsUpdated,
                flightsSkipped: result.flightsSkipped,
                flightsWithoutMatchingPilot: result.flightsWithoutMatchingPilot,
                pilotsWithFlights: result.pilotsWithFlights,
                stats: {
                    stars: stats.stars,
                    rank: stats.rank.name,
                    flightCount: stats.flightCount,
                    averageRating: stats.averageRating,
                    flightHours: stats.flightHours,
                    distance: stats.distance
                }
            });
        } catch (error) {
            console.error("Personal sync error:", error);
            return res.status(500).json({
                error: error.message || "Unable to synchronize flights."
            });
        }
    }
);

// ============================================================
// PILOTS
// ============================================================

app.get(
    "/api/pilots",
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        newsky_pilot_id,
                        discord_user_id,
                        created_at,
                        (avatar_data IS NOT NULL) AS has_avatar
                    FROM users
                    ORDER BY
                        LOWER(
                            COALESCE(
                                display_name,
                                username
                            )
                        ) ASC
                    `
                );

            const users =
                result.rows;

            const pilots =
                [];

            for (
                const user of users
            ) {

                const stats =
                    await getUserStats(
                        user.id
                    );

                pilots.push({

                    id:
                        user.id,

                    username:
                        user.username,

                    displayName:
                        user.display_name ||
                        user.username,

                    avatarUrl:
                        user.has_avatar ? "/pilots/" + user.id + "/avatar" : null,

                    rank:
                        stats.rank.name,

                    stars:
                        stats.stars,

                    flightCount:
                        stats.flightCount,

                    averageRating:
                        stats.averageRating,

                    flightHours:
                        stats.flightHours,

                    distance:
                        stats.distance,

                    newskyLinked:
                        Boolean(
                            user.newsky_pilot_id
                        ),

                    discordLinked:
                        Boolean(
                            user.discord_user_id
                        ),

                    createdAt:
                        user.created_at
                });
            }

            res.json({
                pilots
            });

        } catch (error) {

            console.error(
                "Pilot list error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to load pilots."
            });
        }
    }
);

// ============================================================
// PUBLIC PILOT PROFILE
// ============================================================

app.get(
    "/api/pilots/:id",
    async (req, res) => {

        try {

            const userId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    userId
                )
            ) {

                return res.status(400).json({
                    error:
                        "Invalid pilot ID."
                });
            }

            const result =
                await query(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        profile_bio,
                        created_at,
                        (avatar_data IS NOT NULL) AS has_avatar
                    FROM users
                    WHERE id = $1
                    `,
                    [userId]
                );

            const user =
                result.rows[0];

            if (!user) {

                return res.status(404).json({
                    error:
                        "Pilot not found."
                });
            }

            const stats =
                await getUserStats(
                    user.id
                );

            res.json({

                pilot: {

                    id:
                        user.id,

                    username:
                        user.username,

                    displayName:
                        user.display_name ||
                        user.username,

                    bio:
                        user.profile_bio || "",

                    avatarUrl:
                        user.has_avatar ? "/pilots/" + user.id + "/avatar" : null,

                    rank:
                        stats.rank.name,

                    stars:
                        stats.stars,

                    flightCount:
                        stats.flightCount,

                    averageRating:
                        stats.averageRating,

                    flightHours:
                        stats.flightHours,

                    distance:
                        stats.distance,

                    createdAt:
                        user.created_at
                },

                /*
                 * IMPORTANT:
                 *
                 * No .slice(0, 100) here.
                 *
                 * Public pilot profiles now receive
                 * the complete flight history.
                 */
                flights:
                    stats.flights
                        .map(formatFlight)
            });

        } catch (error) {

            console.error(
                "Pilot profile error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to load pilot profile."
            });
        }
    }
);

app.get(
    "/api/pilots/:id/avatar",
    async (req, res) => {
        const userId = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(userId) || userId < 1) {
            return res.status(400).json({ error: "Invalid pilot ID." });
        }
        try {
            const result = await query(
                "SELECT avatar_mime, avatar_data FROM users WHERE id = $1",
                [userId]
            );
            const pilot = result.rows[0];
            if (!pilot || !pilot.avatar_data) {
                return res.status(404).json({ error: "This pilot has not added a profile photo." });
            }
            const allowed = ["image/jpeg", "image/png", "image/webp"];
            const mime = allowed.includes(pilot.avatar_mime) ? pilot.avatar_mime : "image/jpeg";
            res.set("Content-Type", mime);
            res.set("Cache-Control", "public, max-age=60");
            res.set("X-Content-Type-Options", "nosniff");
            return res.send(pilot.avatar_data);
        } catch (error) {
            console.error("Pilot avatar load failed:", error.message);
            return res.status(500).json({ error: "Unable to load this profile photo." });
        }
    }
);

// ============================================================
// RECENT FLIGHTS
// ============================================================

app.get(
    "/api/flights/recent",
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT
                        f.id,
                        f.newsky_id,
                        f.dep_icao,
                        f.arr_icao,
                        f.aircraft,
                        f.rating,
                        f.duration,
                        f.distance,
                        f.stars,
                        f.dep_time,
                        f.synced_at,

                        u.id AS user_id,
                        u.username,
                        u.display_name

                    FROM flights f

                    LEFT JOIN users u
                        ON u.id = f.user_id

                    WHERE
                        f.dep_time IS NOT NULL

                    ORDER BY
                        f.dep_time DESC

                    LIMIT 3
                    `
                );

            const flights =
                result.rows.map(
                    flight => ({

                        id:
                            flight.id,

                        newskyId:
                            flight.newsky_id,

                        pilotId:
                            flight.user_id,

                        pilot:
                            flight.display_name ||
                            flight.username ||
                            "Unknown Pilot",

                        username:
                            flight.username,

                        departure:
                            flight.dep_icao ||
                            "----",

                        arrival:
                            flight.arr_icao ||
                            "----",

                        aircraft:
                            flight.aircraft ||
                            "Unknown Aircraft",

                        rating:
                            flight.rating !== null
                                ? Number(
                                    flight.rating
                                )
                                : null,

                        duration:
                            flight.duration !== null
                                ? Number(
                                    flight.duration
                                )
                                : null,

                        distance:
                            flight.distance !== null
                                ? Number(
                                    flight.distance
                                )
                                : null,

                        stars:
                            flight.stars !== null
                                ? Number(
                                    flight.stars
                                )
                                : 0,

                        date:
                            flight.dep_time,

                        syncedAt:
                            flight.synced_at
                    })
                );

            res.json({
                flights
            });

        } catch (error) {

            console.error(
                "Recent flights error:",
                error
            );

            res.status(500).json({

                error:
                    "Unable to load recent flights."
            });
        }
    }
);

// ============================================================
// LEADERBOARD
// ============================================================

app.get(
    "/api/ranking",
    async (req, res) => {

        try {

            const result =
                await query(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        newsky_pilot_id,
                        (avatar_data IS NOT NULL) AS has_avatar
                    FROM users
                    `
                );

            const users =
                result.rows;

            const rankings =
                [];

            for (
                const user of users
            ) {

                const stats =
                    await getUserStats(
                        user.id
                    );

                rankings.push({

                    id:
                        user.id,

                    name:
                        user.display_name ||
                        user.username,

                    username:
                        user.username,

                    avatarUrl:
                        user.has_avatar ? "/pilots/" + user.id + "/avatar" : null,

                    stars:
                        stats.stars,

                    flights:
                        stats.flightCount,

                    flightCount:
                        stats.flightCount,

                    averageRating:
                        stats.averageRating,

                    averageStars:
                        stats.flightCount > 0
                            ? round(stats.stars / stats.flightCount, 2)
                            : null,

                    flightHours:
                        stats.flightHours,

                    distance:
                        stats.distance,

                    lastFlight:
                        stats.flights.find(flight => flight.dep_time)?.dep_time || null,

                    bestRating:
                        stats.flights.reduce((best, flight) => {
                            const rating = Number(flight.rating);
                            return Number.isFinite(rating) && rating > 0
                                ? (best === null ? rating : Math.max(best, rating))
                                : best;
                        }, null),

                    aircraftTypes:
                        new Set(stats.flights.map(flight => String(flight.aircraft || "").trim().toLowerCase()).filter(Boolean)).size,

                    routesFlown:
                        new Set(stats.flights.map(flight => {
                            const departure = String(flight.dep_icao || "").trim().toUpperCase();
                            const arrival = String(flight.arr_icao || "").trim().toUpperCase();
                            return departure && arrival ? departure + "-" + arrival : "";
                        }).filter(Boolean)).size,

                    newskyLinked:
                        Boolean(user.newsky_pilot_id),

                    rank:
                        stats.rank.name
                });
            }

            rankings.sort(
                (
                    a,
                    b
                ) => {

                    if (
                        b.stars !==
                        a.stars
                    ) {

                        return (
                            b.stars -
                            a.stars
                        );
                    }

                    if (
                        b.averageRating !==
                        a.averageRating
                    ) {

                        return (
                            b.averageRating -
                            a.averageRating
                        );
                    }

                    return (
                        b.flights -
                        a.flights
                    );
                }
            );

            rankings.forEach(
                (
                    pilot,
                    index
                ) => {

                    pilot.position =
                        index + 1;
                }
            );

            res.json({
                rankings
            });

        } catch (error) {

            console.error(
                "Ranking error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to load ranking."
            });
        }
    }
);

// ============================================================
// ADMIN DATABASE STATS
// ============================================================

app.get(
    "/api/admin/database-stats",
    authenticate,
    async (req, res) => {

        try {

            const usersResult =
                await query(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    `
                );

            const flightsResult =
                await query(
                    `
                    SELECT COUNT(*) AS count
                    FROM flights
                    `
                );

            const usersWithFlightsResult =
                await query(
                    `
                    SELECT
                        u.id,
                        u.username,
                        u.newsky_pilot_id,
                        u.discord_user_id,
                        COUNT(f.id) AS flights
                    FROM users u
                    LEFT JOIN flights f
                        ON f.user_id = u.id
                    GROUP BY
                        u.id,
                        u.username,
                        u.newsky_pilot_id,
                        u.discord_user_id
                    ORDER BY
                        u.id
                    `
                );

            res.json({

                users:
                    Number(
                        usersResult.rows[0].count
                    ),

                flights:
                    Number(
                        flightsResult.rows[0].count
                    ),

                usersWithFlights:
                    usersWithFlightsResult.rows
            });

        } catch (error) {

            console.error(
                "Database stats error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to read database stats."
            });
        }
    }
);


// ============================================================
// WEBSITE CONTENT MANAGEMENT API
// ============================================================

const SITE_ITEM_CATEGORIES = new Set([
    "news", "aircraft", "route", "team", "announcement", "gallery", "other"
]);
const SITE_ITEM_PAGES = new Set([
    "all", "index.html", "about.html", "fleet.html", "routes.html",
    "team.html", "join.html", "manual.html", "contact.html", "booking.html",
    "ranking.html", "pilot.html", "manager.html", "server.html",
    "legal.html", "privacy.html", "operations-center.html", "community.html"
]);
const SITE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function siteInputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function normalizeSiteUrl(value, fieldName, allowRelative = false) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    if (
        allowRelative &&
        !/^[a-z][a-z0-9+.-]*:/i.test(raw) &&
        !raw.startsWith("//")
    ) return raw;

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw siteInputError(fieldName + " must be a valid URL.");
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw siteInputError(fieldName + " must use HTTP or HTTPS.");
    }

    return parsed.toString();
}

function normalizeDiscordInvite(value) {
    const raw = String(value || "").trim();
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw siteInputError("Enter a valid Discord invite URL.");
    }

    const host = parsed.hostname.toLowerCase();
    const validHost = [
        "discord.gg", "www.discord.gg", "discord.com", "www.discord.com"
    ].includes(host);

    if (parsed.protocol !== "https:" || !validHost) {
        throw siteInputError("Use an HTTPS invite from discord.gg or discord.com/invite.");
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length || (host.includes("discord.com") && parts[0] !== "invite")) {
        throw siteInputError("The Discord invite URL appears incomplete.");
    }

    return parsed.toString();
}

function parseSiteImageDataUrl(value) {
    if (!value) return null;

    const match = String(value).match(
        /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i
    );

    if (!match) {
        throw siteInputError("Images must be uploaded as JPG, PNG, or WebP.");
    }

    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) throw siteInputError("The selected image is empty or invalid.");

    if (buffer.length > SITE_IMAGE_MAX_BYTES) {
        throw siteInputError("Images must be 2 MB or smaller. Resize the image and try again.");
    }

    return { buffer, mime: match[1].toLowerCase() };
}

function normalizeSiteItem(body = {}) {
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "announcement").trim().toLowerCase();
    const targetPage = String(body.targetPage || body.target_page || "all").trim().toLowerCase();

    if (!title || title.length > 120) {
        throw siteInputError("Title is required and must be 120 characters or fewer.");
    }
    if (description.length > 2500) {
        throw siteInputError("Description must be 2,500 characters or fewer.");
    }
    if (!SITE_ITEM_CATEGORIES.has(category)) throw siteInputError("Choose a valid item category.");
    if (!SITE_ITEM_PAGES.has(targetPage)) throw siteInputError("Choose a valid website page.");

    const image = parseSiteImageDataUrl(body.imageDataUrl);
    const imageUrl = normalizeSiteUrl(body.imageUrl, "Image URL");
    if (image && imageUrl) {
        throw siteInputError("Choose an uploaded image or an image URL, not both.");
    }

    return {
        title,
        description,
        category,
        // News items always belong in the homepage News section, not the generic content block.
        targetPage: category === "news" ? "index.html" : targetPage,
        linkUrl: normalizeSiteUrl(body.linkUrl || body.link_url, "Link URL", true),
        imageBuffer: image ? image.buffer : null,
        imageMime: image ? image.mime : null,
        imageUrl,
        published: body.published === undefined
            ? true
            : (body.published === true || String(body.published).toLowerCase() === "true")
    };
}

function siteItemSelectSql(whereClause = "") {
    return "SELECT id, title, description, category, target_page, link_url, " +
        "CASE WHEN image_url IS NOT NULL THEN image_url " +
        "WHEN image_data IS NOT NULL THEN '/api/site/items/' || id::text || '/image' " +
        "ELSE NULL END AS image_url, published, created_at, updated_at " +
        "FROM site_items " + whereClause;
}

app.get("/api/site/settings", async (req, res) => {
    try {
        const result = await query(
            "SELECT setting_value FROM site_settings WHERE setting_key = 'discord_invite'"
        );
        res.set("Cache-Control", "no-store");
        res.json({
            discordInvite: result.rows[0] && result.rows[0].setting_value
                ? result.rows[0].setting_value
                : (process.env.DISCORD_INVITE_URL || "https://discord.gg/e7ePxYA24")
        });
    } catch (error) {
        console.error("Public site settings error:", error);
        res.status(500).json({ error: "Unable to load website settings." });
    }
});

app.get("/api/site/items", async (req, res) => {
    try {
        const requestedPage = String(req.query.page || "index.html").trim().toLowerCase();
        const page = SITE_ITEM_PAGES.has(requestedPage) ? requestedPage : "index.html";
        const result = await query(
            siteItemSelectSql(
                "WHERE published = TRUE AND (target_page = $1 OR target_page = 'all') ORDER BY created_at DESC, id DESC"
            ),
            [page]
        );
        res.set("Cache-Control", "no-store");
        res.json({ items: result.rows });
    } catch (error) {
        console.error("Public site items error:", error);
        res.status(500).json({ error: "Unable to load website items." });
    }
});

app.get("/api/site/items/:id/image", async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) return res.status(400).send("Invalid image ID.");

        const result = await query(
            "SELECT image_data, image_mime FROM site_items WHERE id = $1",
            [id]
        );
        const item = result.rows[0];

        if (!item || !item.image_data || !item.image_mime) {
            return res.status(404).send("Image not found.");
        }

        res.set("Content-Type", item.image_mime);
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Cache-Control", "public, max-age=86400");
        return res.send(item.image_data);
    } catch (error) {
        console.error("Site item image error:", error);
        return res.status(500).send("Unable to load image.");
    }
});


// ============================================================
// COOKIE CONSENT & ADMIN REPORTING
// ============================================================

const COOKIE_POLICY_VERSION = "2026-11-01";

app.post("/api/cookie-consent", async (req, res) => {
    try {
        const visitorId = String(req.body && req.body.visitorId || "").trim().toLowerCase();
        const choice = String(req.body && req.body.choice || "").trim().toLowerCase();
        const categories = req.body && req.body.categories && typeof req.body.categories === "object"
            ? req.body.categories
            : {};

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(visitorId)) {
            return res.status(400).json({ error: "A valid consent identifier is required." });
        }
        if (!["accepted", "rejected", "custom"].includes(choice)) {
            return res.status(400).json({ error: "A valid consent choice is required." });
        }

        const analyticsEnabled = choice === "accepted"
            ? true
            : choice === "rejected"
                ? false
                : categories.analytics === true;
        const marketingEnabled = choice === "accepted"
            ? true
            : choice === "rejected"
                ? false
                : categories.marketing === true;

        // Associate a choice with an account only when the browser provides a
        // valid existing Echo session at the moment the choice is submitted.
        // Invalid/expired tokens do not prevent an anonymous visitor from saving.
        let userId = null;
        const authorization = String(req.headers.authorization || "");
        if (authorization.startsWith("Bearer ")) {
            try {
                const decoded = jwt.verify(authorization.substring(7), JWT_SECRET);
                const userResult = await query("SELECT id FROM users WHERE id = $1", [decoded.id]);
                if (userResult.rows[0]) userId = userResult.rows[0].id;
            } catch (_) {
                userId = null;
            }
        }

        await query(
            "INSERT INTO cookie_consent_records " +
            "(visitor_id, choice, analytics_enabled, marketing_enabled, policy_version, user_id, created_at, updated_at) " +
            "VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) " +
            "ON CONFLICT (visitor_id) DO UPDATE SET " +
            "choice = EXCLUDED.choice, analytics_enabled = EXCLUDED.analytics_enabled, " +
            "marketing_enabled = EXCLUDED.marketing_enabled, policy_version = EXCLUDED.policy_version, " +
            "user_id = EXCLUDED.user_id, updated_at = CURRENT_TIMESTAMP",
            [visitorId, choice, analyticsEnabled, marketingEnabled, COOKIE_POLICY_VERSION, userId]
        );

        // Keep only the current preference. Inactive records expire after 24 months.
        await query(
            "DELETE FROM cookie_consent_records WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '24 months'"
        );

        res.set("Cache-Control", "no-store");
        return res.status(201).json({ saved: true, policyVersion: COOKIE_POLICY_VERSION });
    } catch (error) {
        console.error("Cookie consent save error:", error.message);
        return res.status(500).json({ error: "Unable to save your cookie preferences." });
    }
});

app.get("/api/admin/cookie-consent", authenticateAdmin, async (req, res) => {
    try {
        await query(
            "DELETE FROM cookie_consent_records WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '24 months'"
        );

        const [stats, records, total] = await Promise.all([
            query(
                "SELECT COUNT(*)::INTEGER AS total, " +
                "COUNT(*) FILTER (WHERE choice = 'accepted')::INTEGER AS accepted, " +
                "COUNT(*) FILTER (WHERE choice = 'rejected')::INTEGER AS rejected, " +
                "COUNT(*) FILTER (WHERE choice = 'custom')::INTEGER AS custom " +
                "FROM cookie_consent_records"
            ),
            query(
                "SELECT c.visitor_id, c.choice, c.analytics_enabled, c.marketing_enabled, " +
                "c.policy_version, c.updated_at, u.username " +
                "FROM cookie_consent_records c LEFT JOIN users u ON u.id = c.user_id " +
                "ORDER BY c.updated_at DESC LIMIT 1000"
            ),
            query("SELECT COUNT(*)::INTEGER AS count FROM cookie_consent_records")
        ]);

        res.set("Cache-Control", "no-store");
        return res.json({
            stats: stats.rows[0] || { total: 0, accepted: 0, rejected: 0, custom: 0 },
            totalRecords: Number(total.rows[0] && total.rows[0].count || 0),
            records: records.rows
        });
    } catch (error) {
        console.error("Admin cookie consent report error:", error.message);
        return res.status(500).json({ error: "Unable to load cookie consent records." });
    }
});

app.get("/api/admin/site/session", authenticateAdmin, (req, res) => {
    res.json({ authorized: true, username: req.user.username });
});

app.get("/api/admin/site/settings", authenticateAdmin, async (req, res) => {
    try {
        const result = await query(
            "SELECT setting_value, updated_at FROM site_settings WHERE setting_key = 'discord_invite'"
        );
        res.json({
            discordInvite: result.rows[0] && result.rows[0].setting_value
                ? result.rows[0].setting_value
                : (process.env.DISCORD_INVITE_URL || "https://discord.gg/e7ePxYA24"),
            updatedAt: result.rows[0] ? result.rows[0].updated_at : null
        });
    } catch (error) {
        console.error("Admin site settings error:", error);
        res.status(500).json({ error: "Unable to load website settings." });
    }
});

app.put("/api/admin/site/settings", authenticateAdmin, async (req, res) => {
    try {
        const invite = normalizeDiscordInvite(req.body.discordInvite);
        const result = await query(
            "INSERT INTO site_settings (setting_key, setting_value, updated_at) " +
            "VALUES ('discord_invite', $1, CURRENT_TIMESTAMP) " +
            "ON CONFLICT (setting_key) DO UPDATE SET " +
            "setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP " +
            "RETURNING setting_value, updated_at",
            [invite]
        );
        res.json({
            message: "Discord invite updated.",
            discordInvite: result.rows[0].setting_value,
            updatedAt: result.rows[0].updated_at
        });
    } catch (error) {
        console.error("Update Discord invite error:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to update the Discord invite."
        });
    }
});

app.get("/api/admin/site/items", authenticateAdmin, async (req, res) => {
    try {
        const result = await query(siteItemSelectSql("ORDER BY updated_at DESC, id DESC"));
        const stats = await query(
            "SELECT COUNT(*)::INTEGER AS total, " +
            "COUNT(*) FILTER (WHERE published = TRUE)::INTEGER AS published, " +
            "COUNT(*) FILTER (WHERE published = FALSE)::INTEGER AS drafts " +
            "FROM site_items"
        );
        res.json({
            items: result.rows,
            stats: stats.rows[0] || { total: 0, published: 0, drafts: 0 }
        });
    } catch (error) {
        console.error("Admin site items error:", error);
        res.status(500).json({ error: "Unable to load website items." });
    }
});

app.post("/api/admin/site/items", authenticateAdmin, async (req, res) => {
    try {
        const item = normalizeSiteItem(req.body);
        const result = await query(
            "INSERT INTO site_items (title, description, category, target_page, link_url, " +
            "image_data, image_mime, image_url, published, created_by) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
            [
                item.title, item.description, item.category, item.targetPage, item.linkUrl,
                item.imageBuffer, item.imageMime, item.imageUrl, item.published, req.user.id
            ]
        );
        const created = await query(siteItemSelectSql("WHERE id = $1"), [result.rows[0].id]);
        res.status(201).json({ message: "Website item created.", item: created.rows[0] });
    } catch (error) {
        console.error("Create site item error:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to create website item."
        });
    }
});

app.post("/api/admin/site/items/import", authenticateAdmin, async (req, res) => {
    try {
        const sourceItems = req.body && req.body.items;
        if (!Array.isArray(sourceItems) || sourceItems.length < 1 || sourceItems.length > 50) {
            throw siteInputError("Import a JSON object with an items array containing 1 to 50 items.");
        }

        const items = sourceItems.map(item => {
            if (item && item.imageDataUrl) {
                throw siteInputError("Bulk JSON imports use imageUrl fields; upload local pictures through Add item.");
            }
            return normalizeSiteItem(item);
        });

        const insertedIds = [];
        for (const item of items) {
            const result = await query(
                "INSERT INTO site_items (title, description, category, target_page, link_url, image_url, published, created_by) " +
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
                [
                    item.title, item.description, item.category, item.targetPage,
                    item.linkUrl, item.imageUrl, item.published, req.user.id
                ]
            );
            insertedIds.push(result.rows[0].id);
        }

        res.status(201).json({
            message: "Imported " + insertedIds.length + " website item(s).",
            ids: insertedIds
        });
    } catch (error) {
        console.error("Import site items error:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to import website items."
        });
    }
});

app.put("/api/admin/site/items/:id", authenticateAdmin, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) throw siteInputError("Invalid item ID.");

        const item = normalizeSiteItem(req.body);
        const current = await query("SELECT id FROM site_items WHERE id = $1", [id]);
        if (!current.rows.length) return res.status(404).json({ error: "Website item not found." });

        const removeImage = req.body.removeImage === true;
        const result = await query(
            "UPDATE site_items SET " +
            "title = $1, description = $2, category = $3, target_page = $4, link_url = $5, " +
            "image_data = CASE WHEN $9 = TRUE THEN NULL WHEN $6::BYTEA IS NOT NULL THEN $6::BYTEA WHEN $8::TEXT IS NOT NULL THEN NULL ELSE image_data END, " +
            "image_mime = CASE WHEN $9 = TRUE THEN NULL WHEN $7::TEXT IS NOT NULL THEN $7::TEXT WHEN $8::TEXT IS NOT NULL THEN NULL ELSE image_mime END, " +
            "image_url = CASE WHEN $9 = TRUE THEN NULL WHEN $8::TEXT IS NOT NULL THEN $8::TEXT WHEN $6::BYTEA IS NOT NULL THEN NULL ELSE image_url END, " +
            "published = $10, updated_at = CURRENT_TIMESTAMP WHERE id = $11 RETURNING id",
            [
                item.title, item.description, item.category, item.targetPage, item.linkUrl,
                item.imageBuffer, item.imageMime, item.imageUrl, removeImage, item.published, id
            ]
        );

        const updated = await query(siteItemSelectSql("WHERE id = $1"), [result.rows[0].id]);
        res.json({ message: "Website item updated.", item: updated.rows[0] });
    } catch (error) {
        console.error("Update site item error:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to update website item."
        });
    }
});

app.delete("/api/admin/site/items/:id", authenticateAdmin, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id < 1) throw siteInputError("Invalid item ID.");

        const result = await query("DELETE FROM site_items WHERE id = $1 RETURNING id", [id]);
        if (!result.rows.length) return res.status(404).json({ error: "Website item not found." });

        res.json({ message: "Website item deleted.", id });
    } catch (error) {
        console.error("Delete site item error:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to delete website item."
        });
    }
});


// ============================================================
// APPLICATIONS (FormSubmit email + private admin tracker)
// ============================================================

const applicationSubmissionAttempts = new Map();
const APPLICATION_STATUSES = new Set([
    "new", "reviewing", "shortlisted", "accepted", "rejected"
]);

function normalizeApplicationAnswers(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw siteInputError("Application answers are missing.");
    }

    const entries = Object.entries(input);
    if (!entries.length || entries.length > 50) {
        throw siteInputError("The application contains an invalid number of fields.");
    }

    const answers = {};
    let totalChars = 0;

    for (const [rawKey, rawValue] of entries) {
        const key = String(rawKey || "").trim().slice(0, 120);
        if (!key || key.startsWith("_") || key.toLowerCase() === "website") continue;
        if (rawValue === null || rawValue === undefined) continue;
        if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
            continue;
        }

        const value = String(rawValue).replace(/\u0000/g, "").trim().slice(0, 4000);
        totalChars += key.length + value.length;
        if (totalChars > 40000) throw siteInputError("The application is too large. Shorten the answers and try again.");
        answers[key] = value;
    }

    return answers;
}

function getApplicationAnswer(answers, matcher) {
    const entry = Object.entries(answers).find(([key, value]) =>
        matcher(key.toLowerCase()) && String(value || "").trim()
    );
    return entry ? String(entry[1]).trim() : "";
}

app.post("/api/applications", async (req, res) => {
    try {
        // Silent honeypot response for simple automated spam.
        if (String(req.body && req.body.website || "").trim()) {
            return res.status(202).json({ received: true });
        }

        const now = Date.now();
        const key = String(req.ip || req.socket?.remoteAddress || "unknown");
        const windowMs = 30 * 60 * 1000;
        const attempts = (applicationSubmissionAttempts.get(key) || []).filter(time => now - time < windowMs);
        if (attempts.length >= 5) {
            return res.status(429).json({
                error: "Too many applications were submitted from this connection. Please try again later."
            });
        }
        attempts.push(now);
        applicationSubmissionAttempts.set(key, attempts);
        if (applicationSubmissionAttempts.size > 1500) {
            for (const [ip, times] of applicationSubmissionAttempts) {
                if (!times.length || now - times[times.length - 1] >= windowMs) applicationSubmissionAttempts.delete(ip);
            }
        }

        const applicationType = String(req.body && req.body.applicationType || "").trim().toLowerCase();
        if (!["pilot", "manager"].includes(applicationType)) {
            throw siteInputError("Choose a valid application type.");
        }

        const answers = normalizeApplicationAnswers(req.body && req.body.answers);
        const firstName = getApplicationAnswer(answers, key => key === "first name");
        const lastName = getApplicationAnswer(answers, key => key === "last name");
        const fullName = [firstName, lastName].filter(Boolean).join(" ").slice(0, 240);
        const email = getApplicationAnswer(answers, key => key === "email" || key.includes("email"));
        const discordUsername = getApplicationAnswer(answers, key => key.includes("discord"));

        if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw siteInputError("Please provide a first name, last name and valid email address.");
        }

        const result = await query(
            "INSERT INTO applications (application_type, full_name, email, discord_username, answers) " +
            "VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, submitted_at",
            [applicationType, fullName, email.slice(0, 320), discordUsername.slice(0, 160), JSON.stringify(answers)]
        );

        return res.status(201).json({
            received: true,
            id: result.rows[0].id,
            submittedAt: result.rows[0].submitted_at
        });
    } catch (error) {
        console.error("Application intake error:", error.message);
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to save the application copy."
        });
    }
});

app.get("/api/admin/applications", authenticateAdmin, async (req, res) => {
    try {
        const result = await query(
            "SELECT id, application_type, full_name, email, discord_username, status, answers, " +
            "admin_notes, submitted_at, updated_at FROM applications ORDER BY submitted_at DESC, id DESC"
        );
        const stats = await query(
            "SELECT COUNT(*)::INTEGER AS total, " +
            "COUNT(*) FILTER (WHERE status = 'new')::INTEGER AS new, " +
            "COUNT(*) FILTER (WHERE status IN ('reviewing', 'shortlisted'))::INTEGER AS in_progress, " +
            "COUNT(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted, " +
            "COUNT(*) FILTER (WHERE status = 'rejected')::INTEGER AS rejected " +
            "FROM applications"
        );
        res.set("Cache-Control", "no-store");
        return res.json({ applications: result.rows, stats: stats.rows[0] || {} });
    } catch (error) {
        console.error("Admin applications list error:", error);
        return res.status(500).json({ error: "Unable to load applications." });
    }
});

app.patch("/api/admin/applications/:id", authenticateAdmin, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) throw siteInputError("Invalid application ID.");

        let status = null;
        if (req.body && req.body.status !== undefined) {
            status = String(req.body.status).trim().toLowerCase();
            if (!APPLICATION_STATUSES.has(status)) throw siteInputError("Choose a valid application status.");
        }

        let adminNotes = null;
        if (req.body && req.body.adminNotes !== undefined) {
            adminNotes = String(req.body.adminNotes || "").replace(/\u0000/g, "").slice(0, 5000);
        }

        if (status === null && adminNotes === null) {
            throw siteInputError("There are no application changes to save.");
        }

        const result = await query(
            "UPDATE applications SET status = COALESCE($1, status), " +
            "admin_notes = COALESCE($2, admin_notes), updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = $3 RETURNING id, application_type, full_name, email, discord_username, status, " +
            "answers, admin_notes, submitted_at, updated_at",
            [status, adminNotes, id]
        );

        if (!result.rows.length) return res.status(404).json({ error: "Application not found." });
        return res.json({ application: result.rows[0] });
    } catch (error) {
        console.error("Admin application update error:", error);
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to update the application."
        });
    }
});

app.delete("/api/admin/applications/:id", authenticateAdmin, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) throw siteInputError("Invalid application ID.");
        const result = await query("DELETE FROM applications WHERE id = $1 RETURNING id", [id]);
        if (!result.rows.length) return res.status(404).json({ error: "Application not found." });
        return res.json({ deleted: true, id: result.rows[0].id });
    } catch (error) {
        console.error("Admin application delete error:", error);
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Unable to delete the application."
        });
    }
});

// ============================================================
// EXTENDED PLATFORM ROUTES
// ============================================================

registerPlatformRoutes(app, {
    query,
    pool,
    authenticate,
    getRuntimeState: async () => {
        const syncResult = await query("SELECT * FROM flight_sync_state WHERE sync_key = 'global' LIMIT 1");
        return {
            discordReady,
            sync: syncResult.rows[0] || null
        };
    }
});

registerOperationsRoutes(app, { query, pool, authenticate });

// ============================================================
// 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({

            error:
                "Endpoint not found",

            path:
                req.originalUrl
        });
    }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled server error:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(error);
        }

        res.status(500).json({

            error:
                "Internal server error"
        });
    }
);

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value) {

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

// ============================================================
// START SERVER
// ============================================================

async function initializeBackend() {
    while (!databaseReady) {
        try {
            databaseInitError = null;
            console.log("Initializing PostgreSQL / Neon database...");
            await initializeDatabase();
            await initializePlatformSchema(query);
            await initializeOperationsSchema(query);
            databaseReady = true;
            databaseInitError = null;

            if (!cookieConsentRetentionTimer) {
                const cleanExpiredCookieConsent = () => {
                    void query(
                        "DELETE FROM cookie_consent_records WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '24 months'"
                    ).catch(error => console.error("Cookie consent retention cleanup failed:", error.message));
                };
                cleanExpiredCookieConsent();
                cookieConsentRetentionTimer = setInterval(cleanExpiredCookieConsent, 24 * 60 * 60 * 1000);
            }

            console.log("Database initialization completed; API routes are ready.");

            // Start Discord without waiting for its gateway connection. This must not
            // delay NewSky imports, and a failed Discord login is retried automatically.
            void startDiscordBot().catch(error => {
                console.error("Discord bot initialization failed:", error.message);
            });

            // Start NewSky scheduling independently; this function only registers timers.
            await startAutomaticFlightSync();
            return;
        } catch (error) {
            databaseInitError = String(error && error.message || "Unknown database initialization error");
            console.error("Backend database initialization failed; retrying in 15 seconds:", databaseInitError);
            await sleep(15000);
        }
    }
}

async function startServer() {
    const server = app.listen(PORT, () => {
        console.log(`Echo Air Group backend listening on port ${PORT}`);
        void initializeBackend();
    });

    server.on("error", error => {
        console.error("Echo Air Group HTTP listener error:", error);
        process.exit(1);
    });
}

startServer();
