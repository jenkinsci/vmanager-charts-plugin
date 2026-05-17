
(function () {
    if (window.__vmpVPlanPatched2) return;
    window.__vmpVPlanPatched2 = true;

    // Capture items keyed by the row's discriminating param (vPlanType).
    // Multiple chart rows share the same fillUrl base, so we MUST key on
    // vPlanType to avoid one row's list clobbering another's.
    var itemsByType = {};
    function paramFromUrl(url, name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(url || '');
        return m ? decodeURIComponent(m[1]) : '';
    }
    function paramFromBody(body, name) {
        if (!body) return '';
        var s = '';
        try {
            if (typeof body === 'string') s = body;
            else if (body instanceof URLSearchParams) s = body.toString();
            else if (typeof body.toString === 'function') s = body.toString();
        } catch (e) { return ''; }
        var m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(s);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = (typeof input === 'string') ? input
                : (input && input.url) ? input.url : '';
        var p = origFetch.apply(this, arguments);
        if (url.indexOf('VPlanPathItems') >= 0) {
            var vtype = paramFromUrl(url, 'vPlanType')
                     || paramFromBody(init && init.body, 'vPlanType');
            p = p.then(function (rsp) {
                try {
                    var clone = rsp.clone();
                    clone.json().then(function (j) {
                        var arr = Array.isArray(j) ? j
                                : (j && Array.isArray(j.values)) ? j.values
                                : [];
                        var list = arr.map(function (it) {
                            return (typeof it === 'string') ? it
                                 : (it && it.name) ? it.name : String(it);
                        });
                        itemsByType[vtype || ''] = list;
                        scheduleAttach();
                    }).catch(function () {});
                } catch (e) { /* ignore */ }
                return rsp;
            });
        }
        return p;
    };

    function isDbMode(input) {
        var chunk = input.closest('.repeated-chunk') || document;
        var typeSel = chunk.querySelector('select[name$="vPlanType"]');
        return typeSel && typeSel.value === 'DB';
    }

    function attachAll() {
        document.querySelectorAll('input.combobox2').forEach(function (input) {
            if (input.__vmpVPlanAttached) return;
            if (!/vPlanPath$/.test(input.name || '')) return;
            input.__vmpVPlanAttached = true;
            install(input);
        });
        setupVPlanTypeSelects();
    }

    function setupVPlanTypeSelects() {
        document.querySelectorAll('select[name$="vPlanType"]').forEach(function (sel) {
            if (sel.__vmpVPlanTypeSetup) return;
            sel.__vmpVPlanTypeSetup = true;

            var chunk  = sel.closest('.repeated-chunk') || document;
            var input  = chunk.querySelector('input[name$="vPlanPath"]');
            sel.addEventListener('change', function () {
                if (sel.value === 'DB' && input && input.value) {
                    // Clear so the user sees the freshly fetched DB list.
                    input.value = '';
                    input.dispatchEvent(new Event('input',  { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    }

    var attachTimer;
    function scheduleAttach() {
        clearTimeout(attachTimer);
        attachTimer = setTimeout(attachAll, 50);
    }

    function getItems(input) {
        // Find this row's vPlanType select and look up items for THAT type.
        var row = input.closest('.repeated-chunk') || input.closest('.vmp-chart-row') || document;
        var sel = row.querySelector('select[name$="vPlanType"]');
        var vtype = sel ? sel.value : '';
        return itemsByType[vtype] || [];
    }

    function install(input) {
        // Suppress the Jenkins combobox2 native dropdown ג€” we render our own.
        var realDropdown = null;
        Object.defineProperty(input, 'dropdown', {
            configurable: true,
            get: function () { return realDropdown; },
            set: function (v) {
                realDropdown = v;
                if (v && typeof v.show === 'function' && !v.__vmpMuted) {
                    v.__vmpMuted = true;
                    v.show = function () { /* suppressed; custom menu handles UI */ };
                }
            }
        });

        var menu = null;

        function ensureMenu() {
            if (menu) return menu;
            menu = document.createElement('div');
            menu.className = 'vmp-combo-menu vmp-vplan-menu';
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
            menu.style.minWidth = '240px';
            menu.style.padding = '4px 0';
            document.body.appendChild(menu);
            return menu;
        }

        function hide() {
            if (menu) { menu.style.display = 'none'; }
        }

        function position() {
            if (!menu) return;
            var r = input.getBoundingClientRect();
            menu.style.left = r.left + 'px';
            menu.style.top  = (r.bottom + 2) + 'px';
            menu.style.width = Math.max(r.width, 320) + 'px';
        }

        function render() {
            if (!isDbMode(input)) { hide(); return; }
            var items = getItems(input);
            var term = (input.value || '').trim().toLowerCase();
            var matches = term
                ? items.filter(function (s) { return s.toLowerCase().indexOf(term) >= 0; })
                : items.slice();
            ensureMenu();
            menu.innerHTML = '';
            if (matches.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = items.length === 0 ? 'Loadingג€¦' : 'No matches';
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

        input.addEventListener('focus', render);
        input.addEventListener('input', render);
        input.addEventListener('click', render);
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

    new MutationObserver(scheduleAttach).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleAttach);
    } else {
        scheduleAttach();
    }
})();

// Block save when any Chart Title is empty, or any Max Builds is missing/invalid.
(function () {
    if (window.__vmpChartTitleSubmitHooked) return;
    window.__vmpChartTitleSubmitHooked = true;

    function clearErr(input, cls) {
        input.style.outline = '';
        var wrap = input.closest('.jenkins-form-item, .setting-main') || input.parentElement;
        if (wrap) {
            var err = wrap.querySelector('.' + cls);
            if (err) err.remove();
        }
    }

    function showErr(input, cls, msg) {
        input.style.outline = '2px solid var(--error-color, #c33)';
        var wrap = input.closest('.jenkins-form-item, .setting-main') || input.parentElement;
        if (!wrap) return;
        if (!wrap.querySelector('.' + cls)) {
            var e = document.createElement('div');
            e.className = cls;
            e.textContent = msg;
            wrap.appendChild(e);
        }
    }

    function isValidMaxBuilds(v) {
        if (v == null) return false;
        var s = String(v).trim();
        if (s === '') return false;
        if (!/^\d+$/.test(s)) return false;
        var n = parseInt(s, 10);
        return n >= 0;
    }

    document.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t || t.tagName !== 'INPUT') return;
        var name = t.name || '';
        if (/(^|\.)title$/.test(name)
                && t.closest('.repeated-chunk') && (t.value || '').trim()) {
            clearErr(t, 'vmp-chart-title-err');
        }
        if (/(^|\.)maxBuilds$/.test(name)
                && t.closest('.repeated-chunk') && isValidMaxBuilds(t.value)) {
            clearErr(t, 'vmp-chart-maxbuilds-err');
        }
    }, true);

    function findForm() {
        return document.querySelector('form[name="config"]')
            || document.querySelector('#main-panel form')
            || document.querySelector('form');
    }

    function hookForm() {
        var form = findForm();
        if (!form || form.__vmpChartTitleHooked) return;
        form.__vmpChartTitleHooked = true;
        form.addEventListener('submit', function (ev) {
            // A ChartDefinition row is identified by a .repeated-chunk that
            // contains a vPlanType select. Within each such visible row, both
            // .title and .maxBuilds are required.
            var bad = [];
            Array.from(document.querySelectorAll('.repeated-chunk')).forEach(function (chunk) {
                if (!chunk.querySelector('select[name$="vPlanType"]')) return;
                var titleInp = chunk.querySelector('input[type="text"][name$=".title"]');
                if (titleInp && titleInp.offsetParent !== null
                        && !(titleInp.value || '').trim()) {
                    showErr(titleInp, 'vmp-chart-title-err', 'Chart title is required.');
                    bad.push(titleInp);
                }
                var mbInp = chunk.querySelector('input[type="text"][name$=".maxBuilds"]');
                if (mbInp && mbInp.offsetParent !== null
                        && !isValidMaxBuilds(mbInp.value)) {
                    showErr(mbInp, 'vmp-chart-maxbuilds-err',
                            'Max Builds is required (0 for unlimited).');
                    bad.push(mbInp);
                }
            });
            if (bad.length === 0) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            bad[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
            setTimeout(function () { bad[0].focus(); }, 100);
        }, true); // capture phase
    }

    new MutationObserver(hookForm).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hookForm);
    } else {
        hookForm();
    }
})();
        
