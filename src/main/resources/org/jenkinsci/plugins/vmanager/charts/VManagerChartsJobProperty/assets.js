
(function () {
    if (window.__vmpFetchDedupInstalled) return;
    window.__vmpFetchDedupInstalled = true;

    var cache = {};   // key -> Promise<Response> (un-consumed; cloned per caller)

    function paramFromUrl(url, name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(url || '');
        return m ? decodeURIComponent(m[1]) : '';
    }
    function paramFromBody(body, name) {
        if (!body) return '';
        try {
            if (body instanceof FormData) {
                var v = body.get(name);
                return v != null ? String(v) : '';
            }
            var s = (typeof body === 'string') ? body
                  : (body instanceof URLSearchParams) ? body.toString()
                  : (typeof body.toString === 'function') ? body.toString()
                  : '';
            var m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(s);
            return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
        } catch (e) { return ''; }
    }

    function keyFor(url, init) {
        if (/AttributeNameItems/.test(url)) {
            var ent = paramFromUrl(url, 'entityType')
                   || paramFromBody(init && init.body, 'entityType');
            return 'attr:' + ent;
        }
        if (/VPlanPathItems/.test(url)) {
            return 'vplan';
        }
        return null;
    }

    var origFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = (typeof input === 'string') ? input
                : (input && input.url) ? input.url : '';
        var key = keyFor(url, init);
        if (!key) return origFetch.apply(this, arguments);

        if (!cache[key]) {
            // First request for this key: actually hit the network.
            // Store the un-consumed Response so callers can clone it.
            cache[key] = origFetch.apply(this, arguments).then(
                function (rsp) {
                    if (!rsp.ok) delete cache[key];   // don't cache failures
                    return rsp;
                },
                function (err) {
                    delete cache[key];
                    throw err;
                }
            );
        }
        // Every caller (including the very first) gets a fresh clone so
        // its body stream is independent of the cached Response and of
        // any other caller's clone.
        return cache[key].then(function (rsp) { return rsp.clone(); });
    };
})();
    

(function () {
    if (window.__vmpSessionSrcHooked) return;
    window.__vmpSessionSrcHooked = true;

    function syncByName(root, selectName, condClass) {
        var sel = (root || document).querySelector('select[name$="' + selectName + '"]');
        if (!sel) return;
        var scope = sel.closest('.vmp-charts-root, form, body');
        if (!scope) return;
        var cond = scope.querySelector('.' + condClass);
        if (!cond) return;
        cond.style.display = (sel.value === 'FILE') ? '' : 'none';
        if (!sel.__vmpSyncBound) {
            sel.__vmpSyncBound = true;
            sel.addEventListener('change', function () {
                cond.style.display = (sel.value === 'FILE') ? '' : 'none';
            });
        }
    }

    function sync(root) {
        syncByName(root, 'sessionSource', 'vmp-session-file-cond');
    }

    new MutationObserver(function () { sync(); })
        .observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { sync(); });
    } else {
        sync();
    }
})();
        

(function () {
    if (window.__vmpExportHooked) return;
    window.__vmpExportHooked = true;

    function getCrumb() {
        var meta = document.querySelector('meta[name="crumb"]');
        if (meta) {
            return {
                fieldName: meta.getAttribute('crumb-field') || 'Jenkins-Crumb',
                value:     meta.getAttribute('crumb-value') || meta.getAttribute('content') || ''
            };
        }
        if (typeof window.crumb !== 'undefined' && window.crumb && window.crumb.value) {
            return {
                fieldName: window.crumb.fieldName || 'Jenkins-Crumb',
                value:     window.crumb.value
            };
        }
        return null;
    }

    function rootURL() {
        var meta = document.querySelector('meta[name="ROOT_URL"]');
        if (meta && meta.content) return meta.content.replace(/\/$/, '');
        if (typeof window.rootURL === 'string') return window.rootURL.replace(/\/$/, '');
        var head = document.querySelector('head');
        if (head && head.dataset && head.dataset.rooturl) return head.dataset.rooturl.replace(/\/$/, '');
        return '';
    }

    function endpoint() {
        return rootURL()
            + '/descriptorByName/org.jenkinsci.plugins.vmanager.charts.VManagerChartsJobProperty/exportConfig';
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a   = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function onClick(btn) {
        var form = btn.closest('form');
        if (!form) {
            alert('vManager Charts: could not find the surrounding form.');
            return;
        }
        if (typeof buildFormTree !== 'function') {
            alert('vManager Charts: Jenkins form-builder (buildFormTree) is not available; cannot export.');
            return;
        }
        var tree;
        try {
            buildFormTree(form);
            // After buildFormTree(), Jenkins stores the JSON in the form's
            // hidden "json" input; that's the exact same payload Jenkins'
            // own "Save" button submits.
            var jsonInput = form.querySelector('input[name="json"]');
            tree = jsonInput ? jsonInput.value : null;
        } catch (e) {
            alert('vManager Charts: failed to read form data: ' + (e && e.message ? e.message : e));
            return;
        }
        if (!tree) {
            alert('vManager Charts: form has no serialized JSON payload.');
            return;
        }

        var fd = new FormData();
        fd.append('json', tree);

        var crumb   = getCrumb();
        var headers = {};
        if (crumb && crumb.value) {
            headers[crumb.fieldName] = crumb.value;
            fd.append(crumb.fieldName, crumb.value);
        }

        btn.disabled = true;
        var origText = btn.textContent;
        btn.textContent = 'Exportingג€¦';

        fetch(endpoint(), {
            method:      'POST',
            body:        fd,
            headers:     headers,
            credentials: 'same-origin'
        }).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) {
                    throw new Error('HTTP ' + r.status + ': ' + (t || r.statusText));
                });
            }
            return r.blob();
        }).then(function (blob) {
            downloadBlob(blob, 'vmanager-charts-config.json');
        }).catch(function (err) {
            alert('vManager Charts: export failed ג€” ' + (err && err.message ? err.message : err));
        }).then(function () {
            btn.disabled = false;
            btn.textContent = origText;
        });
    }

    function attach() {
        document.querySelectorAll('.vmp-charts-root .vmp-export-btn').forEach(function (btn) {
            if (btn.__vmpExportBound) return;
            btn.__vmpExportBound = true;
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                onClick(btn);
            });
        });
    }

    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
})();
        

(function () {
    if (window.__vmpServerUrlGuarded) return;
    window.__vmpServerUrlGuarded = true;

    function findWrap(inp) {
        return inp.closest('.jenkins-form-item, .setting-main') || inp.parentElement;
    }
    function clearErr(inp) {
        inp.style.outline = '';
        var w = findWrap(inp);
        if (w) {
            var e = w.querySelector('.vmp-server-url-err');
            if (e) e.remove();
        }
    }
    function showErr(inp, msg) {
        inp.style.outline = '2px solid var(--error-color, #c33)';
        var w = findWrap(inp);
        if (!w) return;
        var e = w.querySelector('.vmp-server-url-err');
        if (!e) {
            e = document.createElement('div');
            e.className = 'vmp-server-url-err';
            e.style.color = 'var(--error-color, #c33)';
            e.style.fontSize = '0.8rem';
            e.style.marginTop = '2px';
            w.appendChild(e);
        }
        e.textContent = msg;
    }
    function isEnabledBlock(inp) {
        // The whole block sits inside an f:optionalBlock named 'enabled'.
        // If the block is not checked the input won't be visible (offsetParent
        // null) so we rely on that as the gate.
        return inp.offsetParent !== null;
    }
    function validate(inp) {
        if (!isEnabledBlock(inp)) { clearErr(inp); return true; }
        var v = (inp.value || '').trim();
        if (v === '') {
            showErr(inp, 'vManager Server URL is required.');
            return false;
        }
        if (!/^https?:\/\//i.test(v)) {
            showErr(inp, 'URL must start with http:// or https://');
            return false;
        }
        clearErr(inp);
        return true;
    }
    function attachAll() {
        document.querySelectorAll('input.vmp-server-url').forEach(function (inp) {
            if (inp.__vmpUrlHooked) return;
            inp.__vmpUrlHooked = true;
            inp.addEventListener('input', function () { validate(inp); });
            inp.addEventListener('blur',  function () { validate(inp); });
        });
        var form = document.querySelector('form[name="config"]')
                || document.querySelector('#main-panel form')
                || document.querySelector('form');
        if (form && !form.__vmpUrlSubmitHooked) {
            form.__vmpUrlSubmitHooked = true;
            form.addEventListener('submit', function (ev) {
                var bad = Array.from(document.querySelectorAll('input.vmp-server-url'))
                                .filter(function (inp) { return !validate(inp); });
                if (bad.length === 0) return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                bad[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
                setTimeout(function () { bad[0].focus(); }, 100);
            }, true);
        }
    }
    new MutationObserver(attachAll).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachAll);
    } else {
        attachAll();
    }
})();
        

(function () {
    if (window.__vmpHelpBtnInstalled) return;
    window.__vmpHelpBtnInstalled = true;

    function isCheckboxRow(formItem) {
        // f:entry containing a checkbox or radio uses Jenkins' built-in
        // help ג€” skip so we don't add a duplicate / mis-placed '?' icon.
        return !!formItem.querySelector('input[type="checkbox"], input[type="radio"]');
    }

    function findTitleEl(formItem) {
        return formItem.querySelector('.jenkins-form-label')
            || formItem.querySelector('label.attach-previous')
            || formItem.querySelector('.setting-name')
            || formItem.querySelector('legend')
            || formItem.querySelector('label');
    }

    function process(formItem) {
        if (formItem.__vmpHelped) return;
        if (isCheckboxRow(formItem)) {
            formItem.__vmpHelped = true; // skip silently
            return;
        }
        var desc = formItem.querySelector('.jenkins-form-description');
        if (!desc) return;
        var text = (desc.textContent || '').trim();
        if (!text) return;
        var title = findTitleEl(formItem);
        if (!title) return;
        // DOM-level dedupe: don't add a second "?" if one is already there.
        if (title.querySelector('.vmp-help-btn')) {
            formItem.__vmpHelped = true;
            return;
        }
        formItem.__vmpHelped = true;
        formItem.classList.add('vmp-helped');

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vmp-help-btn';
        btn.textContent = '?';
        btn.setAttribute('aria-label', 'Show help');
        btn.title = 'Show help';

        var panel = document.createElement('div');
        panel.className = 'vmp-help-panel';
        panel.textContent = text;

        // Block label-activation toggling when "?" is clicked.
        btn.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
        });
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            panel.classList.toggle('vmp-open');
        });

        title.appendChild(btn);
        if (title.parentNode) {
            title.parentNode.insertBefore(panel, title.nextSibling);
        }
    }

    function scan() {
        document.querySelectorAll('.vmp-charts-root .jenkins-form-item')
            .forEach(process);
    }

    var t;
    function schedule() { clearTimeout(t); t = setTimeout(scan, 50); }

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', schedule);
    } else {
        schedule();
    }
})();
        
