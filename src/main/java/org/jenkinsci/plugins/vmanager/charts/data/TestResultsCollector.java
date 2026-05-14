package org.jenkinsci.plugins.vmanager.charts.data;

import hudson.model.Job;
import hudson.model.Run;
import hudson.tasks.test.AbstractTestResultAction;
import org.jenkinsci.plugins.vmanager.charts.model.ChartData;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Collects test results statistics from job history.
 */
public class TestResultsCollector {

    private final Job<?, ?> job;
    /** Maximum number of recent builds to scan; {@code <= 0} means unlimited. */
    private final int maxBuilds;

    public TestResultsCollector(Job<?, ?> job, int maxBuilds) {
        this.job = job;
        this.maxBuilds = maxBuilds;
    }

    private boolean reachedLimit(int count) {
        return maxBuilds > 0 && count >= maxBuilds;
    }

    /**
     * Collect test results trend data.
     * Returns passed/failed/skipped test counts over time.
     */
    public ChartData collectTestResults() {
        ChartData chartData = new ChartData();
        List<String> buildNumbers = new ArrayList<>();
        List<String> buildUrls = new ArrayList<>();
        List<Integer> passedCounts = new ArrayList<>();
        List<Integer> failedCounts = new ArrayList<>();
        List<Integer> skippedCounts = new ArrayList<>();

        int count = 0;
        for (Run<?, ?> build : job.getBuilds()) {
            if (reachedLimit(count)) break;
            count++;

            AbstractTestResultAction<?> testAction = build.getAction(AbstractTestResultAction.class);

            if (testAction != null) {
                buildNumbers.add("#" + build.getNumber());
                buildUrls.add(build.getUrl() + "testReport/");

                int totalCount = testAction.getTotalCount();
                int failCount = testAction.getFailCount();
                int skipCount = testAction.getSkipCount();
                int passCount = totalCount - failCount - skipCount;

                passedCounts.add(passCount);
                failedCounts.add(failCount);
                skippedCounts.add(skipCount);
            }
        }

        Collections.reverse(buildNumbers);
        Collections.reverse(buildUrls);
        Collections.reverse(passedCounts);
        Collections.reverse(failedCounts);
        Collections.reverse(skippedCounts);

        chartData.setLabels(buildNumbers);
        chartData.setUrls(buildUrls);
        chartData.addSeries("Passed", passedCounts);
        chartData.addSeries("Failed", failedCounts);
        chartData.addSeries("Skipped", skippedCounts);
        chartData.setChartType("bar");
        chartData.setStacked(true);

        return chartData;
    }
}
