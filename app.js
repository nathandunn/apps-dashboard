/* apps-dashboard — list rendering and row/detail interaction.
 *
 * Plain browser script, no modules and no build step: the container is an
 * nginx:alpine serving this repo directly off a read-only bind mount, so
 * anything the page needs has to be a file sitting next to index.html.
 * Everything here is also loadable in node (scripts/smoke.mjs evaluates this
 * file and calls the same functions the browser calls), which is why the
 * render helpers return strings and the click logic is a pure classifier.
 */
(function (global) {
  'use strict';

  var STATUS_ORDER = { live: 0, building: 1, planned: 2 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var PIN_COOKIE = 'pinned';
  var PIN_MAX_AGE = 60 * 60 * 24 * 365 * 5;

  /* Last-updated time in ms: the `updated` stamp in apps.json (the repo's
     last commit when the entry was written), raised to the repo's live
     pushed_at once GitHub answers. No date sorts last. */
  function updatedOf(a) {
    var t = a && a.updated ? Date.parse(a.updated) : NaN;
    return isNaN(t) ? 0 : t;
  }

  function pinSet(pinned) {
    var set = {};
    (pinned || []).forEach(function (s) { set[s] = true; });
    return set;
  }

  /* Pinned apps first, then everything else. Within each group: most
     recently updated first, then by name. */
  function sortApps(apps, pinned) {
    var pins = pinSet(pinned);
    return apps.slice().sort(function (a, b) {
      return (pins[b.slug] ? 1 : 0) - (pins[a.slug] ? 1 : 0) ||
             updatedOf(b) - updatedOf(a) ||
             a.name.localeCompare(b.name);
    });
  }

  /* --- pins live in a cookie: pinned=slug1,slug2 ------------------------- */
  function readPins(cookie) {
    var m = String(cookie || '').match(/(?:^|;\s*)pinned=([^;]*)/);
    if (!m) return [];
    return decodeURIComponent(m[1]).split(',').filter(function (s) {
      return /^[a-z0-9][a-z0-9-]*$/.test(s);
    });
  }

  function pinCookie(pinned) {
    return PIN_COOKIE + '=' + encodeURIComponent((pinned || []).join(',')) +
      '; Path=/; Max-Age=' + PIN_MAX_AGE + '; SameSite=Lax; Secure';
  }

  function togglePin(pinned, slug) {
    var out = (pinned || []).filter(function (s) { return s !== slug; });
    if (out.length === (pinned || []).length) out.push(slug);
    return out;
  }

  /* "5m ago", "3h ago", "12d ago", else "Sep 9" / "Sep 9 2025". */
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function ago(t, now) {
    if (!t) return '';
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    var d = new Date(t), n = new Date(now);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() +
      (d.getUTCFullYear() === n.getUTCFullYear() ? '' : ' ' + d.getUTCFullYear());
  }

  /* Fold GitHub's repo list (pushed_at) into the entries. Only ever moves a
     date forward, and returns whether anything changed. */
  function mergeGitHub(apps, repos) {
    var pushed = {};
    (repos || []).forEach(function (r) {
      if (r && r.html_url && r.pushed_at) pushed[r.html_url.toLowerCase()] = r.pushed_at;
    });
    var changed = false;
    apps.forEach(function (a) {
      var p = a.repo && pushed[a.repo.toLowerCase().replace(/\/+$/, '')];
      if (p && Date.parse(p) > updatedOf(a)) { a.updated = p; changed = true; }
    });
    return changed;
  }

  function githubOwners(apps) {
    var seen = {};
    apps.forEach(function (a) {
      var m = a.repo && a.repo.match(/^https:\/\/github\.com\/([^\/]+)\//i);
      if (m) seen[m[1]] = true;
    });
    return Object.keys(seen);
  }

  /* The one-liner for the row. `short` is authored per app; an entry added
     without one falls back to its full blurb rather than rendering blank. */
  function oneLine(a) {
    return a.short || a.desc || '';
  }

  function tagsHTML(a) {
    return (a.tags || []).map(function (t) {
      return '<span class="tag">' + esc(t) + '</span>';
    }).join('');
  }

  /* Detail carries only what apps.json already holds: the full blurb, tags,
     status, the live URL and the source link. No invented fields. */
  function detailHTML(a) {
    var rows = [
      ['Status', '<span class="badge ' + esc(a.status) + '">' + esc(a.status) + '</span>'],
      ['Link', a.url
        ? '<a class="meta-link" href="' + esc(a.url) + '">' + esc(a.url.replace(/^https?:\/\//, '')) + '</a>'
        : '<span class="mute">not yet live</span>'],
      ['Source', a.repo
        ? '<a class="meta-link" href="' + esc(a.repo) + '">' + esc(a.repo.replace(/^https?:\/\/(www\.)?github\.com\//, 'github.com/')) + '</a>'
        : '<span class="mute">private repo</span>'],
      ['Updated', a.updated
        ? '<time datetime="' + esc(a.updated) + '">' + esc(String(a.updated).replace('T', ' ').replace(/:\d\dZ?$/, '').replace(/Z$/, '')) + ' UTC</time>'
        : '<span class="mute">unknown</span>']
    ];
    return '<div class="detail-inner">' +
      (a.desc ? '<p class="full">' + esc(a.desc) + '</p>' : '') +
      (a.tags && a.tags.length ? '<div class="tags">' + tagsHTML(a) + '</div>' : '') +
      '<dl class="meta">' + rows.map(function (r) {
        return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
      }).join('') + '</dl>' +
      '</div>';
  }

  /* One row: a full-width button that owns the detail toggle, and an "Open"
     anchor beside it — siblings, never nested, so a tap on Open is never also
     a tap on the toggle. */
  var PIN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M14.5 2.5l7 7-2.2.8-3.8 3.8.9 5.4-1.9 1.9-4.2-4.2-5.3 5.3-1.5-1.5 5.3-5.3-4.2-4.2 1.9-1.9 5.4.9 3.8-3.8z"/></svg>';

  function rowHTML(a, pinned, now) {
    var id = 'd-' + esc(a.slug);
    var live = !!a.url;
    var when = ago(updatedOf(a), now == null ? Date.now() : now);
    return '<article class="row' + (pinned ? ' pinned' : '') + '" data-slug="' + esc(a.slug) + '">' +
      '<div class="head">' +
        '<button class="rowbtn" type="button" aria-expanded="false" aria-controls="' + id + '">' +
          '<span class="chev" aria-hidden="true"></span>' +
          '<span class="text">' +
            '<span class="top"><span class="name">' + esc(a.name) + '</span>' +
            '<span class="badge ' + esc(a.status) + '">' + esc(a.status) + '</span>' +
            (a.new ? '<span class="badge new">new</span>' : '') +
            (when ? '<span class="when">' + esc(when) + '</span>' : '') + '</span>' +
            '<span class="desc">' + esc(oneLine(a)) + '</span>' +
          '</span>' +
        '</button>' +
        '<div class="actions">' +
          '<button class="pin" type="button" aria-pressed="' + (pinned ? 'true' : 'false') + '"' +
            ' aria-label="' + (pinned ? 'Unpin ' : 'Pin ') + esc(a.name) + '"' +
            ' title="' + (pinned ? 'Unpin' : 'Pin to top') + '">' + PIN_SVG + '</button>' +
          '<a class="open" href="' + esc(a.url || '#') + '"' +
            (live ? '' : ' aria-disabled="true" tabindex="-1"') +
            ' aria-label="Open ' + esc(a.name) + '">' + (live ? 'Open' : 'Soon') + '</a>' +
        '</div>' +
      '</div>' +
      '<div class="detail" id="' + id + '" hidden>' + detailHTML(a) + '</div>' +
    '</article>';
  }

  function listHTML(apps, pinned, now) {
    var pins = pinSet(pinned);
    return sortApps(apps, pinned).map(function (a) {
      return rowHTML(a, !!pins[a.slug], now);
    }).join('');
  }

  function footText(apps, today) {
    var live = apps.filter(function (a) { return a.status === 'live'; }).length;
    var building = apps.filter(function (a) { return a.status === 'building'; }).length;
    return live + ' live · ' + building + ' building · ' +
      (apps.length - live - building) + ' planned · updated ' + today;
  }

  function closest(el, test) {
    while (el) {
      if (test(el)) return el;
      el = el.parentElement || el.parentNode || null;
    }
    return null;
  }

  function hasClass(el, c) {
    return !!(el && el.classList && el.classList.contains(c));
  }

  function isTag(el, t) {
    return !!(el && el.tagName && el.tagName.toUpperCase() === t);
  }

  /* What a click on `el` means. Links win outright: "Open" (and the links in
     the detail) must never also toggle the row. */
  function classify(el) {
    if (closest(el, function (n) { return hasClass(n, 'pin'); })) return 'pin';
    if (closest(el, function (n) { return isTag(n, 'A'); })) return 'link';
    if (closest(el, function (n) { return hasClass(n, 'row'); })) return 'toggle';
    return null;
  }

  function rowOf(el) {
    return closest(el, function (n) { return hasClass(n, 'row'); });
  }

  function setExpanded(row, open) {
    var btn = row.querySelector('.rowbtn');
    var detail = row.querySelector('.detail');
    if (open) row.classList.add('open'); else row.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (detail) detail.hidden = !open;
    return open;
  }

  function toggle(row) {
    return setExpanded(row, !(row.classList && row.classList.contains('open')));
  }

  /* One delegated listener on the list, so the whole row — padding included —
     is the tap target for detail. */
  function wire(root, onPin) {
    root.addEventListener('click', function (ev) {
      var what = classify(ev.target);
      if (what === 'link') { ev.stopPropagation(); return; }
      if (what === 'pin') {
        ev.stopPropagation();
        var r = rowOf(ev.target);
        if (r && onPin) onPin(r.getAttribute('data-slug'));
        return;
      }
      if (what !== 'toggle') return;
      var row = rowOf(ev.target);
      if (row) toggle(row);
    });
  }

  function init(opts) {
    opts = opts || {};
    var doc = global.document;
    var root = doc.getElementById(opts.listId || 'list');
    var foot = doc.getElementById(opts.footId || 'foot');
    var pinned = readPins(doc.cookie);

    /* Re-render keeping whichever rows were open. */
    function render(apps) {
      var open = {};
      Array.prototype.forEach.call(root.querySelectorAll('.row.open'), function (r) {
        open[r.getAttribute('data-slug')] = true;
      });
      root.innerHTML = listHTML(apps, pinned, Date.now());
      Object.keys(open).forEach(function (s) {
        var r = root.querySelector('.row[data-slug="' + s.replace(/"/g, '') + '"]');
        if (r) setExpanded(r, true);
      });
    }

    return fetch('./apps.json?' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (apps) {
        render(apps);
        if (foot) foot.textContent = footText(apps, new Date().toISOString().slice(0, 10));
        wire(root, function (slug) {
          pinned = togglePin(pinned, slug);
          try { doc.cookie = pinCookie(pinned); } catch (e) { /* cookies blocked: pin lasts this visit */ }
          render(apps);
        });
        var slug = (global.location && global.location.hash || '').replace(/^#/, '');
        if (slug) {
          var row = root.querySelector('.row[data-slug="' + slug.replace(/"/g, '') + '"]');
          if (row) { setExpanded(row, true); row.scrollIntoView({ block: 'center' }); }
        }
        /* Live dates: one public GitHub call per owner. If it fails (offline,
           rate-limited) the stamps in apps.json stand. */
        githubOwners(apps).forEach(function (owner) {
          fetch('https://api.github.com/users/' + encodeURIComponent(owner) + '/repos?per_page=100&sort=pushed')
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (repos) { if (mergeGitHub(apps, repos)) render(apps); })
            .catch(function () {});
        });
        return apps;
      })
      .catch(function (err) {
        root.innerHTML = '<p class="error">Could not load apps.json — ' + esc(err && err.message) + '</p>';
        throw err;
      });
  }

  global.Dashboard = {
    STATUS_ORDER: STATUS_ORDER,
    esc: esc,
    updatedOf: updatedOf,
    sortApps: sortApps,
    readPins: readPins,
    pinCookie: pinCookie,
    togglePin: togglePin,
    ago: ago,
    mergeGitHub: mergeGitHub,
    githubOwners: githubOwners,
    oneLine: oneLine,
    detailHTML: detailHTML,
    rowHTML: rowHTML,
    listHTML: listHTML,
    footText: footText,
    classify: classify,
    rowOf: rowOf,
    setExpanded: setExpanded,
    toggle: toggle,
    wire: wire,
    init: init
  };
})(typeof window !== 'undefined' ? window : globalThis);
