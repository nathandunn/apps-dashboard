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

  function sortApps(apps) {
    return apps.slice().sort(function (a, b) {
      return (STATUS_ORDER[a.status] == null ? 9 : STATUS_ORDER[a.status]) -
             (STATUS_ORDER[b.status] == null ? 9 : STATUS_ORDER[b.status]) ||
             a.name.localeCompare(b.name);
    });
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
        : '<span class="mute">private repo</span>']
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
  function rowHTML(a) {
    var id = 'd-' + esc(a.slug);
    var live = !!a.url;
    return '<article class="row" data-slug="' + esc(a.slug) + '">' +
      '<div class="head">' +
        '<button class="rowbtn" type="button" aria-expanded="false" aria-controls="' + id + '">' +
          '<span class="chev" aria-hidden="true"></span>' +
          '<span class="text">' +
            '<span class="top"><span class="name">' + esc(a.name) + '</span>' +
            '<span class="badge ' + esc(a.status) + '">' + esc(a.status) + '</span></span>' +
            '<span class="desc">' + esc(oneLine(a)) + '</span>' +
          '</span>' +
        '</button>' +
        '<a class="open" href="' + esc(a.url || '#') + '"' +
          (live ? '' : ' aria-disabled="true" tabindex="-1"') +
          ' aria-label="Open ' + esc(a.name) + '">' + (live ? 'Open' : 'Soon') + '</a>' +
      '</div>' +
      '<div class="detail" id="' + id + '" hidden>' + detailHTML(a) + '</div>' +
    '</article>';
  }

  function listHTML(apps) {
    return sortApps(apps).map(rowHTML).join('');
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
  function wire(root) {
    root.addEventListener('click', function (ev) {
      var what = classify(ev.target);
      if (what === 'link') { ev.stopPropagation(); return; }
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
    return fetch('./apps.json?' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (apps) {
        root.innerHTML = listHTML(apps);
        if (foot) foot.textContent = footText(apps, new Date().toISOString().slice(0, 10));
        wire(root);
        var slug = (global.location && global.location.hash || '').replace(/^#/, '');
        if (slug) {
          var row = root.querySelector('.row[data-slug="' + slug.replace(/"/g, '') + '"]');
          if (row) { setExpanded(row, true); row.scrollIntoView({ block: 'center' }); }
        }
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
    sortApps: sortApps,
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
