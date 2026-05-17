package org.jenkinsci.plugins.vmanager.charts.util;

import com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials;
import hudson.model.TaskListener;
import org.jenkinsci.plugins.vmanager.charts.CustomMetricsRunListener;
import org.jenkinsci.plugins.vmanager.charts.model.ChartDefinition;
import org.jenkinsci.plugins.vmanager.charts.model.MetricDefinition;
import org.jenkinsci.plugins.vmanager.charts.model.RefinementFile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Collects the per-build values of every {@link MetricDefinition} declared
 * on a {@link ChartDefinition}, dispatched by the metric's
 * {@code entityType}:
 *
 * <ul>
 *   <li>{@code SESSION_LEVEL}: all attribute ids in the chart are fetched in a
 *       <em>single</em> POST to {@code /rest/sessions/list} (see
 *       {@link VManagerSessionsClient#fetchSessionAttributeSums}). The numeric
 *       value of each attribute is summed across all returned region rows.</li>
 *   <li>{@code VPLAN_LEVEL}: not yet implemented &mdash; returns a placeholder
 *       random value (so the chart still has data to render).</li>
 *   <li>{@code COVERAGE_LEVEL}: not yet implemented &mdash; placeholder random.</li>
 * </ul>
 *
 * <p>Returned map keys use {@link CustomMetricsRunListener#key(String, String)}
 * so the values can be merged straight onto a
 * {@link org.jenkinsci.plugins.vmanager.charts.CustomMetricsBuildAction}.</p>
 */
public final class CustomMetricsCollector {

    private static final Logger LOGGER = Logger.getLogger(CustomMetricsCollector.class.getName());

    public static final String SESSION_LEVEL  = "SESSION_LEVEL";
    public static final String VPLAN_LEVEL    = "VPLAN_LEVEL";
    public static final String COVERAGE_LEVEL = "COVERAGE_LEVEL";

    private CustomMetricsCollector() {
        // utility class
    }

    /**
     * Collect the values of every metric in {@code chart} for this build.
     *
     * @param serverUrl vManager base URL.
     * @param sessions  session names this build is associated with (may be empty;
     *                  SESSION_LEVEL metrics will then yield 0).
     * @param chart     chart whose metrics are collected.
     * @param creds     HTTP Basic credentials (may be {@code null}).
     * @param listener  build log; each metric and any error is logged with the
     *                  {@code [vManager Charts]} prefix.
     * @return a map keyed by {@link CustomMetricsRunListener#key(String, String)};
     *         empty if the chart has no metrics. Never {@code null}.
     */
    public static Map<String, Double> collect(
            String serverUrl,
            List<String> sessions,
            ChartDefinition chart,
            StandardUsernamePasswordCredentials creds,
            CoverageRoutingContext routingCtx,
            VplanRoutingContext vplanRoutingCtx,
            TaskListener listener) {

        Map<String, Double> values = new LinkedHashMap<>();
        if (chart == null || chart.getMetrics() == null || chart.getMetrics().isEmpty()) {
            return values;
        }
        String chartTitle = chart.getTitle();

        // Bucket metrics by entity type so we can batch SESSION_LEVEL into one call.
        List<MetricDefinition> sessionMetrics  = new ArrayList<>();
        List<MetricDefinition> vplanMetrics    = new ArrayList<>();
        List<MetricDefinition> coverageMetrics = new ArrayList<>();
        List<MetricDefinition> otherMetrics    = new ArrayList<>();
        for (MetricDefinition m : chart.getMetrics()) {
            String t = m.getEntityType();
            if (SESSION_LEVEL.equals(t))       sessionMetrics.add(m);
            else if (VPLAN_LEVEL.equals(t))    vplanMetrics.add(m);
            else if (COVERAGE_LEVEL.equals(t)) coverageMetrics.add(m);
            else                               otherMetrics.add(m);
        }

        collectSessionLevel(serverUrl, sessions, chartTitle, sessionMetrics, creds, values, listener);
        collectVPlanLevel(serverUrl, sessions, chart, vplanMetrics, creds, vplanRoutingCtx, values, listener);
        collectCoverageLevel(serverUrl, sessions, chartTitle, coverageMetrics, creds, routingCtx, values, listener);
        collectUnknown(chartTitle, otherMetrics, values, listener);

        return values;
    }

    /** Backwards-compatible overload (no routing contexts). */
    public static Map<String, Double> collect(
            String serverUrl,
            List<String> sessions,
            ChartDefinition chart,
            StandardUsernamePasswordCredentials creds,
            CoverageRoutingContext routingCtx,
            TaskListener listener) {
        return collect(serverUrl, sessions, chart, creds, routingCtx, null, listener);
    }

    /** Backwards-compatible overload (no routing contexts) used by tests / callers
     *  that don't manage per-build routing OIDs. */
    public static Map<String, Double> collect(
            String serverUrl,
            List<String> sessions,
            ChartDefinition chart,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener) {
        return collect(serverUrl, sessions, chart, creds, null, null, listener);
    }

    // ── SESSION_LEVEL ──────────────────────────────────────────────────────

    private static void collectSessionLevel(String serverUrl,
                                            List<String> sessions,
                                            String chartTitle,
                                            List<MetricDefinition> metrics,
                                            StandardUsernamePasswordCredentials creds,
                                            Map<String, Double> values,
                                            TaskListener listener) {
        if (metrics.isEmpty()) return;

        // attribute id -> metrics that requested it (>1 when the user picked
        // the same attribute multiple times in the chart, distinguished by
        // their nickname / seriesKey).
        Map<String, List<MetricDefinition>> idToMetrics = new LinkedHashMap<>();
        for (MetricDefinition m : metrics) {
            String id = m.getAttributeId();
            if (id != null && !id.isBlank()) {
                idToMetrics.computeIfAbsent(id, k -> new ArrayList<>()).add(m);
            }
        }

        if (sessions == null || sessions.isEmpty() || idToMetrics.isEmpty()) {
            // Nothing to fetch — record zeros so the chart still renders.
            for (MetricDefinition m : metrics) {
                values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
                listener.getLogger().printf(
                        "[vManager Charts] [%s] '%s' (SESSION_LEVEL) skipped (no sessions or no id) = 0%n",
                        chartTitle, m.getDisplayName());
            }
            return;
        }

        try {
            Map<String, Double> sums = VManagerSessionsClient.fetchSessionAttributeSums(
                    serverUrl, sessions, idToMetrics.keySet(), creds, listener);
            for (Map.Entry<String, List<MetricDefinition>> e : idToMetrics.entrySet()) {
                Double v = sums.get(e.getKey());
                double val = v != null ? v : 0.0;
                for (MetricDefinition m : e.getValue()) {
                    values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), val);
                    listener.getLogger().printf(
                            "[vManager Charts] [%s] '%s' (SESSION_LEVEL id='%s') sessions=%d = %s%n",
                            chartTitle, m.getDisplayName(), e.getKey(), sessions.size(), val);
                }
            }
        } catch (Exception ex) {
            LOGGER.log(Level.WARNING,
                    "Failed to fetch SESSION_LEVEL attributes for chart '" + chartTitle + "'", ex);
            listener.getLogger().printf(
                    "[vManager Charts] WARNING: [%s] could not fetch SESSION_LEVEL attributes: %s%n",
                    chartTitle, ex.getMessage());
            // Record zeros so the chart still has values for this build.
            for (MetricDefinition m : metrics) {
                values.putIfAbsent(
                        CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
            }
        }
    }

    // ── VPLAN_LEVEL ───────────────────────────────────────────────────────

    /**
     * Fetches every VPLAN_LEVEL metric via {@code /rest/vplan/get}. Metrics
     * are grouped by hierarchy (same hierarchy &rarr; one POST). The vPlan
     * name + type come from the {@link ChartDefinition} (one vPlan per
     * chart). Within a hierarchy group the first metric's refinement-files
     * and vplan-refinement-files populate the request context.
     */
    private static void collectVPlanLevel(String serverUrl,
                                          List<String> sessions,
                                          ChartDefinition chart,
                                          List<MetricDefinition> metrics,
                                          StandardUsernamePasswordCredentials creds,
                                          VplanRoutingContext routingCtx,
                                          Map<String, Double> values,
                                          TaskListener listener) {
        if (metrics.isEmpty()) return;

        String chartTitle = chart.getTitle();
        String chartVplan = chart.getVPlanPath();
        boolean dbVplan   = !"FILE".equalsIgnoreCase(chart.getVPlanType());

        // Group ONLY by hierarchy path (treating null/blank as one bucket).
        Map<String, VplanGroup> groups = new LinkedHashMap<>();
        for (MetricDefinition m : metrics) {
            String hierarchy = m.getHierarchyPath();
            String groupKey  = hierarchy.trim();
            VplanGroup g     = groups.get(groupKey);
            if (g == null) {
                g = new VplanGroup(
                        hierarchy,
                        refinementPaths(m.getRefinementFiles()),
                        refinementPaths(m.getVplanRefinementFiles()));
                groups.put(groupKey, g);
            }
            g.metrics.add(m);
        }

        for (VplanGroup g : groups.values()) {
            Map<String, List<MetricDefinition>> idToMetrics = new LinkedHashMap<>();
            for (MetricDefinition m : g.metrics) {
                String id = m.getAttributeId();
                if (id != null && !id.isBlank()) {
                    idToMetrics.computeIfAbsent(id, k -> new ArrayList<>()).add(m);
                }
            }

            if (sessions == null || sessions.isEmpty() || idToMetrics.isEmpty()) {
                for (MetricDefinition m : g.metrics) {
                    values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
                    listener.getLogger().printf(
                            "[vManager Charts] [%s] '%s' (VPLAN_LEVEL) skipped (no sessions or no id) = 0%n",
                            chartTitle, m.getDisplayName());
                }
                continue;
            }

            try {
                Map<String, Double> sums = VManagerVplanClient.fetchVplanMetricSums(
                        serverUrl, g.hierarchy, sessions,
                        g.refinementFiles, g.vplanRefinementFiles,
                        chartVplan, dbVplan,
                        idToMetrics.keySet(), creds, routingCtx, listener);
                for (Map.Entry<String, List<MetricDefinition>> e : idToMetrics.entrySet()) {
                    Double v = sums.get(e.getKey());
                    double val = v != null ? v : 0.0;
                    for (MetricDefinition m : e.getValue()) {
                        values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), val);
                        listener.getLogger().printf(
                                "[vManager Charts] [%s] '%s' (VPLAN_LEVEL id='%s' hierarchy='%s' vplan='%s' type=%s refinement=%d vplan-refinement=%d) = %s%n",
                                chartTitle, m.getDisplayName(), e.getKey(),
                                g.hierarchy == null ? "" : g.hierarchy,
                                chartVplan == null ? "" : chartVplan,
                                dbVplan ? "DB" : "FILE",
                                g.refinementFiles.size(), g.vplanRefinementFiles.size(), val);
                    }
                }
            } catch (Exception ex) {
                LOGGER.log(Level.WARNING,
                        "Failed to fetch VPLAN_LEVEL attributes for chart '" + chartTitle + "'", ex);
                listener.getLogger().printf(
                        "[vManager Charts] WARNING: [%s] could not fetch VPLAN_LEVEL attributes: %s%n",
                        chartTitle, ex.getMessage());
                for (MetricDefinition m : g.metrics) {
                    values.putIfAbsent(
                            CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
                }
            }
        }
    }

    /** Holds VPLAN_LEVEL metrics that share the same hierarchy. */
    private static final class VplanGroup {
        final String hierarchy;
        final List<String> refinementFiles;
        final List<String> vplanRefinementFiles;
        final List<MetricDefinition> metrics = new ArrayList<>();
        VplanGroup(String hierarchy,
                   List<String> refinementFiles, List<String> vplanRefinementFiles) {
            this.hierarchy            = hierarchy;
            this.refinementFiles      = refinementFiles;
            this.vplanRefinementFiles = vplanRefinementFiles;
        }
    }

    // ── COVERAGE_LEVEL ─────────────────────────────────────────────────────

    /**
     * Fetches every COVERAGE_LEVEL metric via {@code /rest/metrics/get}. Metrics
     * that share the same {@code (hierarchy, verificationScope, refinementFiles)}
     * triple are batched into a single POST (their attribute ids go into the
     * {@code projection.selection} array).
     */
    private static void collectCoverageLevel(String serverUrl,
                                             List<String> sessions,
                                             String chartTitle,
                                             List<MetricDefinition> metrics,
                                             StandardUsernamePasswordCredentials creds,
                                             CoverageRoutingContext routingCtx,
                                             Map<String, Double> values,
                                             TaskListener listener) {
        if (metrics.isEmpty()) return;

        // Group ONLY by coverage hierarchy: metrics that share the same
        // hierarchy (treating null/blank as a single "empty" bucket) are
        // combined into one /rest/metrics/get call. Metrics with different
        // hierarchies always issue separate REST calls.
        // Within a hierarchy group we use the FIRST metric's verification
        // scope and refinement-file list to populate the request context.
        Map<String, CoverageGroup> groups = new LinkedHashMap<>();
        for (MetricDefinition m : metrics) {
            String hierarchy = m.getCoverageHierarchy();
            String groupKey  = hierarchy.trim();
            CoverageGroup g  = groups.get(groupKey);
            if (g == null) {
                g = new CoverageGroup(
                        hierarchy,
                        m.getVerificationScope(),
                        refinementPaths(m.getRefinementFiles()));
                groups.put(groupKey, g);
            }
            g.metrics.add(m);
        }

        for (CoverageGroup g : groups.values()) {
            // attribute id -> metrics that requested it (>1 when the user
            // picked the same attribute multiple times in the chart).
            Map<String, List<MetricDefinition>> idToMetrics = new LinkedHashMap<>();
            for (MetricDefinition m : g.metrics) {
                String id = m.getAttributeId();
                if (id != null && !id.isBlank()) {
                    idToMetrics.computeIfAbsent(id, k -> new ArrayList<>()).add(m);
                }
            }

            if (sessions == null || sessions.isEmpty() || idToMetrics.isEmpty()) {
                for (MetricDefinition m : g.metrics) {
                    values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
                    listener.getLogger().printf(
                            "[vManager Charts] [%s] '%s' (COVERAGE_LEVEL) skipped (no sessions or no id) = 0%n",
                            chartTitle, m.getDisplayName());
                }
                continue;
            }

            try {
                Map<String, Double> sums = VManagerMetricsClient.fetchMetricSums(
                        serverUrl, g.hierarchy, g.verificationScope,
                        sessions, g.refinementFiles, idToMetrics.keySet(),
                        creds, routingCtx, listener);
                for (Map.Entry<String, List<MetricDefinition>> e : idToMetrics.entrySet()) {
                    Double v = sums.get(e.getKey());
                    double val = v != null ? v : 0.0;
                    for (MetricDefinition m : e.getValue()) {
                        values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), val);
                        listener.getLogger().printf(
                                "[vManager Charts] [%s] '%s' (COVERAGE_LEVEL id='%s' hierarchy='%s' scope='%s' refinement=%d) = %s%n",
                                chartTitle, m.getDisplayName(), e.getKey(),
                                g.hierarchy == null ? "" : g.hierarchy,
                                g.verificationScope == null ? "" : g.verificationScope,
                                g.refinementFiles.size(), val);
                    }
                }
            } catch (Exception ex) {
                LOGGER.log(Level.WARNING,
                        "Failed to fetch COVERAGE_LEVEL attributes for chart '" + chartTitle + "'", ex);
                listener.getLogger().printf(
                        "[vManager Charts] WARNING: [%s] could not fetch COVERAGE_LEVEL attributes: %s%n",
                        chartTitle, ex.getMessage());
                for (MetricDefinition m : g.metrics) {
                    values.putIfAbsent(
                            CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
                }
            }
        }
    }

    private static List<String> refinementPaths(List<RefinementFile> files) {
        List<String> out = new ArrayList<>();
        if (files == null) return out;
        for (RefinementFile rf : files) {
            if (rf == null) continue;
            String p = rf.getPath();
            if (p != null && !p.isBlank()) out.add(p);
        }
        return out;
    }

    /** Holds metrics that share the same /rest/metrics/get request context. */
    private static final class CoverageGroup {
        final String hierarchy;
        final String verificationScope;
        final List<String> refinementFiles;
        final List<MetricDefinition> metrics = new ArrayList<>();
        CoverageGroup(String hierarchy, String verificationScope, List<String> refinementFiles) {
            this.hierarchy         = hierarchy;
            this.verificationScope = verificationScope;
            this.refinementFiles   = refinementFiles;
        }
    }

    private static void collectUnknown(String chartTitle,
                                       List<MetricDefinition> metrics,
                                       Map<String, Double> values,
                                       TaskListener listener) {
        for (MetricDefinition m : metrics) {
            values.put(CustomMetricsRunListener.key(chartTitle, m.getSeriesKey()), 0.0);
            listener.getLogger().printf(
                    "[vManager Charts] [%s] '%s' (unknown entity type '%s') = 0%n",
                    chartTitle, m.getDisplayName(), m.getEntityType());
        }
    }
}
