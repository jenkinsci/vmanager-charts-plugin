package org.jenkinsci.plugins.vmanager.charts.util;

/**
 * Per-build routing-OID holder for vManager COVERAGE_LEVEL REST calls.
 *
 * <p>vManager's {@code /rest/metrics/get} endpoint requires the caller to:
 * <ul>
 *   <li>Always send {@code x-vmgr-routing-retain: 1}.</li>
 *   <li>On the very <em>first</em> call within a build, NOT send
 *       {@code x-vmgr-routing-oid} — the server returns one in the response.</li>
 *   <li>On every subsequent call within the same build, echo the
 *       {@code x-vmgr-routing-oid} value received from the previous call.</li>
 *   <li>Reset between builds (next build starts again with no oid).</li>
 * </ul>
 *
 * <p>One instance is created per {@code onCompleted} invocation in the
 * RunListener and shared across every COVERAGE_LEVEL request issued for that
 * build. Not thread-safe — the listener serially issues requests.</p>
 */
public final class CoverageRoutingContext {

    public static final String HDR_RETAIN = "x-vmgr-routing-retain";
    public static final String HDR_OID    = "x-vmgr-routing-oid";

    private String oid;

    public String getOid() { return oid; }

    public void setOid(String oid) { this.oid = oid; }

    public boolean hasOid() { return oid != null && !oid.isBlank(); }
}
