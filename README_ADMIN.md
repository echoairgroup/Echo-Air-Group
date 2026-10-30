# Echo Air Group Admin & Platform

The admin dashboard is available at `admin.html`. It uses the same Echo Air Group pilot login as the Pilot Dashboard.

## Root administrator setup

Admin access is intentionally disabled until at least one root administrator is configured.

In the Render dashboard, open the **production** `Echo-Air-Group-api` service and go to **Environment**. Configure:

- **Key:** `ADMIN_USERNAMES`
- **Value:** one or more existing Echo pilot usernames, separated by commas.

For example: `pilotone,pilottwo,flightlead`. These accounts become root administrators. Each person signs in with their own existing Echo username and password; never share passwords.

Root administrators can open the **Admin roles** section and assign scoped roles to other existing Echo pilot accounts. Each delegated administrator then signs in through `admin.html` with their own Pilot Dashboard credentials. Available roles:

| Role | Access |
|---|---|
| `admin` | Platform overview, system monitoring, operations, fleet, audit, notifications, Academy, website content and application inbox |
| `operations_manager` | Platform overview, live system monitoring, pilot activity, fleet data and audit log |
| `academy_manager` | Academy course management, teaching assessments, examiner reviews and learning overview |
| `academy_instructor` | Review practical training flights and provide instructor feedback |
| `academy_examiner` | Independently verify passed theory exams or require a retake |
| `analyst` | Read-only overview, monitoring, pilot activity, fleet and audit log |
| `viewer` | Read-only overview, operations, fleet and Academy |

The root username allowlist is the bootstrap mechanism. Do not remove the final root administrator until another root account has been configured.

## Platform modules

- **Live system status:** backend process, Neon database, Discord bot and NewSky synchronization status.
- **Fleet intelligence:** aircraft seen in imported NewSky flight records. Registration and activity are automatically derived. Home base is inferred from the most frequent departure airport in the last 180 days.
- **Pilot activity:** shows each pilot's imported flight count, most recent flight and whether they flew during the last 30 days.
- **Routes flown:** historical map and flight list for imported flights in the last 30 days.
- **Audit log:** records successful administrator changes, actor, action and timestamp. It avoids storing passwords or applicant form contents.
- **Notifications:** lets administrators create and manage operational notices.
- **Pilot profiles:** pilots can edit their public display name, profile photo and short bio. Flight totals, rank and achievements are calculated from imported NewSky records and cannot be edited manually.
- **Pilot achievements:** badges are awarded automatically for flight milestones, hours, distance, routes, airports, aircraft variety and consistent ratings. Public profiles compare each pilot with nearby leaderboard positions.
- **Aviation Academy:** existing pilot accounts can complete interactive lessons and theory exams, record a NewSky-linked practice flight, track personal progress and earn certificates. A theory pass must be verified by an authorised examiner before the course certificate is issued. An instructor reviews practical flight logs and records feedback. There is no separate Academy account.

### NewSky data limitations

Fleet information is generated from aircraft actually present in imported NewSky flight records. NewSky's published API currently marks its fleet scope as not used, so aircraft that have never appeared in imported flights cannot be discovered through that API. Aircraft types are shown only when present or safely recognizable in source data. Photographs are optional external lookups by known registration; when no reliable photograph is available the aircraft card remains usable without one. The displayed home base is an inference, not an official airline assignment.

The route map uses completed/imported flights with both departure and arrival identifiers. It is historical activity, not live aircraft tracking. All activity calculations are based on the data already synchronized into the Echo database.


## Operations Center and Community

The website now includes two linked modules, available from the shared navigation:

- **Operations Center:** public counts for NewSky-imported flights, the published operations schedule, pilot self-assignment to an open plan, and staff-only schedule management.
- **Flight planning:** authorised administrators and `operations_manager` staff can create, edit, publish and cancel planned flights. Plans remain separate from imported completed-flight records; a plan never increments a pilot's actual flight totals.
- **Community calendar:** pilots can RSVP as attending or interested, review their own registrations and cancel an RSVP. Event capacity is enforced on the server.
- **Event management:** administrators and `operations_manager` staff can publish, edit and delete events. Event changes are written to the platform audit log.
- **Announcements:** the Community page combines active platform notices with published News and Announcement content items.

Live aircraft positions are intentionally marked unavailable until a real telemetry provider is configured. The Operations Center does not invent coordinates or treat planned flights as active flights.

## Website content management

The existing Website Content tools remain available to root administrators and delegated `admin` accounts:

- Create, edit, publish and delete website items.
- Upload JPG, PNG or WebP images (maximum 2 MB each).
- Show content on one page or across all pages.
- Import up to 50 website items from a JSON file.
- Update the Discord invite centrally; website links and the booking QR code refresh from the saved setting.

The server creates the `site_items` and `site_settings` tables in Neon at startup. Uploaded images are stored in the database; imported JSON items can include an HTTPS `imageUrl`.

## Applications inbox & Forminit

Pilot and manager application forms keep their existing visual layout and fields. Their submission is sent to Forminit using form ID `lzhwmmwkoq5` and is also copied to the private Neon Applications inbox when the API is available.

For browser submissions, the Forminit form must be set to **Public** authentication mode. Configure the Forminit field blocks to match the existing form fields; the website maps sender fields (first name, last name and email) and text, select, number, phone and URL fields to Forminit's documented `fi-*` names.

New submissions appear in the Applications tab. The inbox supports search, filtering by type and status, viewing submitted answers, private admin notes, status updates, deletion and CSV export. Keep access restricted because application data is personal information.

Only submissions made after the Forminit and inbox integration is deployed are captured in this dashboard. Historical FormSubmit emails are not automatically imported.

## JSON import shape

```json
{
  "items": [
    {
      "title": "New route announced",
      "description": "We have added a new route to our network.",
      "category": "route",
      "targetPage": "routes.html",
      "linkUrl": "routes.html",
      "imageUrl": "https://example.com/route.webp",
      "published": true
    }
  ]
}
```

Supported categories: `news`, `aircraft`, `route`, `team`, `announcement`, `gallery`, `other`.

Supported display targets include `all`, `index.html`, `about.html`, `fleet.html`, `routes.html`, `team.html`, `join.html`, `manual.html`, `contact.html`, `booking.html`, `ranking.html`, `pilot.html`, `manager.html`, `server.html`, `legal.html` and `privacy.html`.
