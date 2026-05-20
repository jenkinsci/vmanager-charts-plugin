package org.jenkinsci.plugins.vmanager.charts;

import edu.umd.cs.findbugs.annotations.NonNull;
import hudson.Extension;
import hudson.FilePath;
import hudson.model.Run;
import hudson.model.TaskListener;
import org.jenkinsci.plugins.workflow.steps.Step;
import org.jenkinsci.plugins.workflow.steps.StepContext;
import org.jenkinsci.plugins.workflow.steps.StepDescriptor;
import org.jenkinsci.plugins.workflow.steps.StepExecution;
import org.jenkinsci.plugins.workflow.steps.SynchronousNonBlockingStepExecution;
import org.kohsuke.stapler.DataBoundConstructor;

import java.util.HashSet;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Pipeline step <code>vManagerChartHelper</code>: copies the conventional
 * vManager Charts input files from the agent workspace into the build's
 * controller-side run directory (next to the log), so that
 * {@link org.jenkinsci.plugins.vmanager.charts.CustomMetricsRunListener} can
 * find them after the build completes.
 *
 * <p>The following files are copied if they exist in the current workspace:</p>
 * <ul>
 *   <li><code>${BUILD_NUMBER}.${BUILD_ID}.session_launch.output</code></li>
 *   <li><code>${BUILD_NUMBER}.${BUILD_ID}.sessions.input</code></li>
 *   <li><code>vmanager-charts-config.json</code></li>
 * </ul>
 *
 * <p>Missing files are silently skipped. Existing files at the destination
 * are overwritten. Must be invoked inside a {@code node { }} block so that
 * a workspace is available.</p>
 *
 * <p>Pipeline usage:</p>
 * <pre>
 *   node('linux') {
 *       // ... vManager Jenkins Plugin produced its .sessions.input here ...
 *       vManagerChartHelper()
 *   }
 * </pre>
 */
public class VManagerChartHelperStep extends Step {

    @DataBoundConstructor
    public VManagerChartHelperStep() {
        // no configuration
    }

    @Override
    public StepExecution start(StepContext context) throws Exception {
        return new Execution(context);
    }

    private static final class Execution extends SynchronousNonBlockingStepExecution<Void> {
        private static final long serialVersionUID = 1L;

        private static final Logger LOGGER = Logger.getLogger(VManagerChartHelperStep.class.getName());

        Execution(StepContext context) {
            super(context);
        }

        @Override
        protected Void run() throws Exception {
            StepContext ctx = getContext();
            FilePath workspace = ctx.get(FilePath.class);
            Run<?, ?> run = ctx.get(Run.class);
            TaskListener listener = ctx.get(TaskListener.class);

            if (workspace == null || run == null) {
                if (listener != null) {
                    listener.getLogger().println(
                            "[vManager Chart Helper] no workspace/run in context; nothing to do.");
                }
                return null;
            }

            FilePath runDir = new FilePath(run.getRootDir());
            String prefix = run.getNumber() + "." + run.getId();
            String[] names = new String[] {
                    prefix + ".session_launch.output",
                    prefix + ".sessions.input",
                    "vmanager-charts-config.json"
            };

            int copied = 0;
            int skipped = 0;
            for (String name : names) {
                FilePath src = workspace.child(name);
                try {
                    if (!src.exists()) {
                        skipped++;
                        continue;
                    }
                    FilePath dst = runDir.child(name);
                    src.copyTo(dst);
                    copied++;
                    if (listener != null) {
                        listener.getLogger().println(
                                "[vManager Chart Helper] copied '" + name
                                + "' from workspace to " + dst.getRemote());
                    }
                } catch (Exception e) {
                    LOGGER.log(Level.WARNING,
                            "vManager Chart Helper: failed to copy " + name, e);
                    if (listener != null) {
                        listener.getLogger().println(
                                "[vManager Chart Helper] WARNING: failed to copy '"
                                + name + "': " + e.getMessage());
                    }
                }
            }

            if (listener != null) {
                listener.getLogger().println(
                        "[vManager Chart Helper] done: " + copied + " copied, "
                        + skipped + " not present in workspace.");
            }
            return null;
        }
    }

    @Extension
    public static final class DescriptorImpl extends StepDescriptor {

        @Override
        public Set<? extends Class<?>> getRequiredContext() {
            Set<Class<?>> ctx = new HashSet<>();
            ctx.add(FilePath.class);
            ctx.add(Run.class);
            ctx.add(TaskListener.class);
            return ctx;
        }

        @Override
        public String getFunctionName() {
            return "vManagerChartHelper";
        }

        @NonNull
        @Override
        public String getDisplayName() {
            return "vManager Chart Helper";
        }
    }
}
