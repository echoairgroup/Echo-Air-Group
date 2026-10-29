# Website Admin Dashboard

The dashboard is available at `admin.html` on the published website. It supports:
- Creating, editing, publishing, and deleting website items.
- Uploading JPG, PNG, or WebP images (maximum 2 MB each).
- Showing content on one page or across all pages.
- Importing up to 50 website items from a JSON file.
- Updating the Discord invite centrally; website links and the booking QR code refresh from the saved setting.

## One-time backend configuration

The API uses the existing Echo Air Group login and database. Admin access is intentionally disabled until an allowlist is configured.

In the Render dashboard, open the existing `echo-air-group-api` web service and go to **Environment**. Add:

- **Key:** `ADMIN_USERNAMES`
- **Value:** the existing website login username that should be allowed to manage the site. Multiple usernames can be comma-separated.

Save the environment change and let Render redeploy the service. Then open `admin.html` and sign in using that website account. Accounts not listed in `ADMIN_USERNAMES` cannot change website content.

The server creates the `site_items` and `site_settings` tables in the existing Neon PostgreSQL database at startup. Uploaded images are stored in the database; imported JSON items can include an HTTPS `imageUrl`.

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

Supported display targets include `all`, `index.html`, `about.html`, `fleet.html`, `routes.html`, `team.html`, `join.html`, `manual.html`, `contact.html`, `booking.html`, `ranking.html`, `pilot.html`, `manager.html`, `server.html`, `legal.html`, and `privacy.html`.
