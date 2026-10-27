#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const report = (condition, message) => {
  if (!condition) failures.push(message);
};

const htmlFiles = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html"));
report(htmlFiles.length >= 10, "Expected the complete Echo Air Group HTML page set.");

for (const file of htmlFiles) {
  const source = read(file);
  report(/<title\b[^>]*>[^<]+<\/title>/i.test(source), file + " is missing a document title.");
  report(/name=["']viewport["']/i.test(source), file + " is missing a responsive viewport meta tag.");
  report(!/http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api/i.test(source), file + " contains a localhost API URL.");
  report(!source.includes(String.fromCharCode(96).repeat(3)), file + " contains a stray Markdown code fence.");

  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let inlineIndex = 0;
  while ((scriptMatch = scriptPattern.exec(source)) !== null) {
    const attributes = scriptMatch[1] || "";
    const body = scriptMatch[2] || "";
    if (/\bsrc\s*=/.test(attributes) || /type=["'](?:application\/(?:ld\+json|json)|module)["']/i.test(attributes) || !body.trim()) {
      continue;
    }
    inlineIndex += 1;
    try {
      new vm.Script(body, { filename: file + " inline script " + inlineIndex });
    } catch (error) {
      report(false, file + " inline script " + inlineIndex + " has a syntax error: " + error.message);
    }
  }
}

const server = read("server.js");
report(!server.includes('"CHANGE_THIS_SECRET"'), "The predictable JWT fallback secret must not be present.");
report(server.includes('const JWT_SECRET = process.env.JWT_SECRET || "";'), "JWT_SECRET should come only from the environment.");
report(/function requireAdmin\(/.test(server), "Admin authorization middleware is missing.");
report(/"\/api\/sync\/all",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Global sync is not protected by the admin guard.");
report(/"\/api\/admin\/database-stats",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Database stats are not protected by the admin guard.");
report(/express\.json\(\{\s*limit:\s*["']256kb["']\s*\}\)/.test(server), "JSON request payload size should be bounded.");
report(/express\.urlencoded\(\{\s*extended:\s*false,\s*limit:\s*["']32kb["']\s*\}\)/.test(server), "Native form body size should be bounded.");
report(/registerRateLimit/.test(server) && /loginRateLimit/.test(server), "Authentication rate limits are missing.");
report(/CREATE TABLE IF NOT EXISTS pilot_applications/.test(server), "Pilot application storage table is missing.");
report(/CREATE TABLE IF NOT EXISTS pilot_application_events/.test(server), "Pilot application audit trail is missing.");
report(/"\/api\/applications",[\s\S]{0,80}applicationRateLimit/.test(server), "Public application intake rate limit is missing.");
report(/"\/api\/admin\/applications",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Application listing is not restricted to administrators.");
report(/"\/api\/admin\/applications\/:id",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Application updates are not restricted to administrators.");
report(/"\/api\/admin\/applications\/:id\/events",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Application history is not restricted to administrators.");
report(/CREATE TABLE IF NOT EXISTS external_submissions/.test(server), "Contact/manager submission table is missing.");
report(/CREATE TABLE IF NOT EXISTS external_submission_events/.test(server), "Contact/manager audit history table is missing.");
report(/"\/api\/contact",[\s\S]{0,80}contactRateLimit/.test(server), "Contact endpoint rate limit is missing.");
report(/"\/api\/manager-applications",[\s\S]{0,100}managerApplicationRateLimit/.test(server), "Manager application rate limit is missing.");
report(/"\/api\/admin\/submissions",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Submissions inbox is not restricted to administrators.");
report(/"\/api\/admin\/submissions\/:id",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Submission updates are not restricted to administrators.");
report(/DISCORD_APPLICATIONS_CHANNEL_ID/.test(server), "Optional recruitment notification configuration is missing.");

report(/CREATE TABLE IF NOT EXISTS bookings/.test(server), "Virtual booking storage table is missing.");
report(/CREATE TABLE IF NOT EXISTS booking_seats/.test(server), "Booking seat inventory is missing.");
report(/CREATE TABLE IF NOT EXISTS booking_events/.test(server), "Booking audit history is missing.");
report(/"\/api\/bookings",[\s\S]{0,80}bookingRateLimit/.test(server), "Virtual booking endpoint is not rate-limited.");
report(/"\/api\/bookings\/seat-availability",[\s\S]{0,100}bookingAvailabilityRateLimit/.test(server), "Seat availability endpoint is not rate-limited.");
report(/"\/api\/admin\/bookings",[\s\S]{0,100}authenticate,[\s\S]{0,60}requireAdmin/.test(server), "Booking administration is not restricted to administrators.");
report(/return_flight_number/.test(server) && /return_seat_numbers/.test(server), "Round-trip details are not persisted.");

const bookingPage = read("booking.html");
report(bookingPage.includes('id="bookingPrivacyAcknowledged"'), "Booking privacy acknowledgement is missing.");
report(bookingPage.includes('fetch(apiBase + "/bookings"'), "Booking page is not connected to the first-party booking API.");
report(bookingPage.includes('fetch(apiBase + "/bookings/seat-availability?'), "Booking seat map is not connected to live seat availability.");
report(bookingPage.includes("liveUnavailableSeats.has(seat)"), "Reserved seats are not blocked in the booking seat map.");
report(bookingPage.includes("getSelectedReturnFlight"), "Round-trip return flight selection is missing.");
report(bookingPage.includes('id="returnLegInfo"'), "Round-trip confirmation is missing its return itinerary.");
report(!/id=["'](?:cardNumber|cardName|expiry|cvv)["']/i.test(bookingPage), "Booking page must not collect card details.");
report(!/id=["'](?:dob|nationality|frequentFlyer)["']/i.test(bookingPage), "Booking page collects unnecessary passenger details.");

const bookingsDashboard = read("bookings-admin.html");
report(bookingsDashboard.includes("headers.Authorization='Bearer '+token"), "Bookings dashboard must send the session token.");
report(bookingsDashboard.includes("action:'cancel'"), "Bookings dashboard does not support cancellation.");
report(bookingsDashboard.includes("/events"), "Bookings dashboard must show the audit history.");


const accountPage = read("Server.html");
report(accountPage.includes("https://echo-air-group-api.onrender.com/api"), "Account dashboard must have a deployed API fallback.");
report(!accountPage.includes("http://localhost:3000/api"), "Account dashboard contains a localhost API fallback.");
report(accountPage.includes("escapeHtml(pilot.name)"), "Pilot names must be escaped before HTML rendering.");
report(accountPage.includes('API + "/ranking"'), "Leaderboard should use the shared API base URL.");

const appScript = read("script.js");
report(/fetch\(ECHO_API_BASE \+ '\/applications'/.test(appScript), "Pilot application client must submit to the hosted API.");

const joinPage = read("join.html");
report(joinPage.includes('id="pilotApplicationForm"'), "Pilot application form is not wired to the API.");
report(joinPage.includes('id="privacyAcknowledged"'), "Pilot application privacy acknowledgement is missing.");
report(!joinPage.includes("formsubmit.co"), "Pilot application still sends personal data to the legacy external form handler.");

const contactPage = read("contact.html");
report(contactPage.includes('id="contactForm"'), "Contact form is not wired to the first-party API.");
report(contactPage.includes('id="contactPrivacyAcknowledged"'), "Contact privacy acknowledgement is missing.");
report(!contactPage.includes("formsubmit.co"), "Contact form still submits personal data to the legacy external form handler.");

const managerPage = read("manager.html");
report(managerPage.includes('id="managerApplicationForm"'), "Manager application is not wired to the first-party API.");
report(managerPage.includes('id="managerPrivacyAcknowledged"'), "Manager privacy acknowledgement is missing.");
report(!managerPage.includes("formsubmit.co"), "Manager application still submits personal data to the legacy external form handler.");

const submissionsDashboard = read("submissions-admin.html");
report(submissionsDashboard.includes("escapeHtml(item.email)"), "Submissions inbox must escape personal data.");
report(submissionsDashboard.includes("headers.Authorization = 'Bearer ' + token"), "Submissions inbox must send the session token.");


const applicationDashboard = read("applications-admin.html");
report(applicationDashboard.includes("escapeHtml(app.email)"), "Recruitment dashboard must escape applicant-provided values.");
report(applicationDashboard.includes("headers.Authorization = 'Bearer ' + token"), "Recruitment dashboard must send the session token.");

const workflowsDir = path.join(root, ".github", "workflows");
if (fs.existsSync(workflowsDir)) {
  for (const file of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const source = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    report(!/\bgit push\b/i.test(source), file + " should not push self-generated changes directly to the repository.");
  }
}

if (failures.length) {
  console.error("Echo Air Group validation failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exitCode = 1;
} else {
  console.log("Echo Air Group validation passed (" + htmlFiles.length + " HTML pages checked).");
}
