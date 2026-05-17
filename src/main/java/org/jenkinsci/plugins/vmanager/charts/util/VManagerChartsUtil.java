package org.jenkinsci.plugins.vmanager.charts.util;

import hudson.FilePath;
import hudson.model.AbstractBuild;
import hudson.model.Run;
import org.jenkinsci.plugins.vmanager.charts.VManagerChartsJobProperty;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Utility helpers for the vManager Charts plugin.
 *
 * <p>Centralises:</p>
 * <ul>
 *     <li>Building the conventional session-input filename
 *         ({@code ${BUILD_NUMBER}.${BUILD_ID}.sessions.input}).</li>
 *     <li>Resolving the actual file location given the user's
 *         {@link VManagerChartsJobProperty#getSessionSource() session source}
 *         choice and (optionally) custom path. The result is a {@link FilePath}
 *         so that reads work transparently on a remote agent (Linux or Windows).</li>
 *     <li>Reading the file contents into a list of session names (one per
 *         non-blank, non-{@code #}-comment line).</li>
 * </ul>
 *
 * <p>The class is {@code final} with a private constructor — it is a pure
 * collection of static helpers and is not intended to be instantiated.</p>
 */
public final class VManagerChartsUtil {

    private static final Logger LOGGER = Logger.getLogger(VManagerChartsUtil.class.getName());

    /** Suffix used for the conventional per-build session-input file. */
    public static final String SESSIONS_INPUT_SUFFIX = ".sessions.input";

    /**
     * Suffix of the per-build file dropped by the vManager Jenkins Plugin
     * (launch mode) listing the IDs of the sessions it just kicked off.
     * Used as a fallback when {@link #SESSIONS_INPUT_SUFFIX} is missing.
     */
    public static final String SESSION_LAUNCH_OUTPUT_SUFFIX = ".session_launch.output";

    private VManagerChartsUtil() {
        // utility class
    }

    /**
     * @return the conventional file name for this run, e.g. {@code 42.42.sessions.input}.
     */
    public static String defaultSessionsFileName(Run<?, ?> run) {
        return run.getNumber() + "." + run.getId() + SESSIONS_INPUT_SUFFIX;
    }

    /**
     * @return the conventional fallback file name for this run, e.g.
     *         {@code 42.42.session_launch.output} — a list of session ids
     *         produced by the vManager Jenkins Plugin in launch mode.
     */
    public static String defaultSessionLaunchOutputFileName(Run<?, ?> run) {
        return run.getNumber() + "." + run.getId() + SESSION_LAUNCH_OUTPUT_SUFFIX;
    }

    /**
     * Resolves the {@link FilePath} of the fallback {@code .session_launch.output}
     * file. We place it next to the resolved sessions-input file (so a
     * custom user path's directory is honoured); if no input file is known
     * we fall back to the workspace root.
     *
     * @return the {@link FilePath} that <em>should</em> contain the session
     *         ids (the file may or may not actually exist), or {@code null}
     *         when neither a sessions-input file nor a workspace is available.
     */
    public static FilePath resolveSessionLaunchOutputFile(Run<?, ?> run,
                                                          FilePath sessionsInputFile,
                                                          FilePath workspace) {
        String defaultName = defaultSessionLaunchOutputFileName(run);
        if (sessionsInputFile != null) {
            FilePath parent = sessionsInputFile.getParent();
            if (parent != null) {
                return parent.child(defaultName);
            }
        }
        return workspace == null ? null : workspace.child(defaultName);
    }

    /**
     * Best-effort lookup of the build's workspace.
     *
     * <p>For freestyle ({@code AbstractBuild}) jobs this is straightforward.
     * For Pipeline ({@code WorkflowRun}) jobs there is no single workspace
     * for the whole build, so we walk the flow graph (via reflection so we
     * don't take a hard dependency on workflow-api at runtime) and return
     * the workspace of the most recent {@code node { }} block. This is the
     * directory where the vManager Jenkins Plugin would have dropped the
     * {@code .sessions.input} / {@code .session_launch.output} files.</p>
     */
    public static FilePath getCurrentWorkspace(Run<?, ?> run) {
        if (run instanceof AbstractBuild) {
            return ((AbstractBuild<?, ?>) run).getWorkspace();
        }
        return findPipelineWorkspace(run);
    }

    /**
     * Reflection-based lookup of a Pipeline build's workspace. Returns the
     * workspace of the most recently visited {@code node { }} block (BFS from
     * the flow heads towards parents), or {@code null} if no such workspace
     * is recorded on the flow graph.
     */
    private static FilePath findPipelineWorkspace(Run<?, ?> run) {
        try {
            Method getExecution = run.getClass().getMethod("getExecution");
            Object exec = getExecution.invoke(run);
            if (exec == null) return null;

            Object headsObj = exec.getClass().getMethod("getCurrentHeads").invoke(exec);
            if (!(headsObj instanceof List)) return null;

            ClassLoader cl = exec.getClass().getClassLoader();
            Class<?> wsActionClass;
            try {
                wsActionClass = Class.forName(
                        "org.jenkinsci.plugins.workflow.actions.WorkspaceAction", false, cl);
            } catch (ClassNotFoundException cnf) {
                return null;
            }

            Deque<Object> queue = new ArrayDeque<>();
            for (Object h : (List<?>) headsObj) {
                if (h != null) queue.add(h);
            }
            Set<String> seen = new HashSet<>();
            while (!queue.isEmpty()) {
                Object node = queue.poll();
                String id;
                try {
                    id = (String) node.getClass().getMethod("getId").invoke(node);
                } catch (Throwable t) {
                    id = String.valueOf(System.identityHashCode(node));
                }
                if (!seen.add(id)) continue;

                Object action = node.getClass()
                        .getMethod("getAction", Class.class)
                        .invoke(node, wsActionClass);
                if (action != null) {
                    Object ws = action.getClass().getMethod("getWorkspace").invoke(action);
                    if (ws instanceof FilePath) {
                        return (FilePath) ws;
                    }
                    if (ws instanceof String) {
                        // Older WorkspaceAction returns the remote path as String.
                        return new FilePath(new java.io.File((String) ws));
                    }
                }

                Object parents = node.getClass().getMethod("getParents").invoke(node);
                if (parents instanceof List) {
                    for (Object p : (List<?>) parents) {
                        if (p != null) queue.add(p);
                    }
                }
            }
        } catch (Throwable t) {
            LOGGER.log(Level.FINE, "Pipeline workspace lookup failed", t);
        }
        return null;
    }

    /**
     * Resolves the {@link FilePath} of the sessions input file for this build,
     * applying the rules described on
     * {@link VManagerChartsJobProperty#getSessionSource()}:
     * <ul>
     *   <li>{@code PLUGIN} (default) — file is in the build workspace and is
     *       named per {@link #defaultSessionsFileName(Run)}.</li>
     *   <li>{@code FILE} with empty path — same as {@code PLUGIN}.</li>
     *   <li>{@code FILE} with a non-empty path — that path is used. Absolute
     *       paths are resolved on the same node/channel as the workspace.
     *       Relative paths are resolved against the workspace.</li>
     * </ul>
     *
     * @return the {@link FilePath} that <em>should</em> contain the session
     *         names (the file may or may not actually exist), or {@code null}
     *         if no workspace is available and no absolute path was given.
     */
    public static FilePath resolveSessionsInputFile(Run<?, ?> run,
                                                    FilePath workspace,
                                                    String sessionSource,
                                                    String userPath) {
        String defaultName = defaultSessionsFileName(run);
        String mode = sessionSource == null || sessionSource.isBlank()
                ? "PLUGIN" : sessionSource.trim().toUpperCase();

        // PLUGIN, or FILE with no user path → workspace/{default name}
        if ("PLUGIN".equals(mode)
                || userPath == null || userPath.trim().isEmpty()) {
            return workspace == null ? null : workspace.child(defaultName);
        }

        String p = userPath.trim();
        if (workspace != null) {
            if (isAbsolutePath(p)) {
                // Absolute on the same node as the workspace.
                return new FilePath(workspace.getChannel(), p);
            }
            return workspace.child(p);
        }
        // No workspace (e.g. pipeline) — fall back to local interpretation.
        return new FilePath(new java.io.File(p));
    }

    /**
     * Reads session names from the resolved file. Empty lines and lines
     * starting with {@code #} are skipped.
     *
     * @return an immutable list of session names (possibly empty); never {@code null}.
     */
    public static List<String> readSessionNames(FilePath file)
            throws IOException, InterruptedException {
        if (file == null || !file.exists()) {
            return Collections.emptyList();
        }
        String content = file.readToString();
        List<String> names = new ArrayList<>();
        for (String raw : content.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            names.add(line);
        }
        return Collections.unmodifiableList(names);
    }

    /**
     * Convenience: resolve and read in one call.
     */
    public static List<String> readSessionNames(Run<?, ?> run,
                                                FilePath workspace,
                                                String sessionSource,
                                                String userPath)
            throws IOException, InterruptedException {
        return readSessionNames(
                resolveSessionsInputFile(run, workspace, sessionSource, userPath));
    }

    /**
     * Loose absolute-path detection that works for both POSIX
     * ({@code /foo/bar}) and Windows ({@code C:\foo} or {@code \\server\share}).
     */
    private static boolean isAbsolutePath(String p) {
        if (p == null || p.isEmpty()) return false;
        char c0 = p.charAt(0);
        if (c0 == '/' || c0 == '\\') return true;
        return p.length() >= 2 && p.charAt(1) == ':'
                && Character.isLetter(c0);
    }
}
