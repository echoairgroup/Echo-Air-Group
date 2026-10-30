"use strict";

const crypto = require("crypto");

const ROLE_PERMISSIONS = {
    super_admin: ["*"],
    admin: [
        "overview.read", "system.read", "operations.read", "fleet.read",
        "audit.read", "notifications.read", "notifications.write",
        "academy.read", "academy.write", "applications.read", "applications.write",
        "content.read", "content.write"
    ],
    operations_manager: ["overview.read", "system.read", "operations.read", "fleet.read", "audit.read"],
    academy_manager: ["overview.read", "academy.read", "academy.write"],
    analyst: ["overview.read", "system.read", "operations.read", "fleet.read", "audit.read"],
    viewer: ["overview.read", "operations.read", "fleet.read", "academy.read"]
};

const VALID_ROLES = new Set(Object.keys(ROLE_PERMISSIONS).filter(role => role !== "super_admin"));
const photoCache = new Map();
const PHOTO_CACHE_MS = 24 * 60 * 60 * 1000;

const SEED_COURSES = [
    {
        slug: "eag-flight-operations",
        title: "Echo Air Group Flight Operations",
        subtitle: "How to fly, record and complete an EAG flight",
        category: "Company procedures",
        level: "Beginner",
        duration: 35,
        description: "Learn the complete virtual-airline flight workflow, from linking your NewSky pilot account to confirming that a flight has synchronized.",
        lessons: [
            {
                title: "Welcome to Echo Air Group",
                minutes: 8,
                body: "Welcome to Echo Air Group. This academy is a virtual-airline learning resource for flight-simulation pilots. It does not replace real-world flight training, an instructor, an aircraft flight manual or official operating procedures.\n\nYour Echo account is your identity on the website. Use the same username and password for the Pilot Dashboard and the Aviation Academy. Link the correct NewSky pilot ID in your Pilot Dashboard so that the automatic flight importer can match your NewSky flights to your Echo account.\n\nKeep your NewSky pilot profile accurate. If a flight is not appearing on your Echo profile, first check that the correct NewSky account is linked and that the flight is visible in NewSky."
            },
            {
                title: "Preparing and recording a virtual flight",
                minutes: 12,
                body: "Before a virtual flight, choose a suitable aircraft and route in your simulator and prepare the flight using the tools and procedures appropriate to that aircraft and simulator. Check your route, weather, fuel planning and simulator settings before departure.\n\nUse your NewSky account and airline workflow consistently. The Echo website imports flights from NewSky; pilots do not need to manually enter the same flight into the website. Never submit another pilot's flight under your own profile.\n\nA simulated flight is not authorization or instruction to operate a real aircraft. In real aviation, follow the operator's approved procedures, aircraft documentation and instructor or dispatch instructions."
            },
            {
                title: "After landing and flight synchronization",
                minutes: 15,
                body: "After a virtual flight, complete the normal NewSky submission process and confirm the flight is visible in your NewSky history. Echo Air Group synchronizes linked pilots' flight history automatically in the background.\n\nA new flight may take a short time to appear after synchronization. You can check the Pilot Dashboard for flight history and the Operations overview for recent activity. If a flight remains missing, verify the NewSky pilot link before contacting a manager.\n\nDo not create duplicate manual records to compensate for a delayed sync. The NewSky flight ID is used to prevent duplicate imports."
            }
        ],
        quiz: {
            title: "Flight Operations Knowledge Check",
            pass: 75,
            questions: [
                { prompt: "Which account should be linked to your Echo pilot profile?", options: ["Your own NewSky pilot account", "A manager's NewSky account", "Any available NewSky account"], correct: 0, explanation: "Flights are matched to Echo users through the linked NewSky pilot ID." },
                { prompt: "Where should you confirm that a flight has been submitted?", options: ["A social-media post", "Your NewSky flight history", "A manually edited website card"], correct: 1, explanation: "NewSky is the source used by Echo's automatic flight synchronization." },
                { prompt: "What should you do if a flight has not appeared on Echo yet?", options: ["Create a duplicate flight", "Use another pilot's account", "Check your NewSky link and allow the next sync"], correct: 2, explanation: "The importer matches flights by NewSky pilot ID and unique flight ID." },
                { prompt: "Does this virtual academy authorize real-world aircraft operation?", options: ["Yes", "No", "Only after one quiz"], correct: 1, explanation: "This is simulation education, not real-world flight instruction or authorization." }
            ]
        }
    },
    {
        slug: "flight-planning-navigation",
        title: "Flight Planning & Navigation",
        subtitle: "Routes, airport identifiers and simulator preparation",
        category: "Flight planning",
        level: "Beginner",
        duration: 40,
        description: "Understand route structure, ICAO airport identifiers and how to prepare a coherent simulator flight.",
        lessons: [
            {
                title: "Understanding airport identifiers",
                minutes: 10,
                body: "International flight-simulation tools commonly identify airports with four-character ICAO location indicators. Examples include EHAM for Amsterdam Schiphol, EDDL for Düsseldorf and KJFK for New York John F. Kennedy.\n\nA route is commonly described as departure airport, route or waypoints, and destination airport. Echo's flight history stores departure and arrival identifiers when NewSky supplies them.\n\nAlways verify that the airport and runway selected in your simulator match the intended route. Similar airport names and nearby airports can be easy to confuse."
            },
            {
                title: "Building a simulator route",
                minutes: 15,
                body: "Start with a departure and destination, then use a flight-planning tool suitable for your simulator and aircraft to build the route. Review the route for sensible waypoints, airways and expected cruise levels. Check the route against current simulator data and the aircraft's capabilities.\n\nFor a virtual flight, use the flight-planning and performance tools available to your simulator community. Do not treat a website route line or a training example as an operational clearance.\n\nA well-prepared route should be understandable, saved before departure and consistent with the flight details submitted to NewSky."
            },
            {
                title: "Distance, time and aircraft suitability",
                minutes: 15,
                body: "Route distance and estimated flight time help you decide whether an aircraft is suitable for a planned simulator trip. Actual time depends on aircraft performance, winds, route, altitude, loading and simulator conditions.\n\nCompare the planned flight with the aircraft's published simulated performance information. Avoid selecting an aircraft solely because it appears in a leaderboard or fleet card.\n\nAfter the flight, Echo displays the distance and duration supplied or calculated from the imported NewSky flight data."
            }
        ],
        quiz: {
            title: "Navigation Knowledge Check",
            pass: 75,
            questions: [
                { prompt: "How many characters are normally used in an ICAO airport location indicator?", options: ["Two", "Four", "Six"], correct: 1, explanation: "ICAO airport identifiers normally contain four characters." },
                { prompt: "What is the safest source for aircraft-specific simulator performance?", options: ["A random route card", "The aircraft's documentation and approved simulator tools", "Another pilot's guess"], correct: 1, explanation: "Use aircraft-specific documentation and trusted tools." },
                { prompt: "What does a route normally identify?", options: ["Departure, route and destination", "Only the pilot's username", "Only the aircraft registration"], correct: 0, explanation: "A route describes the origin, path and destination." },
                { prompt: "Can an Echo route map be treated as a real-world clearance?", options: ["Yes", "No", "Only at night"], correct: 1, explanation: "It visualizes simulation history and is not an air traffic clearance." }
            ]
        }
    },
    {
        slug: "weather-metar-taf",
        title: "Weather Fundamentals: METAR & TAF",
        subtitle: "Read common weather information used in flight simulation",
        category: "Weather",
        level: "Beginner",
        duration: 45,
        description: "Learn the structure of METAR and TAF reports and understand common weather groups in a simulator context.",
        lessons: [
            {
                title: "What a METAR tells you",
                minutes: 15,
                body: "A METAR is a routine aviation weather report for an aerodrome. A report can contain the observation time, wind, visibility, significant weather, cloud, temperature, dew point and altimeter setting.\n\nFor example, a wind group such as 24010KT indicates wind from 240 degrees at 10 knots. The actual report can include gusts, variable direction or special visibility groups.\n\nMETARs are time-stamped observations. Always check the report time and use the weather source appropriate to your simulator session."
            },
            {
                title: "Understanding a TAF",
                minutes: 15,
                body: "A TAF is an aerodrome forecast valid for a stated period. It describes expected conditions and may include changes over time. Common groups include FM for a change from a stated time, TEMPO for temporary conditions and PROB for a probability group.\n\nA TAF is a forecast, not a guarantee that conditions will occur exactly as written. Compare the valid period with the planned simulator flight time.\n\nWhen practicing in a simulator, use the weather source that is configured for the session. Differences between live weather and a simulator's injected weather can occur."
            },
            {
                title: "Weather and simulator decision-making",
                minutes: 15,
                body: "Wind, visibility, cloud and precipitation can affect a simulated approach, departure and cruise. Practice recognizing when a weather setup is beyond your current simulator experience and choose a suitable training scenario.\n\nThis lesson is educational only. Real-world operational weather minima, alternate requirements and go/no-go decisions must be handled under the applicable operator procedures and qualified instruction.\n\nFor a training flight, record the conditions you practiced and review how they affected your simulator workload."
            }
        ],
        quiz: {
            title: "Weather Knowledge Check",
            pass: 75,
            questions: [
                { prompt: "What does a METAR primarily provide?", options: ["An aerodrome weather observation", "A flight plan", "An aircraft maintenance record"], correct: 0, explanation: "A METAR is an aerodrome weather observation." },
                { prompt: "What does a TAF provide?", options: ["A forecast for an aerodrome", "A pilot licence", "A runway diagram only"], correct: 0, explanation: "A TAF is an aerodrome forecast valid for a stated period." },
                { prompt: "In a wind group, what does 24010KT indicate?", options: ["Wind from 240 degrees at 10 knots", "Visibility 240 metres", "Temperature 10 degrees"], correct: 0, explanation: "The group gives wind direction and speed." },
                { prompt: "What should you check before using a METAR or TAF?", options: ["The issue/valid time", "Only the airport name", "The pilot's ranking"], correct: 0, explanation: "Weather reports are time-dependent." }
            ]
        }
    },
    {
        slug: "ifr-instruments-communications",
        title: "IFR Instruments & Radio Communications",
        subtitle: "Instrument concepts and clear simulator radio work",
        category: "IFR & communications",
        level: "Intermediate",
        duration: 50,
        description: "Explore common instrument-flight concepts and practice concise, structured radio communication in a simulator.",
        lessons: [
            {
                title: "Instrument flight concepts",
                minutes: 16,
                body: "Instrument flight relies on interpreting flight instruments and following procedures when outside visual references are limited. In a simulator, practice maintaining a stable attitude, monitoring altitude and heading, and cross-checking information rather than focusing on a single display.\n\nUnderstand the difference between a navigation aid, a published procedure and an ATC clearance. A published approach procedure contains constraints and segments; a clearance is an instruction issued by the appropriate controller.\n\nUse the documentation for your aircraft and simulator avionics. This module is a learning aid and does not replace real instrument training."
            },
            {
                title: "Structured radio communication",
                minutes: 17,
                body: "Good radio calls are concise, clear and use the correct station and callsign. Listen before transmitting, avoid stepping on another transmission and read back the important parts of a clearance in the simulator environment.\n\nA typical simulator call identifies who you are calling, who you are, where you are and what you need. Use the phraseology and procedures applicable to the network or event you are flying on.\n\nIf you do not understand an instruction, ask for clarification instead of guessing. In real aviation, always use the required official phraseology and follow the applicable rules."
            },
            {
                title: "Approach briefing and stabilization",
                minutes: 17,
                body: "Before a simulated approach, review the selected runway, approach type, navigation source and missed-approach information from the simulator's published procedure. Confirm the avionics setup and cross-check the displayed information.\n\nA stable approach is a useful training goal. Establish the intended configuration and speed according to the aircraft documentation and your simulator procedures. If the approach becomes unstable in the simulation, practice a go-around rather than forcing a landing.\n\nReview the flight afterwards and note one item to improve on the next training session."
            }
        ],
        quiz: {
            title: "IFR & Radio Knowledge Check",
            pass: 75,
            questions: [
                { prompt: "What should you do if a simulator ATC instruction is unclear?", options: ["Guess", "Ask for clarification", "Ignore every further call"], correct: 1, explanation: "Ask for clarification rather than acting on an uncertain instruction." },
                { prompt: "What is a published approach procedure?", options: ["A procedure with defined segments and constraints", "An aircraft paint scheme", "A pilot ranking"], correct: 0, explanation: "Approach procedures define the path and restrictions for an approach." },
                { prompt: "Why listen before transmitting?", options: ["To avoid blocking another transmission", "To increase flight distance", "To change the aircraft type"], correct: 0, explanation: "Listening helps keep radio communication clear." },
                { prompt: "What is a useful response to an unstable simulated approach?", options: ["Continue regardless", "Practice the go-around procedure", "Turn off the instruments"], correct: 1, explanation: "A go-around is the appropriate training response to an unstable approach." }
            ]
        }
    },
    {
        slug: "safety-professional-standards",
        title: "Safety Mindset & Pilot Standards",
        subtitle: "Preparation, workload and professional virtual-airline conduct",
        category: "Safety & standards",
        level: "All levels",
        duration: 35,
        description: "Build consistent habits for simulator preparation, workload management, respectful communication and post-flight learning.",
        lessons: [
            {
                title: "Preparation and personal limits",
                minutes: 10,
                body: "Good preparation starts before the simulator session. Check that your simulator, add-ons and online network are ready. Decide what you want to practice and choose a scenario that matches your experience.\n\nIf you are tired, distracted or struggling with a procedure, pause the session or choose a simpler training objective. Virtual airline participation should remain enjoyable and respectful.\n\nThis academy is not a real-world safety-management system and does not establish operational authority."
            },
            {
                title: "Workload and communication",
                minutes: 12,
                body: "Simulator workload can rise quickly when navigation, aircraft configuration, weather and radio tasks occur together. Use a repeatable flow, keep the information you need accessible and avoid unnecessary distractions.\n\nCommunicate clearly with other pilots and managers. If you need help, explain what you are doing and where you are stuck. In group flights, respect the event briefing and the network's procedures.\n\nReport technical problems constructively so managers can improve the virtual operation."
            },
            {
                title: "Review, learning and community standards",
                minutes: 13,
                body: "After a flight, review the result and identify one thing that went well and one thing you would improve. Use the flight history and performance information as learning aids rather than as a substitute for judgment.\n\nRespect other pilots, protect account credentials and never impersonate another member. Keep communications professional and follow the community rules.\n\nA strong virtual pilot is reliable, prepared, helpful and willing to keep learning."
            }
        ],
        quiz: {
            title: "Pilot Standards Knowledge Check",
            pass: 75,
            questions: [
                { prompt: "What should you do if you are too distracted to complete a training session comfortably?", options: ["Pause or choose a simpler exercise", "Ignore the issue", "Use another pilot's account"], correct: 0, explanation: "Choose a training session appropriate to your current capacity." },
                { prompt: "What is a useful post-flight review?", options: ["Identify one success and one improvement", "Delete the flight history", "Change the aircraft registration"], correct: 0, explanation: "A short reflection turns each flight into a learning opportunity." },
                { prompt: "How should pilot credentials be handled?", options: ["Share passwords with friends", "Keep them private", "Post them in chat"], correct: 1, explanation: "Every member should use their own account and keep credentials private." },
                { prompt: "What is the purpose of the Echo Aviation Academy?", options: ["Virtual-airline and simulator learning", "Real-world flight licensing", "Replacing aircraft manuals"], correct: 0, explanation: "The academy is a virtual learning resource." }
            ]
        }
    }
];

function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function safeJson(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

async function initializePlatformSchema(query) {
    const statements = [
        "ALTER TABLE flights ADD COLUMN IF NOT EXISTS aircraft_registration TEXT",
        "ALTER TABLE flights ADD COLUMN IF NOT EXISTS aircraft_type TEXT",
        "CREATE INDEX IF NOT EXISTS flights_dep_time_platform_idx ON flights (dep_time)",
        "CREATE TABLE IF NOT EXISTS platform_admin_roles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('admin','operations_manager','academy_manager','analyst','viewer')), granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS platform_audit_log (id BIGSERIAL PRIMARY KEY, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_username TEXT NOT NULL DEFAULT 'system', action TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT 'system', target_id TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS platform_audit_log_created_idx ON platform_audit_log (created_at DESC)",
        "CREATE TABLE IF NOT EXISTS platform_notifications (id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','critical')), created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMPTZ)",
        "CREATE INDEX IF NOT EXISTS platform_notifications_created_idx ON platform_notifications (created_at DESC)",
        "CREATE TABLE IF NOT EXISTS academy_courses (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General', level TEXT NOT NULL DEFAULT 'Beginner', duration_minutes INTEGER NOT NULL DEFAULT 30, published BOOLEAN NOT NULL DEFAULT TRUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS academy_lessons (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE, title TEXT NOT NULL, lesson_body TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, estimated_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(course_id, sort_order))",
        "CREATE TABLE IF NOT EXISTS academy_quizzes (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL UNIQUE REFERENCES academy_courses(id) ON DELETE CASCADE, title TEXT NOT NULL, pass_percent INTEGER NOT NULL DEFAULT 75 CHECK (pass_percent BETWEEN 1 AND 100), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS academy_questions (id SERIAL PRIMARY KEY, quiz_id INTEGER NOT NULL REFERENCES academy_quizzes(id) ON DELETE CASCADE, prompt TEXT NOT NULL, options JSONB NOT NULL, correct_option INTEGER NOT NULL, explanation TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(quiz_id, sort_order))",
        "CREATE TABLE IF NOT EXISTS academy_enrollments (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')), progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100), enrolled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ, UNIQUE(user_id, course_id))",
        "CREATE TABLE IF NOT EXISTS academy_lesson_progress (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE, completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, lesson_id))",
        "CREATE TABLE IF NOT EXISTS academy_quiz_attempts (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, quiz_id INTEGER NOT NULL REFERENCES academy_quizzes(id) ON DELETE CASCADE, score_percent INTEGER NOT NULL, question_count INTEGER NOT NULL, correct_count INTEGER NOT NULL, passed BOOLEAN NOT NULL, answers JSONB NOT NULL DEFAULT '{}'::jsonb, attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS academy_quiz_attempts_lookup_idx ON academy_quiz_attempts (user_id, quiz_id, attempted_at DESC)",
        "CREATE TABLE IF NOT EXISTS academy_certificates (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE, certificate_code TEXT UNIQUE NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, course_id))"
    ];
    for (const statement of statements) await query(statement);

    await query(
        "UPDATE flights SET aircraft_registration = COALESCE(aircraft_registration, " +
        "CASE WHEN BTRIM(COALESCE(aircraft,'')) ~* '^(?:[A-Z0-9]{1,2}-[A-Z0-9]{3,5}|N[1-9][0-9]{0,4}[A-Z]{0,2})' " +
        "THEN UPPER(SUBSTRING(BTRIM(aircraft) FROM '^(?:[A-Z0-9]{1,2}-[A-Z0-9]{3,5}|N[1-9][0-9]{0,4}[A-Z]{0,2})')) ELSE NULL END) " +
        "WHERE aircraft_registration IS NULL AND aircraft IS NOT NULL"
    );

    for (const course of SEED_COURSES) {
        const inserted = await query(
            "INSERT INTO academy_courses (slug, title, subtitle, description, category, level, duration_minutes, published) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT (slug) DO NOTHING RETURNING id",
            [course.slug, course.title, course.subtitle, course.description, course.category, course.level, course.duration]
        );
        let courseId = inserted.rows[0] && inserted.rows[0].id;
        if (!courseId) {
            const existing = await query("SELECT id FROM academy_courses WHERE slug = $1", [course.slug]);
            courseId = existing.rows[0] && existing.rows[0].id;
        }
        if (!courseId) continue;

        for (let index = 0; index < course.lessons.length; index++) {
            const lesson = course.lessons[index];
            await query(
                "INSERT INTO academy_lessons (course_id, title, lesson_body, sort_order, estimated_minutes) " +
                "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (course_id, sort_order) DO NOTHING",
                [courseId, lesson.title, lesson.body, index + 1, lesson.minutes]
            );
        }

        const quizInsert = await query(
            "INSERT INTO academy_quizzes (course_id, title, pass_percent) VALUES ($1,$2,$3) " +
            "ON CONFLICT (course_id) DO NOTHING RETURNING id",
            [courseId, course.quiz.title, course.quiz.pass]
        );
        let quizId = quizInsert.rows[0] && quizInsert.rows[0].id;
        if (!quizId) {
            const existingQuiz = await query("SELECT id FROM academy_quizzes WHERE course_id = $1", [courseId]);
            quizId = existingQuiz.rows[0] && existingQuiz.rows[0].id;
        }
        if (!quizId) continue;
        for (let index = 0; index < course.quiz.questions.length; index++) {
            const question = course.quiz.questions[index];
            await query(
                "INSERT INTO academy_questions (quiz_id, prompt, options, correct_option, explanation, sort_order) " +
                "VALUES ($1,$2,$3::jsonb,$4,$5,$6) ON CONFLICT (quiz_id, sort_order) DO NOTHING",
                [quizId, question.prompt, JSON.stringify(question.options), question.correct, question.explanation, index + 1]
            );
        }
    }
}

function registerPlatformRoutes(app, dependencies) {
    const { query, pool, authenticate, getRuntimeState } = dependencies;

    async function resolveRole(user) {
        const username = String(user && user.username || "").trim().toLowerCase();
        const rootNames = String(process.env.ADMIN_USERNAMES || "")
            .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
        if (username && rootNames.includes(username)) return "super_admin";
        const result = await query("SELECT role FROM platform_admin_roles WHERE user_id = $1", [user.id]);
        return result.rows[0] ? result.rows[0].role : null;
    }

    function hasPermission(role, permission) {
        const permissions = ROLE_PERMISSIONS[role] || [];
        return permissions.includes("*") || permissions.includes(permission);
    }

    function requirePermission(permission) {
        return (req, res, next) => {
            authenticate(req, res, async () => {
                try {
                    const role = await resolveRole(req.user);
                    if (!role || !hasPermission(role, permission)) {
                        return res.status(403).json({ error: "Your account does not have permission to access this admin section." });
                    }
                    req.platformAdminRole = role;
                    return next();
                } catch (error) {
                    console.error("Platform permission check failed:", error.message);
                    return res.status(500).json({ error: "Unable to verify administrator permissions." });
                }
            });
        };
    }

    async function audit(req, action, targetType, targetId, details = {}) {
        try {
            await query(
                "INSERT INTO platform_audit_log (actor_id, actor_username, action, target_type, target_id, details) " +
                "VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
                [
                    req.user ? req.user.id : null,
                    req.user ? req.user.username : "system",
                    String(action).slice(0, 120),
                    String(targetType || "system").slice(0, 80),
                    targetId === null || targetId === undefined ? null : String(targetId).slice(0, 120),
                    JSON.stringify(details || {})
                ]
            );
        } catch (error) {
            console.error("Platform audit write failed:", error.message);
        }
    }

    app.get("/api/platform/status", async (req, res) => {
        const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
        let database = { status: "error", label: "Unavailable" };
        let newsky = { status: "unknown", label: "Checking" };
        try {
            await query("SELECT 1");
            database = { status: "ok", label: "Connected" };
        } catch (error) {
            database = { status: "error", label: "Disconnected" };
        }
        try {
            const runtime = await getRuntimeState();
            const sync = runtime.sync || null;
            if (!process.env.NEWSKY_API_KEY) {
                newsky = { status: "error", label: "Not configured", detail: "NEWSKY_API_KEY is missing." };
            } else if (sync && sync.status === "error") {
                newsky = { status: "error", label: "Sync error", detail: sync.last_error || "The latest sync failed." };
            } else if (sync && sync.last_completed_at) {
                const age = Date.now() - new Date(sync.last_completed_at).getTime();
                if (Number.isFinite(age) && age <= 45 * 60 * 1000) {
                    newsky = { status: "ok", label: "Connected", lastSync: sync.last_completed_at };
                } else {
                    newsky = { status: "warning", label: "Sync overdue", lastSync: sync.last_completed_at };
                }
            } else {
                newsky = { status: "warning", label: "Waiting for first sync" };
            }
            res.set("Cache-Control", "no-store");
            return res.json({
                backend: { status: "ok", label: "Online", uptimeSeconds: Math.floor(process.uptime()), startedAt },
                database,
                discord: runtime.discordReady
                    ? { status: "ok", label: "Connected" }
                    : { status: "warning", label: "Not connected" },
                newsky,
                sync: sync ? {
                    status: sync.status,
                    lastStartedAt: sync.last_started_at,
                    lastCompletedAt: sync.last_completed_at,
                    lastError: sync.last_error,
                    linkedPilots: Number(sync.linked_pilots || 0),
                    flightsImported: Number(sync.flights_imported || 0),
                    flightsUpdated: Number(sync.flights_updated || 0)
                } : null,
                checkedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error("Platform status error:", error.message);
            return res.status(500).json({ backend: { status: "error", label: "Status check failed" }, database, discord: { status: "unknown", label: "Unknown" }, newsky });
        }
    });

    async function buildOperations() {
        const days = 30;
        const result = await query(
            "SELECT u.id, u.username, u.display_name, u.newsky_pilot_id, " +
            "COUNT(f.id)::INTEGER AS total_flights, " +
            "COUNT(f.id) FILTER (WHERE CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN f.dep_time::timestamptz >= NOW() - INTERVAL '30 days' ELSE FALSE END)::INTEGER AS flights_30d, " +
            "MAX(CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN f.dep_time::timestamptz END) AS last_flight_at " +
            "FROM users u LEFT JOIN flights f ON f.user_id = u.id " +
            "GROUP BY u.id, u.username, u.display_name, u.newsky_pilot_id " +
            "ORDER BY last_flight_at DESC NULLS LAST, LOWER(COALESCE(u.display_name,u.username))"
        );
        const pilots = result.rows.map(row => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name || row.username,
            newskyLinked: Boolean(String(row.newsky_pilot_id || "").trim()),
            totalFlights: Number(row.total_flights || 0),
            flights30d: Number(row.flights_30d || 0),
            lastFlightAt: row.last_flight_at,
            activity: Number(row.flights_30d || 0) > 0 ? "flown" : "not_flown"
        }));
        return {
            pilots,
            totals: {
                pilots: pilots.length,
                activePilots30d: pilots.filter(pilot => pilot.flights30d > 0).length,
                notFlown30d: pilots.filter(pilot => pilot.flights30d === 0).length,
                linkedToNewsky: pilots.filter(pilot => pilot.newskyLinked).length,
                flights30d: pilots.reduce((total, pilot) => total + pilot.flights30d, 0)
            },
            days
        };
    }

    app.get("/api/platform/operations", requirePermission("operations.read"), async (req, res) => {
        try {
            const data = await buildOperations();
            res.set("Cache-Control", "no-store");
            return res.json(data);
        } catch (error) {
            console.error("Platform operations error:", error.message);
            return res.status(500).json({ error: "Unable to load pilot activity." });
        }
    });

    app.get("/api/platform/routes", async (req, res) => {
        try {
            const days = clamp(req.query.days || 30, 1, 31);
            const result = await query(
                "SELECT f.id, f.dep_icao, f.arr_icao, f.aircraft, f.aircraft_registration, f.aircraft_type, " +
                "f.duration, f.distance, f.dep_time, u.id AS pilot_id, u.username, u.display_name " +
                "FROM flights f LEFT JOIN users u ON u.id = f.user_id " +
                "WHERE CASE WHEN f.dep_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN f.dep_time::timestamptz >= NOW() - ($1::text || ' days')::interval ELSE FALSE END " +
                "AND f.dep_icao IS NOT NULL AND f.arr_icao IS NOT NULL " +
                "ORDER BY f.dep_time DESC",
                [days]
            );
            const flights = result.rows.map(row => ({
                id: row.id,
                departure: row.dep_icao,
                arrival: row.arr_icao,
                aircraft: row.aircraft || "Unknown aircraft",
                registration: row.aircraft_registration || extractRegistration(row.aircraft),
                aircraftType: row.aircraft_type || null,
                durationMinutes: row.duration === null ? null : Number(row.duration),
                distanceKm: row.distance === null ? null : Number(row.distance),
                date: row.dep_time,
                pilot: row.display_name || row.username || "Unknown pilot",
                pilotId: row.pilot_id
            }));
            res.set("Cache-Control", "no-store");
            return res.json({ days, count: flights.length, flights });
        } catch (error) {
            console.error("Platform route history error:", error.message);
            return res.status(500).json({ error: "Unable to load route history." });
        }
    });

    function extractRegistration(value) {
        const raw = String(value || "").trim().toUpperCase();
        const match = raw.match(/^(?:([A-Z0-9]{1,2}-[A-Z0-9]{3,5})|(N[1-9][0-9]{0,4}[A-Z]{0,2}))/);
        return match ? (match[1] || match[2]) : null;
    }

    app.get("/api/platform/fleet", async (req, res) => {
        try {
            const result = await query(
                "SELECT aircraft, aircraft_registration, aircraft_type, dep_icao, dep_time " +
                "FROM flights WHERE aircraft IS NOT NULL AND BTRIM(aircraft) <> '' ORDER BY dep_time DESC"
            );
            const groups = new Map();
            const now = Date.now();
            const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
            const oneEightyDaysAgo = now - 180 * 24 * 60 * 60 * 1000;
            for (const row of result.rows) {
                const name = String(row.aircraft || "").trim();
                const registration = row.aircraft_registration || extractRegistration(name);
                const key = registration || name.toLowerCase();
                let item = groups.get(key);
                if (!item) {
                    item = {
                        key,
                        registration,
                        name,
                        aircraftType: row.aircraft_type || null,
                        totalFlights: 0,
                        flights30d: 0,
                        lastFlightAt: null,
                        bases: new Map()
                    };
                    groups.set(key, item);
                }
                item.totalFlights++;
                if (!item.aircraftType && row.aircraft_type) item.aircraftType = row.aircraft_type;
                const stamp = row.dep_time ? new Date(row.dep_time).getTime() : NaN;
                if (Number.isFinite(stamp)) {
                    if (!item.lastFlightAt || stamp > new Date(item.lastFlightAt).getTime()) item.lastFlightAt = row.dep_time;
                    if (stamp >= thirtyDaysAgo) item.flights30d++;
                    if (stamp >= oneEightyDaysAgo && row.dep_icao) {
                        const code = String(row.dep_icao).trim().toUpperCase();
                        item.bases.set(code, (item.bases.get(code) || 0) + 1);
                    }
                }
            }
            const aircraft = Array.from(groups.values()).map(item => {
                const base = Array.from(item.bases.entries()).sort((a, b) => b[1] - a[1])[0];
                return {
                    id: item.key,
                    registration: item.registration,
                    name: item.name,
                    aircraftType: item.aircraftType,
                    typeLabel: item.aircraftType || "Not supplied by NewSky",
                    homeBase: base ? base[0] : null,
                    homeBaseSource: base ? "Most frequent departure in the last 180 days" : "No recent departure data",
                    totalFlights: item.totalFlights,
                    flights30d: item.flights30d,
                    lastFlightAt: item.lastFlightAt,
                    status: item.flights30d > 0 ? "active" : "inactive",
                    statusLabel: item.flights30d > 0 ? "Flown in last 30 days" : "No flight in last 30 days",
                    photoAvailable: false
                };
            }).sort((a, b) => {
                if (a.flights30d !== b.flights30d) return b.flights30d - a.flights30d;
                return String(a.registration || a.name).localeCompare(String(b.registration || b.name));
            });
            res.set("Cache-Control", "no-store");
            return res.json({
                aircraft,
                totals: {
                    aircraftObserved: aircraft.length,
                    active30d: aircraft.filter(item => item.flights30d > 0).length,
                    noFlights30d: aircraft.filter(item => item.flights30d === 0).length,
                    registrationsKnown: aircraft.filter(item => item.registration).length
                },
                source: "Unique aircraft observed in imported NewSky flights. NewSky's public fleet scope is currently not used."
            });
        } catch (error) {
            console.error("Platform fleet error:", error.message);
            return res.status(500).json({ error: "Unable to load aircraft history." });
        }
    });

    app.get("/api/platform/fleet/:registration/photo", async (req, res) => {
        const registration = String(req.params.registration || "").trim().toUpperCase();
        if (!/^[A-Z0-9-]{3,12}$/.test(registration)) return res.status(400).json({ error: "Invalid aircraft registration." });
        const cached = photoCache.get(registration);
        if (cached && Date.now() - cached.cachedAt < PHOTO_CACHE_MS) {
            return res.json(cached.payload);
        }
        try {
            const response = await fetch("https://api.planespotters.net/pub/photos/reg/" + encodeURIComponent(registration), {
                headers: { "User-Agent": "EchoAirGroup/1.0 (+https://github.com/echoairgroup/Echo-Air-Group)", "Accept": "application/json" },
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) return res.status(response.status === 404 ? 404 : 502).json({ error: "No aircraft photo is currently available." });
            const payload = await response.json();
            const photo = Array.isArray(payload.photos) ? payload.photos[0] : null;
            if (!photo) return res.status(404).json({ error: "No aircraft photo is currently available." });
            const result = {
                thumbnail: photo.thumbnail_large && photo.thumbnail_large.src ? photo.thumbnail_large.src : (photo.thumbnail && photo.thumbnail.src ? photo.thumbnail.src : null),
                photoUrl: photo.link || null,
                photographer: photo.photographer || "Unknown photographer",
                source: "Planespotters.net"
            };
            if (!result.thumbnail || !result.photoUrl) return res.status(404).json({ error: "No usable aircraft photo is available." });
            photoCache.set(registration, { cachedAt: Date.now(), payload: result });
            return res.json(result);
        } catch (error) {
            console.warn("Aircraft photo lookup failed:", registration, error.message);
            return res.status(502).json({ error: "Aircraft photo service is temporarily unavailable." });
        }
    });

    app.get("/api/platform/admin/session", requirePermission("overview.read"), async (req, res) => {
        const permissions = ROLE_PERMISSIONS[req.platformAdminRole] || [];
        return res.json({
            authorized: true,
            username: req.user.username,
            role: req.platformAdminRole,
            permissions,
            isRootAdmin: req.platformAdminRole === "super_admin"
        });
    });

    app.get("/api/platform/admin/overview", requirePermission("overview.read"), async (req, res) => {
        try {
            const [users, flights, applications, courses, notifications, sync] = await Promise.all([
                query("SELECT COUNT(*)::INTEGER AS count FROM users"),
                query("SELECT COUNT(*)::INTEGER AS count FROM flights"),
                query("SELECT COUNT(*)::INTEGER AS count, COUNT(*) FILTER (WHERE status = 'new')::INTEGER AS new FROM applications"),
                query("SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE published)::INTEGER AS published FROM academy_courses"),
                query("SELECT COUNT(*)::INTEGER AS count FROM platform_notifications WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP"),
                query("SELECT * FROM flight_sync_state WHERE sync_key = 'global'")
            ]);
            const runtime = await getRuntimeState();
            const operations = await buildOperations();
            const recentAudit = await query("SELECT id, actor_username, action, target_type, target_id, details, created_at FROM platform_audit_log ORDER BY created_at DESC LIMIT 12");
            const status = {
                backend: { status: "ok", uptimeSeconds: Math.floor(process.uptime()) },
                database: "connected",
                discord: runtime.discordReady ? "connected" : "not connected",
                newsky: sync.rows[0] ? sync.rows[0].status : "not started"
            };
            return res.json({
                stats: {
                    pilots: Number(users.rows[0].count),
                    flights: Number(flights.rows[0].count),
                    applications: Number(applications.rows[0].count),
                    newApplications: Number(applications.rows[0].new),
                    courses: Number(courses.rows[0].total),
                    publishedCourses: Number(courses.rows[0].published),
                    notifications: Number(notifications.rows[0].count),
                    activePilots30d: operations.totals.activePilots30d,
                    inactivePilots30d: operations.totals.notFlown30d
                },
                system: status,
                sync: sync.rows[0] || null,
                recentAudit: recentAudit.rows
            });
        } catch (error) {
            console.error("Platform admin overview error:", error.message);
            return res.status(500).json({ error: "Unable to load admin overview." });
        }
    });

    app.get("/api/platform/admin/operations", requirePermission("operations.read"), async (req, res) => {
        try { return res.json(await buildOperations()); }
        catch (error) { return res.status(500).json({ error: "Unable to load operations." }); }
    });

    app.get("/api/platform/admin/fleet", requirePermission("fleet.read"), async (req, res) => {
        try {
            const rows = await query(
                "SELECT aircraft, aircraft_registration, aircraft_type, dep_icao, dep_time " +
                "FROM flights WHERE aircraft IS NOT NULL AND BTRIM(aircraft) <> '' ORDER BY dep_time DESC"
            );
            const counts = new Map();
            for (const row of rows.rows) {
                const name = String(row.aircraft || "").trim();
                const registration = row.aircraft_registration || extractRegistration(name);
                const key = registration || name.toLowerCase();
                let item = counts.get(key);
                if (!item) item = { registration, name, type: row.aircraft_type || null, total: 0, recent: 0, last: null };
                item.total++;
                const stamp = row.dep_time ? new Date(row.dep_time).getTime() : NaN;
                if (Number.isFinite(stamp)) {
                    if (!item.last || stamp > new Date(item.last).getTime()) item.last = row.dep_time;
                    if (stamp >= Date.now() - 30 * 86400000) item.recent++;
                }
                if (!item.type && row.aircraft_type) item.type = row.aircraft_type;
                counts.set(key, item);
            }
            return res.json({ aircraft: Array.from(counts.values()) });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load fleet data." });
        }
    });

    app.get("/api/platform/admin/roles", requirePermission("roles.read"), async (req, res) => {
        try {
            const result = await query(
                "SELECT u.id AS user_id, u.username, u.display_name, r.role, r.created_at, r.updated_at " +
                "FROM platform_admin_roles r JOIN users u ON u.id = r.user_id ORDER BY LOWER(u.username)"
            );
            return res.json({ roles: result.rows, availableRoles: Array.from(VALID_ROLES) });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load administrator roles." });
        }
    });

    app.post("/api/platform/admin/roles", requirePermission("roles.manage"), async (req, res) => {
        try {
            const username = String(req.body && req.body.username || "").trim();
            const role = String(req.body && req.body.role || "").trim();
            if (!username || !VALID_ROLES.has(role)) return res.status(400).json({ error: "Enter an existing Echo username and a valid role." });
            const userResult = await query("SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)", [username]);
            const user = userResult.rows[0];
            if (!user) return res.status(404).json({ error: "That Echo pilot account could not be found." });
            if (String(process.env.ADMIN_USERNAMES || "").split(",").map(value => value.trim().toLowerCase()).includes(String(user.username).toLowerCase())) {
                return res.status(400).json({ error: "This account is already a root administrator through ADMIN_USERNAMES." });
            }
            await query(
                "INSERT INTO platform_admin_roles (user_id, role, granted_by, updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP) " +
                "ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, updated_at = CURRENT_TIMESTAMP",
                [user.id, role, req.user.id]
            );
            await audit(req, "admin.role.assign", "user", user.id, { username: user.username, role });
            return res.status(201).json({ message: "Administrator role saved.", username: user.username, role });
        } catch (error) {
            console.error("Role assignment error:", error.message);
            return res.status(500).json({ error: "Unable to save administrator role." });
        }
    });

    app.delete("/api/platform/admin/roles/:userId", requirePermission("roles.manage"), async (req, res) => {
        const userId = Number.parseInt(req.params.userId, 10);
        if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ error: "Invalid user ID." });
        try {
            const result = await query(
                "DELETE FROM platform_admin_roles WHERE user_id = $1 RETURNING user_id",
                [userId]
            );
            if (!result.rows.length) return res.status(404).json({ error: "Administrator role not found." });
            await audit(req, "admin.role.remove", "user", userId);
            return res.json({ message: "Administrator role removed." });
        } catch (error) {
            return res.status(500).json({ error: "Unable to remove administrator role." });
        }
    });

    app.get("/api/platform/admin/audit", requirePermission("audit.read"), async (req, res) => {
        try {
            const limit = clamp(req.query.limit || 100, 1, 250);
            const result = await query(
                "SELECT id, actor_username, action, target_type, target_id, details, created_at " +
                "FROM platform_audit_log ORDER BY created_at DESC LIMIT $1",
                [limit]
            );
            return res.json({ entries: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load audit history." });
        }
    });

    app.get("/api/platform/admin/notifications", requirePermission("notifications.read"), async (req, res) => {
        try {
            const result = await query(
                "SELECT n.id, n.title, n.message, n.level, n.created_at, n.expires_at, u.username AS created_by " +
                "FROM platform_notifications n LEFT JOIN users u ON u.id = n.created_by " +
                "WHERE n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP ORDER BY n.created_at DESC LIMIT 100"
            );
            return res.json({ notifications: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load notifications." });
        }
    });

    app.post("/api/platform/admin/notifications", requirePermission("notifications.write"), async (req, res) => {
        const title = String(req.body && req.body.title || "").trim().slice(0, 120);
        const message = String(req.body && req.body.message || "").trim().slice(0, 2000);
        const level = String(req.body && req.body.level || "info").trim();
        if (!title || !message || !["info", "success", "warning", "critical"].includes(level)) {
            return res.status(400).json({ error: "Enter a title, message and valid notification level." });
        }
        try {
            const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
            if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "Invalid expiry date." });
            const result = await query(
                "INSERT INTO platform_notifications (title, message, level, created_by, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
                [title, message, level, req.user.id, expiresAt]
            );
            await audit(req, "notification.create", "notification", result.rows[0].id, { level });
            return res.status(201).json({ notification: result.rows[0] });
        } catch (error) {
            return res.status(500).json({ error: "Unable to create notification." });
        }
    });

    app.delete("/api/platform/admin/notifications/:id", requirePermission("notifications.write"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid notification ID." });
        try {
            const result = await query("DELETE FROM platform_notifications WHERE id = $1 RETURNING id", [id]);
            if (!result.rows.length) return res.status(404).json({ error: "Notification not found." });
            await audit(req, "notification.delete", "notification", id);
            return res.json({ deleted: true });
        } catch (error) {
            return res.status(500).json({ error: "Unable to delete notification." });
        }
    });

    app.get("/api/platform/academy/catalog", authenticate, async (req, res) => {
        try {
            const result = await query(
                "SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.category, c.level, c.duration_minutes, " +
                "COUNT(DISTINCT l.id)::INTEGER AS lesson_count, q.id AS quiz_id, q.title AS quiz_title, q.pass_percent, " +
                "e.status AS enrollment_status, e.progress_percent, e.enrolled_at, e.completed_at, " +
                "EXISTS (SELECT 1 FROM academy_certificates cert WHERE cert.user_id = $1 AND cert.course_id = c.id) AS certificate_earned " +
                "FROM academy_courses c LEFT JOIN academy_lessons l ON l.course_id = c.id " +
                "LEFT JOIN academy_quizzes q ON q.course_id = c.id " +
                "LEFT JOIN academy_enrollments e ON e.course_id = c.id AND e.user_id = $1 " +
                "WHERE c.published = TRUE GROUP BY c.id, q.id, e.status, e.progress_percent, e.enrolled_at, e.completed_at " +
                "ORDER BY c.category, c.id",
                [req.user.id]
            );
            return res.json({ courses: result.rows });
        } catch (error) {
            console.error("Academy catalog error:", error.message);
            return res.status(500).json({ error: "Unable to load academy courses." });
        }
    });

    app.get("/api/platform/academy/me", authenticate, async (req, res) => {
        try {
            const [enrollments, certificates, attempts] = await Promise.all([
                query(
                    "SELECT e.course_id, c.slug, c.title, e.status, e.progress_percent, e.enrolled_at, e.updated_at, e.completed_at " +
                    "FROM academy_enrollments e JOIN academy_courses c ON c.id = e.course_id " +
                    "WHERE e.user_id = $1 ORDER BY e.updated_at DESC",
                    [req.user.id]
                ),
                query(
                    "SELECT cert.certificate_code, cert.issued_at, c.title AS course_title, c.slug " +
                    "FROM academy_certificates cert JOIN academy_courses c ON c.id = cert.course_id " +
                    "WHERE cert.user_id = $1 ORDER BY cert.issued_at DESC",
                    [req.user.id]
                ),
                query(
                    "SELECT a.id, a.score_percent, a.passed, a.attempted_at, q.title AS quiz_title, c.title AS course_title " +
                    "FROM academy_quiz_attempts a JOIN academy_quizzes q ON q.id = a.quiz_id " +
                    "JOIN academy_courses c ON c.id = q.course_id WHERE a.user_id = $1 ORDER BY a.attempted_at DESC LIMIT 25",
                    [req.user.id]
                )
            ]);
            return res.json({ enrollments: enrollments.rows, certificates: certificates.rows, recentAttempts: attempts.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load your academy progress." });
        }
    });

    app.get("/api/platform/academy/courses/:slug", authenticate, async (req, res) => {
        try {
            const courseResult = await query(
                "SELECT id, slug, title, subtitle, description, category, level, duration_minutes " +
                "FROM academy_courses WHERE slug = $1 AND published = TRUE",
                [String(req.params.slug || "").toLowerCase()]
            );
            const course = courseResult.rows[0];
            if (!course) return res.status(404).json({ error: "Course not found." });
            const [lessons, quiz, progress, attempts, certificate] = await Promise.all([
                query("SELECT id, title, lesson_body, sort_order, estimated_minutes FROM academy_lessons WHERE course_id = $1 ORDER BY sort_order", [course.id]),
                query("SELECT id, title, pass_percent FROM academy_quizzes WHERE course_id = $1", [course.id]),
                query("SELECT lesson_id, completed_at FROM academy_lesson_progress WHERE user_id = $1 AND lesson_id IN (SELECT id FROM academy_lessons WHERE course_id = $2)", [req.user.id, course.id]),
                query("SELECT score_percent, passed, attempted_at FROM academy_quiz_attempts WHERE user_id = $1 AND quiz_id IN (SELECT id FROM academy_quizzes WHERE course_id = $2) ORDER BY attempted_at DESC LIMIT 10", [req.user.id, course.id]),
                query("SELECT certificate_code, issued_at FROM academy_certificates WHERE user_id = $1 AND course_id = $2", [req.user.id, course.id])
            ]);
            let quizData = null;
            if (quiz.rows[0]) {
                const questions = await query(
                    "SELECT id, prompt, options, sort_order FROM academy_questions WHERE quiz_id = $1 ORDER BY sort_order",
                    [quiz.rows[0].id]
                );
                quizData = { ...quiz.rows[0], questions: questions.rows.map(question => ({
                    ...question,
                    options: safeJson(question.options, [])
                })) };
            }
            return res.json({
                course,
                lessons: lessons.rows,
                completedLessonIds: progress.rows.map(row => Number(row.lesson_id)),
                quiz: quizData,
                attempts: attempts.rows,
                certificate: certificate.rows[0] || null
            });
        } catch (error) {
            console.error("Academy course load error:", error.message);
            return res.status(500).json({ error: "Unable to load this course." });
        }
    });

    app.post("/api/platform/academy/courses/:courseId/enroll", authenticate, async (req, res) => {
        const courseId = Number.parseInt(req.params.courseId, 10);
        if (!Number.isSafeInteger(courseId) || courseId < 1) return res.status(400).json({ error: "Invalid course." });
        try {
            const course = await query("SELECT id FROM academy_courses WHERE id = $1 AND published = TRUE", [courseId]);
            if (!course.rows.length) return res.status(404).json({ error: "Course not found." });
            const enrollment = await query(
                "INSERT INTO academy_enrollments (user_id, course_id) VALUES ($1,$2) " +
                "ON CONFLICT (user_id, course_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING *",
                [req.user.id, courseId]
            );
            await audit(req, "academy.enroll", "course", courseId);
            return res.json({ enrollment: enrollment.rows[0] });
        } catch (error) {
            return res.status(500).json({ error: "Unable to enroll in this course." });
        }
    });

    async function refreshCourseProgress(userId, courseId) {
        const [lessonCounts, quiz, certificate] = await Promise.all([
            query(
                "SELECT COUNT(*)::INTEGER AS total, COUNT(p.id)::INTEGER AS completed " +
                "FROM academy_lessons l LEFT JOIN academy_lesson_progress p ON p.lesson_id = l.id AND p.user_id = $1 " +
                "WHERE l.course_id = $2",
                [userId, courseId]
            ),
            query("SELECT id FROM academy_quizzes WHERE course_id = $1", [courseId]),
            query("SELECT id, certificate_code FROM academy_certificates WHERE user_id = $1 AND course_id = $2", [userId, courseId])
        ]);
        const totalLessons = Number(lessonCounts.rows[0].total || 0);
        const completedLessons = Number(lessonCounts.rows[0].completed || 0);
        let quizPassed = false;
        if (quiz.rows[0]) {
            const passed = await query(
                "SELECT 1 FROM academy_quiz_attempts WHERE user_id = $1 AND quiz_id = $2 AND passed = TRUE LIMIT 1",
                [userId, quiz.rows[0].id]
            );
            quizPassed = passed.rows.length > 0;
        }
        const progress = totalLessons > 0
            ? Math.min(100, Math.round((completedLessons / totalLessons) * 80) + (quizPassed ? 20 : 0))
            : (quizPassed ? 100 : 0);
        const completed = totalLessons > 0 && completedLessons === totalLessons && quizPassed;
        await query(
            "INSERT INTO academy_enrollments (user_id, course_id, status, progress_percent, completed_at, updated_at) " +
            "VALUES ($1,$2,$3,$4,CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP) " +
            "ON CONFLICT (user_id, course_id) DO UPDATE SET status = EXCLUDED.status, progress_percent = EXCLUDED.progress_percent, " +
            "completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(academy_enrollments.completed_at, CURRENT_TIMESTAMP) ELSE NULL END, " +
            "updated_at = CURRENT_TIMESTAMP",
            [userId, courseId, completed ? "completed" : "in_progress", progress]
        );
        let certificate = certificate.rows[0] || null;
        if (completed && !certificate) {
            const code = "EAG-" + new Date().getUTCFullYear() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
            const created = await query(
                "INSERT INTO academy_certificates (user_id, course_id, certificate_code) VALUES ($1,$2,$3) " +
                "ON CONFLICT (user_id, course_id) DO UPDATE SET certificate_code = academy_certificates.certificate_code RETURNING certificate_code, issued_at",
                [userId, courseId, code]
            );
            certificate = created.rows[0];
        }
        return { totalLessons, completedLessons, quizPassed, progress, completed, certificate };
    }

    app.post("/api/platform/academy/lessons/:lessonId/complete", authenticate, async (req, res) => {
        const lessonId = Number.parseInt(req.params.lessonId, 10);
        if (!Number.isSafeInteger(lessonId) || lessonId < 1) return res.status(400).json({ error: "Invalid lesson." });
        try {
            const lesson = await query(
                "SELECT l.id, l.course_id FROM academy_lessons l JOIN academy_courses c ON c.id = l.course_id " +
                "WHERE l.id = $1 AND c.published = TRUE",
                [lessonId]
            );
            if (!lesson.rows.length) return res.status(404).json({ error: "Lesson not found." });
            const courseId = lesson.rows[0].course_id;
            await query(
                "INSERT INTO academy_enrollments (user_id, course_id) VALUES ($1,$2) ON CONFLICT (user_id, course_id) DO NOTHING",
                [req.user.id, courseId]
            );
            await query(
                "INSERT INTO academy_lesson_progress (user_id, lesson_id) VALUES ($1,$2) ON CONFLICT (user_id, lesson_id) DO NOTHING",
                [req.user.id, lessonId]
            );
            const progress = await refreshCourseProgress(req.user.id, courseId);
            return res.json({ lessonCompleted: true, ...progress });
        } catch (error) {
            console.error("Academy lesson completion error:", error.message);
            return res.status(500).json({ error: "Unable to save lesson progress." });
        }
    });

    app.post("/api/platform/academy/quizzes/:quizId/attempt", authenticate, async (req, res) => {
        const quizId = Number.parseInt(req.params.quizId, 10);
        const submittedAnswers = req.body && req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
        if (!Number.isSafeInteger(quizId) || quizId < 1) return res.status(400).json({ error: "Invalid quiz." });
        try {
            const quizResult = await query(
                "SELECT q.id, q.course_id, q.title, q.pass_percent FROM academy_quizzes q " +
                "JOIN academy_courses c ON c.id = q.course_id WHERE q.id = $1 AND c.published = TRUE",
                [quizId]
            );
            const quiz = quizResult.rows[0];
            if (!quiz) return res.status(404).json({ error: "Quiz not found." });
            const questions = await query(
                "SELECT id, correct_option, explanation, options FROM academy_questions WHERE quiz_id = $1 ORDER BY sort_order",
                [quizId]
            );
            if (!questions.rows.length) return res.status(400).json({ error: "This quiz does not contain questions yet." });
            let correct = 0;
            const answerRecord = {};
            const review = questions.rows.map(question => {
                const submitted = Number(submittedAnswers[question.id]);
                const valid = Number.isInteger(submitted) && submitted >= 0 && submitted < safeJson(question.options, []).length;
                const isCorrect = valid && submitted === Number(question.correct_option);
                if (isCorrect) correct++;
                answerRecord[question.id] = valid ? submitted : null;
                return {
                    questionId: question.id,
                    correct: isCorrect,
                    correctOption: Number(question.correct_option),
                    explanation: question.explanation || ""
                };
            });
            const score = Math.round((correct / questions.rows.length) * 100);
            const passed = score >= Number(quiz.pass_percent);
            const inserted = await query(
                "INSERT INTO academy_quiz_attempts (user_id, quiz_id, score_percent, question_count, correct_count, passed, answers) " +
                "VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id, attempted_at",
                [req.user.id, quizId, score, questions.rows.length, correct, passed, JSON.stringify(answerRecord)]
            );
            await query(
                "INSERT INTO academy_enrollments (user_id, course_id) VALUES ($1,$2) ON CONFLICT (user_id, course_id) DO NOTHING",
                [req.user.id, quiz.course_id]
            );
            const progress = await refreshCourseProgress(req.user.id, quiz.course_id);
            return res.json({
                attemptId: inserted.rows[0].id,
                attemptedAt: inserted.rows[0].attempted_at,
                scorePercent: score,
                correctCount: correct,
                questionCount: questions.rows.length,
                passed,
                passPercent: Number(quiz.pass_percent),
                review,
                ...progress
            });
        } catch (error) {
            console.error("Academy quiz attempt error:", error.message);
            return res.status(500).json({ error: "Unable to grade this quiz." });
        }
    });

    app.get("/api/platform/academy/certificates/:code", async (req, res) => {
        try {
            const result = await query(
                "SELECT cert.certificate_code, cert.issued_at, c.title AS course_title, u.display_name, u.username " +
                "FROM academy_certificates cert JOIN academy_courses c ON c.id = cert.course_id " +
                "JOIN users u ON u.id = cert.user_id WHERE cert.certificate_code = $1",
                [String(req.params.code || "").trim().toUpperCase()]
            );
            if (!result.rows.length) return res.status(404).json({ valid: false, error: "Certificate not found." });
            const certificate = result.rows[0];
            return res.json({
                valid: true,
                certificate: {
                    code: certificate.certificate_code,
                    course: certificate.course_title,
                    pilot: certificate.display_name || certificate.username,
                    issuedAt: certificate.issued_at
                }
            });
        } catch (error) {
            return res.status(500).json({ valid: false, error: "Unable to verify certificate." });
        }
    });

    app.get("/api/platform/admin/academy/courses", requirePermission("academy.read"), async (req, res) => {
        try {
            const result = await query(
                "SELECT c.id, c.slug, c.title, c.description, c.category, c.level, c.duration_minutes, c.published, c.created_at, " +
                "COUNT(DISTINCT l.id)::INTEGER AS lesson_count, COUNT(DISTINCT e.user_id)::INTEGER AS enrolled_pilots " +
                "FROM academy_courses c LEFT JOIN academy_lessons l ON l.course_id = c.id " +
                "LEFT JOIN academy_enrollments e ON e.course_id = c.id " +
                "GROUP BY c.id ORDER BY c.created_at"
            );
            return res.json({ courses: result.rows });
        } catch (error) {
            return res.status(500).json({ error: "Unable to load Academy management." });
        }
    });

    app.post("/api/platform/admin/academy/courses", requirePermission("academy.write"), async (req, res) => {
        const body = req.body || {};
        const slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 80);
        const title = String(body.title || "").trim().slice(0, 160);
        const description = String(body.description || "").trim().slice(0, 3000);
        const lessons = Array.isArray(body.lessons) ? body.lessons : [];
        const quiz = body.quiz && typeof body.quiz === "object" ? body.quiz : null;
        const questions = quiz && Array.isArray(quiz.questions) ? quiz.questions : [];
        if (!slug || !title || !description || !lessons.length || !quiz || !questions.length) {
            return res.status(400).json({ error: "A slug, title, description, at least one lesson and a quiz with questions are required." });
        }
        if (lessons.length > 30 || questions.length > 40) return res.status(400).json({ error: "A course can contain at most 30 lessons and 40 quiz questions." });
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const courseResult = await client.query(
                "INSERT INTO academy_courses (slug, title, subtitle, description, category, level, duration_minutes, published, created_by) " +
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
                [slug, title, String(body.subtitle || "").slice(0, 180), description, String(body.category || "General").slice(0, 80),
                    String(body.level || "Beginner").slice(0, 50), clamp(body.durationMinutes || 30, 1, 1000), body.published !== false, req.user.id]
            );
            const courseId = courseResult.rows[0].id;
            for (let index = 0; index < lessons.length; index++) {
                const lesson = lessons[index];
                const lessonTitle = String(lesson && lesson.title || "").trim().slice(0, 180);
                const lessonBody = String(lesson && (lesson.body || lesson.content) || "").trim().slice(0, 12000);
                if (!lessonTitle || !lessonBody) throw new Error("Every lesson needs a title and body.");
                await client.query(
                    "INSERT INTO academy_lessons (course_id, title, lesson_body, sort_order, estimated_minutes) VALUES ($1,$2,$3,$4,$5)",
                    [courseId, lessonTitle, lessonBody, index + 1, clamp(lesson.minutes || 10, 1, 240)]
                );
            }
            const quizResult = await client.query(
                "INSERT INTO academy_quizzes (course_id, title, pass_percent) VALUES ($1,$2,$3) RETURNING id",
                [courseId, String(quiz.title || "Knowledge Check").slice(0, 180), clamp(quiz.passPercent || 75, 1, 100)]
            );
            const quizId = quizResult.rows[0].id;
            for (let index = 0; index < questions.length; index++) {
                const question = questions[index];
                const options = Array.isArray(question && question.options) ? question.options.map(value => String(value).slice(0, 500)) : [];
                const correct = Number(question && question.correctOption);
                const prompt = String(question && question.prompt || "").trim().slice(0, 1200);
                if (!prompt || options.length < 2 || options.length > 8 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
                    throw new Error("Every quiz question needs a prompt, 2–8 options and a valid correctOption index.");
                }
                await client.query(
                    "INSERT INTO academy_questions (quiz_id, prompt, options, correct_option, explanation, sort_order) VALUES ($1,$2,$3::jsonb,$4,$5,$6)",
                    [quizId, prompt, JSON.stringify(options), correct, String(question.explanation || "").slice(0, 1200), index + 1]
                );
            }
            await client.query("COMMIT");
            await audit(req, "academy.course.create", "academy_course", courseId, { slug });
            return res.status(201).json({ message: "Academy course created.", courseId, slug });
        } catch (error) {
            await client.query("ROLLBACK");
            const clientError = /needs a title|needs a prompt|correctOption/i.test(error.message);
            return res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : "Unable to create Academy course." });
        } finally {
            client.release();
        }
    });

    app.patch("/api/platform/admin/academy/courses/:id", requirePermission("academy.write"), async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid course ID." });
        try {
            const published = req.body && req.body.published !== undefined ? req.body.published === true : null;
            const result = await query(
                "UPDATE academy_courses SET published = COALESCE($1,published), updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, slug, published",
                [published, id]
            );
            if (!result.rows.length) return res.status(404).json({ error: "Course not found." });
            await audit(req, "academy.course.update", "academy_course", id, { published });
            return res.json({ course: result.rows[0] });
        } catch (error) {
            return res.status(500).json({ error: "Unable to update course." });
        }
    });
}

module.exports = { initializePlatformSchema, registerPlatformRoutes };
