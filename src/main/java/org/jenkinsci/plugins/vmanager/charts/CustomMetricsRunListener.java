package org.jenkinsci.plugins.vmanager.charts;

import com.cloudbees.plugins.credentials.CredentialsMatchers;
import com.cloudbees.plugins.credentials.CredentialsProvider;
import com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials;
import com.cloudbees.plugins.credentials.domains.URIRequirementBuilder;
import hudson.Extension;
import hudson.FilePath;
import hudson.model.Job;
import hudson.model.Run;
import hudson.model.TaskListener;
import hudson.model.listeners.RunListener;
import hudson.security.ACL;
import org.jenkinsci.plugins.vmanager.charts.model.ChartDefinition;
import org.jenkinsci.plugins.vmanager.charts.util.CoverageRoutingContext;
import org.jenkinsci.plugins.vmanager.charts.util.VManagerChartsUtil;
import org.jenkinsci.plugins.vmanager.charts.util.VManagerRunsClient;
import org.jenkinsci.plugins.vmanager.charts.util.VManagerSessionsClient;
import org.jenkinsci.plugins.vmanager.charts.util.VplanRoutingContext;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Fires after every build completes. For each configured Custom Chart, fetches
 * each metric's value from the vManager REST API and stores the values
 * (keyed by "chartTitle::attributeName") on a {@link CustomMetricsBuildAction}.
 */
@Extension
public class CustomMetricsRunListener extends RunListener<Run<?, ?>> {

    private static final Logger LOGGER = Logger.getLogger(CustomMetricsRunListener.class.getName());

    public static String key(String chartTitle, String attributeName) {
        return (chartTitle == null ? "" : chartTitle) + "::" + (attributeName == null ? "" : attributeName);
    }

    @Override
    public void onCompleted(Run<?, ?> run, TaskListener listener) {
        Job<?, ?> job = run.getParent();
        VManagerChartsJobProperty property =
                (VManagerChartsJobProperty) job.getProperty(VManagerChartsJobProperty.class);

        if (property == null || !property.isEnabled()) {
            return;
        }

        String serverUrl = property.getServerUrl();
        if (serverUrl == null || serverUrl.isBlank()) {
            listener.getLogger().println(
                    "[vManager Charts] WARNING: vManager Server URL not configured for this job. Skipping.");
            return;
        }

        StandardUsernamePasswordCredentials creds = lookupCredentials(job, property.getCredentialsId(), serverUrl);
        if (creds == null) {
            listener.getLogger().println(
                    "[vManager Charts] WARNING: credentials not found (id='"
                            + property.getCredentialsId() + "'). Skipping.");
            return;
        }

        // Resolve which vManager session(s) this build is associated with.
        FilePath workspace = VManagerChartsUtil.getCurrentWorkspace(run);
        FilePath sessionsFile = VManagerChartsUtil.resolveSessionsInputFile(
                run, workspace, property.getSessionSource(), property.getSessionInputFile());
        List<String> sessions;
        try {
            sessions = VManagerChartsUtil.readSessionNames(sessionsFile);
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Failed to read sessions input file "
                    + (sessionsFile == null ? "<null>" : sessionsFile.getRemote()), e);
            listener.getLogger().println(
                    "[vManager Charts] WARNING: could not read sessions input file "
                    + (sessionsFile == null ? "<null>" : sessionsFile.getRemote())
                    + ": " + e.getMessage());
            sessions = java.util.Collections.emptyList();
        }
        if (sessionsFile != null) {
            listener.getLogger().println("[vManager Charts] sessions input file: "
                    + sessionsFile.getRemote()
                    + " (" + sessions.size() + " session" + (sessions.size() == 1 ? "" : "s") + ")");
        }
        for (String s : sessions) {
            listener.getLogger().println("[vManager Charts]   session: " + s);
        }

        // ── Per-build session run-state aggregates (used by Success/Failure chart) ──
        boolean savedAction = false;
        if (property.isShowSuccessRate() && !sessions.isEmpty()) {
            try {
                VManagerSessionsClient.SessionAggregates agg =
                        VManagerSessionsClient.fetchAggregated(serverUrl, sessions, creds, listener);
                run.addAction(new SessionStatsBuildAction(
                        agg.passedRuns, agg.failedRuns, agg.running,
                        agg.waiting, agg.otherRuns, sessions.size()));
                savedAction = true;
                listener.getLogger().printf(
                        "[vManager Charts] session run state: passed=%d failed=%d running=%d waiting=%d other=%d (rows=%d)%n",
                        agg.passedRuns, agg.failedRuns, agg.running, agg.waiting,
                        agg.otherRuns, agg.rowCount);
            } catch (Exception e) {
                LOGGER.log(Level.WARNING, "Failed to fetch session aggregates from vManager", e);
                listener.getLogger().println(
                        "[vManager Charts] WARNING: could not fetch session aggregates: " + e.getMessage());
            }
        }

        // ── Per-build Regression Optimization Chart data ─────────────────────
        if (property.isShowBuildLevelCharts()
                && property.isShowRegressionOptimizationChart()
                && !sessions.isEmpty()) {
            try {
                long sessionStartMs = VManagerRunsClient.fetchSessionStartMillis(
                        serverUrl, sessions, creds, listener);
                List<VManagerRunsClient.RunPoint> points =
                        VManagerRunsClient.fetchRunPoints(
                                serverUrl, sessions, sessionStartMs, creds, listener);
                int n = points.size();
                List<double[]> small  = new java.util.ArrayList<>();
                List<double[]> medium = new java.util.ArrayList<>();
                List<double[]> large  = new java.util.ArrayList<>();
                if (n > 0) {
                    int third     = n / 3;
                    int smallEnd  = third;
                    int mediumEnd = third + third;
                    for (int i = 0; i < n; i++) {
                        VManagerRunsClient.RunPoint pt = points.get(i);
                        double[] xy = new double[]{ pt.timeToEndMinutes, pt.durationMinutes };
                        if (i < smallEnd)        small.add(xy);
                        else if (i < mediumEnd)  medium.add(xy);
                        else                     large.add(xy);
                    }
                }
                run.addAction(new RegressionOptimizationBuildAction(small, medium, large));
                savedAction = true;
                listener.getLogger().printf(
                        "[vManager Charts] regression optimization: rows=%d small=%d medium=%d large=%d%n",
                        n, small.size(), medium.size(), large.size());
            } catch (Exception e) {
                LOGGER.log(Level.WARNING, "Failed to fetch regression-optimization data from vManager", e);
                listener.getLogger().println(
                        "[vManager Charts] WARNING: could not fetch regression-optimization data: " + e.getMessage());
            }
        }

        // ── Custom-metric collection (delegated to CustomMetricsCollector) ────
        List<ChartDefinition> charts = property.isShowCustomMetrics()
                ? property.getCustomCharts() : java.util.Collections.<ChartDefinition>emptyList();

        Map<String, Double> collected = new LinkedHashMap<>();
        // Per-build routing-OID holder shared across every COVERAGE_LEVEL call
        // for every chart in this build. Reset implicitly each build because
        // a fresh context is created here.
        CoverageRoutingContext routingCtx = new CoverageRoutingContext();
        // Per-build routing-OID holder for VPLAN_LEVEL calls, keyed by
        // (vplan, type). Same (vplan, type) may carry its OID across charts
        // within this build; a different (vplan, type) starts a fresh chain.
        VplanRoutingContext vplanRoutingCtx = new VplanRoutingContext();
        for (ChartDefinition chart : charts) {
            collected.putAll(
                    org.jenkinsci.plugins.vmanager.charts.util.CustomMetricsCollector.collect(
                            serverUrl, sessions, chart, creds, routingCtx, vplanRoutingCtx, listener));
        }

        if (!collected.isEmpty()) {
            run.addAction(new CustomMetricsBuildAction(collected));
            savedAction = true;
        }

        if (savedAction) {
            try {
                run.save();
            } catch (IOException e) {
                LOGGER.log(Level.WARNING, "Failed to persist build actions for " + run, e);
            }
        }
    }

    private StandardUsernamePasswordCredentials lookupCredentials(Job<?, ?> job, String credentialsId, String serverUrl) {
        if (credentialsId == null || credentialsId.isBlank()) {
            return null;
        }
        List<StandardUsernamePasswordCredentials> candidates = CredentialsProvider.lookupCredentialsInItem(
                StandardUsernamePasswordCredentials.class,
                job,
                ACL.SYSTEM2,
                URIRequirementBuilder.fromUri(serverUrl).build());
        return CredentialsMatchers.firstOrNull(
                candidates,
                CredentialsMatchers.withId(credentialsId));
    }
}
