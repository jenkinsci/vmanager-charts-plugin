
(function () {

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
        
