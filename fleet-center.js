/* Echo Air Group Fleet Center */
(() => {
    "use strict";

    const cards = Array.from(document.querySelectorAll(".cards > .fcard"));
    const search = document.getElementById("fleetSearch");
    const manufacturer = document.getElementById("fleetManufacturerFilter");
    const mission = document.getElementById("fleetMissionFilter");
    const resultCount = document.getElementById("fleetResultCount");
    if (!cards.length || !search || !manufacturer || !mission) return;

    const normalized = (value) => String(value || "").trim().toLowerCase();
    const dialog = document.createElement("dialog");
    dialog.className = "fleet-dialog";
    dialog.setAttribute("aria-labelledby", "fleetDialogTitle");
    document.body.appendChild(dialog);

    function applyFilters() {
        const query = normalized(search.value);
        const selectedMaker = manufacturer.value;
        const selectedMission = mission.value;
        let shown = 0;

        cards.forEach((card) => {
            const title = card.querySelector("h3");
            const subtitle = card.querySelector(".fcard-sub");
            const badge = card.querySelector(".fcard-badge");
            const specs = card.querySelector(".fcard-specs");
            const searchable = normalized([
                title && title.textContent,
                subtitle && subtitle.textContent,
                badge && badge.textContent,
                specs && specs.textContent
            ].join(" "));

            const makerText = normalized(title && title.textContent);
            const missionText = normalized([
                subtitle && subtitle.textContent,
                badge && badge.textContent
            ].join(" "));
            const matchesQuery = !query || searchable.includes(query);
            const matchesMaker = selectedMaker === "all" || makerText.startsWith(selectedMaker);
            const matchesMission = selectedMission === "all" || missionText.includes(selectedMission);
            const visible = matchesQuery && matchesMaker && matchesMission;

            card.hidden = !visible;
            if (visible) shown++;
        });

        if (resultCount) {
            resultCount.textContent = "Showing " + shown + " of " + cards.length + " aircraft";
        }
    }

    function closeDialog() {
        if (typeof dialog.close === "function" && dialog.open) dialog.close();
    }

    function openDetails(card) {
        const titleNode = card.querySelector("h3");
        const title = titleNode ? titleNode.textContent.trim() : "Aircraft details";
        const imageNode = card.querySelector("img");
        const badgeNode = card.querySelector(".fcard-badge");
        const subtitleNode = card.querySelector(".fcard-sub");
        const specNode = card.querySelector(".fcard-specs");

        dialog.replaceChildren();

        const header = document.createElement("div");
        header.className = "fleet-dialog-header";
        if (imageNode && imageNode.src) {
            const image = document.createElement("img");
            image.className = "fleet-dialog-image";
            image.src = imageNode.src;
            image.alt = imageNode.alt || title;
            image.loading = "eager";
            header.appendChild(image);
        }

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "fleet-dialog-close";
        closeButton.setAttribute("aria-label", "Close aircraft details");
        closeButton.textContent = "×";
        closeButton.addEventListener("click", closeDialog);
        header.appendChild(closeButton);

        const heading = document.createElement("div");
        heading.className = "fleet-dialog-header-content";
        const eyebrow = document.createElement("div");
        eyebrow.className = "fleet-dialog-eyebrow";
        eyebrow.textContent = badgeNode ? badgeNode.textContent.trim() : "Echo Air Group Fleet";
        const h2 = document.createElement("h2");
        h2.id = "fleetDialogTitle";
        h2.textContent = title;
        heading.append(eyebrow, h2);
        header.appendChild(heading);

        const body = document.createElement("div");
        body.className = "fleet-dialog-body";
        const subtitle = document.createElement("p");
        subtitle.className = "fleet-dialog-subtitle";
        subtitle.textContent = subtitleNode ? subtitleNode.textContent.trim() : "Aircraft information";
        body.appendChild(subtitle);

        if (specNode) {
            const specs = specNode.cloneNode(true);
            specs.classList.add("fleet-dialog-specs");
            body.appendChild(specs);
        }

        const note = document.createElement("p");
        note.className = "fleet-dialog-note";
        note.textContent = "These specifications are indicative. Exact range, seating, engine options and performance vary by aircraft variant and simulator add-on.";
        body.appendChild(note);

        const actions = document.createElement("div");
        actions.className = "fleet-dialog-actions";
        const bookingLink = document.createElement("a");
        bookingLink.href = "booking.html";
        bookingLink.textContent = "Open flight booking";
        const done = document.createElement("button");
        done.type = "button";
        done.textContent = "Close details";
        done.addEventListener("click", closeDialog);
        actions.append(bookingLink, done);
        body.appendChild(actions);

        dialog.append(header, body);
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
    }

    cards.forEach((card) => {
        const info = card.querySelector(".fcard-info");
        if (!info || info.querySelector(".fcard-detail-btn")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "fcard-detail-btn";
        button.textContent = "Explore aircraft →";
        button.addEventListener("click", () => openDetails(card));
        info.appendChild(button);
    });

    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("cancel", () => {
        if (!dialog.open) dialog.removeAttribute("open");
    });
    search.addEventListener("input", applyFilters);
    manufacturer.addEventListener("change", applyFilters);
    mission.addEventListener("change", applyFilters);
    applyFilters();
})();
