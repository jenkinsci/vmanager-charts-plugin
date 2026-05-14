package org.jenkinsci.plugins.vmanager.charts.data;

import hudson.model.Job;
import hudson.model.Run;
import org.jenkinsci.plugins.vmanager.charts.SessionStatsBuildAction;
import org.jenkinsci.plugins.vmanager.charts.model.ChartData;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Collects build statistics from job history.
 */
public class BuildStatisticsCollector {

    private final Job<?, ?> job;
    /** Maximum number of recent builds to scan; {@code <= 0} means unlimited. */
    private final int maxBuilds;

    public BuildStatisticsCollector(Job<?, ?> job, int maxBuilds) {
        this.job = job;
        this.maxBuilds = maxBuilds;
    }

    private boolean reachedLimit(int count) {
        return maxBuilds > 0 && count >= maxBuilds;
    }

    /**
     * Collect build duration data for all builds.
     * Returns data formatted for ECharts time-series chart.
     */
    public ChartData collectBuildDurations() {
        ChartData chartData = new ChartData();
        List<String> buildNumbers = new ArrayList<>();
        List<Long> durations = new ArrayList<>();

        int count = 0;
        for (Run<?, ?> build : job.getBuilds()) {
            if (reachedLimit(count)) break;
            count++;

            buildNumbers.add("#" + build.getNumber());
            durations.add(build.getDuration() / 1000);
        }

        Collections.reverse(buildNumbers);
        Collections.reverse(durations);

        chartData.setLabels(buildNumbers);
        chartData.addSeries("Duration (seconds)", durations);
        chartData.setChartType("line");

        return chartData;
    }

    /**
     * Collect per-build session run-state data for the stacked bar chart.
     * One bar per Jenkins build that has a {@link SessionStatsBuildAction}
     * (i.e. one whose vManager session aggregates have been collected).
     * Series: Passed / Failed / Running / Waiting / Other.
     */
    public ChartData collectSuccessRates() {
        ChartData chartData = new ChartData();

        List<String> labels = new ArrayList<>();
        List<Integer> passed   = new ArrayList<>();
        List<Integer> failed   = new ArrayList<>();
        List<Integer> running  = new ArrayList<>();
        List<Integer> waiting  = new ArrayList<>();
        List<Integer> other    = new ArrayList<>();

        int scanned = 0;
        for (Run<?, ?> build : job.getBuilds()) {
            if (reachedLimit(scanned)) break;
            scanned++;

            SessionStatsBuildAction a = build.getAction(SessionStatsBuildAction.class);
            if (a == null) continue;

            labels.add("#" + build.getNumber());
            passed.add(a.getPassedRuns());
            failed.add(a.getFailedRuns());
            running.add(a.getRunning());
            waiting.add(a.getWaiting());
            other.add(a.getOtherRuns());
        }

        // Builds were iterated newest → oldest; reverse so the chart reads left-to-right.
        Collections.reverse(labels);
        Collections.reverse(passed);
        Collections.reverse(failed);
        Collections.reverse(running);
        Collections.reverse(waiting);
        Collections.reverse(other);

        chartData.setLabels(labels);
        chartData.addSeries("Passed",  passed);
        chartData.addSeries("Failed",  failed);
        chartData.addSeries("Running", running);
        chartData.addSeries("Waiting", waiting);
        chartData.addSeries("Other",   other);
        chartData.setChartType("bar");
        chartData.setStacked(true);

        return chartData;
    }
}
