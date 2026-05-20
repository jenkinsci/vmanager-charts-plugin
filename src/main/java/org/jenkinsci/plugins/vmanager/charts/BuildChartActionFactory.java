package org.jenkinsci.plugins.vmanager.charts;

import hudson.Extension;
import hudson.model.Action;
import hudson.model.Job;
import hudson.model.Run;
import jenkins.model.TransientActionFactory;
import org.jenkinsci.plugins.vmanager.charts.util.JsonConfigLoader;

import edu.umd.cs.findbugs.annotations.NonNull;
import java.util.Collection;
import java.util.Collections;

/**
 * Attaches a {@link BuildChartAction} to every build whose parent job has
 * the "Build Level Charts" option enabled and at least one build-level
 * chart selected. The action shows a "vManager Charts" link in the
 * individual build's left sidebar.
 */
@Extension
public class BuildChartActionFactory extends TransientActionFactory<Run> {

    @Override
    public Class<Run> type() {
        return Run.class;
    }

    @NonNull
    @Override
    public Collection<? extends Action> createFor(@NonNull Run target) {
        Job<?, ?> job = target.getParent();
        VManagerChartsJobProperty gui =
                (VManagerChartsJobProperty) job.getProperty(VManagerChartsJobProperty.class);
        // When configSource=FILE, consult the JSON the build mirrored so
        // the build-level sidebar link reflects what the build produced.
        VManagerChartsJobProperty p = JsonConfigLoader.effectiveForRun(target, gui);
        if (p == null || !p.isEnabled() || !p.isShowBuildLevelCharts()) {
            return Collections.emptyList();
        }
        if (!p.isShowRegressionOptimizationChart()) {
            // No build-level charts selected — nothing to render, hide the link.
            return Collections.emptyList();
        }
        return Collections.singleton(new BuildChartAction(target));
    }
}
