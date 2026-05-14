package org.jenkinsci.plugins.vmanager.charts.util;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Per-build routing-OID holder for vManager VPLAN_LEVEL REST calls
 * ({@code /rest/vplan/get}).
 *
 * <p>Unlike COVERAGE_LEVEL — which uses a single shared OID for all calls in
 * a build — VPLAN routing OIDs are scoped to a single (vPlan, vPlanType)
 * pair. The same {@code (vplan, type)} combination may be reused across
 * charts within one build (the OID returned by chart&nbsp;1 is sent on the
 * first matching call in chart&nbsp;2), but a different {@code (vplan, type)}
 * starts a new chain (no OID on its first call).</p>
 *
 * <p>Implementation: a per-build {@link Map} keyed by
 * {@code "<vplan>\u0001<type>"}. Lookups before the first server response
 * for a key return {@code null} (caller omits the
 * {@code x-vmgr-routing-oid} header). Each successful response updates the
 * map for that key.</p>
 *
 * <p>Reset between builds because a fresh instance is created per build in
 * the RunListener. Not thread-safe.</p>
 */
public final class VplanRoutingContext {

    public static final String HDR_RETAIN = "x-vmgr-routing-retain";
    public static final String HDR_OID    = "x-vmgr-routing-oid";

    private final Map<String, String> oidByKey = new LinkedHashMap<>();

    /** @return OID previously returned for {@code (vplan, type)}, or {@code null}. */
    public String getOid(String vplan, String type) {
        return oidByKey.get(key(vplan, type));
    }

    public boolean hasOid(String vplan, String type) {
        String v = oidByKey.get(key(vplan, type));
        return v != null && !v.isBlank();
    }

    public void setOid(String vplan, String type, String oid) {
        if (oid == null || oid.isBlank()) return;
        oidByKey.put(key(vplan, type), oid);
    }

    private static String key(String vplan, String type) {
        return (vplan == null ? "" : vplan) + "\u0001" + (type == null ? "" : type);
    }
}
