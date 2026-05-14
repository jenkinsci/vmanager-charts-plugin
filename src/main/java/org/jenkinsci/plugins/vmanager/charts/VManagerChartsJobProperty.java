package org.jenkinsci.plugins.vmanager.charts;

import com.cloudbees.plugins.credentials.CredentialsMatchers;
import com.cloudbees.plugins.credentials.CredentialsProvider;
import com.cloudbees.plugins.credentials.common.StandardListBoxModel;
import com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials;
import com.cloudbees.plugins.credentials.domains.URIRequirementBuilder;
import hudson.Extension;
import hudson.model.Item;
import hudson.model.Job;
import hudson.model.JobProperty;
import hudson.model.JobPropertyDescriptor;
import hudson.security.ACL;
import hudson.util.FormValidation;
import hudson.util.ListBoxModel;
import org.jenkinsci.plugins.vmanager.charts.model.ChartDefinition;
import jenkins.model.Jenkins;
import org.kohsuke.stapler.AncestorInPath;
import org.kohsuke.stapler.DataBoundConstructor;
import org.kohsuke.stapler.DataBoundSetter;
import org.kohsuke.stapler.QueryParameter;

import javax.annotation.Nonnull;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Job property that enables vManager Charts for a job and configures
 * which charts are displayed. Rendered in the job's General configuration section.
 */
public class VManagerChartsJobProperty extends JobProperty<Job<?, ?>> {

    private boolean enabled = true;
    private boolean showBuildDuration = true;
    private boolean showSuccessRate = true;
    private boolean showTestResults = true;
    private boolean showCustomMetrics = false;
    private boolean showBuildLevelCharts = false;
    private boolean showRegressionOptimizationChart = false;
    private String serverUrl;
    private String credentialsId;
    private String vManagerSchema = "latest";
    /** Number of most-recent builds to include in built-in charts; 0 = no limit. */
    private int maxBuilds = 50;
    /**
     * How the vManager session name(s) for this build are obtained.
     * "PLUGIN" = leverage info recorded by the vManager Jenkins Plugin.
     * "FILE"   = read session names from a text file (one per line).
     */
    private String sessionSource = "PLUGIN";
    /**
     * When {@link #sessionSource} = "FILE", absolute or workspace-relative path
     * to the file containing session names (one per line). When blank, the
     * plugin will look in the build's workspace for
     * {@code ${BUILD_NUMBER}.${BUILD_ID}.sessions.input}.
     */
    private String sessionInputFile = "";
    private List<ChartDefinition> customCharts = new ArrayList<>();

    @DataBoundConstructor
    public VManagerChartsJobProperty() {
    }

    public boolean isEnabled() {
        return enabled;
    }

    @DataBoundSetter
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isShowBuildDuration() {
        return showBuildDuration;
    }

    @DataBoundSetter
    public void setShowBuildDuration(boolean showBuildDuration) {
        this.showBuildDuration = showBuildDuration;
    }

    public boolean isShowSuccessRate() {
        return showSuccessRate;
    }

    @DataBoundSetter
    public void setShowSuccessRate(boolean showSuccessRate) {
        this.showSuccessRate = showSuccessRate;
    }

    public boolean isShowTestResults() {
        return showTestResults;
    }

    @DataBoundSetter
    public void setShowTestResults(boolean showTestResults) {
        this.showTestResults = showTestResults;
    }

    public boolean isShowCustomMetrics() {
        return showCustomMetrics;
    }

    @DataBoundSetter
    public void setShowCustomMetrics(boolean showCustomMetrics) {
        this.showCustomMetrics = showCustomMetrics;
    }

    public boolean isShowBuildLevelCharts() {
        return showBuildLevelCharts;
    }

    @DataBoundSetter
    public void setShowBuildLevelCharts(boolean showBuildLevelCharts) {
        this.showBuildLevelCharts = showBuildLevelCharts;
    }

    public boolean isShowRegressionOptimizationChart() {
        return showRegressionOptimizationChart;
    }

    @DataBoundSetter
    public void setShowRegressionOptimizationChart(boolean showRegressionOptimizationChart) {
        this.showRegressionOptimizationChart = showRegressionOptimizationChart;
    }

    public String getServerUrl() {
        return serverUrl;
    }

    @DataBoundSetter
    public void setServerUrl(String serverUrl) {
        this.serverUrl = serverUrl;
    }

    public String getCredentialsId() {
        return credentialsId;
    }

    @DataBoundSetter
    public void setCredentialsId(String credentialsId) {
        this.credentialsId = credentialsId;
    }

    public String getVManagerSchema() {
        return vManagerSchema == null || vManagerSchema.isBlank() ? "latest" : vManagerSchema;
    }

    @DataBoundSetter
    public void setVManagerSchema(String vManagerSchema) {
        this.vManagerSchema = vManagerSchema;
    }

    public List<ChartDefinition> getCustomCharts() {
        if (!showCustomMetrics) {
            return Collections.emptyList();
        }
        return customCharts == null ? Collections.emptyList() : customCharts;
    }

    @DataBoundSetter
    public void setCustomCharts(List<ChartDefinition> customCharts) {
        this.customCharts = customCharts != null ? customCharts : new ArrayList<>();
    }

    /** Number of most-recent builds to include in built-in charts; 0 = unlimited. */
    public int getMaxBuilds() {
        return maxBuilds;
    }

    @DataBoundSetter
    public void setMaxBuilds(int maxBuilds) {
        this.maxBuilds = Math.max(0, maxBuilds);
    }

    public String getSessionSource() {
        return sessionSource == null || sessionSource.isBlank() ? "PLUGIN" : sessionSource;
    }

    @DataBoundSetter
    public void setSessionSource(String sessionSource) {
        this.sessionSource = sessionSource == null || sessionSource.isBlank()
                ? "PLUGIN" : sessionSource;
    }

    public String getSessionInputFile() {
        return sessionInputFile == null ? "" : sessionInputFile;
    }

    @DataBoundSetter
    public void setSessionInputFile(String sessionInputFile) {
        this.sessionInputFile = sessionInputFile == null ? "" : sessionInputFile.trim();
    }

    @Extension
    public static class DescriptorImpl extends JobPropertyDescriptor {

        @Nonnull
        @Override
        public String getDisplayName() {
            return "vManager Charts";
        }

        @Override
        public boolean isApplicable(Class<? extends Job> jobType) {
            return true;
        }

        public ListBoxModel doFillCredentialsIdItems(@AncestorInPath Item item,
                                                     @QueryParameter String credentialsId,
                                                     @QueryParameter String serverUrl) {
            StandardListBoxModel result = new StandardListBoxModel();
            if (item == null) {
                if (!Jenkins.get().hasPermission(Jenkins.ADMINISTER)) {
                    return result.includeCurrentValue(credentialsId);
                }
            } else {
                if (!item.hasPermission(Item.EXTENDED_READ)
                        && !item.hasPermission(CredentialsProvider.USE_ITEM)) {
                    return result.includeCurrentValue(credentialsId);
                }
            }
            return result
                    .includeEmptyValue()
                    .includeMatchingAs(
                            ACL.SYSTEM2,
                            item,
                            StandardUsernamePasswordCredentials.class,
                            URIRequirementBuilder.fromUri(serverUrl).build(),
                            CredentialsMatchers.always())
                    .includeCurrentValue(credentialsId);
        }

        public FormValidation doCheckServerUrl(@QueryParameter String value) {
            if (value == null || value.isBlank()) {
                return FormValidation.error("vManager Server URL is required.");
            }
            if (!value.startsWith("http://") && !value.startsWith("https://")) {
                return FormValidation.error("URL must start with http:// or https://");
            }
            return FormValidation.ok();
        }

        public FormValidation doCheckCredentialsId(@AncestorInPath Item item,
                                                    @QueryParameter String value) {
            if (value == null || value.isBlank()) {
                return FormValidation.error("Credentials are required.");
            }
            return FormValidation.ok();
        }

        public ListBoxModel doFillSessionSourceItems() {
            ListBoxModel m = new ListBoxModel();
            m.add("Leverage vManager Jenkins Plugin Information", "PLUGIN");
            m.add("Input file name",                              "FILE");
            return m;
        }

        public FormValidation doCheckMaxBuilds(@QueryParameter String value) {
            if (value == null || value.isBlank()) {
                return FormValidation.error("Maximum builds is required (use 0 for unlimited).");
            }
            int n;
            try {
                n = Integer.parseInt(value.trim());
            } catch (NumberFormatException e) {
                return FormValidation.error("Must be a whole number (0 for unlimited).");
            }
            if (n < 0) {
                return FormValidation.error("Must be 0 or greater (0 = unlimited).");
            }
            if (n == 0) {
                return FormValidation.warning(
                        "0 means no limit — all builds in the job history will be scanned. "
                        + "This may be slow on jobs with very long history.");
            }
            return FormValidation.ok();
        }
    }
}
