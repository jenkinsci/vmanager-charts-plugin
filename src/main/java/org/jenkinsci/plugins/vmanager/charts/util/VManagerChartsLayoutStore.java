package org.jenkinsci.plugins.vmanager.charts.util;

import hudson.model.Job;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Persists the per-job dashboard layout (chart order and per-chart width) for
 * the two chart pages ({@code VManagerChartsAction} and {@code BuildChartAction}).
 *
 * <p>Storage is one JSON file per scope, placed under {@code Job.getRootDir()}
 * (i.e. {@code $JENKINS_HOME/jobs/<job>/}). One layout is shared by all
 * users; the build-scope layout is shared by every build of the job.</p>
 *
 * <p>The JSON shape is opaque to Java &mdash; just a string blob written by the
 * dashboard JS and replayed back to it. Java only validates length and that
 * it parses as a JSON object (see {@code doSaveLayout} on the action classes).</p>
 */
public final class VManagerChartsLayoutStore {

    private static final Logger LOGGER = Logger.getLogger(VManagerChartsLayoutStore.class.getName());

    public static final String JOB_LAYOUT_FILE   = "vmanager-charts-layout-job.json";
    public static final String BUILD_LAYOUT_FILE = "vmanager-charts-layout-build.json";

    /** Hard cap on payload size, just to keep a misbehaving client honest. */
    public static final int MAX_LAYOUT_BYTES = 64 * 1024;

    private VManagerChartsLayoutStore() {
        // utility class
    }

    public static String loadJobLayout(Job<?, ?> job) {
        return readFile(new File(job.getRootDir(), JOB_LAYOUT_FILE));
    }

    public static String loadBuildLayout(Job<?, ?> job) {
        return readFile(new File(job.getRootDir(), BUILD_LAYOUT_FILE));
    }

    public static void saveJobLayout(Job<?, ?> job, String json) throws IOException {
        writeFile(new File(job.getRootDir(), JOB_LAYOUT_FILE), json);
    }

    public static void saveBuildLayout(Job<?, ?> job, String json) throws IOException {
        writeFile(new File(job.getRootDir(), BUILD_LAYOUT_FILE), json);
    }

    private static String readFile(File f) {
        if (f == null || !f.isFile()) {
            return "{}";
        }
        try {
            byte[] bytes = Files.readAllBytes(f.toPath());
            String s = new String(bytes, StandardCharsets.UTF_8).trim();
            return s.isEmpty() ? "{}" : s;
        } catch (IOException e) {
            LOGGER.log(Level.FINE, "Failed to read dashboard layout " + f, e);
            return "{}";
        }
    }

    private static void writeFile(File f, String json) throws IOException {
        if (json == null) {
            json = "{}";
        }
        Files.write(f.toPath(), json.getBytes(StandardCharsets.UTF_8));
    }
}
