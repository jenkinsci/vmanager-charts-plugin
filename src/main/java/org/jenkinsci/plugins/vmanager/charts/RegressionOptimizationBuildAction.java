package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Per-build action that records the data for the
 * <strong>Regression Optimization Chart</strong>: every run that belongs to
 * the build's vManager session(s) bucketed into Small / Medium / Large
 * thirds by duration.
 *
 * <p>Each point is a two-element array {@code [endTimeMinutes,
 * durationMinutes]} (already converted from the raw {@code end_time} ms
 * and {@code duration} seconds returned by vManager).</p>
 *
 * <p>Hidden from the sidebar (null icon/display/url); the data is consumed
 * by {@link BuildChartAction#getRegressionOptimizationData()}.</p>
 */
public class RegressionOptimizationBuildAction implements Action, Serializable {

    private static final long serialVersionUID = 1L;

    private final List<double[]> small;
    private final List<double[]> medium;
    private final List<double[]> large;

    public RegressionOptimizationBuildAction(List<double[]> small,
                                             List<double[]> medium,
                                             List<double[]> large) {
        this.small  = small  == null ? new ArrayList<>() : new ArrayList<>(small);
        this.medium = medium == null ? new ArrayList<>() : new ArrayList<>(medium);
        this.large  = large  == null ? new ArrayList<>() : new ArrayList<>(large);
    }

    public List<double[]> getSmall()  { return Collections.unmodifiableList(small);  }
    public List<double[]> getMedium() { return Collections.unmodifiableList(medium); }
    public List<double[]> getLarge()  { return Collections.unmodifiableList(large);  }

    @Override public String getIconFileName() { return null; }
    @Override public String getDisplayName()  { return null; }
    @Override public String getUrlName()      { return null; }
}
