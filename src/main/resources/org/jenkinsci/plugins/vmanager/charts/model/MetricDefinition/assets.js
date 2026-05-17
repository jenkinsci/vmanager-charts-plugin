
(function () {
    if (window.__vmpComboPatched) return;
    window.__vmpComboPatched = true;

    // Capture items keyed by the row's discriminating param (entityType).
    // Across multiple metric rows the fillUrl base is identical, so we MUST
    // key on entityType to avoid one row's list clobbering another's.
    var itemsByEntity = {};
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
        if (url.indexOf('AttributeNameItems') >= 0) {
            var entity = paramFromUrl(url, 'entityType')
                      || paramFromBody(init && init.body, 'entityType');
            p = p.then(function (rsp) {
                try {
                    var clone = rsp.clone();
                    clone.json().then(function (j) {
                        var arr = Array.isArray(j) ? j
                                : (j && Array.isArray(j.values)) ? j.values
                                : [];
                        // Items may be strings or {name: '...'} objects.
                        var list = arr.map(function (it) {
                            return (typeof it === 'string') ? it
                                 : (it && it.name) ? it.name : String(it);
                        });
                        itemsByEntity[entity || ''] = list;
                        scheduleAttach();
                    }).catch(function () {});
                } catch (e) { /* ignore */ }
                return rsp;
            });
        }
        return p;
    };

    // Find which fillUrl belongs to an input by class+placement.
    // combobox2 sets `fillUrl` attribute; use that.
    function attachAll() {
        document.querySelectorAll('input.combobox2').forEach(function (input) {
            if (input.__vmpAttached) return;
            var url = input.getAttribute('fillUrl');
            if (!url) return;
            // Only handle our attribute combobox (name ends with attributeName)
            if (!/attributeName$/.test(input.name || '')) return;
            input.__vmpAttached = true;
            install(input);
        });
        setupEntitySelects();
        setupNicknameValidation();
        hookFormSubmit();
    }

    function setupEntitySelects() {
        document.querySelectorAll('select[name$=".entityType"]').forEach(function (sel) {
            if (sel.__vmpEntitySetup) return;
            // Only apply when this select lives in the same row as our cond divs.
            var row = sel.closest('.repeated-chunk') || (function () {
                var p = sel;
                for (var n = 0; n < 10; n++) {
                    p = p.parentElement;
                    if (!p) return null;
                    if (p.querySelector && p.querySelector('.vmp-entity-cond')) return p;
                }
                return null;
            }());
            if (!row) return;
            sel.__vmpEntitySetup = true;

            var condDivs = Array.from(row.querySelectorAll('.vmp-entity-cond'));
            var attrInput = row.querySelector('input.combobox2');

            function update(clearAttr) {
                var val = sel.value;
                condDivs.forEach(function (div) {
                    // data-vmp-entity may be a single value or a comma-separated
                    // list (e.g. "VPLAN_LEVEL,COVERAGE_LEVEL") for fields shared
                    // across entity types.
                    var allowed = (div.dataset.vmpEntity || '')
                        .split(',').map(function (s) { return s.trim(); });
                    div.style.display = allowed.indexOf(val) >= 0 ? '' : 'none';
                });
                if (clearAttr && attrInput) {
                    // Set silently — no 'input' event, so the dropdown won't open
                    // showing the previous entity's stale option list.
                    attrInput.value = '';
                    clearFieldError(attrInput);
                }
            }
            sel.addEventListener('change', function () { update(true); });
            update(false);
        });
    }

    var attachTimer;
    function scheduleAttach() {
        clearTimeout(attachTimer);
        attachTimer = setTimeout(attachAll, 50);
    }

    function getItems(input) {
        // Find this row's entityType select and look up items for THAT entity.
        var row = input.closest('.repeated-chunk') || input.closest('.vmp-metric-row') || document;
        var sel = row.querySelector('select[name$=".entityType"]');
        var entity = sel ? sel.value : '';
        return itemsByEntity[entity] || [];
    }

    function install(input) {
        // Suppress the Jenkins combobox2 dropdown — we render our own.
        // It is attached via tippy; we keep it but hide it via CSS by overriding
        // the input.dropdown.show() method after Jenkins creates it.
        var origDescribe = Object.getOwnPropertyDescriptor(input, 'dropdown');
        var realDropdown = null;
        Object.defineProperty(input, 'dropdown', {
            configurable: true,
            get: function () { return realDropdown; },
            set: function (v) {
                realDropdown = v;
                if (v && typeof v.show === 'function' && !v.__vmpMuted) {
                    v.__vmpMuted = true;
                    var origShow = v.show.bind(v);
                    v.show = function () {
                        // do nothing — our custom dropdown handles UI
                    };
                    // keep hide working
                }
            }
        });

        var menu = null;
        var activeIdx = -1;

        function ensureMenu() {
            if (menu) return menu;
            menu = document.createElement('div');
            menu.className = 'vmp-combo-menu';
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
            activeIdx = -1;
        }

        function position() {
            if (!menu) return;
            var r = input.getBoundingClientRect();
            menu.style.left = r.left + 'px';
            menu.style.top  = (r.bottom + 2) + 'px';
            menu.style.width = Math.max(r.width, 320) + 'px';
        }

        function render() {
            var items = getItems(input);
            var term = (input.value || '').trim().toLowerCase();
            var matches = term
                ? items.filter(function (s) { return s.toLowerCase().indexOf(term) >= 0; })
                : items.slice();
            ensureMenu();
            menu.innerHTML = '';
            if (matches.length === 0) {
                var empty = document.createElement('div');
                empty.textContent = items.length === 0 ? 'Loading…' : 'No matches';
                empty.style.padding = '8px 12px';
                empty.style.color = 'var(--text-color-secondary, #888)';
                menu.appendChild(empty);
            } else {
                matches.slice(0, 200).forEach(function (s, i) {
                    var it = document.createElement('div');
                    it.textContent = s;
                    it.dataset.idx = i;
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
        input.addEventListener('blur', function () { setTimeout(hide, 180); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { hide(); }
        });
        // Clear error styling as soon as the user types a value
        input.addEventListener('input', function () {
            if ((input.value || '').trim()) clearFieldError(input);
        });
        window.addEventListener('scroll', function () { if (menu && menu.style.display !== 'none') position(); }, true);
        window.addEventListener('resize', function () { if (menu && menu.style.display !== 'none') position(); });
    }

    function clearFieldError(inp) {
        inp.style.outline = '';
        var wrap = inp.closest('.jenkins-form-item, .setting-main') || inp.parentElement;
        if (wrap) {
            var err = wrap.querySelector('.vmp-attr-err');
            if (err) err.remove();
        }
    }

    function showFieldError(inp, msg) {
        inp.style.outline = '2px solid var(--error-color, #c33)';
        var wrap = inp.closest('.jenkins-form-item, .setting-main') || inp.parentElement;
        if (!wrap) return;
        var err = wrap.querySelector('.vmp-attr-err');
        if (!err) {
            err = document.createElement('div');
            err.className = 'vmp-attr-err';
            err.style.color = 'var(--error-color, #c33)';
            err.style.fontSize = '0.8rem';
            err.style.marginTop = '2px';
            wrap.appendChild(err);
        }
        err.textContent = msg || 'Attribute name is required.';
    }

    // ── Nickname uniqueness ────────────────────────────────────────────
    // The nickname distinguishes between two metrics that pick the same
    // attribute. It must be unique within a single chart. We compute the
    // chart scope by walking up to the outermost .repeated-chunk ancestor
    // (the metric chunk's grand-ancestor of the same class) and group
    // nickname inputs by that scope.
    function chartScopeOf(input) {
        var chunks = [];
        var p = input.parentElement;
        while (p) {
            if (p.classList && p.classList.contains('repeated-chunk')) chunks.push(p);
            p = p.parentElement;
        }
        // Outermost wins; if only one (no chart-level repeatable wrapper) use it.
        return chunks.length ? chunks[chunks.length - 1] : document.body;
    }

    function metricChunkOf(input) {
        // The metric's own row is the innermost .repeated-chunk ancestor.
        return input.closest('.repeated-chunk');
    }

    function attrValueOf(metricChunk) {
        if (!metricChunk) return '';
        var a = metricChunk.querySelector('input.combobox2[name$=".attributeName"]')
             || metricChunk.querySelector('input[name$=".attributeName"]');
        return a ? (a.value || '').trim() : '';
    }

    function validateNicknamesIn(scope) {
        var inputs = Array.from(scope.querySelectorAll('input.vmp-nickname'));

        // Pass 1: clear any previous errors so we can recompute from scratch.
        inputs.forEach(clearFieldError);

        // Pass 2: flag duplicate nicknames within this chart.
        var byVal = {};
        inputs.forEach(function (inp) {
            var v = (inp.value || '').trim().toLowerCase();
            if (!v) return;
            (byVal[v] = byVal[v] || []).push(inp);
        });
        Object.keys(byVal).forEach(function (v) {
            var group = byVal[v];
            if (group.length > 1) {
                group.forEach(function (inp) {
                    showFieldError(inp, 'Nickname must be unique within this chart.');
                });
            }
        });

        // Pass 3: when the same attribute is picked more than once in this
        // chart, every occurrence MUST have a nickname (so the chart series
        // can be told apart). Flag the rows that are missing one.
        var byAttr = {};
        inputs.forEach(function (inp) {
            var attr = attrValueOf(metricChunkOf(inp));
            if (!attr) return;
            var key = attr.toLowerCase();
            (byAttr[key] = byAttr[key] || []).push(inp);
        });
        Object.keys(byAttr).forEach(function (k) {
            var group = byAttr[k];
            if (group.length < 2) return;
            group.forEach(function (inp) {
                if (!(inp.value || '').trim()) {
                    showFieldError(inp,
                        'Nickname is required: this attribute is used more than once in this chart.');
                }
            });
        });
    }

    function collectAllNicknameProblems() {
        var bad = [];
        var seenScopes = [];
        document.querySelectorAll('input.vmp-nickname').forEach(function (inp) {
            if (inp.offsetParent === null) return;
            var scope = chartScopeOf(inp);
            if (seenScopes.indexOf(scope) >= 0) return;
            seenScopes.push(scope);
            var inputs = Array.from(scope.querySelectorAll('input.vmp-nickname'));

            // Duplicate nicknames
            var byVal = {};
            inputs.forEach(function (i2) {
                var v = (i2.value || '').trim().toLowerCase();
                if (!v) return;
                (byVal[v] = byVal[v] || []).push(i2);
            });
            Object.keys(byVal).forEach(function (v) {
                if (byVal[v].length > 1) byVal[v].forEach(function (x) { bad.push(x); });
            });

            // Duplicate attributes with missing nicknames
            var byAttr = {};
            inputs.forEach(function (i2) {
                var attr = attrValueOf(metricChunkOf(i2));
                if (!attr) return;
                var key = attr.toLowerCase();
                (byAttr[key] = byAttr[key] || []).push(i2);
            });
            Object.keys(byAttr).forEach(function (k) {
                var grp = byAttr[k];
                if (grp.length < 2) return;
                grp.forEach(function (i2) {
                    if (!(i2.value || '').trim()) bad.push(i2);
                });
            });
        });
        return bad;
    }

    function setupNicknameValidation() {
        document.querySelectorAll('input.vmp-nickname').forEach(function (inp) {
            if (inp.__vmpNickHooked) return;
            inp.__vmpNickHooked = true;
            var handler = function () { validateNicknamesIn(chartScopeOf(inp)); };
            inp.addEventListener('input', handler);
            inp.addEventListener('blur',  handler);
        });
        // Also re-validate every chart scope when an attribute combobox
        // value changes — picking the same attribute as a sibling row must
        // immediately demand a nickname.
        document.querySelectorAll('input.combobox2[name$=".attributeName"]').forEach(function (a) {
            if (a.__vmpAttrNickHooked) return;
            a.__vmpAttrNickHooked = true;
            var handler = function () {
                var scope = chartScopeOf(a);
                if (scope) validateNicknamesIn(scope);
            };
            a.addEventListener('input',  handler);
            a.addEventListener('change', handler);
            a.addEventListener('blur',   handler);
        });
    }

    function hookFormSubmit() {
        var form = document.querySelector('form[name="config"]')
                || document.querySelector('#main-panel form')
                || document.querySelector('form');
        if (!form || form.__vmpSubmitHooked) return;
        form.__vmpSubmitHooked = true;
        form.addEventListener('submit', function (ev) {
            var bad = Array.from(
                document.querySelectorAll('input.combobox2')
            ).filter(function (inp) {
                return /attributeName$/.test(inp.name || '')
                    && inp.offsetParent !== null
                    && !(inp.value || '').trim();
            });
            // Re-validate nicknames across all charts; mark dups + missing.
            var nickProblems = collectAllNicknameProblems();
            if (bad.length === 0 && nickProblems.length === 0) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            bad.forEach(showFieldError);
            nickProblems.forEach(function (inp) { validateNicknamesIn(chartScopeOf(inp)); });
            var first = bad[0] || nickProblems[0];
            if (first) {
                first.scrollIntoView({ block: 'center', behavior: 'smooth' });
                setTimeout(function () { first.focus(); }, 100);
            }
        }, true); // capture phase — runs before Jenkins' own submit handler
    }

    // Watch for dynamically added repeatable rows.
    new MutationObserver(scheduleAttach).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleAttach);
    } else {
        scheduleAttach();
    }
}());
        
