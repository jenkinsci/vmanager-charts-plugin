package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;
import hudson.model.Run;
import org.kohsuke.stapler.bind.JavaScriptMethod;

import javax.annotation.CheckForNull;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Build-level action that adds a "vManager Charts" link to every individual
 * build's left sidebar. The page hosts one or more build-scope charts.
 *
 * <p>Currently the page hosts a single chart, the
 * <strong>Regression Optimization Chart</strong> &mdash; a scatter of all
 * runs in the build's vManager session(s), bucketed by duration into
 * Small (green), Medium (orange) and Large (red) thirds. Additional
 * build-level charts can be added to the same page over time.</p>
 *
 * <p>The chart's data is computed at the end of each build by
 * {@code CustomMetricsRunListener} and stored on the build as a
 * {@link RegressionOptimizationBuildAction}; this action simply hands that
 * stored data to the front-end ECharts code via a Stapler proxy.</p>
 */
public class BuildChartAction implements Action {

    private final Run<?, ?> run;

    public BuildChartAction(Run<?, ?> run) {
        this.run = run;
    }

    public Run<?, ?> getRun() {
        return run;
    }

    @Override
    @CheckForNull
    public String getIconFileName() {
        return "symbol-stats-chart-outline plugin-ionicons-api";
    }

    @Override
    @CheckForNull
    public String getDisplayName() {
        return "vManager Charts";
    }

    @Override
    @CheckForNull
    public String getUrlName() {
        return "vmanager-chart";
    }

    /** Page heading: "vManager Charts for build #N". */
    public String getPageHeading() {
        if (run == null) return "vManager Charts";
        return "vManager Charts for build #" + run.getNumber();
    }

    /** Whether the Regression Optimization Chart is enabled on the parent job. */
    public boolean isShowRegressionOptimizationChart() {
        if (run == null) return false;
        VManagerChartsJobProperty p = (VManagerChartsJobProperty)
                run.getParent().getProperty(VManagerChartsJobProperty.class);
        return p != null && p.isEnabled()
                && p.isShowBuildLevelCharts()
                && p.isShowRegressionOptimizationChart();
    }

    // ── Regression Optimization Chart (chart #1) ─────────────────────────

    /**
     * Result returned to the front-end Stapler proxy. Three groups; each
     * group is a list of {@code [endTimeMinutes, durationMinutes]} points.
     */
    public static final class RegressionOptimizationData {
        private final List<double[]> small;
        private final List<double[]> medium;
        private final List<double[]> large;
        private final String error;

        RegressionOptimizationData(List<double[]> small, List<double[]> medium,
                                   List<double[]> large, String error) {
            this.small  = small  == null ? Collections.<double[]>emptyList() : small;
            this.medium = medium == null ? Collections.<double[]>emptyList() : medium;
            this.large  = large  == null ? Collections.<double[]>emptyList() : large;
            this.error  = error;
        }

        public List<double[]> getSmall()  { return small;  }
        public List<double[]> getMedium() { return medium; }
        public List<double[]> getLarge()  { return large;  }
        public String getError()          { return error;  }
    }

    /**
     * Stapler/JS-callable: returns the Regression Optimization data that was
     * fetched and stored on this build at build-completion time.
     */
    @JavaScriptMethod
    public RegressionOptimizationData getRegressionOptimizationData() {
        if (run == null) {
            return new RegressionOptimizationData(null, null, null,
                    "No build context available.");
        }
        RegressionOptimizationBuildAction stored =
                run.getAction(RegressionOptimizationBuildAction.class);
        if (stored == null) {
            return new RegressionOptimizationData(null, null, null,
                    "No regression-optimization data stored on this build "
                            + "(it is computed at build completion; rerun the build "
                            + "after enabling the chart, or check the build log for errors).");
        }
        return new RegressionOptimizationData(
                new ArrayList<>(stored.getSmall()),
                new ArrayList<>(stored.getMedium()),
                new ArrayList<>(stored.getLarge()),
                null);
    }
}
