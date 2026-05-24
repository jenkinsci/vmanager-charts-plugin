package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;

import java.io.Serializable;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Per-build action that records the result of one grouped-runs heat-map
 * REST query. One instance is stored on the build per configured
 * {@link org.jenkinsci.plugins.vmanager.charts.model.GroupedRunsChartDefinition},
 * distinguished by {@link #getChartTitle()}.
 *
 * <p>The {@link #counts} map preserves the server's DESCENDING-by-count
 * order. Hidden from the sidebar (null icon/display/url); consumed by
 * {@link VManagerChartsAction}.</p>
 *
 * <p>This class is still named {@code FailureTriageBuildAction} for
 * backward compatibility with build XMLs written by earlier versions of
 * the plugin that only supported a single hard-coded "Failure Triage"
 * heat-map. The {@code chartTitle} field defaults to an empty string
 * when reading legacy data.</p>
 */
public class FailureTriageBuildAction implements Action, Serializable {

    private static final long serialVersionUID = 1L;

    /** Title of the chart this action belongs to (empty for legacy data). */
    private String chartTitle = "";
    /** Id of the run attribute the data was grouped by (empty for legacy data). */
    private String groupByAttributeId = "";
    private final LinkedHashMap<String, Integer> counts;

    public FailureTriageBuildAction(Map<String, Integer> counts) {
        this("", "", counts);
    }

    public FailureTriageBuildAction(String chartTitle,
                                    String groupByAttributeId,
                                    Map<String, Integer> counts) {
        this.chartTitle         = chartTitle == null ? "" : chartTitle;
        this.groupByAttributeId = groupByAttributeId == null ? "" : groupByAttributeId;
        this.counts = counts == null ? new LinkedHashMap<>() : new LinkedHashMap<>(counts);
    }

    public String getChartTitle()         { return chartTitle == null ? "" : chartTitle; }
    public String getGroupByAttributeId() { return groupByAttributeId == null ? "" : groupByAttributeId; }

    public Map<String, Integer> getCounts() {
        return Collections.unmodifiableMap(counts);
    }

    @Override public String getIconFileName() { return null; }
    @Override public String getDisplayName()  { return null; }
    @Override public String getUrlName()      { return null; }
}
