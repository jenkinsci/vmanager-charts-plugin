package org.jenkinsci.plugins.vmanager.charts;

import hudson.Extension;
import hudson.model.Action;
import hudson.model.Job;
import jenkins.model.TransientActionFactory;

import javax.annotation.Nonnull;
import java.util.Collection;
import java.util.Collections;

/**
 * Factory that adds VManagerChartsAction to all Jenkins jobs.
 * This makes the "vManager Charts" link appear in the job sidebar.
 */
@Extension
public class VManagerChartsActionFactory extends TransientActionFactory<Job> {

    @Override
    public Class<Job> type() {
        return Job.class;
    }

    @Nonnull
    @Override
    public Collection<? extends Action> createFor(@Nonnull Job target) {
        VManagerChartsJobProperty property =
                (VManagerChartsJobProperty) target.getProperty(VManagerChartsJobProperty.class);
        if (property == null || !property.isEnabled()) {
            return Collections.emptyList();
        }
        return Collections.singleton(new VManagerChartsAction(target));
    }
}
