package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Attached to a Run after build completion to persist the fetched custom metric values.
 * Hidden from the sidebar (null icon/display/url).
 */
public class CustomMetricsBuildAction implements Action {

    private final Map<String, Double> metrics;

    public CustomMetricsBuildAction(Map<String, Double> metrics) {
        this.metrics = new LinkedHashMap<>(metrics);
    }

    public Map<String, Double> getMetrics() {
        return Collections.unmodifiableMap(metrics);
    }

    @Override
    public String getIconFileName() {
        return null;
    }

    @Override
    public String getDisplayName() {
        return null;
    }

    @Override
    public String getUrlName() {
        return null;
    }
}
