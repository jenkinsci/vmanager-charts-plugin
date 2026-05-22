/* vManager Charts mini-dashboard
 *
 * Wraps a set of .chart-section elements into a flex grid that supports:
 *   - reorder via left/right arrow buttons (no drag-and-drop)
 *   - per-card width toggle: 50% / 100% (Auto = 50%, last lone card -> 100%)
 *   - magnifier button that opens a modal with the card at full size
 *   - persistence on the Jenkins controller via the action's doSaveLayout
 *
 * Activation: the page must contain a root element with [data-vmgr-dashboard]
 * carrying:
 *   data-save-url      POST endpoint that accepts the layout JSON
 *   data-layout        initial layout JSON ({ order:[ids], widths:{id:"50"|"100"|"auto"} })
 *   data-can-configure "true" to allow editing, otherwise read-only
 *
 * Each card must be a .chart-section with a stable data-chart-id.
 *
 * The page's existing chart init code may call
 *   window.VmgrDashboard.register(cardId, [echartsInstance, ...])
 * after creating its echarts instances so the dashboard can resize them when
 * the layout changes and resize them inside the magnifier modal.
 */
(function () {
    'use strict';

    var REGISTRY = {}; // cardId -> [echarts instances]
    var ROOT = null;
    var CAN_EDIT = false;
    var SAVE_URL = '';
    var SAVE_TIMER = null;
    var LAYOUT = { order: [], widths: {} };

    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    function cards() {
        if (!ROOT) return [];
        return Array.prototype.slice.call(
            ROOT.querySelectorAll(':scope > .chart-section[data-chart-id]'));
    }

    function cardWidth(id) {
        var w = LAYOUT.widths && LAYOUT.widths[id];
        if (w === '50' || w === '100') return w;
        return 'auto';
    }

    /**
     * Compute the rendered width per card, applying the auto rules:
     *  - explicit '100': lives on its own row
     *  - explicit '50' or 'auto' paired with another 50/auto: 50/50
     *  - lone trailing auto: promoted to 100
     *  - lone trailing 50: stays 50 (user asked for it)
     */
    function computeWidths(list) {
        var result = {};
        var i = 0;
        while (i < list.length) {
            var c = list[i];
            var id = c.dataset.chartId;
            var w = cardWidth(id);
            if (w === '100') {
                result[id] = 100;
                i++;
                continue;
            }
            if (i + 1 < list.length) {
                var next = list[i + 1];
                var nid = next.dataset.chartId;
                var nw = cardWidth(nid);
                if (nw !== '100') {
                    result[id]  = 50;
                    result[nid] = 50;
                    i += 2;
                    continue;
                }
            }
            result[id] = (w === '50') ? 50 : 100;
            i++;
        }
        return result;
    }

    function applyLayout() {
        if (!ROOT) return;
        var list = cards();

        // 1) Reorder DOM children to match LAYOUT.order
        var byId = {};
        list.forEach(function (el) { byId[el.dataset.chartId] = el; });
        var seen = {};
        var ordered = [];
        (LAYOUT.order || []).forEach(function (id) {
            if (byId[id] && !seen[id]) {
                ordered.push(byId[id]);
                seen[id] = true;
            }
        });
        list.forEach(function (el) {
            if (!seen[el.dataset.chartId]) ordered.push(el);
        });
        ordered.forEach(function (el) { ROOT.appendChild(el); });

        // 2) Compute & apply widths
        var widths = computeWidths(ordered);
        ordered.forEach(function (el) {
            var id = el.dataset.chartId;
            var w  = widths[id] || 100;
            el.dataset.vmgrComputedWidth = String(w);
            el.dataset.vmgrUserWidth     = cardWidth(id);
        });

        // 3) Update arrow-button enabled state based on new positions
        ordered.forEach(updateArrowButtons);

        // 4) Let echarts redraw
        resizeAll();
    }

    function resizeAll() {
        requestAnimationFrame(function () {
            Object.keys(REGISTRY).forEach(function (id) {
                REGISTRY[id].forEach(function (inst) {
                    try { inst.resize(); } catch (e) { /* ignore */ }
                });
            });
        });
    }

    function scheduleSave() {
        if (!CAN_EDIT || !SAVE_URL) return;
        clearTimeout(SAVE_TIMER);
        SAVE_TIMER = setTimeout(saveNow, 400);
    }

    function saveNow() {
        if (!CAN_EDIT || !SAVE_URL) return;
        var order = cards().map(function (c) { return c.dataset.chartId; });
        var payload = JSON.stringify({ order: order, widths: LAYOUT.widths || {} });
        var headers = { 'Content-Type': 'application/json' };
        if (window.crumb && window.crumb.fieldName) {
            headers[window.crumb.fieldName] = window.crumb.value;
        }
        fetch(SAVE_URL, { method: 'POST', headers: headers, body: payload, credentials: 'same-origin' })
            .catch(function (err) {
                console.warn('[vManager Charts] failed to save layout:', err);
            });
    }

    // ── toolbar wiring ───────────────────────────────────────────────────────

    function decorateCard(card) {
        if (card.dataset.vmgrDecorated === '1') return;
        card.dataset.vmgrDecorated = '1';

        var bar = document.createElement('div');
        bar.className = 'vmgr-card-toolbar';

        // Left side: ← →
        var leftGroup = document.createElement('div');
        leftGroup.className = 'vmgr-tb-group vmgr-tb-left';

        var leftBtn = document.createElement('button');
        leftBtn.type = 'button';
        leftBtn.className = 'vmgr-tb-btn vmgr-move-left-btn';
        leftBtn.title = 'Move left';
        leftBtn.setAttribute('aria-label', 'Move left');
        leftBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
        leftBtn.disabled = !CAN_EDIT;
        leftBtn.addEventListener('click', function () { moveCard(card, -1); });
        leftGroup.appendChild(leftBtn);

        var rightBtn = document.createElement('button');
        rightBtn.type = 'button';
        rightBtn.className = 'vmgr-tb-btn vmgr-move-right-btn';
        rightBtn.title = 'Move right';
        rightBtn.setAttribute('aria-label', 'Move right');
        rightBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path fill="currentColor" d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>';
        rightBtn.disabled = !CAN_EDIT;
        rightBtn.addEventListener('click', function () { moveCard(card, +1); });
        leftGroup.appendChild(rightBtn);

        bar.appendChild(leftGroup);

        // Right side: width toggle + magnifier
        var rightGroup = document.createElement('div');
        rightGroup.className = 'vmgr-tb-group vmgr-tb-right';

        var widthBtn = document.createElement('button');
        widthBtn.type = 'button';
        widthBtn.className = 'vmgr-tb-btn vmgr-width-btn';
        widthBtn.title = 'Toggle 50% / 100% width';
        widthBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>'
            + '<span class="vmgr-width-label">50%</span>';
        widthBtn.disabled = !CAN_EDIT;
        widthBtn.addEventListener('click', function () { cycleWidth(card); });
        rightGroup.appendChild(widthBtn);

        var magBtn = document.createElement('button');
        magBtn.type = 'button';
        magBtn.className = 'vmgr-tb-btn vmgr-mag-btn';
        magBtn.title = 'Open in full size';
        magBtn.setAttribute('aria-label', 'Open in full size');
        magBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path fill="currentColor" d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 1 0 0 12A6 6 0 0 0 10 4zm11 17.59L15.41 16l-1.42 1.41L19.59 23 21 21.59z"/>'
            + '</svg>';
        magBtn.addEventListener('click', function () { openMagnifier(card); });
        rightGroup.appendChild(magBtn);

        bar.appendChild(rightGroup);

        card.appendChild(bar);
        updateWidthButton(card);
    }

    function updateWidthButton(card) {
        var label = card.querySelector('.vmgr-width-btn .vmgr-width-label');
        if (!label) return;
        var id = card.dataset.chartId;
        var w = cardWidth(id);
        if (w === '50')  label.textContent = '50%';
        else if (w === '100') label.textContent = '100%';
        else label.textContent = 'Auto';
    }

    function updateArrowButtons(card) {
        if (!CAN_EDIT) return;
        var list = cards();
        var idx = list.indexOf(card);
        var leftBtn  = card.querySelector('.vmgr-move-left-btn');
        var rightBtn = card.querySelector('.vmgr-move-right-btn');
        if (leftBtn)  leftBtn.disabled  = (idx <= 0);
        if (rightBtn) rightBtn.disabled = (idx < 0 || idx >= list.length - 1);
    }

    function cycleWidth(card) {
        var id = card.dataset.chartId;
        var w = cardWidth(id);
        var next = (w === 'auto') ? '50' : (w === '50' ? '100' : 'auto');
        LAYOUT.widths = LAYOUT.widths || {};
        if (next === 'auto') delete LAYOUT.widths[id]; else LAYOUT.widths[id] = next;
        updateWidthButton(card);
        applyLayout();
        scheduleSave();
    }

    /**
     * Swap this card with its previous (delta=-1) or next (delta=+1) sibling
     * card. Updates LAYOUT.order from current DOM and persists.
     */
    function moveCard(card, delta) {
        if (!CAN_EDIT) return;
        var list = cards();
        var idx = list.indexOf(card);
        if (idx < 0) return;
        var target = idx + delta;
        if (target < 0 || target >= list.length) return;

        var other = list[target];
        if (delta < 0) {
            ROOT.insertBefore(card, other);
        } else {
            ROOT.insertBefore(card, other.nextSibling);
        }
        LAYOUT.order = cards().map(function (c) { return c.dataset.chartId; });
        applyLayout();
        scheduleSave();
    }

    // ── modal magnifier ──────────────────────────────────────────────────────
    //
    // We do NOT move the card in the DOM. Moving an echarts container in/out
    // of a modal caused the sibling chart below to render blank after close
    // (the card got reattached to a flex slot of a different width and some
    // browsers failed to repaint cleanly).
    //
    // Instead we keep the card where it is and use position:fixed via the
    // .vmgr-in-modal class to visually float it above a backdrop. A single
    // shared backdrop element is created lazily.

    var BACKDROP = null;
    var CLOSE_BTN = null;
    var MAGNIFIED = null;

    function ensureBackdrop() {
        if (BACKDROP) return BACKDROP;
        BACKDROP = document.createElement('div');
        BACKDROP.className = 'vmgr-modal-backdrop';
        BACKDROP.style.display = 'none';
        BACKDROP.addEventListener('click', function (e) {
            if (e.target === BACKDROP) closeMagnifier();
        });
        document.body.appendChild(BACKDROP);

        // Close button is reparented INTO the magnified card on open so it
        // shares the card's stacking context — that way echarts hover
        // tooltips (which render inside the card) can layer above it.
        CLOSE_BTN = document.createElement('button');
        CLOSE_BTN.type = 'button';
        CLOSE_BTN.className = 'vmgr-modal-close';
        CLOSE_BTN.setAttribute('aria-label', 'Close');
        CLOSE_BTN.innerHTML = '\u00D7';
        CLOSE_BTN.addEventListener('click', closeMagnifier);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && MAGNIFIED) closeMagnifier();
        });
        return BACKDROP;
    }

    function openMagnifier(card) {
        ensureBackdrop();
        if (MAGNIFIED && MAGNIFIED !== card) closeMagnifier();

        MAGNIFIED = card;
        card.classList.add('vmgr-in-modal');
        document.body.classList.add('vmgr-modal-open');
        BACKDROP.style.display = '';
        if (CLOSE_BTN) card.appendChild(CLOSE_BTN);

        requestAnimationFrame(function () {
            (REGISTRY[card.dataset.chartId] || []).forEach(function (inst) {
                try { inst.resize(); } catch (_) {}
            });
        });
    }

    function closeMagnifier() {
        if (!MAGNIFIED) return;
        var card = MAGNIFIED;
        MAGNIFIED = null;
        card.classList.remove('vmgr-in-modal');
        document.body.classList.remove('vmgr-modal-open');
        if (BACKDROP) BACKDROP.style.display = 'none';
        if (CLOSE_BTN && CLOSE_BTN.parentNode) CLOSE_BTN.parentNode.removeChild(CLOSE_BTN);

        // Force every chart (especially the one we just shrank back down)
        // to recompute its size now that its container reverted to its
        // original flex slot.
        requestAnimationFrame(resizeAll);
        setTimeout(resizeAll, 80);
    }

    // ── boot ─────────────────────────────────────────────────────────────────

    function init() {
        ROOT = document.querySelector('[data-vmgr-dashboard]');
        if (!ROOT) return;
        SAVE_URL = ROOT.getAttribute('data-save-url') || '';
        CAN_EDIT = ROOT.getAttribute('data-can-configure') === 'true';
        try {
            LAYOUT = JSON.parse(ROOT.getAttribute('data-layout') || '{}') || {};
        } catch (e) {
            LAYOUT = {};
            console.warn('[vManager Charts] invalid saved layout, ignoring:', e);
        }
        LAYOUT.order  = Array.isArray(LAYOUT.order) ? LAYOUT.order : [];
        LAYOUT.widths = (LAYOUT.widths && typeof LAYOUT.widths === 'object') ? LAYOUT.widths : {};
        cards().forEach(decorateCard);
        applyLayout();
        window.addEventListener('resize', resizeAll);
    }

    // Public hook used by per-page assets.js to attach echarts instances.
    window.VmgrDashboard = {
        register: function (cardId, instances) {
            if (!cardId || !instances) return;
            REGISTRY[cardId] = (REGISTRY[cardId] || []).concat(
                Array.isArray(instances) ? instances : [instances]);
        },
        applyLayout: applyLayout
    };

    ready(init);
})();
