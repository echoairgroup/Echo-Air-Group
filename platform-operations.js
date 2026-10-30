"use strict";

const PLAN_STATUSES = new Set(["planned", "boarding", "cancelled"]);
const EVENT_TYPES = new Set(["group-flight", "training", "meeting", "community", "other"]);
const RSVP_STATUSES = new Set(["attending", "interested"]);

async function initializeOperationsSchema(query) {
    const statements = [
        "CREATE TABLE IF NOT EXISTS operations_flight_plans (" +
            "id BIGSERIAL PRIMARY KEY, flight_number TEXT NOT NULL, departure_icao TEXT NOT NULL, " +
            "arrival_icao TEXT NOT NULL, aircraft TEXT NOT NULL DEFAULT '', callsign TEXT NOT NULL DEFAULT '', " +
            "scheduled_departure TIMESTAMPTZ NOT NULL, estimated_duration_minutes INTEGER NOT NULL DEFAULT 60 " +
            "CHECK (estimated_duration_minutes BETWEEN 1 AND 1800), " +
            "status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','boarding','cancelled')), " +
            "pilot_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, " +
            "capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100), " +
            "notes TEXT NOT NULL DEFAULT '', published BOOLEAN NOT NULL DEFAULT TRUE, " +
            "created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, " +
            "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
            "updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS operations_flight_plans_schedule_idx ON operations_flight_plans (scheduled_departure, status) WHERE published = TRUE",
        "CREATE INDEX IF NOT EXISTS operations_flight_plans_pilot_idx ON operations_flight_plans (pilot_user_id, scheduled_departure)",
        "CREATE TABLE IF NOT EXISTS operations_flight_plan_pilots (" +
            "plan_id BIGINT NOT NULL REFERENCES operations_flight_plans(id) ON DELETE CASCADE, " +
            "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
            "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (plan_id,user_id))",
        "CREATE INDEX IF NOT EXISTS operations_flight_plan_pilots_user_idx ON operations_flight_plan_pilots (user_id, created_at DESC)",
        "INSERT INTO operations_flight_plan_pilots (plan_id,user_id) SELECT id,pilot_user_id FROM operations_flight_plans " +
            "WHERE pilot_user_id IS NOT NULL ON CONFLICT (plan_id,user_id) DO NOTHING",
        "CREATE TABLE IF NOT EXISTS community_events (" +
            "id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', " +
            "event_type TEXT NOT NULL DEFAULT 'community' CHECK (event_type IN ('group-flight','training','meeting','community','other')), " +
            "location TEXT NOT NULL DEFAULT '', starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ, " +
            "capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 2000), " +
            "published BOOLEAN NOT NULL DEFAULT TRUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, " +
            "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS community_events_schedule_idx ON community_events (starts_at, published)",
        "CREATE TABLE IF NOT EXISTS community_event_rsvps (" +
            "id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE, " +
            "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
            "status TEXT NOT NULL CHECK (status IN ('attending','interested')), " +
            "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
            "UNIQUE(event_id, user_id))",
        "CREATE INDEX IF NOT EXISTS community_event_rsvps_event_idx ON community_event_rsvps (event_id, status)",
        "CREATE INDEX IF NOT EXISTS community_event_rsvps_user_idx ON community_event_rsvps (user_id, updated_at DESC)"
    ];

    for (const statement of statements) await query(statement);
}

function registerOperationsRoutes(app, dependencies) {
    const { query, pool, authenticate } = dependencies;

    async function resolveRole(user) {
        const username = String(user && user.username || "").trim().toLowerCase();
        const rootNames = String(process.env.ADMIN_USERNAMES || "")
            .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
        if (username && rootNames.includes(username)) return "super_admin";
        const result = await query("SELECT role FROM platform_admin_roles WHERE user_id = $1", [user.id]);
        return result.rows[0] ? result.rows[0].role : null;
    }

    function requirePermission(permission) {
        const rolePermissions = {
            super_admin: ["*"],
            admin: ["operations.read", "operations.write", "events.manage"],
            operations_manager: ["operations.read", "operations.write", "events.manage"],
            analyst: ["operations.read"],
            viewer: ["operations.read"]
        };

        return (req, res, next) => {
            authenticate(req, res, async () => {
                try {
                    const role = await resolveRole(req.user);
                    const permissions = rolePermissions[role] || [];
                    if (!permissions.includes("*") && !permissions.includes(permission)) {
                        return res.status(403).json({ error: "Your account does not have permission to access this operations section." });
                    }
                    req.operationsRole = role;
                    return next();
                } catch (error) {
                    console.error("Operations permission check failed:", error.message);
                    return res.status(500).json({ error: "Unable to verify operations permissions." });
                }
            });
        };
    }

    async function writeAudit(req, action, targetType, targetId, details) {
        try {
            await query(
                "INSERT INTO platform_audit_log (actor_id, actor_username, action, target_type, target_id, details) " +
                "VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
                [
                    req.user ? req.user.id : null,
                    req.user ? req.user.username : "system",
                    String(action).slice(0, 120),
                    String(targetType).slice(0, 80),
                    targetId === null || targetId === undefined ? null : String(targetId),
                    JSON.stringify(details || {})
                ]
            );
        } catch (error) {
            console.warn("Operations audit entry could not be saved:", error.message);
        }
    }

    function cleanText(value, maxLength, fallback) {
        return String(value === undefined || value === null ? (fallback || "") : value)
            .replace(/\u0000/g, "").trim().slice(0, maxLength);
    }

    function validIcao(value) {
        const code = cleanText(value, 4, "").toUpperCase();
        return /^[A-Z0-9]{4}$/.test(code) ? code : null;
    }

    function validDate(value) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    function normalizePlan(input, current) {
        const source = input || {};
        const previous = current || {};
        const departure = validIcao(source.departureIcao !== undefined ? source.departureIcao : previous.departure_icao);
        const arrival = validIcao(source.arrivalIcao !== undefined ? source.arrivalIcao : previous.arrival_icao);
        const flightNumber = cleanText(source.flightNumber !== undefined ? source.flightNumber : previous.flight_number, 16, "").toUpperCase();
        const departureTime = validDate(source.scheduledDeparture !== undefined ? source.scheduledDeparture : previous.scheduled_departure);
        const duration = Number(source.estimatedDurationMinutes !== undefined ? source.estimatedDurationMinutes : previous.estimated_duration_minutes);
        const capacity = Number(source.capacity !== undefined ? source.capacity : previous.capacity || 1);
        const status = cleanText(source.status !== undefined ? source.status : previous.status || "planned", 20, "planned");
        const notes = cleanText(source.notes !== undefined ? source.notes : previous.notes || "", 2000, "");
        const aircraft = cleanText(source.aircraft !== undefined ? source.aircraft : previous.aircraft || "", 100, "");
        const callsign = cleanText(source.callsign !== undefined ? source.callsign : previous.callsign || "", 32, "");

        if (!flightNumber || !/^[A-Z0-9][A-Z0-9 -]{1,15}$/.test(flightNumber)) throw new Error("Enter a valid flight number.");
        if (!departure || !arrival) throw new Error("Enter valid four-character ICAO departure and arrival codes.");
        if (departure === arrival) throw new Error("Departure and arrival airports must be different.");
        if (!departureTime) throw new Error("Enter a valid scheduled departure date and time.");
        if (!Number.isInteger(duration) || duration < 1 || duration > 1800) throw new Error("Estimated duration must be between 1 and 1,800 minutes.");
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new Error("Pilot capacity must be between 1 and 100.");
        if (!PLAN_STATUSES.has(status)) throw new Error("Choose a valid flight-plan status.");

        return {
            flightNumber,
            departure,
            arrival,
            aircraft,
            callsign,
            departureTime,
            duration,
            capacity,
            status,
            notes
        };
    }

    function normalizeEvent(input, current) {
        const source = input || {};
        const previous = current || {};
        const title = cleanText(source.title !== undefined ? source.title : previous.title, 120, "");
        const description = cleanText(source.description !== undefined ? source.description : previous.description || "", 4000, "");
        const eventType = cleanText(source.eventType !== undefined ? source.eventType : previous.event_type || "community", 24, "community");
        const location = cleanText(source.location !== undefined ? source.location : previous.location || "", 160, "");
        const startsAt = validDate(source.startsAt !== undefined ? source.startsAt : previous.starts_at);
        const endValue = source.endsAt !== undefined ? source.endsAt : previous.ends_at;
        const endsAt = endValue ? validDate(endValue) : null;
        const capacityValue = source.capacity !== undefined ? source.capacity : previous.capacity;
        const capacity = capacityValue === null || capacityValue === "" || capacityValue === undefined ? null : Number(capacityValue);
        const published = source.published === undefined ? (previous.published === undefined ? true : previous.published === true) : source.published === true;

        if (!title) throw new Error("Enter an event title.");
        if (!EVENT_TYPES.has(eventType)) throw new Error("Choose a valid event type.");
        if (!startsAt) throw new Error("Enter a valid event start date and time.");
        if (endValue && !endsAt) throw new Error("Enter a valid event end date and time.");
        if (endsAt && endsAt.getTime() < startsAt.getTime()) throw new Error("The event cannot end before it starts.");
        if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000)) throw new Error("Capacity must be between 1 and 2,000, or left blank.");
        return { title, description, eventType, location, startsAt, endsAt, capacity, published };
    }

    async function eventRows(userId, includePast) {
        const result = await query(
            "SELECT e.id, e.title, e.description, e.event_type, e.location, e.starts_at, e.ends_at, e.capacity, e.published, " +
            "COUNT(r.id) FILTER (WHERE r.status = 'attending')::INTEGER AS attending_count, " +
            "COUNT(r.id) FILTER (WHERE r.status = 'interested')::INTEGER AS interested_count, " +
            "COALESCE(MAX(CASE WHEN r.user_id = $1 THEN r.status END), '') AS my_rsvp " +
            "FROM community_events e LEFT JOIN community_event_rsvps r ON r.event_id = e.id " +
            "WHERE e.published = TRUE AND ($2::boolean OR e.starts_at >= CURRENT_TIMESTAMP - INTERVAL '30 days') " +
            "GROUP BY e.id ORDER BY e.starts_at ASC LIMIT 100",
            [userId || 0, includePast === true]
        );
        return result.rows.map(row => ({
            id: Number(row.id),
            title: row.title,
            description: row.description,
            type: row.event_type,
            location: row.location,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            capacity: row.capacity === null ? null : Number(row.capacity),
            attendingCount: Number(row.attending_count || 0),
            interestedCount: Number(row.interested_count || 0),
            myRsvp: row.my_rsvp || null
        }));
    }

    // Public, factual operational summary. Flight totals are derived only from NewSky-imported rows.
    app.get("/api/operations/summary", async (req, res) => {
        try {
            const [flightStats, plans, events, sync] = await Promise.all([
                query(
                    "SELECT COUNT(*)::INTEGER AS total_flights, " +
                    "COUNT(*) FILTER (WHERE CASE WHEN dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' " +
                    "THEN dep_time::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 days' ELSE FALSE END)::INTEGER AS flights_30d, " +
                    "COUNT(DISTINCT user_id) FILTER (WHERE CASE WHEN dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' " +
                    "THEN dep_time::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 days' ELSE FALSE END)::INTEGER AS active_pilots_30d " +
                    "FROM flights"
                ),
                query("SELECT COUNT(*)::INTEGER AS count FROM operations_flight_plans WHERE published = TRUE AND status <> 'cancelled' AND scheduled_departure >= CURRENT_TIMESTAMP"),
                query("SELECT COUNT(*)::INTEGER AS count FROM community_events WHERE published = TRUE AND starts_at >= CURRENT_TIMESTAMP"),
                query("SELECT last_completed_at, status FROM flight_sync_state WHERE sync_key = 'global' LIMIT 1")
            ]);
            return res.json({
                flights: flightStats.rows[0] || { total_flights: 0, flights_30d: 0, active_pilots_30d: 0 },
                upcomingPlans: Number(plans.rows[0].count || 0),
                upcomingEvents: Number(events.rows[0].count || 0),
                sync: sync.rows[0] || null,
                liveTracking: { available: false, reason: "Live aircraft positions are not currently supplied by the connected flight-data integration." }
            });
        } catch (error) {
            console.error("Public operations summary failed:", error.message);
            return res.status(500).json({ error: "Unable to load operations summary." });
        }
    });

    // Public schedule exposes only published flight-plan information, never internal notes.
    app.get("/api/operations/schedule", async (req, res) => {
        try {
            let currentUserId = 0;
            const authorization = String(req.headers.authorization || "");
            if (authorization.startsWith("Bearer ")) {
                try {
                    const decoded = require("jsonwebtoken").verify(authorization.slice(7), process.env.JWT_SECRET || "CHANGE_THIS_SECRET");
                    const userResult = await query("SELECT id FROM users WHERE id=$1", [decoded.id]);
                    if (userResult.rows[0]) currentUserId = Number(userResult.rows[0].id);
                } catch (_error) {
                    currentUserId = 0;
                }
            }
            const result = await query(
                "SELECT p.id, p.flight_number, p.departure_icao, p.arrival_icao, p.aircraft, p.callsign, " +
                "p.scheduled_departure, p.estimated_duration_minutes, p.status, p.capacity, p.pilot_user_id, " +
                "u.display_name AS pilot_name, " +
                "(SELECT COUNT(*)::INTEGER FROM operations_flight_plan_pilots pp WHERE pp.plan_id=p.id) AS pilot_count, " +
                "EXISTS (SELECT 1 FROM operations_flight_plan_pilots pp WHERE pp.plan_id=p.id AND pp.user_id=$1) AS assigned_to_me " +
                "FROM operations_flight_plans p LEFT JOIN users u ON u.id = p.pilot_user_id " +
                "WHERE p.published = TRUE AND p.status <> 'cancelled' " +
                "AND p.scheduled_departure >= CURRENT_TIMESTAMP - INTERVAL '12 hours' " +
                "ORDER BY p.scheduled_departure ASC LIMIT 100",
                [currentUserId]
            );
            return res.json({
                plans: result.rows.map(row => ({
                    id: Number(row.id),
                    flightNumber: row.flight_number,
                    departureIcao: row.departure_icao,
                    arrivalIcao: row.arrival_icao,
                    aircraft: row.aircraft,
                    callsign: row.callsign,
                    scheduledDeparture: row.scheduled_departure,
                    estimatedDurationMinutes: Number(row.estimated_duration_minutes),
                    status: row.status,
                    capacity: Number(row.capacity),
                    pilotName: row.pilot_name || null,
                    pilotCount: Number(row.pilot_count || 0),
                    assignedToMe: row.assigned_to_me === true,
                    full: Number(row.pilot_count || 0) >= Number(row.capacity)
                }))
            });
        } catch (error) {
            console.error("Public operations schedule failed:", error.message);
            return res.status(500).json({ error: "Unable to load the published flight schedule." });
        }
    });

    app.get("/api/platform/operations-center", requirePermission("operations.read"), async (req, res) => {
        try {
            const [summary, plans, actualFlights, events] = await Promise.all([
                query(
                    "SELECT COUNT(*)::INTEGER AS total_flights, " +
                    "COUNT(*) FILTER (WHERE CASE WHEN dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' " +
                    "THEN dep_time::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 days' ELSE FALSE END)::INTEGER AS flights_30d, " +
                    "COUNT(DISTINCT user_id) FILTER (WHERE CASE WHEN dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' " +
                    "THEN dep_time::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 days' ELSE FALSE END)::INTEGER AS active_pilots_30d " +
                    "FROM flights"
                ),
                query(
                    "SELECT p.id, p.flight_number, p.departure_icao, p.arrival_icao, p.aircraft, p.callsign, " +
                    "p.scheduled_departure, p.estimated_duration_minutes, p.status, p.capacity, p.notes, p.published, " +
                    "p.pilot_user_id, u.username AS pilot_username, u.display_name AS pilot_name, " +
                    "(SELECT COUNT(*)::INTEGER FROM operations_flight_plan_pilots pp WHERE pp.plan_id=p.id) AS pilot_count " +
                    "FROM operations_flight_plans p LEFT JOIN users u ON u.id = p.pilot_user_id " +
                    "ORDER BY p.scheduled_departure DESC LIMIT 150"
                ),
                query(
                    "SELECT f.id, f.dep_icao, f.arr_icao, f.aircraft, f.duration, f.distance, f.dep_time, " +
                    "u.display_name AS pilot_name, u.username " +
                    "FROM flights f JOIN users u ON u.id = f.user_id " +
                    "ORDER BY CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN f.dep_time::timestamptz ELSE NULL END DESC NULLS LAST " +
                    "LIMIT 12"
                ),
                query("SELECT COUNT(*)::INTEGER AS count FROM community_events WHERE published = TRUE AND starts_at >= CURRENT_TIMESTAMP")
            ]);
            return res.json({
                summary: {
                    totalFlights: Number(summary.rows[0].total_flights || 0),
                    flights30d: Number(summary.rows[0].flights_30d || 0),
                    activePilots30d: Number(summary.rows[0].active_pilots_30d || 0),
                    upcomingPlans: plans.rows.filter(row => row.status !== "cancelled" && new Date(row.scheduled_departure).getTime() >= Date.now()).length,
                    upcomingEvents: Number(events.rows[0].count || 0)
                },
                plans: plans.rows.map(row => ({
                    id: Number(row.id),
                    flightNumber: row.flight_number,
                    departureIcao: row.departure_icao,
                    arrivalIcao: row.arrival_icao,
                    aircraft: row.aircraft,
                    callsign: row.callsign,
                    scheduledDeparture: row.scheduled_departure,
                    estimatedDurationMinutes: Number(row.estimated_duration_minutes),
                    status: row.status,
                    capacity: Number(row.capacity),
                    notes: row.notes,
                    published: row.published === true,
                    pilotUserId: row.pilot_user_id,
                    pilotUsername: row.pilot_username || null,
                    pilotName: row.pilot_name || null,
                    pilotCount: Number(row.pilot_count || 0)
                })),
                recentFlights: actualFlights.rows.map(row => ({
                    id: Number(row.id),
                    departure: row.dep_icao,
                    arrival: row.arr_icao,
                    aircraft: row.aircraft,
                    duration: Number(row.duration || 0),
                    distance: Number(row.distance || 0),
                    departureTime: row.dep_time,
                    pilotName: row.pilot_name || row.username
                })),
                liveTracking: { available: false, message: "Live positions require a telemetry feed; no simulated position data is displayed." }
            });
        } catch (error) {
            console.error("Operations center load failed:", error.message);
            return res.status(500).json({ error: "Unable to load the Operations Center." });
        }
    });

    app.get("/api/platform/operations/flight-plans", requirePermission("operations.read"), async (req, res) => {
        try {
            const result = await query(
                "SELECT p.*, u.username AS pilot_username, u.display_name AS pilot_name, " +
                "(SELECT COUNT(*)::INTEGER FROM operations_flight_plan_pilots pp WHERE pp.plan_id=p.id) AS pilot_count " +
                "FROM operations_flight_plans p LEFT JOIN users u ON u.id = p.pilot_user_id " +
                "ORDER BY p.scheduled_departure DESC LIMIT 200"
            );
            return res.json({ plans: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load flight plans." });
        }
    });

    app.post("/api/platform/operations/flight-plans", requirePermission("operations.write"), async (req, res) => {
        try {
            const plan = normalizePlan(req.body);
            const result = await query(
                "INSERT INTO operations_flight_plans (flight_number, departure_icao, arrival_icao, aircraft, callsign, " +
                "scheduled_departure, estimated_duration_minutes, status, capacity, notes, published, created_by) " +
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
                [plan.flightNumber, plan.departure, plan.arrival, plan.aircraft, plan.callsign, plan.departureTime,
                    plan.duration, plan.status, plan.capacity, plan.notes, (!req.body || req.body.published !== false), req.user.id]
            );
            await writeAudit(req, "operations.flight_plan.create", "flight_plan", result.rows[0].id, {
                flightNumber: plan.flightNumber, departure: plan.departure, arrival: plan.arrival
            });
            return res.status(201).json({ message: "Flight plan created.", id: Number(result.rows[0].id) });
        } catch (error) {
            const clientError = /valid|Enter|must be|Choose|between|different/.test(error.message || "");
            return res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "Unable to create flight plan." });
        }
    });

    app.patch("/api/platform/operations/flight-plans/:id", requirePermission("operations.write"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid flight-plan ID." });
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const currentResult = await client.query("SELECT * FROM operations_flight_plans WHERE id=$1 FOR UPDATE", [id]);
            const current = currentResult.rows[0];
            if (!current) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Flight plan not found." });
            }
            const plan = normalizePlan(req.body, current);
            const assigned = await client.query(
                "SELECT COUNT(*)::INTEGER AS count FROM operations_flight_plan_pilots WHERE plan_id=$1",
                [id]
            );
            if (Number(assigned.rows[0].count || 0) > plan.capacity) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "Pilot capacity cannot be lower than the number of pilots already assigned." });
            }
            const published = req.body && req.body.published !== undefined ? req.body.published === true : current.published === true;
            await client.query(
                "UPDATE operations_flight_plans SET flight_number=$1, departure_icao=$2, arrival_icao=$3, aircraft=$4, callsign=$5, " +
                "scheduled_departure=$6, estimated_duration_minutes=$7, status=$8, capacity=$9, notes=$10, published=$11, updated_at=CURRENT_TIMESTAMP " +
                "WHERE id=$12",
                [plan.flightNumber, plan.departure, plan.arrival, plan.aircraft, plan.callsign, plan.departureTime,
                    plan.duration, plan.status, plan.capacity, plan.notes, published, id]
            );
            await client.query("COMMIT");
            await writeAudit(req, "operations.flight_plan.update", "flight_plan", id, { status: plan.status, published, capacity: plan.capacity });
            return res.json({ message: "Flight plan updated.", id });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            const clientError = /valid|Enter|must be|Choose|between|different/.test(error.message || "");
            return res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "Unable to update flight plan." });
        } finally {
            client.release();
        }
    });

    app.delete("/api/platform/operations/flight-plans/:id", requirePermission("operations.write"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid flight-plan ID." });
        try {
            const result = await query(
                "UPDATE operations_flight_plans SET status='cancelled', published=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id",
                [id]
            );
            if (!result.rows.length) return res.status(404).json({ error: "Flight plan not found." });
            await writeAudit(req, "operations.flight_plan.cancel", "flight_plan", id, {});
            return res.json({ cancelled: true, id });
        } catch (error) {
            return res.status(500).json({ error: "Unable to cancel flight plan." });
        }
    });

    app.post("/api/operations/flight-plans/:id/claim", authenticate, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid flight-plan ID." });
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const planResult = await client.query(
                "SELECT id, capacity, status, published, scheduled_departure FROM operations_flight_plans WHERE id=$1 FOR UPDATE",
                [id]
            );
            const plan = planResult.rows[0];
            if (!plan || plan.published !== true || plan.status !== "planned" || new Date(plan.scheduled_departure).getTime() <= Date.now()) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "This flight is no longer available for pilot assignment." });
            }
            const existing = await client.query(
                "SELECT 1 FROM operations_flight_plan_pilots WHERE plan_id=$1 AND user_id=$2",
                [id, req.user.id]
            );
            if (existing.rows.length) {
                await client.query("COMMIT");
                return res.json({ assigned: true, alreadyAssigned: true, id });
            }
            const count = await client.query(
                "SELECT COUNT(*)::INTEGER AS count FROM operations_flight_plan_pilots WHERE plan_id=$1",
                [id]
            );
            const assignedCount = Number(count.rows[0].count || 0);
            if (assignedCount >= Number(plan.capacity)) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "All pilot slots for this flight have been claimed." });
            }
            await client.query(
                "INSERT INTO operations_flight_plan_pilots (plan_id,user_id) VALUES ($1,$2)",
                [id, req.user.id]
            );
            await client.query(
                "UPDATE operations_flight_plans SET pilot_user_id=COALESCE(pilot_user_id,$1),updated_at=CURRENT_TIMESTAMP WHERE id=$2",
                [req.user.id, id]
            );
            await client.query("COMMIT");
            await writeAudit(req, "operations.flight_plan.claim", "flight_plan", id, { pilotId: req.user.id });
            return res.json({ assigned: true, id, remainingSlots: Math.max(0, Number(plan.capacity) - assignedCount - 1) });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Flight-plan assignment failed:", error.message);
            return res.status(500).json({ error: "Unable to assign yourself to this flight." });
        } finally {
            client.release();
        }
    });

    app.delete("/api/operations/flight-plans/:id/claim", authenticate, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid flight-plan ID." });
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const planResult = await client.query(
                "SELECT id,status FROM operations_flight_plans WHERE id=$1 FOR UPDATE",
                [id]
            );
            if (!planResult.rows.length || planResult.rows[0].status !== "planned") {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "You cannot release this pilot assignment." });
            }
            const removed = await client.query(
                "DELETE FROM operations_flight_plan_pilots WHERE plan_id=$1 AND user_id=$2 RETURNING user_id",
                [id, req.user.id]
            );
            if (!removed.rows.length) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "You do not have a pilot assignment for this flight." });
            }
            await client.query(
                "UPDATE operations_flight_plans SET pilot_user_id=(SELECT user_id FROM operations_flight_plan_pilots WHERE plan_id=$1 ORDER BY created_at ASC LIMIT 1),updated_at=CURRENT_TIMESTAMP WHERE id=$1",
                [id]
            );
            await client.query("COMMIT");
            await writeAudit(req, "operations.flight_plan.unclaim", "flight_plan", id, { pilotId: req.user.id });
            return res.json({ released: true, id });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Flight-plan release failed:", error.message);
            return res.status(500).json({ error: "Unable to release your assignment." });
        } finally {
            client.release();
        }
    });

    app.get("/api/community/events", async (req, res) => {
        const includePast = String(req.query.past || "").toLowerCase() === "true";
        try {
            let userId = 0;
            const header = String(req.headers.authorization || "");
            if (header.startsWith("Bearer ")) {
                try {
                    const decoded = require("jsonwebtoken").verify(header.slice(7), process.env.JWT_SECRET || "CHANGE_THIS_SECRET");
                    const userResult = await query("SELECT id FROM users WHERE id=$1", [decoded.id]);
                    if (userResult.rows[0]) userId = Number(userResult.rows[0].id);
                } catch (_error) {
                    userId = 0;
                }
            }
            return res.json({ events: await eventRows(userId, includePast) });
        } catch (error) {
            console.error("Community event listing failed:", error.message);
            return res.status(500).json({ error: "Unable to load community events." });
        }
    });

    app.get("/api/community/spotlight", async (req, res) => {
        try {
            const result = await query(
                "SELECT u.id, COALESCE(NULLIF(BTRIM(u.display_name),''),u.username) AS pilot_name, " +
                "COUNT(f.id)::INTEGER AS flights, COALESCE(SUM(f.distance),0)::DOUBLE PRECISION AS distance_nm, " +
                "MAX(CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN f.dep_time::timestamptz ELSE NULL END) AS last_flight_at " +
                "FROM flights f JOIN users u ON u.id=f.user_id " +
                "WHERE CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' " +
                "THEN f.dep_time::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 days' ELSE FALSE END " +
                "GROUP BY u.id,u.username,u.display_name ORDER BY COUNT(f.id) DESC,SUM(f.distance) DESC,LOWER(u.username) ASC LIMIT 3"
            );
            return res.json({
                periodDays: 30,
                pilots: result.rows.map((row,index) => ({
                    rank: index + 1,
                    pilotId: Number(row.id),
                    pilotName: row.pilot_name,
                    flights: Number(row.flights || 0),
                    distanceNm: Number(row.distance_nm || 0),
                    lastFlightAt: row.last_flight_at
                }))
            });
        } catch (error) {
            console.error("Community pilot spotlight failed:", error.message);
            return res.status(500).json({ error: "Unable to load the pilot spotlight." });
        }
    });

    app.get("/api/community/announcements", async (req, res) => {
        try {
            // Only explicitly published website News/Announcement items are public.
            // Internal platform_notifications are intentionally never exposed here.
            const items = await query(
                "SELECT id, title, description, category, link_url, created_at FROM site_items " +
                "WHERE published=TRUE AND LOWER(category) IN ('news','announcement') " +
                "ORDER BY created_at DESC LIMIT 20"
            );
            const announcements = items.rows.map(row => ({
                id: "site-item-" + row.id,
                title: row.title,
                body: row.description,
                level: row.category === "news" ? "news" : "info",
                createdAt: row.created_at,
                url: row.link_url
            }));
            return res.json({ announcements });
        } catch (error) {
            console.error("Community announcements failed:", error.message);
            return res.status(500).json({ error: "Unable to load announcements." });
        }
    });

    app.get("/api/community/my-events", authenticate, async (req, res) => {
        try {
            const result = await query(
                "SELECT e.id, e.title, e.event_type, e.location, e.starts_at, e.ends_at, r.status AS my_rsvp " +
                "FROM community_event_rsvps r JOIN community_events e ON e.id=r.event_id " +
                "WHERE r.user_id=$1 AND e.published=TRUE AND e.starts_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' " +
                "ORDER BY e.starts_at ASC LIMIT 100",
                [req.user.id]
            );
            return res.json({ events: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load your event registrations." });
        }
    });

    app.post("/api/community/events/:id/rsvp", authenticate, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        const status = cleanText(req.body && req.body.status || "attending", 20, "attending");
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event ID." });
        if (!RSVP_STATUSES.has(status)) return res.status(400).json({ error: "Choose attending or interested." });

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const eventResult = await client.query(
                "SELECT id, capacity, starts_at FROM community_events WHERE id=$1 AND published=TRUE FOR UPDATE",
                [id]
            );
            const event = eventResult.rows[0];
            if (!event) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Event not found." });
            }
            if (new Date(event.starts_at).getTime() < Date.now() - 3600000) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "Registration for this event is closed." });
            }
            if (status === "attending" && event.capacity !== null) {
                const count = await client.query(
                    "SELECT COUNT(*)::INTEGER AS count FROM community_event_rsvps WHERE event_id=$1 AND status='attending' AND user_id<>$2",
                    [id, req.user.id]
                );
                if (Number(count.rows[0].count) >= Number(event.capacity)) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({ error: "This event has reached its attendance capacity." });
                }
            }
            await client.query(
                "INSERT INTO community_event_rsvps (event_id,user_id,status) VALUES ($1,$2,$3) " +
                "ON CONFLICT (event_id,user_id) DO UPDATE SET status=EXCLUDED.status,updated_at=CURRENT_TIMESTAMP",
                [id, req.user.id, status]
            );
            await client.query("COMMIT");
            return res.json({ registered: true, eventId: id, status });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Community RSVP failed:", error.message);
            return res.status(500).json({ error: "Unable to save your event registration." });
        } finally {
            client.release();
        }
    });

    app.delete("/api/community/events/:id/rsvp", authenticate, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event ID." });
        try {
            await query("DELETE FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2", [id, req.user.id]);
            return res.json({ cancelled: true, eventId: id });
        } catch (error) {
            return res.status(500).json({ error: "Unable to cancel your event registration." });
        }
    });

    app.get("/api/platform/admin/community/events", requirePermission("events.manage"), async (req, res) => {
        try {
            const result = await query(
                "SELECT e.id, e.title, e.description, e.event_type, e.location, e.starts_at, e.ends_at, e.capacity, e.published, " +
                "COUNT(r.id) FILTER (WHERE r.status='attending')::INTEGER AS attending_count, " +
                "COUNT(r.id) FILTER (WHERE r.status='interested')::INTEGER AS interested_count " +
                "FROM community_events e LEFT JOIN community_event_rsvps r ON r.event_id=e.id " +
                "GROUP BY e.id ORDER BY e.starts_at DESC LIMIT 200"
            );
            return res.json({ events: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load event management." });
        }
    });

    app.post("/api/platform/admin/community/events", requirePermission("events.manage"), async (req, res) => {
        try {
            const event = normalizeEvent(req.body);
            const result = await query(
                "INSERT INTO community_events (title,description,event_type,location,starts_at,ends_at,capacity,published,created_by) " +
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
                [event.title,event.description,event.eventType,event.location,event.startsAt,event.endsAt,event.capacity,event.published,req.user.id]
            );
            await writeAudit(req, "community.event.create", "community_event", result.rows[0].id, { title: event.title, type: event.eventType });
            return res.status(201).json({ message: "Community event created.", id: Number(result.rows[0].id) });
        } catch (error) {
            const clientError = /Enter|Choose|valid|before|Capacity/.test(error.message || "");
            return res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "Unable to create community event." });
        }
    });

    app.patch("/api/platform/admin/community/events/:id", requirePermission("events.manage"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event ID." });
        try {
            const currentResult = await query("SELECT * FROM community_events WHERE id=$1", [id]);
            const current = currentResult.rows[0];
            if (!current) return res.status(404).json({ error: "Event not found." });
            const event = normalizeEvent(req.body, current);
            await query(
                "UPDATE community_events SET title=$1,description=$2,event_type=$3,location=$4,starts_at=$5,ends_at=$6,capacity=$7,published=$8,updated_at=CURRENT_TIMESTAMP WHERE id=$9",
                [event.title,event.description,event.eventType,event.location,event.startsAt,event.endsAt,event.capacity,event.published,id]
            );
            await writeAudit(req, "community.event.update", "community_event", id, { title: event.title, published: event.published });
            return res.json({ message: "Community event updated.", id });
        } catch (error) {
            const clientError = /Enter|Choose|valid|before|Capacity/.test(error.message || "");
            return res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "Unable to update community event." });
        }
    });

    app.delete("/api/platform/admin/community/events/:id", requirePermission("events.manage"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event ID." });
        try {
            const result = await query("DELETE FROM community_events WHERE id=$1 RETURNING id", [id]);
            if (!result.rows.length) return res.status(404).json({ error: "Event not found." });
            await writeAudit(req, "community.event.delete", "community_event", id, {});
            return res.json({ deleted: true, id });
        } catch (error) {
            return res.status(500).json({ error: "Unable to delete community event." });
        }
    });
}

module.exports = { initializeOperationsSchema, registerOperationsRoutes };
