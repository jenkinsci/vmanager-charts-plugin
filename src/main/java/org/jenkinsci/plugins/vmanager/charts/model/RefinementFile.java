package org.jenkinsci.plugins.vmanager.charts.model;

import hudson.Extension;
import hudson.model.AbstractDescribableImpl;
import hudson.model.Descriptor;
import org.kohsuke.stapler.DataBoundConstructor;

import javax.annotation.Nonnull;

/**
 * One full filesystem path to a vManager refinement (or vPlan refinement) file.
 *
 * <p>Used as the row type for the repeatable path lists on a
 * {@link MetricDefinition} (Coverage / vPlan refinement files).</p>
 */
public class RefinementFile extends AbstractDescribableImpl<RefinementFile> {

    private final String path;

    @DataBoundConstructor
    public RefinementFile(String path) {
        this.path = path == null ? "" : path.trim();
    }

    public String getPath() {
        return path == null ? "" : path;
    }

    @Extension
    public static class DescriptorImpl extends Descriptor<RefinementFile> {
        @Nonnull
        @Override
        public String getDisplayName() {
            return "Refinement File";
        }
    }
}
