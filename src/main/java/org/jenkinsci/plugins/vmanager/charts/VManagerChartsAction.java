package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;
import hudson.model.Job;
import hudson.model.Run;
import org.jenkinsci.plugins.vmanager.charts.data.BuildStatisticsCollector;
import org.jenkinsci.plugins.vmanager.charts.data.TestResultsCollector;
import org.jenkinsci.plugins.vmanager.charts.model.ChartData;
import org.jenkinsci.plugins.vmanager.charts.model.ChartDefinition;
import org.jenkinsci.plugins.vmanager.charts.model.MetricDefinition;
import org.kohsuke.stapler.bind.JavaScriptMethod;

import javax.annotation.CheckForNull;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Action that adds "vManager Charts" link to job sidebar.
 * Handles rendering of the vManager charts page.
 */
public class VManagerChartsAction implements Action {

    @SuppressWarnings("unused") // read by Stapler / Jelly via getJob()
    private final Job<?, ?> job;

    public VManagerChartsAction(Job<?, ?> job) {
        this.job = job;
    }

    @Override
    @CheckForNull
    public String getIconFileName() {
        return "symbol-stats-chart-outline plugin-ionicons-api";
    }

    @Override
    @CheckForNull
    public String getDisplayName() {
        return Messages.VManagerCharts_DisplayName();
    }

    @Override
    @CheckForNull
    public String getUrlName() {
        return "vmanager-charts";
    }

    public Job<?, ?> getJob() {
        return job;
    }

    public boolean isShowBuildDuration() {
        return getProperty() == null || getProperty().isShowBuildDuration();
    }

    public boolean isShowSuccessRate() {
        return getProperty() == null || getProperty().isShowSuccessRate();
    }

    public boolean isShowTestResults() {
        return getProperty() == null || getProperty().isShowTestResults();
    }

    private VManagerChartsJobProperty getProperty() {
        return (VManagerChartsJobProperty) job.getProperty(VManagerChartsJobProperty.class);
    }

    public boolean isShowCustomMetrics() {
        VManagerChartsJobProperty p = getProperty();
        return p != null && p.isEnabled() && !p.getCustomCharts().isEmpty();
    }

    /** Used by index.jelly to render one container per configured chart. */
    public List<String> getCustomChartTitles() {
        VManagerChartsJobProperty p = getProperty();
        if (p == null) {
            return Collections.emptyList();
        }
        List<String> titles = new ArrayList<>();
        for (ChartDefinition c : p.getCustomCharts()) {
            titles.add(c.getTitle());
        }
        return titles;
    }

    /**
     * Returns one {@link ChartData} per configured custom chart, where each
     * ChartData contains one series per metric in that chart (each series may
     * carry its own type: line/bar/column).
     */
    @JavaScriptMethod
    public List<ChartData> getCustomMetricsData() {
        VManagerChartsJobProperty p = getProperty();
        if (p == null || p.getCustomCharts().isEmpty()) {
            return Collections.emptyList();
        }

        List<ChartData> result = new ArrayList<>();
        for (ChartDefinition chart : p.getCustomCharts()) {
            int chartMax = chart.getMaxBuilds(); // 0 = unlimited

            // Per-chart: walk newest -> oldest builds that have a CustomMetricsBuildAction,
            // bounded by this chart's own maxBuilds.
            List<String> buildLabels = new ArrayList<>();
            Map<String, List<Double>> valuesByKey = new LinkedHashMap<>();
            for (MetricDefinition md : chart.getMetrics()) {
                valuesByKey.put(
                        CustomMetricsRunListener.key(chart.getTitle(), md.getSeriesKey()),
                        new ArrayList<>());
            }

            int matched = 0;
            for (Run<?, ?> build : job.getBuilds()) {
                if (chartMax > 0 && matched >= chartMax) break;
                CustomMetricsBuildAction action = build.getAction(CustomMetricsBuildAction.class);
                if (action == null) continue;

                buildLabels.add("#" + build.getNumber());
                for (Map.Entry<String, List<Double>> e : valuesByKey.entrySet()) {
                    Double val = action.getMetrics().get(e.getKey());
                    e.getValue().add(val != null ? val : 0.0);
                }
                matched++;
            }

            Collections.reverse(buildLabels);
            for (List<Double> values : valuesByKey.values()) {
                Collections.reverse(values);
            }

            ChartData chartData = new ChartData();
            chartData.setLabels(buildLabels);
            chartData.setChartType("line");
            chartData.setOption("title", chart.getTitle());
            for (MetricDefinition md : chart.getMetrics()) {
                String k = CustomMetricsRunListener.key(chart.getTitle(), md.getSeriesKey());
                chartData.addSeries(md.getDisplayName(), valuesByKey.get(k), md.getChartType());
            }
            result.add(chartData);
        }
        return result;
    }

    @JavaScriptMethod
    public ChartData getBuildDurationData() {
        return new BuildStatisticsCollector(job, getMaxBuilds()).collectBuildDurations();
    }

    @JavaScriptMethod
    public ChartData getSuccessRateData() {
        return new BuildStatisticsCollector(job, getMaxBuilds()).collectSuccessRates();
    }

    @JavaScriptMethod
    public ChartData getTestResultsData() {
        return new TestResultsCollector(job, getMaxBuilds()).collectTestResults();
    }

    /**
     * Resolve the user-configured max-builds setting from the
     * {@link VManagerChartsJobProperty}, falling back to {@code 50} when
     * the property is not attached (legacy jobs).
     */
    private int getMaxBuilds() {
        VManagerChartsJobProperty p = job.getProperty(VManagerChartsJobProperty.class);
        return p != null ? p.getMaxBuilds() : 50;
    }
}
