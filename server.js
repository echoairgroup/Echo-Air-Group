const express = require("express");
const crypto = require("node:crypto");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// ============================================================
// BASIC CONFIGURATION
// ============================================================

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "";
const DATABASE_URL = process.env.DATABASE_URL;

// Admin access is opt-in and fails closed unless explicitly configured.
const ADMIN_USER_IDS = new Set(
    (process.env.ADMIN_USER_IDS || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
);

function createRateLimiter({ windowMs, max, message }) {
    const requests = new Map();

    return function rateLimit(req, res, next) {
        const now = Date.now();
        const key = String(req.ip || req.socket?.remoteAddress || "unknown");
        let entry = requests.get(key);

        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            requests.set(key, entry);
        }

        if (requests.size > 5000) {
            for (const [storedKey, storedEntry] of requests) {
                if (storedEntry.resetAt <= now) requests.delete(storedKey);
            }
        }

        res.setHeader("RateLimit-Limit", String(max));
        res.setHeader("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
        res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

        if (entry.count >= max) {
            res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
            return res.status(429).json({ error: message });
        }

        entry.count += 1;
        return next();
    };
}

const registerRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: "Too many registration attempts. Please try again later."
});

const loginRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Please wait and try again."
});

const applicationRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: "Too many application attempts. Please try again later."
});

const managerApplicationRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 2,
    message: "Too many manager application attempts. Please try again later."
});

const contactRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: "Too many messages submitted. Please try again later."
});

const bookingRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: "Too many virtual booking attempts. Please try again later."
});

function requireAuthConfigured(req, res, next) {
    if (!JWT_SECRET) {
        return res.status(503).json({
            error: "Authentication is not configured."
        });
    }

    return next();
}

function requireAdmin(req, res, next) {
    if (ADMIN_USER_IDS.size === 0) {
        return res.status(503).json({
            error: "Administrator access is not configured."
        });
    }

    if (!ADMIN_USER_IDS.has(Number(req.user?.id))) {
        return res.status(403).json({
            error: "Administrator access required."
        });
    }

    return next();
}

// Baseline security headers. A restrictive CSP requires a separate
// migration because existing pages rely on inline scripts and styles.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (req.secure || req.get("x-forwarded-proto") === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }

    return next();
});

const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

if (configuredOrigins.length > 0) {
    app.use(cors({
        origin(origin, callback) {
            if (!origin || configuredOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(null, false);
        }
    }));
} else {
    // Keep public read-only endpoints working until the canonical web origin
    // is verified and CORS_ORIGINS is configured in the hosting environment.
    app.use(cors());
}

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

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

    await query(`
        CREATE TABLE IF NOT EXISTS pilot_applications (
            id BIGSERIAL PRIMARY KEY,
            first_name VARCHAR(80) NOT NULL,
            last_name VARCHAR(80) NOT NULL,
            age SMALLINT NOT NULL CHECK (age BETWEEN 1 AND 120),
            country VARCHAR(100) NOT NULL,
            email VARCHAR(254) NOT NULL,
            discord_username VARCHAR(100) NOT NULL,
            simulator VARCHAR(100) NOT NULL,
            experience_level VARCHAR(80) NOT NULL,
            flight_hours INTEGER NOT NULL DEFAULT 0 CHECK (flight_hours >= 0),
            network VARCHAR(40),
            reason TEXT,
            privacy_notice_version VARCHAR(24) NOT NULL DEFAULT '2026-10',
            privacy_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'withdrawn')),
            review_notes VARCHAR(2000),
            reviewed_at TIMESTAMPTZ,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_pilot_applications_status_created_at
        ON pilot_applications (status, created_at DESC);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_pilot_applications_email
        ON pilot_applications (LOWER(email));
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS pilot_application_events (
            id BIGSERIAL PRIMARY KEY,
            application_id BIGINT NOT NULL
                REFERENCES pilot_applications(id) ON DELETE CASCADE,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(40) NOT NULL,
            note VARCHAR(2000),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_pilot_application_events_application
        ON pilot_application_events (application_id, created_at DESC);
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS external_submissions (
            id BIGSERIAL PRIMARY KEY,
            type VARCHAR(20) NOT NULL CHECK (type IN ('manager', 'contact')),
            name VARCHAR(160) NOT NULL,
            email VARCHAR(254) NOT NULL,
            subject VARCHAR(160) NOT NULL,
            message TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            privacy_notice_version VARCHAR(24) NOT NULL DEFAULT '2026-10',
            privacy_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20) NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'in_progress', 'responded', 'closed', 'pending', 'reviewing', 'approved', 'rejected', 'withdrawn')),
            review_notes VARCHAR(2000),
            reviewed_at TIMESTAMPTZ,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_external_submissions_type_status_created
        ON external_submissions (type, status, created_at DESC);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_external_submissions_email
        ON external_submissions (LOWER(email));
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS external_submission_events (
            id BIGSERIAL PRIMARY KEY,
            submission_id BIGINT NOT NULL
                REFERENCES external_submissions(id) ON DELETE CASCADE,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(40) NOT NULL,
            note VARCHAR(2000),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_external_submission_events_submission
        ON external_submission_events (submission_id, created_at DESC);
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS bookings (
            id BIGSERIAL PRIMARY KEY,
            booking_reference VARCHAR(12) NOT NULL UNIQUE,
            status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('confirmed', 'cancelled')),
            payment_status VARCHAR(24) NOT NULL DEFAULT 'not_applicable'
                CHECK (payment_status = 'not_applicable'),
            trip_type VARCHAR(12) NOT NULL
                CHECK (trip_type IN ('oneway', 'roundtrip')),
            passenger_count SMALLINT NOT NULL
                CHECK (passenger_count BETWEEN 1 AND 8),
            passenger_first_name VARCHAR(80) NOT NULL,
            passenger_last_name VARCHAR(80) NOT NULL,
            passenger_email VARCHAR(254) NOT NULL,
            passenger_phone VARCHAR(40),
            flight_number VARCHAR(12) NOT NULL,
            origin_icao CHAR(4) NOT NULL,
            destination_icao CHAR(4) NOT NULL,
            departure_date DATE NOT NULL,
            return_date DATE,
            return_flight_number VARCHAR(12),
            return_departure_time TIME,
            return_arrival_time TIME,
            return_duration VARCHAR(20),
            return_aircraft VARCHAR(30),
            return_seat_numbers VARCHAR(5)[],
            departure_time TIME NOT NULL,
            arrival_time TIME NOT NULL,
            duration VARCHAR(20) NOT NULL,
            aircraft VARCHAR(30) NOT NULL,
            seat_numbers VARCHAR(5)[] NOT NULL,
            cabin VARCHAR(20) NOT NULL
                CHECK (cabin IN ('Economy', 'Premium Economy', 'Business')),
            extras JSONB NOT NULL DEFAULT '{}'::jsonb,
            estimated_total NUMERIC(10, 2) NOT NULL CHECK (estimated_total >= 0),
            privacy_notice_version VARCHAR(24) NOT NULL DEFAULT '2026-10',
            privacy_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK (origin_icao <> destination_icao),
            CHECK (array_length(seat_numbers, 1) = passenger_count),
            CHECK (
                (trip_type = 'oneway' AND return_date IS NULL) OR
                (trip_type = 'roundtrip' AND return_date IS NOT NULL AND return_date > departure_date)
            )
        );
    `);

    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_flight_number VARCHAR(12);
    `);
    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_departure_time TIME;
    `);
    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_arrival_time TIME;
    `);
    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_duration VARCHAR(20);
    `);
    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_aircraft VARCHAR(30);
    `);
    await query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS return_seat_numbers VARCHAR(5)[];
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_bookings_created_at
        ON bookings (created_at DESC);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_bookings_status_created_at
        ON bookings (status, created_at DESC);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_bookings_flight_date
        ON bookings (flight_number, departure_date);
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS booking_seats (
            id BIGSERIAL PRIMARY KEY,
            booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            flight_number VARCHAR(12) NOT NULL,
            departure_date DATE NOT NULL,
            seat_number VARCHAR(5) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved', 'released')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (booking_id, seat_number)
        );
    `);

    await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_active_flight_seat
        ON booking_seats (flight_number, departure_date, seat_number)
        WHERE status = 'reserved';
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS booking_events (
            id BIGSERIAL PRIMARY KEY,
            booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(40) NOT NULL,
            note VARCHAR(2000),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_booking_events_booking
        ON booking_events (booking_id, created_at DESC);
    `);

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

// Optional channel for recruitment notifications. Messages include reference
// numbers only; applicant names, email addresses and message contents are not posted.
const DISCORD_APPLICATIONS_CHANNEL_ID =
    process.env.DISCORD_APPLICATIONS_CHANNEL_ID || "";

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

    const value =
        firstValue(
            flight,
            [
                "distance",
                "distanceKm",
                "distance_km",
                "routeDistance",
                "distanceFlown"
            ]
        );

    return toNumber(value);
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

    const distance =
        flights.reduce(
            (
                total,
                flight
            ) =>
                total +
                toNumber(
                    flight.distance
                ),
            0
        );

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
            round(
                distance,
                2
            ),

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

    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured.");
    }

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

    if (!JWT_SECRET) {
        return res.status(503).json({
            error: "Authentication is not configured."
        });
    }

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

// ============================================================
// DISCORD BOT
// ============================================================

let discordClient = null;

let discordReady =
    false;

async function startDiscordBot() {

    if (!DISCORD_BOT_TOKEN) {

        console.warn(
            "Discord bot disabled: DISCORD_BOT_TOKEN is missing."
        );

        return;
    }

    if (!DISCORD_GUILD_ID) {

        console.warn(
            "Discord bot warning: DISCORD_GUILD_ID is missing."
        );
    }

    discordClient =
        new Client({
            intents: [
                GatewayIntentBits.Guilds
            ]
        });

    discordClient.once(
        "ready",
        async () => {

            discordReady =
                true;

            console.log(
                `Discord bot logged in as ${discordClient.user.tag}`
            );

            if (DISCORD_GUILD_ID) {

                try {

                    const guild =
                        await discordClient.guilds.fetch(
                            DISCORD_GUILD_ID
                        );

                    console.log(
                        `Discord server connected: ${guild.name}`
                    );

                } catch (error) {

                    console.error(
                        "Could not access Discord server:",
                        error.message
                    );
                }
            }
        }
    );

    discordClient.on(
        "error",
        error => {

            console.error(
                "Discord client error:",
                error
            );
        }
    );

    try {

        await discordClient.login(
            DISCORD_BOT_TOKEN
        );

    } catch (error) {

        console.error(
            "Discord bot login failed:",
            error.message
        );

        discordReady =
            false;
    }
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

        try {

            await query(
                "SELECT 1"
            );

            res.json({

                status:
                    "ok",

                database:
                    "connected",

                discordBot:
                    discordReady
                        ? "connected"
                        : "not connected",

                time:
                    new Date().toISOString()
            });

        } catch (error) {

            console.error("Health check failed:", error);

            res.status(500).json({

                status:
                    "error",

                database:
                    "disconnected",

                discordBot:
                    discordReady
                        ? "connected"
                        : "not connected",

                error:
                    "Health check failed"
            });
        }
    }
);

// ============================================================
// REGISTER
// ============================================================

app.post(
    "/api/auth/register",
    registerRateLimit,
    requireAuthConfigured,
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
    loginRateLimit,
    requireAuthConfigured,
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

const NEWSKY_MIN_DATE =
    process.env.NEWSKY_HISTORY_START ||
    "2020-01-01";

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
                        })
                }
            );

        text =
            await response.text();

        console.log(
            `NewSky HTTP status: ${response.status}`
        );

        if (
            response.status !== 429
        ) {

            break;
        }

        console.warn(
            `NewSky rate limit reached. Attempt ${attempt}/${NEWSKY_MAX_RETRIES}.`
        );

        const retryAfter =
            response.headers.get(
                "retry-after"
            );

        let waitTime =
            10000;

        if (retryAfter) {

            const retrySeconds =
                Number(
                    retryAfter
                );

            if (
                Number.isFinite(
                    retrySeconds
                )
            ) {

                waitTime =
                    Math.max(
                        retrySeconds * 1000,
                        10000
                    );
            }
        }

        console.log(
            `Waiting ${Math.round(
                waitTime / 1000
            )} seconds before retry...`
        );

        await sleep(waitTime);
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

    let rangeStart =
        toDateOnly(
            NEWSKY_MIN_DATE
        );

    let rangeNumber =
        0;

    if (
        rangeStart >
        today
    ) {

        throw new Error(
            `NEWSKY_HISTORY_START (${rangeStart}) cannot be in the future.`
        );
    }

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
        `History end: ${today}`
    );
    console.log(
        `Page size: ${NEWSKY_PAGE_SIZE}`
    );
    console.log(
        "============================================================"
    );
    console.log("");

    while (
        rangeStart <=
        today
    ) {

        rangeNumber++;

        const rangeEnd =
            minDate(
                addDays(
                    rangeStart,
                    29
                ),
                today
            );

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
             * Respect the NewSky rate limit between requests.
             *
             * We intentionally wait before every request after
             * the first request of the entire sync.
             */
            if (
                allFlights.length > 0
            ) {

                await sleep(
                    NEWSKY_RATE_LIMIT_DELAY
                );
            }

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

        rangeStart =
            addDays(
                rangeEnd,
                1
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
// SYNC ALL ECHO AIR GROUP FLIGHTS
// ============================================================

app.post(
    "/api/sync/all",
    authenticate,
    requireAdmin,
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

            const pilotId =
                String(
                    req.user.newsky_pilot_id ||
                    ""
                ).trim();

            if (!pilotId) {

                return res.status(400).json({
                    error:
                        "Please link your NewSky Pilot ID first."
                });
            }

            console.log(
                `Starting personal flight sync for ${req.user.username} (${pilotId})`
            );

            const allFlights =
                await getAllNewSkyFlights();

            const pilotFlights =
                allFlights.filter(
                    flight =>
                        String(
                            getPilotId(
                                flight
                            )
                        ).trim() ===
                        pilotId
                );

            console.log(
                `Found ${pilotFlights.length} flight(s) for pilot ${pilotId}.`
            );

            const result =
                await importAllFlights(
                    pilotFlights
                );

            const stats =
                await getUserStats(
                    req.user.id
                );

            const discordResult =
                await syncDiscordRank(
                    req.user.id
                );

            res.json({

                message:
                    `${pilotFlights.length} flight(s) found for your NewSky Pilot ID.`,

                newskyFlightsReceived:
                    allFlights.length,

                pilotFlightsFound:
                    pilotFlights.length,

                flightsImported:
                    result.imported,

                flightsUpdated:
                    result.updated,

                flightsSkipped:
                    result.skipped,

                discordRankSync:
                    discordResult,

                stats: {

                    stars:
                        stats.stars,

                    rank:
                        stats.rank.name,

                    flightCount:
                        stats.flightCount,

                    averageRating:
                        stats.averageRating,

                    flightHours:
                        stats.flightHours,

                    distance:
                        stats.distance
                }
            });

        } catch (error) {

            console.error(
                "Personal sync error:",
                error
            );

            res.status(500).json({

                error:
                    error.message ||
                    "Unable to synchronize flights."
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
                        created_at
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
                        created_at
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
                        display_name
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

                    stars:
                        stats.stars,

                    flights:
                        stats.flightCount,

                    flightCount:
                        stats.flightCount,

                    averageRating:
                        stats.averageRating,

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
    requireAdmin,
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
// ============================================================
// VIRTUAL BOOKING ENGINE
// ============================================================

// The website labels these as virtual fares: they are never payments,
// and the API intentionally has no card-number, expiry or CVV fields.
const DEMO_FLIGHT_ROWS = [
    ["ECV201","EHAM","LIRF","07:20","09:35","2h 15m","A320",129],
    ["ECV203","EHAM","LIRF","11:45","14:00","2h 15m","A21N",145],
    ["ECV205","EHAM","LIRF","16:30","18:45","2h 15m","A320",139],
    ["ECV207","EHAM","LIRF","20:10","22:25","2h 15m","B737-800",125],
    ["ECV202","LIRF","EHAM","08:15","10:35","2h 20m","A320",132],
    ["ECV204","LIRF","EHAM","12:30","14:50","2h 20m","A21N",148],
    ["ECV206","LIRF","EHAM","17:15","19:35","2h 20m","A320",142],
    ["ECV208","LIRF","EHAM","21:00","23:20","2h 20m","B737-800",128],
    ["ECV301","LEBL","LIRF","06:50","08:40","1h 50m","A319",99],
    ["ECV303","LEBL","LIRF","10:25","12:15","1h 50m","A320",109],
    ["ECV305","LEBL","LIRF","14:40","16:30","1h 50m","A21N",115],
    ["ECV307","LEBL","LIRF","19:20","21:10","1h 50m","A320",105],
    ["ECV302","LIRF","LEBL","08:10","10:05","1h 55m","A319",101],
    ["ECV304","LIRF","LEBL","11:50","13:45","1h 55m","A320",111],
    ["ECV306","LIRF","LEBL","15:25","17:20","1h 55m","A21N",117],
    ["ECV308","LIRF","LEBL","20:10","22:05","1h 55m","A320",107],
    ["ECV401","LIRF","LKPR","07:15","08:55","1h 40m","A320",105],
    ["ECV403","LIRF","LKPR","13:20","15:00","1h 40m","A319",98],
    ["ECV405","LIRF","LKPR","18:45","20:25","1h 40m","A21N",112],
    ["ECV402","LKPR","LIRF","09:45","11:25","1h 40m","A320",108],
    ["ECV404","LKPR","LIRF","15:55","17:35","1h 40m","A319",101],
    ["ECV406","LKPR","LIRF","21:15","22:55","1h 40m","A21N",115],
    ["ECV501","EHAM","LEBL","06:40","08:55","2h 15m","A320",119],
    ["ECV503","EHAM","LEBL","12:15","14:30","2h 15m","A21N",129],
    ["ECV505","EHAM","LEBL","17:50","20:05","2h 15m","A320",124],
    ["ECV502","LEBL","EHAM","09:40","12:00","2h 20m","A320",122],
    ["ECV504","LEBL","EHAM","15:15","17:35","2h 20m","A21N",132],
    ["ECV506","LEBL","EHAM","20:50","23:10","2h 20m","A320",127],
    ["ECV601","LGAV","LIRF","07:00","08:50","1h 50m","A320",115],
    ["ECV603","LGAV","LIRF","12:40","14:30","1h 50m","A21N",125],
    ["ECV605","LGAV","LIRF","18:10","20:00","1h 50m","A320",119],
    ["ECV602","LIRF","LGAV","09:40","11:30","1h 50m","A320",118],
    ["ECV604","LIRF","LGAV","15:20","17:10","1h 50m","A21N",128],
    ["ECV606","LIRF","LGAV","20:50","22:40","1h 50m","A320",122],
    ["ECV701","LIRF","LGKR","08:00","09:20","1h 20m","A319",89],
    ["ECV703","LIRF","LGKR","13:45","15:05","1h 20m","A320",95],
    ["ECV705","LIRF","LGKR","18:30","19:50","1h 20m","A21N",102],
    ["ECV702","LGKR","LIRF","10:10","11:30","1h 20m","A319",92],
    ["ECV704","LGKR","LIRF","15:55","17:15","1h 20m","A320",98],
    ["ECV706","LGKR","LIRF","20:40","22:00","1h 20m","A21N",105],
    ["ECV801","EHAM","LFPG","07:15","08:40","1h 25m","A320",99],
    ["ECV803","EHAM","LFPG","12:20","13:45","1h 25m","A319",95],
    ["ECV805","EHAM","LFPG","18:15","19:40","1h 25m","A21N",108],
    ["ECV802","LFPG","EHAM","09:30","10:55","1h 25m","A320",102],
    ["ECV804","LFPG","EHAM","15:00","16:25","1h 25m","A319",98],
    ["ECV806","LFPG","EHAM","20:30","21:55","1h 25m","A21N",111],
    ["ECV901","EGLL","EHAM","06:55","09:15","1h 20m","A320",109],
    ["ECV903","EGLL","EHAM","12:10","14:30","1h 20m","A21N",119],
    ["ECV905","EGLL","EHAM","18:40","21:00","1h 20m","A320",114],
    ["ECV902","EHAM","EGLL","09:50","10:10","1h 20m","A320",112],
    ["ECV904","EHAM","EGLL","15:25","15:45","1h 20m","A21N",122],
    ["ECV906","EHAM","EGLL","21:45","22:05","1h 20m","A320",117],
    ["ECV1001","KJFK","EHAM","17:30","06:20","7h 50m","A350-900",499],
    ["ECV1003","KJFK","EHAM","21:15","10:05","7h 50m","A350-900",529],
    ["ECV1002","EHAM","KJFK","11:20","13:55","8h 35m","A350-900",519],
    ["ECV1004","EHAM","KJFK","15:40","18:15","8h 35m","A350-900",549],
    ["ECV1101","WSSS","KJFK","10:30","17:20","17h 50m","A350-900",899],
    ["ECV1103","WSSS","KJFK","23:15","06:05","17h 50m","A350-900",949],
    ["ECV1102","KJFK","WSSS","20:10","15:00","17h 50m","A350-900",929]
];

const DEMO_FLIGHT_SCHEDULE = new Map(
    DEMO_FLIGHT_ROWS.map(([number, from, to, departure, arrival, duration, aircraft, baseFare]) => [
        number, { number, from, to, departure, arrival, duration, aircraft, baseFare }
    ])
);

const DEMO_AIRPORT_CODES = new Set([
    "LIRF", "LEBL", "LKPR", "EHAM", "EDDF", "LOWW", "LGKR",
    "LGAV", "LIRN", "LIMC", "LFPG", "EGLL", "KJFK", "WSSS"
]);

function generatePersistentBookingReference() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return "EAG" + Array.from(
        { length: 6 },
        () => alphabet[crypto.randomInt(0, alphabet.length)]
    ).join("");
}

function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00.000Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findDemoReturnFlight(outboundFlight) {
    if (!outboundFlight) return null;
    return DEMO_FLIGHT_ROWS
        .filter((row) => row[1] === outboundFlight.to && row[2] === outboundFlight.from)
        .map(([number, from, to, departure, arrival, duration, aircraft, baseFare]) => ({
            number, from, to, departure, arrival, duration, aircraft, baseFare
        }))
        .sort((a, b) => a.baseFare - b.baseFare || a.number.localeCompare(b.number))[0] || null;
}

// Create a persistent virtual itinerary. This endpoint never accepts payment
// credentials and never charges a card; the server calculates a display-only fare.
app.post(
    "/api/bookings",
    bookingRateLimit,
    async (req, res) => {
        const input = req.body || {};
        const flight = input.flight || {};
        const passenger = input.passenger || {};
        const flightNumber = String(flight.number || "").trim().toUpperCase();
        const officialFlight = DEMO_FLIGHT_SCHEDULE.get(flightNumber);
        const tripType = String(input.tripType || "").trim().toLowerCase();
        const returnFlight = tripType === "roundtrip"
            ? findDemoReturnFlight(officialFlight)
            : null;
        const departureDate = String(flight.date || "").trim();
        const returnDateRaw = String(input.returnDate || "").trim();
        const returnDate = tripType === "roundtrip" ? returnDateRaw : null;
        const passengerCount = Number(input.passengerCount);
        const cabin = String(input.cabin || "").trim();
        const firstName = String(passenger.firstName || "").trim();
        const lastName = String(passenger.lastName || "").trim();
        const email = String(passenger.email || "").trim().toLowerCase();
        const phone = String(passenger.phone || "").trim();
        const seatNumbers = Array.isArray(input.seatNumbers)
            ? input.seatNumbers.map((seat) => String(seat).trim().toUpperCase())
            : [];
        const privacyAcknowledged =
            input.privacyAcknowledged === true || input.privacyAcknowledged === "yes";
        const allowedCabins = new Set(["Economy", "Premium Economy", "Business"]);
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!privacyAcknowledged) {
            return res.status(400).json({ error: "Please acknowledge the privacy notice before confirming your virtual booking." });
        }
        if (!officialFlight) {
            return res.status(400).json({ error: "The selected flight is not in the published Echo Air Group demo schedule." });
        }
        if (
            String(flight.from || "").toUpperCase() !== officialFlight.from ||
            String(flight.to || "").toUpperCase() !== officialFlight.to ||
            String(flight.departure || "") !== officialFlight.departure ||
            String(flight.arrival || "") !== officialFlight.arrival ||
            String(flight.duration || "") !== officialFlight.duration ||
            String(flight.aircraft || "") !== officialFlight.aircraft
        ) {
            return res.status(400).json({ error: "The selected flight details do not match the published demo schedule." });
        }
        if (!DEMO_AIRPORT_CODES.has(officialFlight.from) || !DEMO_AIRPORT_CODES.has(officialFlight.to) || officialFlight.from === officialFlight.to) {
            return res.status(400).json({ error: "The selected route is invalid." });
        }
        if (!isValidIsoDate(departureDate) || departureDate < new Date().toISOString().slice(0, 10)) {
            return res.status(400).json({ error: "Choose a valid departure date that is today or later." });
        }
        if (tripType !== "oneway" && tripType !== "roundtrip") {
            return res.status(400).json({ error: "Choose one-way or round-trip mode." });
        }
        if (tripType === "roundtrip" && (!returnDate || !isValidIsoDate(returnDate) || returnDate <= departureDate)) {
            return res.status(400).json({ error: "For a round trip, the return date must be after the departure date." });
        }
        if (tripType === "roundtrip" && !returnFlight) {
            return res.status(400).json({ error: "There is no published return service for this route. Choose a different route or a one-way trip." });
        }
        if (!Number.isSafeInteger(passengerCount) || passengerCount < 1 || passengerCount > 8) {
            return res.status(400).json({ error: "Choose between 1 and 8 passengers." });
        }
        if (!allowedCabins.has(cabin)) {
            return res.status(400).json({ error: "Choose a valid cabin." });
        }
        if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80) {
            return res.status(400).json({ error: "Enter a valid passenger first and last name." });
        }
        if (!emailPattern.test(email) || email.length > 254) {
            return res.status(400).json({ error: "Enter a valid passenger email address." });
        }
        if (phone.length > 40) {
            return res.status(400).json({ error: "Phone number must be 40 characters or fewer." });
        }
        if (seatNumbers.length !== passengerCount || new Set(seatNumbers).size !== passengerCount) {
            return res.status(400).json({ error: "Select one unique seat for each passenger." });
        }

        const flightNumericCode = Number(flightNumber.replace("ECV", ""));
        for (const seat of seatNumbers) {
            const match = seat.match(/^([1-9]|1\d|2[0-4])([A-F])$/);
            if (!match) {
                return res.status(400).json({ error: "One or more seat selections are invalid." });
            }

            const row = Number(match[1]);
            const letter = match[2];
            const cabinAllowsSeat =
                (cabin === "Economy" && row >= 5) ||
                (cabin === "Premium Economy" && row >= 5 && row <= 6) ||
                (cabin === "Business" && row <= 4);

            if (!cabinAllowsSeat) {
                return res.status(400).json({ error: "One or more seats do not belong to the selected cabin." });
            }
            if ((row * 7 + letter.charCodeAt(0) + flightNumericCode) % 11 === 0) {
                return res.status(409).json({ error: "One of the selected seats is marked unavailable on the outbound flight. Please select another seat." });
            }
            if (returnFlight) {
                const returnFlightNumericCode = Number(returnFlight.number.replace("ECV", ""));
                if ((row * 7 + letter.charCodeAt(0) + returnFlightNumericCode) % 11 === 0) {
                    return res.status(409).json({ error: "One of the selected seats is marked unavailable on the return flight. Please select different seats." });
                }
            }
        }

        const extrasInput = input.extras || {};
        const extras = {
            baggage: extrasInput.baggage === true,
            meal: extrasInput.meal === true,
            wifi: extrasInput.wifi === true,
            insurance: extrasInput.insurance === true
        };
        const perPassengerSurcharge =
            (cabin === "Premium Economy" ? 35 : cabin === "Business" ? 120 : 0) +
            (extras.baggage ? 35 : 0) +
            (extras.meal ? 18 : 0) +
            (extras.wifi ? 9 : 0) +
            (extras.insurance ? 15 : 0);
        const legs = returnFlight ? 2 : 1;
        const estimatedTotal = Number((
            (officialFlight.baseFare + (returnFlight ? returnFlight.baseFare : 0) +
                perPassengerSurcharge * legs) * passengerCount
        ).toFixed(2));

        const client = await pool.connect();
        let booking;
        try {
            await client.query("BEGIN");
            const reference = generatePersistentBookingReference();
            const inserted = await client.query(
                "INSERT INTO bookings (booking_reference, trip_type, passenger_count, passenger_first_name, " +
                "passenger_last_name, passenger_email, passenger_phone, flight_number, origin_icao, destination_icao, " +
                "departure_date, return_date, return_flight_number, return_departure_time, return_arrival_time, " +
                "return_duration, return_aircraft, return_seat_numbers, departure_time, arrival_time, duration, aircraft, " +
                "seat_numbers, cabin, extras, estimated_total, privacy_notice_version, privacy_acknowledged_at, status, payment_status) " +
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,CURRENT_TIMESTAMP,'confirmed','not_applicable') " +
                "RETURNING id, booking_reference, status, trip_type, passenger_count, flight_number, origin_icao, destination_icao, " +
                "departure_date, return_date, return_flight_number, return_departure_time, return_arrival_time, return_duration, " +
                "return_aircraft, return_seat_numbers, departure_time, arrival_time, aircraft, seat_numbers, cabin, estimated_total, created_at",
                [
                    reference, tripType, passengerCount, firstName, lastName, email,
                    phone || null, officialFlight.number, officialFlight.from, officialFlight.to,
                    departureDate, returnDate, returnFlight?.number || null,
                    returnFlight?.departure || null, returnFlight?.arrival || null,
                    returnFlight?.duration || null, returnFlight?.aircraft || null,
                    returnFlight ? seatNumbers : null,
                    officialFlight.departure, officialFlight.arrival, officialFlight.duration,
                    officialFlight.aircraft, seatNumbers, cabin, extras, estimatedTotal, "2026-10"
                ]
            );
            booking = inserted.rows[0];

            for (const seat of seatNumbers) {
                await client.query(
                    "INSERT INTO booking_seats (booking_id, flight_number, departure_date, seat_number, status) " +
                    "VALUES ($1,$2,$3,$4,'reserved')",
                    [booking.id, officialFlight.number, departureDate, seat]
                );
                if (returnFlight) {
                    await client.query(
                        "INSERT INTO booking_seats (booking_id, flight_number, departure_date, seat_number, status) " +
                        "VALUES ($1,$2,$3,$4,'reserved')",
                        [booking.id, returnFlight.number, returnDate, seat]
                    );
                }
            }

            await client.query(
                "INSERT INTO booking_events (booking_id, action, note) VALUES ($1, 'created', $2)",
                [booking.id, "Virtual reservation created. No payment was collected."]
            );
            await client.query("COMMIT");

            return res.status(201).json({
                message: "Your virtual booking is confirmed. No payment was taken.",
                booking: {
                    id: booking.id,
                    reference: booking.booking_reference,
                    status: booking.status,
                    tripType: booking.trip_type,
                    passengerCount: booking.passenger_count,
                    flightNumber: booking.flight_number,
                    from: booking.origin_icao,
                    to: booking.destination_icao,
                    departureDate: booking.departure_date,
                    returnDate: booking.return_date,
                    departure: String(booking.departure_time).slice(0, 5),
                    arrival: String(booking.arrival_time).slice(0, 5),
                    aircraft: booking.aircraft,
                    seatNumbers: booking.seat_numbers,
                    returnFlight: booking.return_flight_number ? {
                        number: booking.return_flight_number,
                        departure: String(booking.return_departure_time).slice(0, 5),
                        arrival: String(booking.return_arrival_time).slice(0, 5),
                        duration: booking.return_duration,
                        aircraft: booking.return_aircraft,
                        date: booking.return_date,
                        seatNumbers: booking.return_seat_numbers
                    } : null,
                    cabin: booking.cabin,
                    estimatedTotal: Number(booking.estimated_total),
                    paymentStatus: "not_applicable",
                    createdAt: booking.created_at
                }
            });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            if (error?.code === "23505" && error?.constraint === "idx_booking_active_flight_seat") {
                return res.status(409).json({ error: "One of those seats was just reserved. Please choose different seats." });
            }
            console.error("Unable to create virtual booking:", error);
            return res.status(500).json({ error: "We could not save your virtual booking. Please try again." });
        } finally {
            client.release();
        }
    }
);

// Authorized booking list for operational review. Booking records are demo
// itineraries only; payment_status is always not_applicable.
app.get(
    "/api/admin/bookings",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const requestedStatus = String(req.query.status || "").trim().toLowerCase();
        const search = String(req.query.search || "").trim().slice(0, 100).toLowerCase();
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const offset = Math.min(10000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0));

        if (requestedStatus && !["confirmed", "cancelled"].includes(requestedStatus)) {
            return res.status(400).json({ error: "Invalid booking status filter." });
        }

        try {
            const filters = [];
            const params = [];
            if (requestedStatus) {
                params.push(requestedStatus);
                filters.push("status = $" + params.length);
            }
            if (search) {
                params.push(search);
                const p = "$" + params.length;
                filters.push(
                    "(POSITION(" + p + " IN LOWER(booking_reference)) > 0 OR " +
                    "POSITION(" + p + " IN LOWER(passenger_first_name)) > 0 OR " +
                    "POSITION(" + p + " IN LOWER(passenger_last_name)) > 0 OR " +
                    "POSITION(" + p + " IN LOWER(passenger_email)) > 0 OR " +
                    "POSITION(" + p + " IN LOWER(flight_number)) > 0)"
                );
            }
            const where = filters.length ? "WHERE " + filters.join(" AND ") : "";
            const count = await query("SELECT COUNT(*)::int AS total FROM bookings " + where, params);
            const pageParams = params.slice();
            pageParams.push(limit, offset);
            const result = await query(
                "SELECT id, booking_reference, status, payment_status, trip_type, passenger_count, " +
                "passenger_first_name, passenger_last_name, passenger_email, passenger_phone, " +
                "flight_number, origin_icao, destination_icao, departure_date, return_date, " +
                "return_flight_number, return_departure_time, return_arrival_time, return_duration, return_aircraft, return_seat_numbers, " +
                "departure_time, arrival_time, duration, aircraft, seat_numbers, cabin, extras, estimated_total, created_at, updated_at " +
                "FROM bookings " + where +
                " ORDER BY created_at DESC, id DESC LIMIT $" + (pageParams.length - 1) +
                " OFFSET $" + pageParams.length,
                pageParams
            );
            return res.json({
                total: Number(count.rows[0].total),
                limit,
                offset,
                bookings: result.rows
            });
        } catch (error) {
            console.error("Unable to load virtual bookings:", error);
            return res.status(500).json({ error: "Unable to load bookings." });
        }
    }
);

app.patch(
    "/api/admin/bookings/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const id = Number(req.params.id);
        const action = String(req.body?.action || "").trim().toLowerCase();
        const note = String(req.body?.note || "").trim();

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ error: "Invalid booking ID." });
        }
        if (action !== "cancel") {
            return res.status(400).json({ error: "Only cancellation is available for virtual bookings." });
        }
        if (note.length > 2000) {
            return res.status(400).json({ error: "Cancellation note must be 2,000 characters or fewer." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const selected = await client.query(
                "SELECT id, booking_reference, status FROM bookings WHERE id = $1 FOR UPDATE",
                [id]
            );
            const current = selected.rows[0];
            if (!current) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Booking not found." });
            }
            if (current.status === "cancelled") {
                await client.query("COMMIT");
                return res.json({ booking: { id: current.id, reference: current.booking_reference, status: current.status } });
            }
            const updated = await client.query(
                "UPDATE bookings SET status='cancelled', updated_at=CURRENT_TIMESTAMP " +
                "WHERE id=$1 RETURNING id, booking_reference, status, updated_at",
                [id]
            );
            await client.query(
                "UPDATE booking_seats SET status='released' WHERE booking_id=$1 AND status='reserved'",
                [id]
            );
            await client.query(
                "INSERT INTO booking_events (booking_id, actor_user_id, action, note) VALUES ($1,$2,'cancelled',$3)",
                [id, req.user.id, note || "Virtual booking cancelled by an administrator."]
            );
            await client.query("COMMIT");
            return res.json({ booking: updated.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            console.error("Unable to cancel virtual booking:", error);
            return res.status(500).json({ error: "Unable to cancel booking." });
        } finally {
            client.release();
        }
    }
);

app.get(
    "/api/admin/bookings/:id/events",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ error: "Invalid booking ID." });
        }
        try {
            const result = await query(
                "SELECT e.id, e.action, e.note, e.created_at, u.username AS actor_username, " +
                "u.display_name AS actor_display_name FROM booking_events e " +
                "LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.booking_id=$1 " +
                "ORDER BY e.created_at DESC, e.id DESC LIMIT 100",
                [id]
            );
            return res.json({ events: result.rows });
        } catch (error) {
            console.error("Unable to load booking history:", error);
            return res.status(500).json({ error: "Unable to load booking history." });
        }
    }
);

// PILOT APPLICATIONS
// ============================================================

// Public submission endpoint. Only the recruitment team can read or review
// submitted personal data; unauthenticated requests can never list applications.
app.post(
    "/api/applications",
    applicationRateLimit,
    async (req, res) => {
        const form = req.body || {};
        const read = (key, legacyKey) =>
            String(form[key] ?? form[legacyKey] ?? "").trim();
        const isNativeFormPost =
            String(req.get("content-type") || "").includes("application/x-www-form-urlencoded");
        const respondError = (status, message) => {
            if (isNativeFormPost && req.accepts("html")) {
                const state = status >= 500 ? "error" : "invalid";
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/join.html?application=" + state + "#application"
                );
            }
            return res.status(status).json({ error: message });
        };

        const firstName = read("firstName", "First Name");
        const lastName = read("lastName", "Last Name");
        const age = Number(read("age", "Age"));
        const country = read("country", "Country");
        const email = read("email", "Email Address").toLowerCase();
        const discord = read("discord", "Discord Username");
        const simulator = read("simulator", "Simulator");
        const experience = read("experience", "Experience Level");
        const flightHours = Number(read("flightHours", "Approximate Flight Hours"));
        const network = read("network", "Network");
        const reason = String(form.reason ?? form["Why do you want to join Echo Air Group?"] ?? "").trim();

        const allowedSimulators = new Set([
            "Microsoft Flight Simulator 2024",
            "Microsoft Flight Simulator 2020",
            "X-Plane 12",
            "X-Plane 11",
            "Prepar3D"
        ]);
        const allowedExperience = new Set([
            "Beginner — 0–50 hours",
            "Intermediate — 50–300 hours",
            "Advanced — 300–1,000 hours",
            "Expert — 1,000+ hours"
        ]);
        const allowedNetworks = new Set(["", "VATSIM", "IVAO", "Both", "Offline"]);
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!firstName || !lastName || !country || !email || !discord || !simulator || !experience) {
            return respondError(400, "Complete all required application fields.");
        }

        if (firstName.length > 80 || lastName.length > 80 || country.length > 100 ||
            email.length > 254 || discord.length > 100 || simulator.length > 100 ||
            experience.length > 80 || network.length > 40) {
            return respondError(400, "One or more application fields exceed the allowed length.");
        }

        if (!Number.isInteger(age) || age < 1 || age > 120) {
            return respondError(400, "Enter a valid age.");
        }

        if (!emailPattern.test(email)) {
            return respondError(400, "Enter a valid email address.");
        }

        if (!allowedSimulators.has(simulator) || !allowedExperience.has(experience) || !allowedNetworks.has(network)) {
            return respondError(400, "One or more application selections are invalid.");
        }

        if (!Number.isSafeInteger(flightHours) || flightHours < 0 || flightHours > 100000) {
            return respondError(400, "Enter valid approximate flight hours.");
        }

        if (reason.length > 3000) {
            return respondError(400, "The application message must be 3,000 characters or fewer.");
        }

        const privacyAcknowledged =
            form.privacyAcknowledged === true ||
            form.privacyAcknowledged === "yes" ||
            form["Privacy acknowledgement"] === "yes";

        if (!privacyAcknowledged) {
            return respondError(400, "Please confirm that you have read the privacy notice.");
        }

        try {
            const client = await pool.connect();
            let result;
            try {
                await client.query("BEGIN");
                result = await client.query(
                    `
                    INSERT INTO pilot_applications (
                        first_name, last_name, age, country, email,
                        discord_username, simulator, experience_level,
                        flight_hours, network, reason, privacy_notice_version,
                        privacy_acknowledged_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
                    RETURNING id, status, created_at
                    `,
                    [
                        firstName, lastName, age, country, email, discord,
                        simulator, experience, flightHours, network || null,
                        reason || null, "2026-10"
                    ]
                );

                await client.query(
                    `
                    INSERT INTO pilot_application_events (application_id, action, note)
                    VALUES ($1, 'submitted', 'Application received')
                    `,
                    [result.rows[0].id]
                );

                await client.query("COMMIT");
            } catch (transactionError) {
                await client.query("ROLLBACK").catch(() => {});
                throw transactionError;
            } finally {
                client.release();
            }

            const application = result.rows[0];

            void notifyRecruitment({ type: "pilot", id: application.id });

            if (isNativeFormPost && req.accepts("html")) {
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/join.html?application=received#application"
                );
            }

            return res.status(201).json({
                message: "Your pilot application has been received.",
                application: {
                    id: application.id,
                    status: application.status,
                    createdAt: application.created_at
                }
            });
        } catch (error) {
            console.error("Pilot application submission failed:", error);
            return respondError(500, "We could not save your application. Please try again later.");
        }
    }
);

// Recruitment-only list. Search and status filters are parameterized, and
// pagination is bounded so the endpoint cannot return the entire database.
app.get(
    "/api/admin/applications",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const allowedStatuses = new Set(["pending", "reviewing", "approved", "rejected", "withdrawn"]);
        const requestedStatus = String(req.query.status || "").trim().toLowerCase();
        const search = String(req.query.search || "").trim().slice(0, 100);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const offset = Math.min(10000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0));

        if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
            return res.status(400).json({ error: "Invalid application status filter." });
        }

        try {
            const filters = [];
            const params = [];

            if (requestedStatus) {
                params.push(requestedStatus);
                filters.push("status = $" + params.length);
            }

            if (search) {
                params.push(search.toLowerCase());
                const searchParam = "$" + params.length;
                filters.push(
                    "(POSITION(" + searchParam + " IN LOWER(first_name)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(last_name)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(email)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(discord_username)) > 0)"
                );
            }

            const where = filters.length ? "WHERE " + filters.join(" AND ") : "";
            const countResult = await query(
                "SELECT COUNT(*)::int AS total FROM pilot_applications " + where,
                params
            );

            const pageParams = params.slice();
            pageParams.push(limit);
            pageParams.push(offset);
            const result = await query(
                "SELECT id, first_name, last_name, age, country, email, discord_username, " +
                "simulator, experience_level, flight_hours, network, reason, status, review_notes, " +
                "reviewed_at, reviewed_by, privacy_notice_version, privacy_acknowledged_at, created_at, updated_at " +
                "FROM pilot_applications " + where +
                " ORDER BY created_at DESC, id DESC LIMIT $" + (pageParams.length - 1) +
                " OFFSET $" + pageParams.length,
                pageParams
            );

            return res.json({
                total: Number(countResult.rows[0].total),
                limit,
                offset,
                applications: result.rows
            });
        } catch (error) {
            console.error("Unable to load pilot applications:", error);
            return res.status(500).json({ error: "Unable to load pilot applications." });
        }
    }
);

// Status changes and the audit event are committed together.
app.patch(
    "/api/admin/applications/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const applicationId = Number(req.params.id);
        const status = String(req.body?.status || "").trim().toLowerCase();
        const allowedStatuses = new Set(["pending", "reviewing", "approved", "rejected", "withdrawn"]);
        const reviewNotes = String(req.body?.reviewNotes || "").trim();

        if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
            return res.status(400).json({ error: "Invalid application ID." });
        }

        if (!allowedStatuses.has(status)) {
            return res.status(400).json({ error: "Invalid application status." });
        }

        if (reviewNotes.length > 2000) {
            return res.status(400).json({ error: "Review notes must be 2,000 characters or fewer." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const existing = await client.query(
                "SELECT id, status FROM pilot_applications WHERE id = $1 FOR UPDATE",
                [applicationId]
            );

            if (!existing.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Application not found." });
            }

            const previousStatus = existing.rows[0].status;
            const updated = await client.query(
                `
                UPDATE pilot_applications
                SET status = $1,
                    review_notes = $2,
                    reviewed_at = CASE WHEN $1 = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END,
                    reviewed_by = CASE WHEN $1 = 'pending' THEN NULL ELSE $3 END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING id, status, review_notes, reviewed_at, reviewed_by, updated_at
                `,
                [status, reviewNotes || null, req.user.id, applicationId]
            );

            await client.query(
                `
                INSERT INTO pilot_application_events (
                    application_id, actor_user_id, action, note
                )
                VALUES ($1, $2, 'status_changed', $3)
                `,
                [
                    applicationId,
                    req.user.id,
                    "Status changed from " + previousStatus + " to " + status +
                        (reviewNotes ? ": " + reviewNotes : "")
                ]
            );

            await client.query("COMMIT");
            return res.json({ application: updated.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            console.error("Unable to update pilot application:", error);
            return res.status(500).json({ error: "Unable to update pilot application." });
        } finally {
            client.release();
        }
    }
);

app.get(
    "/api/admin/applications/:id/events",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const applicationId = Number(req.params.id);

        if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
            return res.status(400).json({ error: "Invalid application ID." });
        }

        try {
            const result = await query(
                `
                SELECT e.id, e.action, e.note, e.created_at,
                       u.username AS actor_username,
                       u.display_name AS actor_display_name
                FROM pilot_application_events e
                LEFT JOIN users u ON u.id = e.actor_user_id
                WHERE e.application_id = $1
                ORDER BY e.created_at DESC, e.id DESC
                LIMIT 100
                `,
                [applicationId]
            );
            return res.json({ events: result.rows });
        } catch (error) {
            console.error("Unable to load application history:", error);
            return res.status(500).json({ error: "Unable to load application history." });
        }
    }
);


async function notifyRecruitment({ type, id }) {
    if (!DISCORD_APPLICATIONS_CHANNEL_ID || !discordClient || !discordReady) {
        return;
    }

    try {
        const channel = await discordClient.channels.fetch(
            DISCORD_APPLICATIONS_CHANNEL_ID
        );

        if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
            console.warn("Recruitment notification skipped: configured channel is not text-capable.");
            return;
        }

        const reviewPage = type === "pilot"
            ? "https://echoairgroup.github.io/Echo-Air-Group/applications-admin.html"
            : "https://echoairgroup.github.io/Echo-Air-Group/submissions-admin.html";

        await channel.send({
            content:
                "New " + type + " submission received (reference #" + id + "). Review: " + reviewPage,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        // Submission persistence must not fail because the optional notification failed.
        console.error("Recruitment notification failed:", error?.message || error);
    }
}

async function createExternalSubmission(input) {
    const client = await pool.connect();
    let submission;

    try {
        await client.query("BEGIN");
        const result = await client.query(
            "INSERT INTO external_submissions " +
            "(type, name, email, subject, message, details, privacy_notice_version, privacy_acknowledged_at, status) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8) " +
            "RETURNING id, type, status, created_at",
            [
                input.type, input.name, input.email, input.subject,
                input.message, input.details || {}, "2026-10", input.status
            ]
        );
        submission = result.rows[0];
        await client.query(
            "INSERT INTO external_submission_events (submission_id, action, note) " +
            "VALUES ($1, 'submitted', $2)",
            [submission.id, input.type + " submission received"]
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    void notifyRecruitment({ type: submission.type, id: submission.id });
    return submission;
}

// Contact messages are stored in the first-party inbox. Public visitors can
// submit a message but cannot list or read the inbox.
app.post(
    "/api/contact",
    contactRateLimit,
    async (req, res) => {
        const form = req.body || {};
        const read = (key, legacyKey) => String(form[key] ?? form[legacyKey] ?? "").trim();
        const name = read("name", "name");
        const email = read("email", "email").toLowerCase();
        const subject = read("subject", "subject");
        const message = read("message", "message");
        const privacyAcknowledged =
            form.privacyAcknowledged === true ||
            form.privacyAcknowledged === "yes";

        const nativeFormPost =
            String(req.get("content-type") || "").includes("application/x-www-form-urlencoded");
        const respondError = (status, errorMessage) => {
            if (nativeFormPost && req.accepts("html")) {
                const state = status >= 500 ? "error" : "invalid";
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/contact.html?contact=" + state + "#contact-form"
                );
            }
            return res.status(status).json({ error: errorMessage });
        };

        const allowedSubjects = new Set([
            "General Question", "Pilot Application", "Partnership",
            "Technical Issue", "Other"
        ]);
        const validEmail =
            email.length <= 254 &&
            email.indexOf("@") > 0 &&
            email.lastIndexOf(".") > email.indexOf("@") + 1;

        if (!name || !email || !subject || !message) {
            return respondError(400, "Complete all required contact fields.");
        }
        if (name.length > 160 || email.length > 254 || message.length > 5000) {
            return respondError(400, "One or more contact fields exceed the allowed length.");
        }
        if (!validEmail) {
            return respondError(400, "Enter a valid email address.");
        }
        if (!allowedSubjects.has(subject)) {
            return respondError(400, "Select a valid contact subject.");
        }
        if (!privacyAcknowledged) {
            return respondError(400, "Please confirm that you have read the privacy notice.");
        }

        try {
            const submission = await createExternalSubmission({
                type: "contact",
                name,
                email,
                subject,
                message,
                details: {},
                status: "new"
            });

            if (nativeFormPost && req.accepts("html")) {
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/contact.html?contact=received#contact-form"
                );
            }

            return res.status(201).json({
                message: "Your message has been received.",
                submission: {
                    id: submission.id,
                    status: submission.status,
                    createdAt: submission.created_at
                }
            });
        } catch (error) {
            console.error("Contact submission failed:", error);
            return respondError(500, "We could not save your message. Please try again later.");
        }
    }
);

// Management applications share the secure inbox and event history but store
// their longer questionnaire in JSONB so new form questions remain additive.
app.post(
    "/api/manager-applications",
    managerApplicationRateLimit,
    async (req, res) => {
        const form = req.body || {};
        const read = (key, legacyKey) => String(form[key] ?? form[legacyKey] ?? "").trim();
        const firstName = read("firstName", "First Name");
        const lastName = read("lastName", "Last Name");
        const age = Number(read("age", "Age"));
        const country = read("country", "Country");
        const email = read("email", "Email Address").toLowerCase();
        const discord = read("discord", "Discord Username");
        const newSkyUsername = read("newSkyUsername", "NewSky Username");
        const currentPosition = read("currentPosition", "Current Echo Air Group Position");
        const role = read("preferredManagerType", "Preferred Manager Type");
        const secondaryArea = read("secondaryArea", "Secondary Management Area");
        const managementExperience = read("managementExperience", "Management Experience");
        const flightHoursRaw = read("flightHours", "Approximate Flight Hours");
        const flightHours = flightHoursRaw === "" ? null : Number(flightHoursRaw);
        const simulator = read("simulator", "Main Simulator");
        const network = read("network", "Flight Network");
        const availability = read("availability", "Weekly Availability");
        const timezone = read("timezone", "Time Zone");
        const motivation = read("motivation", "Why do you want to become a manager?");
        const roleReason = read("roleReason", "Why did you choose this management role?");
        const previousExperience = read("previousExperience", "Previous Management or Leadership Experience");
        const improvements = read("improvements", "What would you improve at Echo Air Group?");
        const suitability = read("suitability", "What makes you suitable for management?");
        const communityExperience = read("communityExperience", "Discord and Community Experience");
        const additionalInfo = read("additionalInfo", "Additional Information");
        const privacyAcknowledged =
            form.privacyAcknowledged === true ||
            form.privacyAcknowledged === "yes";

        const nativeFormPost =
            String(req.get("content-type") || "").includes("application/x-www-form-urlencoded");
        const respondError = (status, errorMessage) => {
            if (nativeFormPost && req.accepts("html")) {
                const state = status >= 500 ? "error" : "invalid";
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/manager.html?application=" + state + "#application"
                );
            }
            return res.status(status).json({ error: errorMessage });
        };

        const allowedRoles = new Set([
            "Executive / General Manager", "Operations Manager", "Flight Operations Manager",
            "Recruitment Manager", "Human Resources Manager", "Pilot Relations Manager",
            "Training Manager", "Events Manager", "Community Manager", "Discord Manager",
            "Discord Moderator", "Social Media Manager", "Marketing Manager",
            "Partnerships Manager", "Fleet Manager", "Route Manager", "Scheduling Manager",
            "Airline Development Manager", "Website / IT Manager", "Data / Statistics Manager",
            "Other / Specialist Manager"
        ]);
        const allowedPositions = new Set([
            "Pilot", "First Officer", "Senior First Officer", "Captain", "Senior Captain",
            "Other", "Not currently an Echo pilot"
        ]);
        const allowedExperience = new Set([
            "No previous management experience",
            "Some previous management experience",
            "1+ years of management experience",
            "2+ years of management experience",
            "Experienced manager / administrator"
        ]);
        const allowedAvailability = new Set([
            "Less than 2 hours", "2–5 hours", "5–10 hours", "10–15 hours", "15+ hours"
        ]);
        const allowedSimulators = new Set([
            "", "Microsoft Flight Simulator 2024", "Microsoft Flight Simulator 2020",
            "X-Plane 12", "X-Plane 11", "Prepar3D", "Other"
        ]);
        const allowedNetworks = new Set(["", "VATSIM", "IVAO", "Both", "Offline"]);
        const validEmail =
            email.length <= 254 &&
            email.indexOf("@") > 0 &&
            email.lastIndexOf(".") > email.indexOf("@") + 1;

        if (!firstName || !lastName || !country || !email || !discord ||
            !currentPosition || !role || !managementExperience || !availability ||
            !timezone || !motivation || !roleReason || !improvements || !suitability) {
            return respondError(400, "Complete all required management application fields.");
        }
        if (firstName.length > 80 || lastName.length > 80 || country.length > 100 ||
            email.length > 254 || discord.length > 100 || newSkyUsername.length > 100 ||
            currentPosition.length > 80 || role.length > 120 || secondaryArea.length > 120 ||
            managementExperience.length > 100 || simulator.length > 100 || network.length > 40 ||
            availability.length > 80 || timezone.length > 80 || motivation.length > 3000 ||
            roleReason.length > 3000 || previousExperience.length > 3000 ||
            improvements.length > 3000 || suitability.length > 3000 ||
            communityExperience.length > 3000 || additionalInfo.length > 3000) {
            return respondError(400, "One or more management application fields exceed the allowed length.");
        }
        if (!validEmail) {
            return respondError(400, "Enter a valid email address.");
        }
        if (!Number.isInteger(age) || age < 1 || age > 120) {
            return respondError(400, "Enter a valid age.");
        }
        if (flightHours !== null && (!Number.isSafeInteger(flightHours) || flightHours < 0 || flightHours > 100000)) {
            return respondError(400, "Enter valid approximate flight hours.");
        }
        if (!allowedPositions.has(currentPosition) || !allowedRoles.has(role) ||
            !allowedExperience.has(managementExperience) || !allowedAvailability.has(availability) ||
            !allowedSimulators.has(simulator) || !allowedNetworks.has(network)) {
            return respondError(400, "One or more management application selections are invalid.");
        }
        if (!privacyAcknowledged) {
            return respondError(400, "Please confirm that you have read the privacy notice.");
        }

        const details = {
            newSkyUsername,
            currentPosition,
            preferredManagerType: role,
            secondaryManagementArea: secondaryArea,
            managementExperience,
            flightHours,
            mainSimulator: simulator,
            flightNetwork: network,
            weeklyAvailability: availability,
            timezone,
            motivation,
            roleReason,
            previousExperience,
            improvements,
            suitability,
            communityExperience,
            additionalInfo
        };

        try {
            const submission = await createExternalSubmission({
                type: "manager",
                name: firstName + " " + lastName,
                email,
                subject: role,
                message: motivation,
                details: {
                    firstName,
                    lastName,
                    age,
                    country,
                    discordUsername: discord,
                    ...details
                },
                status: "pending"
            });

            if (nativeFormPost && req.accepts("html")) {
                return res.redirect(
                    303,
                    "https://echoairgroup.github.io/Echo-Air-Group/manager.html?application=received#application"
                );
            }

            return res.status(201).json({
                message: "Your management application has been received.",
                submission: {
                    id: submission.id,
                    status: submission.status,
                    createdAt: submission.created_at
                }
            });
        } catch (error) {
            console.error("Manager application submission failed:", error);
            return respondError(500, "We could not save your management application. Please try again later.");
        }
    }
);

// Authorized inbox for the external/contact and manager submissions. The type
// is required to avoid accidentally mixing recruitment and general messages.
app.get(
    "/api/admin/submissions",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const type = String(req.query.type || "").trim().toLowerCase();
        const requestedStatus = String(req.query.status || "").trim().toLowerCase();
        const search = String(req.query.search || "").trim().slice(0, 100);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const offset = Math.min(10000, Math.max(0, Number.parseInt(req.query.offset, 10) || 0));
        const statusOptions = type === "manager"
            ? new Set(["pending", "reviewing", "approved", "rejected", "withdrawn"])
            : new Set(["new", "in_progress", "responded", "closed"]);

        if (!["manager", "contact"].includes(type)) {
            return res.status(400).json({ error: "Choose manager or contact submissions." });
        }
        if (requestedStatus && !statusOptions.has(requestedStatus)) {
            return res.status(400).json({ error: "Invalid status filter for this inbox." });
        }

        try {
            const filters = [];
            const params = [type];
            filters.push("type = $1");
            if (requestedStatus) {
                params.push(requestedStatus);
                filters.push("status = $" + params.length);
            }
            if (search) {
                params.push(search.toLowerCase());
                const searchParam = "$" + params.length;
                filters.push(
                    "(POSITION(" + searchParam + " IN LOWER(name)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(email)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(subject)) > 0 OR " +
                    "POSITION(" + searchParam + " IN LOWER(message)) > 0)"
                );
            }

            const where = "WHERE " + filters.join(" AND ");
            const countResult = await query(
                "SELECT COUNT(*)::int AS total FROM external_submissions " + where,
                params
            );
            const pageParams = params.slice();
            pageParams.push(limit, offset);
            const result = await query(
                "SELECT id, type, name, email, subject, message, details, status, review_notes, " +
                "reviewed_at, reviewed_by, privacy_notice_version, privacy_acknowledged_at, created_at, updated_at " +
                "FROM external_submissions " + where +
                " ORDER BY created_at DESC, id DESC LIMIT $" + (pageParams.length - 1) +
                " OFFSET $" + pageParams.length,
                pageParams
            );
            return res.json({
                total: Number(countResult.rows[0].total),
                limit,
                offset,
                submissions: result.rows
            });
        } catch (error) {
            console.error("Unable to load external submissions:", error);
            return res.status(500).json({ error: "Unable to load submissions." });
        }
    }
);

app.patch(
    "/api/admin/submissions/:id",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const submissionId = Number(req.params.id);
        const status = String(req.body?.status || "").trim().toLowerCase();
        const reviewNotes = String(req.body?.reviewNotes || "").trim();

        if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
            return res.status(400).json({ error: "Invalid submission ID." });
        }
        if (reviewNotes.length > 2000) {
            return res.status(400).json({ error: "Review notes must be 2,000 characters or fewer." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const existing = await client.query(
                "SELECT id, type, status FROM external_submissions WHERE id = $1 FOR UPDATE",
                [submissionId]
            );
            const submission = existing.rows[0];
            if (!submission) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Submission not found." });
            }

            const allowedStatuses = submission.type === "manager"
                ? new Set(["pending", "reviewing", "approved", "rejected", "withdrawn"])
                : new Set(["new", "in_progress", "responded", "closed"]);
            if (!allowedStatuses.has(status)) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Invalid status for this submission type." });
            }

            const updated = await client.query(
                "UPDATE external_submissions SET status = $1, review_notes = $2, " +
                "reviewed_at = CASE WHEN $1 IN ('pending', 'new') THEN NULL ELSE CURRENT_TIMESTAMP END, " +
                "reviewed_by = CASE WHEN $1 IN ('pending', 'new') THEN NULL ELSE $3 END, " +
                "updated_at = CURRENT_TIMESTAMP WHERE id = $4 " +
                "RETURNING id, type, status, review_notes, reviewed_at, reviewed_by, updated_at",
                [status, reviewNotes || null, req.user.id, submissionId]
            );
            await client.query(
                "INSERT INTO external_submission_events (submission_id, actor_user_id, action, note) " +
                "VALUES ($1, $2, 'status_changed', $3)",
                [
                    submissionId,
                    req.user.id,
                    "Status changed from " + submission.status + " to " + status +
                        (reviewNotes ? ": " + reviewNotes : "")
                ]
            );
            await client.query("COMMIT");
            return res.json({ submission: updated.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            console.error("Unable to update external submission:", error);
            return res.status(500).json({ error: "Unable to update submission." });
        } finally {
            client.release();
        }
    }
);

app.get(
    "/api/admin/submissions/:id/events",
    authenticate,
    requireAdmin,
    async (req, res) => {
        const submissionId = Number(req.params.id);
        if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
            return res.status(400).json({ error: "Invalid submission ID." });
        }
        try {
            const result = await query(
                "SELECT e.id, e.action, e.note, e.created_at, " +
                "u.username AS actor_username, u.display_name AS actor_display_name " +
                "FROM external_submission_events e " +
                "LEFT JOIN users u ON u.id = e.actor_user_id " +
                "WHERE e.submission_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 100",
                [submissionId]
            );
            return res.json({ events: result.rows });
        } catch (error) {
            console.error("Unable to load submission history:", error);
            return res.status(500).json({ error: "Unable to load submission history." });
        }
    }
);

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

async function startServer() {

    try {

        await initializeDatabase();

        app.listen(
            PORT,
            async () => {

                console.log(
                    `Echo Air Group backend running on port ${PORT}`
                );

                console.log(
                    "Database: Neon PostgreSQL"
                );

                await startDiscordBot();
            }
        );

    } catch (error) {

        console.error(
            "Failed to start Echo Air Group backend:",
            error
        );

        process.exit(1);
    }
}

startServer();
