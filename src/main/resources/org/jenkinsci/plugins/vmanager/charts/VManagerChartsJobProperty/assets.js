
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
            // Key by vPlanType + serverUrl so the (empty) result Jenkins
            // fetches on page-load while vPlanType is still "" doesn't
            // poison the cache and starve the real "DB" fetch.
            var vt  = paramFromUrl(url, 'vPlanType')
                   || paramFromBody(init && init.body, 'vPlanType');
            var srv = paramFromUrl(url, 'serverUrl')
                   || paramFromBody(init && init.body, 'serverUrl');
            return 'vplan:' + vt + '|' + srv;
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
        
