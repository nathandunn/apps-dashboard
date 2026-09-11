# apps-dashboard

Static index for https://apps.precogsoftwareservices.com — one clickable row per app.

Three files, no build step and no dependencies: the hub runs `nginx:alpine` with this
repo bind-mounted read-only at `/usr/share/nginx/html`, so a push plus a pull on the hub
is the deploy.

- `apps.json` — the data. Add or update an app here.
  - `short` is the one line shown in the row; `desc` is the full blurb shown when the row
    is expanded. An entry with no `short` falls back to `desc`.
- `index.html` — markup and styles (`:root` holds the palette constants).
- `app.js` — list rendering and the row/detail interaction, as a plain browser script.

Each row expands in place to show the full description, tags, status, the live URL and the
GitHub link. The whole row is the tap target for that detail; the **Open** button is a
separate tap target that goes straight to the app. `#<slug>` on the URL opens that row.

## Checks

    node scripts/smoke.mjs        # 222 assertions against the real app.js — no deps
    scripts/verify-links.sh       # curls the live page and all 11 Open links for 200

Do not add a `package.json` here: `/opt/scripts/deploy.sh` branches on it and would switch
this app from the plain-static bind mount to a `npm run build` + `dist` image, which this
repo has no build to satisfy. `scripts/smoke.mjs` is dependency-free for that reason.
