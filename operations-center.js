(() => {
    "use strict";

    const API = "https://echo-air-group-api.onrender.com/api";
    const $ = (selector) => document.querySelector(selector);
    const localToken = () => localStorage.getItem("echo_token") || "";
    const adminToken = () => sessionStorage.getItem("eag_admin_token") || "";
    let editingPlanId = null;

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = String(text);
        return element;
    }

    function dateTime(value) {
        if (!value) return "Time to be confirmed";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Time to be confirmed" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    function duration(value) {
        const minutes = Number(value) || 0;
        if (minutes < 60) return minutes + " min";
        const hours = Math.floor(minutes / 60);
        const remaining = minutes % 60;
        return hours + "h" + (remaining ? " " + remaining + "m" : "");
    }

    async function request(path, options, token) {
        const opts = options || {};
        const headers = { Accept: "application/json", ...(opts.headers || {}) };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        const selectedToken = token === "admin" ? adminToken() : token === "pilot" ? localToken() : (adminToken() || localToken());
        if (selectedToken) headers.Authorization = "Bearer " + selectedToken;
        const response = await fetch(API + path, { ...opts, headers, cache: "no-store" });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
        if (!response.ok) {
            const error = new Error(data.error || "Request failed (" + response.status + ").");
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function setStatus(target, message, error) {
        if (!target) return;
        target.textContent = message || "";
        target.classList.toggle("error", error === true);
    }

    async function loadSummary() {
        const [summary, schedule] = await Promise.all([
            request("/operations/summary"),
            request("/operations/schedule")
        ]);

        const stats = $("#opsStats");
        const data = summary.flights || {};
        const items = [
            ["Recorded flights", Number(data.total_flights || 0), "NewSky flight history"],
            ["Flights · 30 days", Number(data.flights_30d || 0), "Imported activity"],
            ["Active pilots · 30 days", Number(data.active_pilots_30d || 0), "Based on flown records"],
            ["Upcoming plans", Number(summary.upcomingPlans || 0), "Published schedule"]
        ];
        stats.replaceChildren();
        items.forEach(([label, value, note]) => {
            const card = node("article", "ops-stat");
            card.append(node("span", "", label), node("strong", "", value.toLocaleString("en-GB")), node("small", "", note));
            stats.appendChild(card);
        });

        const sync = summary.sync && summary.sync.last_completed_at ? dateTime(summary.sync.last_completed_at) : "No completed sync reported";
        $("#opsUpdated").textContent = "Last data sync: " + sync;
        $("#trackingStatus").textContent = summary.liveTracking && summary.liveTracking.available ? "Telemetry connected" : "Telemetry not connected";
        $("#trackingMessage").textContent = summary.liveTracking && summary.liveTracking.reason
            ? summary.liveTracking.reason
            : "Live position tracking is available from the configured telemetry source.";
        renderSchedule(schedule.plans || []);
        renderActualFlights(summary.recentFlights || []);
    }

    function renderSchedule(plans) {
        const root = $("#flightPlans");
        root.replaceChildren();
        if (!plans.length) {
            root.appendChild(node("div", "ops-empty", "There are no published upcoming flight plans yet. Check the community calendar for group flights and events."));
            return;
        }

        plans.forEach((plan) => {
            const card = node("article", "ops-flight-item");
            const left = node("div");
            const route = node("div", "ops-flight-route");
            const origin = node("div", "ops-airport");
            origin.append(node("strong", "", plan.departureIcao), node("small", "", "DEPARTURE"));
            const line = node("span", "ops-route-line");
            const destination = node("div", "ops-airport");
            destination.append(node("strong", "", plan.arrivalIcao), node("small", "", "ARRIVAL"));
            route.append(origin, line, destination);
            const meta = node("div", "ops-flight-meta");
            meta.append(
                node("span", "", dateTime(plan.scheduledDeparture)),
                node("span", "", plan.aircraft || "Aircraft TBC"),
                node("span", "", duration(plan.estimatedDurationMinutes)),
                node("span", "", (Number(plan.pilotCount || 0) + " / " + Number(plan.capacity || 1) + " pilot slots")),
                node("span", "", plan.pilotName ? "Lead pilot: " + plan.pilotName : "Pilot open")
            );
            left.append(route, meta);

            const actions = node("div", "ops-flight-actions");
            actions.append(node("span", "ops-flight-number", plan.flightNumber));
            const status = node("span", "ops-pill" + (plan.status === "boarding" ? " boarding" : ""), plan.status === "boarding" ? "Boarding" : "Planned");
            actions.appendChild(status);
            if (localToken()) {
                let actionLabel = "Join flight";
                let actionMethod = "POST";
                let actionDisabled = false;
                if (plan.status !== "planned") {
                    actionLabel = plan.status === "boarding" ? "Boarding in progress" : "Unavailable";
                    actionDisabled = true;
                } else if (plan.assignedToMe) {
                    actionLabel = "Release assignment";
                    actionMethod = "DELETE";
                } else if (plan.full || Number(plan.pilotCount || 0) >= Number(plan.capacity || 1)) {
                    actionLabel = "Fully assigned";
                    actionDisabled = true;
                }
                const button = node("button", "ops-claim-button", actionLabel);
                button.type = "button";
                button.disabled = actionDisabled;
                if (!actionDisabled) {
                    button.addEventListener("click", async () => {
                        button.disabled = true;
                        button.textContent = "Saving…";
                        try {
                            await request("/operations/flight-plans/" + encodeURIComponent(plan.id) + "/claim", { method: actionMethod }, "pilot");
                            await loadSummary();
                        } catch (error) {
                            button.disabled = false;
                            button.textContent = error.message;
                            window.setTimeout(() => { button.textContent = actionLabel; }, 3200);
                        }
                    });
                }
                actions.appendChild(button);
            } else {
                const signIn = node("a", "ops-claim-button", "Pilot sign in");
                signIn.href = "ranking.html";
                actions.appendChild(signIn);
            }
            card.append(left, actions);
            root.appendChild(card);
        });
    }

    async function loadStaffWorkspace() {
        if (!adminToken()) return;
        try {
            const session = await request("/platform/admin/session", {}, "admin");
            const permissions = session.permissions || [];
            const canManage = session.role === "super_admin" || session.role === "admin" ||
                session.role === "operations_manager" || permissions.includes("*") || permissions.includes("operations.write");
            if (!canManage) return;

            $("#opsStaffPanel").hidden = false;
            $("#opsRoleLabel").textContent = (session.role || "Operations staff").replace(/_/g, " ");
            await loadStaffPlans();
            await loadRecentFlights();
        } catch (_error) {
            // Visitors and pilots without operations permissions keep the public view.
        }
    }

    function renderActualFlights(flights) {
        const root = $("#recentFlights");
        root.replaceChildren();
        if (!flights.length) {
            root.appendChild(node("div", "ops-empty", "No completed flight records have been imported yet."));
            return;
        }
        flights.forEach((flight) => {
            const card = node("article", "ops-actual-item");
            const hours = Number(flight.durationHours || 0);
            const hoursText = hours > 0 ? (Math.round(hours * 100) / 100) + " h" : "Duration not supplied";
            const distanceText = Number(flight.distanceNm || 0) > 0 ? " · " + Math.round(flight.distanceNm).toLocaleString("en-GB") + " nm" : "";
            card.append(
                node("strong", "", (flight.departure || "----") + " → " + (flight.arrival || "----")),
                node("small", "", (flight.pilotName || "Echo pilot") + " · " + (flight.aircraft || "Aircraft not supplied")),
                node("small", "", dateTime(flight.departureTime) + " · " + hoursText + distanceText)
            );
            root.appendChild(card);
        });
    }

    async function loadStaffPlans() {
        const root = $("#staffPlanList");
        try {
            const data = await request("/platform/operations/flight-plans", {}, "admin");
            root.replaceChildren();
            if (!(data.plans || []).length) {
                root.appendChild(node("div", "ops-empty", "No flight plans have been created."));
                return;
            }
            data.plans.forEach((plan) => {
                const row = node("div", "ops-staff-plan");
                const info = node("div");
                info.append(
                    node("strong", "", plan.flight_number + " · " + plan.departure_icao + " → " + plan.arrival_icao),
                    node("small", "", dateTime(plan.scheduled_departure) + " · " + Number(plan.pilot_count || 0) + " / " + Number(plan.capacity || 1) + " pilots · " + (plan.pilot_name || "No lead pilot") + " · " + (plan.published ? "Published" : "Draft"))
                );
                const actions = node("div", "ops-staff-plan-actions");
                const edit = node("button", "", "Edit");
                edit.type = "button";
                edit.addEventListener("click", () => fillPlanForm(plan));
                const cancel = node("button", "danger", "Cancel");
                cancel.type = "button";
                cancel.disabled = plan.status === "cancelled";
                cancel.addEventListener("click", async () => {
                    if (!window.confirm("Cancel " + plan.flight_number + "? The plan will be unpublished and retained for the audit trail.")) return;
                    try {
                        await request("/platform/operations/flight-plans/" + plan.id, { method: "DELETE" }, "admin");
                        await loadStaffPlans();
                        await loadSummary();
                    } catch (error) {
                        window.alert(error.message);
                    }
                });
                actions.append(edit, cancel);
                row.append(info, actions);
                root.appendChild(row);
            });
        } catch (error) {
            root.replaceChildren(node("div", "ops-empty", error.message));
        }
    }

    function fillPlanForm(plan) {
        editingPlanId = Number(plan.id);
        const form = $("#planForm");
        form.elements.flightNumber.value = plan.flight_number || "";
        form.elements.aircraft.value = plan.aircraft || "";
        form.elements.departureIcao.value = plan.departure_icao || "";
        form.elements.arrivalIcao.value = plan.arrival_icao || "";
        const date = new Date(plan.scheduled_departure);
        form.elements.scheduledDeparture.value = Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        form.elements.estimatedDurationMinutes.value = plan.estimated_duration_minutes || 60;
        form.elements.callsign.value = plan.callsign || "";
        form.elements.capacity.value = plan.capacity || 1;
        form.elements.status.value = plan.status || "planned";
        form.elements.notes.value = plan.notes || "";
        form.elements.published.checked = plan.published === true;
        $("#planFormTitle").textContent = "Edit flight plan";
        $("#savePlanButton").textContent = "Save changes";
        $("#cancelPlanEdit").hidden = false;
        $("#planForm").scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function resetPlanForm() {
        editingPlanId = null;
        $("#planForm").reset();
        $("#planForm").elements.estimatedDurationMinutes.value = 90;
        $("#planForm").elements.capacity.value = 1;
        $("#planForm").elements.status.value = "planned";
        $("#planForm").elements.published.checked = true;
        $("#planFormTitle").textContent = "Publish a flight plan";
        $("#savePlanButton").textContent = "Publish flight plan";
        $("#cancelPlanEdit").hidden = true;
        setStatus($("#planFormStatus"), "");
    }

    function wirePlanForm() {
        const form = $("#planForm");
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const fields = new FormData(form);
            const localDate = fields.get("scheduledDeparture");
            const date = new Date(localDate);
            const body = {
                flightNumber: fields.get("flightNumber"),
                aircraft: fields.get("aircraft"),
                departureIcao: fields.get("departureIcao"),
                arrivalIcao: fields.get("arrivalIcao"),
                scheduledDeparture: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
                estimatedDurationMinutes: Number(fields.get("estimatedDurationMinutes")),
                callsign: fields.get("callsign"),
                capacity: Number(fields.get("capacity")),
                status: fields.get("status"),
                notes: fields.get("notes"),
                published: form.elements.published.checked
            };
            const button = $("#savePlanButton");
            button.disabled = true;
            setStatus($("#planFormStatus"), "Saving flight plan…");
            try {
                const path = editingPlanId
                    ? "/platform/operations/flight-plans/" + editingPlanId
                    : "/platform/operations/flight-plans";
                await request(path, { method: editingPlanId ? "PATCH" : "POST", body: JSON.stringify(body) }, "admin");
                setStatus($("#planFormStatus"), editingPlanId ? "Flight plan updated." : "Flight plan published.");
                resetPlanForm();
                await loadStaffPlans();
                await loadSummary();
            } catch (error) {
                setStatus($("#planFormStatus"), error.message, true);
            } finally {
                button.disabled = false;
            }
        });
        $("#cancelPlanEdit").addEventListener("click", resetPlanForm);
        $("#refreshSchedule").addEventListener("click", async () => {
            try { await loadSummary(); } catch (error) { $("#flightPlans").replaceChildren(node("div", "ops-empty", error.message)); }
        });
    }

    async function init() {
        wirePlanForm();
        try {
            await loadSummary();
        } catch (error) {
            $("#opsStats").replaceChildren(node("div", "ops-empty", error.message));
            $("#flightPlans").replaceChildren(node("div", "ops-empty", "The schedule could not be loaded. Please try again later."));
        }
        await loadStaffWorkspace();
    }

    init();
})();