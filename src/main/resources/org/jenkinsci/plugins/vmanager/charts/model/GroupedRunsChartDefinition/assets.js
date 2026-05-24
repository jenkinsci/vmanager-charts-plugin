/*
 * Custom combobox UI for the Grouped Runs "Group-by attribute" field.
 *
 * Jenkins' default combobox2 dropdown closes/hides as soon as the user
 * clicks into the input — and the items are sourced from a tippy-managed
 * popup that is awkward to coerce into "open on focus, stay open while
 * typing, show a scrollbar". We replace it with a small popover that:
 *
 *   - Opens immediately when the input gains focus / is clicked.
 *   - Filters case-insensitively by substring as the user types.
 *   - Always shows a vertical scrollbar when the list is long.
 *   - Closes on Escape, on blur, or when an item is picked.
 *
 * The item list is captured from the JSON response of the Stapler
 * fillUrl (the URL ends in /GroupByAttributeItems and is requested by
 * combobox2). We intercept window.fetch to keep the list in memory.
 */
(function () {
    if (window.__vmpGroupedRunsComboPatched) return;
    window.__vmpGroupedRunsComboPatched = true;

    var items = [];   // string[]
    var loaded = false;

    var origFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = (typeof input === 'string') ? input
                : (input && input.url) ? input.url : '';
        var p = origFetch.apply(this, arguments);
        if (url && url.indexOf('GroupByAttributeItems') >= 0) {
            p = p.then(function (rsp) {
                try {
                    var clone = rsp.clone();
                    clone.json().then(function (j) {
                        var arr = Array.isArray(j) ? j
                                : (j && Array.isArray(j.values)) ? j.values
                                : [];
                        items = arr.map(function (it) {
                            return (typeof it === 'string') ? it
                                 : (it && it.name) ? it.name : String(it);
                        });
                        loaded = true;
                        scheduleAttach();
                    }).catch(function () {});
                } catch (e) { /* ignore */ }
                return rsp;
            });
        }
        return p;
    };

    var attachTimer;
    function scheduleAttach() {
        clearTimeout(attachTimer);
        attachTimer = setTimeout(attachAll, 50);
    }

    function attachAll() {
        document.querySelectorAll('input.combobox2').forEach(function (input) {
            if (input.__vmpGroupedAttached) return;
            if (!/groupByAttribute$/.test(input.name || '')) return;
            input.__vmpGroupedAttached = true;
            install(input);
        });
    }

    function install(input) {
        // Suppress Jenkins' own combobox2 popup so we don't get two dropdowns.
        var realDropdown = null;
        Object.defineProperty(input, 'dropdown', {
            configurable: true,
            get: function () { return realDropdown; },
            set: function (v) {
                realDropdown = v;
                if (v && typeof v.show === 'function' && !v.__vmpMuted) {
                    v.__vmpMuted = true;
                    v.show = function () { /* suppressed — we render our own */ };
                }
            }
        });

        var menu = null;

        function ensureMenu() {
            if (menu) return menu;
            menu = document.createElement('div');
            menu.className = 'vmp-grouped-combo-menu';
            menu.style.position = 'fixed';
            menu.style.zIndex = '10050';
            menu.style.background = 'var(--card-background, #fff)';
            menu.style.color = 'var(--text-color, #000)';
            menu.style.border = '1px solid var(--card-border-color, #ccc)';
            menu.style.borderRadius = '6px';
            menu.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
            menu.style.maxHeight = '320px';
            menu.style.overflowY = 'auto';
            menu.style.fontSize = '0.85rem';
            menu.style.minWidth = '320px';
            menu.style.padding = '4px 0';
            document.body.appendChild(menu);
            return menu;
        }

        function hide() {
            if (menu) menu.style.display = 'none';
        }

        function position() {
            if (!menu) return;
            var r = input.getBoundingClientRect();
            menu.style.left = r.left + 'px';
            menu.style.top  = (r.bottom + 2) + 'px';
            menu.style.width = Math.max(r.width, 360) + 'px';
        }

        function render() {
            ensureMenu();
            menu.innerHTML = '';
            var term = (input.value || '').trim().toLowerCase();
            var matches = term
                ? items.filter(function (s) { return s.toLowerCase().indexOf(term) >= 0; })
                : items.slice();
            if (matches.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = loaded ? 'No matches' : 'Loading\u2026';
                empty.style.padding = '8px 12px';
                empty.style.color = 'var(--text-color-secondary, #888)';
                menu.appendChild(empty);
            } else {
                matches.slice(0, 500).forEach(function (s) {
                    var it = document.createElement('div');
                    it.textContent = s;
                    it.style.padding = '6px 12px';
                    it.style.cursor = 'pointer';
                    it.style.whiteSpace = 'nowrap';
                    it.style.overflow = 'hidden';
                    it.style.textOverflow = 'ellipsis';
                    it.addEventListener('mouseenter', function () {
                        it.style.background = 'var(--item-background--hover, rgba(0,0,0,0.06))';
                    });
                    it.addEventListener('mouseleave', function () {
                        it.style.background = '';
                    });
                    it.addEventListener('mousedown', function (ev) {
                        ev.preventDefault();
                        input.value = s;
                        input.dispatchEvent(new Event('input',  { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        hide();
                    });
                    menu.appendChild(it);
                });
            }
            position();
            menu.style.display = 'block';
        }

        // If the fillUrl hasn't been triggered yet (combobox2 fetches lazily),
        // force a fetch on first focus so the list is available immediately.
        function maybeKickFill() {
            if (loaded) return;
            var url = input.getAttribute('fillUrl');
            if (!url) return;
            try {
                var body = new URLSearchParams();
                // Include the values the descriptor depends on so Stapler
                // routes them correctly when @QueryParameter reads them.
                input.getAttribute('fillDependsOn')
                     && input.getAttribute('fillDependsOn').split(/\s+/).forEach(function (depPath) {
                    var name = depPath.split('/').pop();
                    var depInput = findDependency(input, depPath);
                    body.append(name, depInput ? (depInput.value || '') : '');
                });
                origFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body.toString()
                });
            } catch (e) { /* ignore */ }
        }

        function findDependency(fromInput, relPath) {
            // depPath like "../serverUrl". Walk up by '..' segments from the
            // input's form/repeated-chunk ancestor; then look for a matching name.
            var parts = relPath.split('/');
            var name  = parts.pop();
            var node  = fromInput;
            for (var i = 0; i < parts.length; i++) {
                if (parts[i] === '..') {
                    node = node && node.closest('.repeated-chunk, .jenkins-form-item, form');
                    if (node) node = node.parentElement;
                }
            }
            if (!node) node = document;
            return node.querySelector('[name$="' + name + '"]')
                || document.querySelector('[name$="' + name + '"]');
        }

        input.addEventListener('focus', function () { maybeKickFill(); render(); });
        input.addEventListener('click', function () { maybeKickFill(); render(); });
        input.addEventListener('input', render);
        input.addEventListener('blur',  function () { setTimeout(hide, 180); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') hide();
        });

        window.addEventListener('scroll', function () {
            if (menu && menu.style.display !== 'none') position();
        }, true);
        window.addEventListener('resize', function () {
            if (menu && menu.style.display !== 'none') position();
        });
    }

    // First pass: in case the list was preloaded by another row.
    document.addEventListener('DOMContentLoaded', attachAll);
    // Re-attach when repeatable rows are added.
    var mo = new MutationObserver(scheduleAttach);
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // ─────────────────────────────────────────────────────────────────────
    // Multi-select dropdown for the Statuses field.
    //
    // The underlying input is a textbox that stores a CSV (e.g.
    // "passed,failed"). For each such input we hide it and render a
    // pill-style button that opens a popover with one checkbox per status
    // (the full list is in a sibling hidden input ".vmp-status-filters-all"
    // serialized as Java's List.toString(): "[a, b, c]"). Selecting boxes
    // updates the CSV on the textbox in real time so form submission picks
    // up the user's choice.
    // ─────────────────────────────────────────────────────────────────────

    function scheduleAttachStatuses() {
        clearTimeout(attachTimer);
        attachTimer = setTimeout(function () { attachAll(); attachStatusFilters(); }, 50);
    }

    function attachStatusFilters() {
        document.querySelectorAll('input.vmp-status-filters').forEach(function (input) {
            if (input.__vmpStatusAttached) return;
            input.__vmpStatusAttached = true;
            installStatusMultiSelect(input);
        });
    }

    function parseAllStatuses(raw) {
        if (!raw) return [];
        // Java's AbstractCollection.toString() format: "[a, b, c]"
        var s = String(raw).trim();
        if (s.startsWith('[') && s.endsWith(']')) s = s.substring(1, s.length - 1);
        return s.split(',').map(function (x) { return x.trim(); })
                .filter(function (x) { return x.length > 0; });
    }

    function csvSelected(input) {
        return (input.value || '').split(',')
                .map(function (s) { return s.trim().toLowerCase(); })
                .filter(function (s) { return s.length > 0; });
    }

    function installStatusMultiSelect(input) {
        // Locate the sibling hidden input holding the full status list.
        var wrap = input.closest('.jenkins-form-item, .setting-main') || input.parentElement;
        var allEl = wrap ? wrap.querySelector('.vmp-status-filters-all') : null;
        var all = parseAllStatuses(allEl ? allEl.value : '');
        if (all.length === 0) {
            // Fallback so the widget still renders something usable.
            all = ['running','finished','other','waiting','stopped','passed','failed'];
        }

        // Hide the raw textbox; we drive its value from the popover.
        input.style.display = 'none';

        // Create the trigger button.
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vmp-status-filters-btn jenkins-button';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '6px';
        btn.style.width = '100%';
        btn.style.maxWidth = '100%';
        btn.style.boxSizing = 'border-box';
        btn.style.justifyContent = 'space-between';
        btn.style.padding = '4px 10px';
        btn.style.border = '1px solid var(--card-border-color, #ccc)';
        btn.style.borderRadius = '6px';
        btn.style.background = 'var(--input-background, #fff)';
        btn.style.color = 'var(--text-color, #000)';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '0.85rem';
        btn.style.overflow = 'hidden';
        btn.style.whiteSpace = 'nowrap';
        btn.style.textOverflow = 'ellipsis';
        input.parentNode.insertBefore(btn, input.nextSibling);

        function updateLabel() {
            var sel = csvSelected(input);
            var label = sel.length === 0 ? 'All statuses'
                      : sel.length === all.length ? 'All statuses'
                      : sel.length <= 2 ? sel.join(', ')
                      : sel.length + ' selected';
            btn.innerHTML = '<span>' + escapeHtml(label) + '</span><span style="opacity:0.6;">\u25BE</span>';
        }
        function escapeHtml(s) {
            return String(s).replace(/[&<>]/g, function (c) {
                return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
            });
        }
        updateLabel();

        var menu = null;
        function ensureMenu() {
            if (menu) return menu;
            menu = document.createElement('div');
            menu.className = 'vmp-status-menu';
            menu.style.position = 'fixed';
            menu.style.zIndex = '10050';
            menu.style.background = 'var(--card-background, #fff)';
            menu.style.color = 'var(--text-color, #000)';
            menu.style.border = '1px solid var(--card-border-color, #ccc)';
            menu.style.borderRadius = '6px';
            menu.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
            menu.style.maxHeight = '320px';
            menu.style.overflowY = 'auto';
            menu.style.fontSize = '0.85rem';
            menu.style.minWidth = '180px';
            menu.style.padding = '4px 0';
            document.body.appendChild(menu);
            return menu;
        }
        function hideMenu() { if (menu) menu.style.display = 'none'; }
        function position() {
            if (!menu) return;
            var r = btn.getBoundingClientRect();
            menu.style.left = r.left + 'px';
            menu.style.top  = (r.bottom + 2) + 'px';
            menu.style.width = Math.max(r.width, 200) + 'px';
        }

        function render() {
            ensureMenu();
            var sel = csvSelected(input);
            menu.innerHTML = '';
            // Header row with select-all / clear shortcuts.
            var hdr = document.createElement('div');
            hdr.style.display = 'flex';
            hdr.style.justifyContent = 'space-between';
            hdr.style.padding = '4px 12px 6px';
            hdr.style.borderBottom = '1px solid var(--card-border-color, #eee)';
            hdr.style.marginBottom = '4px';
            var allBtn = document.createElement('a');
            allBtn.href = '#'; allBtn.textContent = 'Select all';
            allBtn.style.fontSize = '0.75rem';
            allBtn.addEventListener('click', function (e) {
                e.preventDefault();
                input.value = all.join(',');
                input.dispatchEvent(new Event('change', { bubbles: true }));
                updateLabel(); render();
            });
            var noneBtn = document.createElement('a');
            noneBtn.href = '#'; noneBtn.textContent = 'Clear';
            noneBtn.style.fontSize = '0.75rem';
            noneBtn.addEventListener('click', function (e) {
                e.preventDefault();
                input.value = '';
                input.dispatchEvent(new Event('change', { bubbles: true }));
                updateLabel(); render();
            });
            hdr.appendChild(allBtn); hdr.appendChild(noneBtn);
            menu.appendChild(hdr);

            all.forEach(function (status) {
                var row = document.createElement('label');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '8px';
                row.style.padding = '4px 12px';
                row.style.cursor = 'pointer';
                row.addEventListener('mouseenter', function () {
                    row.style.background = 'var(--item-background--hover, rgba(0,0,0,0.06))';
                });
                row.addEventListener('mouseleave', function () { row.style.background = ''; });

                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = sel.indexOf(status) >= 0;
                cb.addEventListener('change', function () {
                    var current = csvSelected(input);
                    if (cb.checked) {
                        if (current.indexOf(status) < 0) current.push(status);
                    } else {
                        current = current.filter(function (s) { return s !== status; });
                    }
                    // Preserve canonical ALL_STATUSES order in the CSV.
                    var ordered = all.filter(function (s) { return current.indexOf(s) >= 0; });
                    input.value = ordered.join(',');
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    updateLabel();
                });

                var txt = document.createElement('span');
                txt.textContent = status;
                row.appendChild(cb); row.appendChild(txt);
                menu.appendChild(row);
            });

            position();
            menu.style.display = 'block';
        }

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            if (menu && menu.style.display === 'block') hideMenu();
            else render();
        });
        document.addEventListener('mousedown', function (ev) {
            if (!menu) return;
            if (menu.style.display !== 'block') return;
            if (btn.contains(ev.target) || menu.contains(ev.target)) return;
            hideMenu();
        });
        window.addEventListener('scroll', function () {
            if (menu && menu.style.display === 'block') position();
        }, true);
        window.addEventListener('resize', function () {
            if (menu && menu.style.display === 'block') position();
        });
    }

    document.addEventListener('DOMContentLoaded', attachStatusFilters);
    // Same MutationObserver will also pick up new repeatable rows for the
    // status filter; trigger an attach when DOM changes.
    new MutationObserver(attachStatusFilters)
        .observe(document.documentElement, { childList: true, subtree: true });
})();
