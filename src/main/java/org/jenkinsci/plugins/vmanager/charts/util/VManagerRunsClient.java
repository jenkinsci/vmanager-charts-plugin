package org.jenkinsci.plugins.vmanager.charts.util;

import com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials;
import hudson.model.TaskListener;
import net.sf.json.JSONArray;
import net.sf.json.JSONObject;
import net.sf.json.JSONSerializer;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Thin client around the vManager {@code /rest/runs/list} endpoint used to
 * fetch the {@code (start_time, duration)} pair of every run that belongs to a
 * given set of sessions.
 *
 * <p>The payload uses a {@code .ChainedFilter} (OR) of one
 * {@code .RelationFilter} per session name, asks the server to sort by
 * {@code duration ASCENDING} and projects only the two columns we need
 * ({@code duration}, {@code start_time}).</p>
 *
 * <p>For internal vManager servers with self-signed certs the underlying
 * {@link VManagerHttpClient} trusts all certs/hostnames.</p>
 */
public final class VManagerRunsClient {

    private static final Logger LOGGER = Logger.getLogger(VManagerRunsClient.class.getName());

    /**
     * Single run point: holds both {@code timeToStartMinutes} and
     * {@code timeToEndMinutes} (elapsed minutes from the session's start to
     * the run's start / end respectively), the run {@code durationMinutes},
     * the vManager-reported {@code estimatedDurationMinutes} (the value of
     * the {@code estimated_duration_vmgr} attribute, converted from seconds
     * to minutes) and the vManager run {@code id} (numeric).
     */
    public static final class RunPoint {
        public final double timeToStartMinutes;
        public final double timeToEndMinutes;
        public final double durationMinutes;
        public final double estimatedDurationMinutes;
        public final double id;
        public final double actualIndex;
        RunPoint(double timeToStartMinutes, double timeToEndMinutes,
                 double durationMinutes, double estimatedDurationMinutes,
                 double id, double actualIndex) {
            this.timeToStartMinutes       = timeToStartMinutes;
            this.timeToEndMinutes         = timeToEndMinutes;
            this.durationMinutes          = durationMinutes;
            this.estimatedDurationMinutes = estimatedDurationMinutes;
            this.id                       = id;
            this.actualIndex              = actualIndex;
        }
    }

    private VManagerRunsClient() {
        // static utility
    }

    /**
     * POSTs {@code /rest/sessions/list} for the given sessions, sorted by
     * {@code start_time ASCENDING}, and returns the {@code start_time} (in
     * ms) of the earliest session &mdash; i.e. the start of the regression.
     *
     * @return the session start time in milliseconds, or {@code 0L} if no
     *         row was returned (or the value was missing/non-numeric).
     */
    public static long fetchSessionStartMillis(
            String baseUrl,
            Collection<String> sessionNames,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener) throws IOException {

        if (sessionNames == null || sessionNames.isEmpty()
                || baseUrl == null || baseUrl.isBlank()) {
            return 0L;
        }

        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        String url  = base + "/rest/sessions/list";

        // ── filter: ChainedFilter(OR) of one AttValueFilter per session ──
        JSONArray chain = new JSONArray();
        for (String session : sessionNames) {
            if (session == null || session.isBlank()) continue;
            JSONObject f = new JSONObject();
            f.put("@c",       ".AttValueFilter");
            f.put("attName",  "session_name");
            f.put("attValue", session);
            f.put("operand",  "EQUALS");
            chain.add(f);
        }

        JSONObject filter = new JSONObject();
        filter.put("@c",        ".ChainedFilter");
        filter.put("condition", "OR");
        filter.put("chain",     chain);

        JSONArray sortSpec = new JSONArray();
        JSONObject sort = new JSONObject();
        sort.put("attName",   "start_time");
        sort.put("direction", "ASCENDING");
        sortSpec.add(sort);

        JSONArray selection = new JSONArray();
        selection.add("start_time");

        JSONObject projection = new JSONObject();
        projection.put("type",      "SELECTION_ONLY");
        projection.put("selection", selection);

        JSONObject body = new JSONObject();
        body.put("filter",     filter);
        body.put("sortSpec",   sortSpec);
        body.put("projection", projection);
        body.put("pageOffset", 0);
        body.put("pageLength", 1000);

        String payload = body.toString();

        String debug = "[vManager Charts] POST " + url
                + "\n  headers: Content-Type=application/json; charset=UTF-8, "
                + "Accept=application/json, Authorization=Basic <redacted>"
                + "\n  payload: " + payload;
        if (listener != null && BuildLog.isVerbose()) listener.getLogger().println(debug);
        LOGGER.log(Level.FINE, debug);

        String responseBody = VManagerHttpClient.postJson(url, payload, creds);

        Object parsed = JSONSerializer.toJSON(responseBody);
        if (!(parsed instanceof JSONArray)) return 0L;
        JSONArray rows = (JSONArray) parsed;
        if (rows.isEmpty()) return 0L;

        Object first = rows.get(0);
        if (!(first instanceof JSONObject)) return 0L;
        long startMs = (long) optDouble((JSONObject) first, "start_time");

        String summary = "[vManager Charts] session start_time = " + startMs + " ms (from "
                + rows.size() + " session row" + (rows.size() == 1 ? "" : "s") + ")";
        if (listener != null && BuildLog.isVerbose()) listener.getLogger().println(summary);
        LOGGER.log(Level.FINE, summary);

        return startMs;
    }

    /**
     * POSTs {@code /rest/runs/list} for the given sessions and returns the
     * resulting points (already converted to minutes), preserving the
     * server's ASCENDING-by-duration ordering.
     *
     * @param baseUrl       vManager server base URL (e.g. {@code https://host:port/vmgr/vapi}).
     * @param sessionNames  one or more session names; {@code null}/empty returns an empty list.
     * @param creds         credentials for HTTP Basic auth; may be {@code null} (no auth header).
     * @param listener      optional task listener; when non-null the URL,
     *                      headers and payload are echoed to the build log.
     * @param sessionStartMillis  the session start time in ms, used to
     *                            compute each point's {@code timeToStartMinutes}
     *                            as {@code (startTimeMs - sessionStartMillis) / 60000}.
     * @return list of {@link RunPoint} (never {@code null}).
     */
    public static List<RunPoint> fetchRunPoints(
            String baseUrl,
            Collection<String> sessionNames,
            long sessionStartMillis,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener) throws IOException {

        if (sessionNames == null || sessionNames.isEmpty()
                || baseUrl == null || baseUrl.isBlank()) {
            return Collections.emptyList();
        }

        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        String url  = base + "/rest/runs/list";

        // ── filter: ChainedFilter(OR) of one RelationFilter per session ──
        JSONArray chain = new JSONArray();
        

        JSONObject relationFilter = new JSONObject();
        relationFilter.put("@c",           ".RelationFilter");
        relationFilter.put("relationName", "session");

        JSONArray sessionValues = new JSONArray();
        for (String session : sessionNames) {
            if (session == null || session.isBlank()) continue;
            sessionValues.add(session);
        }

        JSONObject inFilter = new JSONObject();
        inFilter.put("@c",           ".InFilter");
        inFilter.put("attName",       "name");
        inFilter.put("operand",       "IN");
        inFilter.put("values",        sessionValues);
        relationFilter.put("filter",  inFilter);
        chain.add(relationFilter);

        //Make sure you are not taking into account null duration
        relationFilter = new JSONObject();
        relationFilter.put("@c",           ".AttValueFilter");
        relationFilter.put("attName", "duration");
        relationFilter.put("attValue",       "0");
        relationFilter.put("operand",  "GREATER_OR_EQUALS_TO");
        chain.add(relationFilter);

        //Only passed runs
        relationFilter = new JSONObject();
        relationFilter.put("@c",           ".AttValueFilter");
        relationFilter.put("attName", "status");
        relationFilter.put("attValue",       "passed");
        relationFilter.put("operand",  "EQUALS");
        chain.add(relationFilter);
        

        JSONObject filter = new JSONObject();
        filter.put("@c",        ".ChainedFilter");
        filter.put("condition", "AND");
        filter.put("chain",     chain);

        // ── sortSpec: duration ASCENDING ──
        JSONArray sortSpec = new JSONArray();
        JSONObject sort = new JSONObject();
        sort.put("attName",   "duration");
        sort.put("direction", "ASCENDING");
        sortSpec.add(sort);

        // ── projection: SELECTION_ONLY [duration, start_time, end_time, estimated_duration_vmgr, id, actual_index_vmgr] ──
        JSONArray selection = new JSONArray();
        selection.add("duration");
        selection.add("start_time");
        selection.add("end_time");
        selection.add("estimated_duration_vmgr");
        selection.add("id");
        selection.add("actual_index_vmgr");

        JSONObject projection = new JSONObject();
        projection.put("type",      "SELECTION_ONLY");
        projection.put("selection", selection);

        JSONObject body = new JSONObject();
        body.put("filter",     filter);
        body.put("sortSpec",   sortSpec);
        body.put("projection", projection);
        body.put("pageOffset", 0);
        body.put("pageLength", 200000);

        String payload = body.toString();

        // ── debug: URL, headers, payload ──
        String debug = "[vManager Charts] POST " + url
                + "\n  headers: Content-Type=application/json; charset=UTF-8, "
                + "Accept=application/json, Authorization=Basic <redacted>"
                + "\n  payload: " + payload;
        if (listener != null && BuildLog.isVerbose()) {
            listener.getLogger().println(debug);
        }
        LOGGER.log(Level.FINE, debug);

        // ── fire the request ──
        String responseBody = VManagerHttpClient.postJson(url, payload, creds);

        Object parsed = JSONSerializer.toJSON(responseBody);
        if (!(parsed instanceof JSONArray)) {
            return Collections.emptyList();
        }
        JSONArray rows = (JSONArray) parsed;

        List<RunPoint> out = new ArrayList<>(rows.size());
        for (int i = 0; i < rows.size(); i++) {
            Object e = rows.get(i);
            if (!(e instanceof JSONObject)) continue;
            JSONObject row = (JSONObject) e;
            double durationMinutes        = optDouble(row, "duration") / 60.0;                    // sec → min
            double estimatedDurationMinutes = optDouble(row, "estimated_duration_vmgr") / 60.0;     // sec → min
            double startTimeMs            = optDouble(row, "start_time");
            double endTimeMs              = optDouble(row, "end_time");
            double runId                  = optDouble(row, "id");
            double actualIndex            = optDouble(row, "actual_index_vmgr");
            // Time elapsed from session start to this run's start / end (ms → min).
            double timeToStartMinutes     = (startTimeMs - sessionStartMillis) / 60000.0;
            double timeToEndMinutes       = (endTimeMs   - sessionStartMillis) / 60000.0;
            out.add(new RunPoint(timeToStartMinutes, timeToEndMinutes,
                                 durationMinutes, estimatedDurationMinutes, runId, actualIndex));
        }
        return out;
    }

    private static double optDouble(JSONObject row, String key) {
        if (!row.has(key)) return 0.0;
        Object v = row.get(key);
        if (v == null || net.sf.json.JSONNull.getInstance().equals(v)) return 0.0;
        if (v instanceof Number) return ((Number) v).doubleValue();
        try {
            return Double.parseDouble(v.toString().trim());
        } catch (NumberFormatException nfe) {
            return 0.0;
        }
    }

    /**
     * POSTs {@code /rest/runs/list} grouped by {@code first_failure_description}
     * for the given sessions and returns a map of description &rarr;
     * {@code number_of_entities}. Thin wrapper around
     * {@link #fetchGroupByCounts(String, Collection, StandardUsernamePasswordCredentials,
     * TaskListener, String, int, java.util.List)} preserved for backward
     * compatibility with the original single-purpose Failure Triage chart;
     * applies the historical {@code status IN ["failed"]} filter so callers
     * get the same data set they used to.
     */
    public static java.util.LinkedHashMap<String, Integer> fetchFailureDescriptionCounts(
            String baseUrl,
            Collection<String> sessionNames,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener) throws IOException {
        return fetchGroupByCounts(baseUrl, sessionNames, creds, listener,
                "first_failure_description", 100,
                java.util.Collections.singletonList("failed"));
    }

    /**
     * Two-argument convenience overload for callers that don't need to
     * restrict by run status. Equivalent to passing an empty
     * {@code statusFilters} list.
     */
    public static java.util.LinkedHashMap<String, Integer> fetchGroupByCounts(
            String baseUrl,
            Collection<String> sessionNames,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener,
            String groupByAttributeId,
            int pageLength) throws IOException {
        return fetchGroupByCounts(baseUrl, sessionNames, creds, listener,
                groupByAttributeId, pageLength, java.util.Collections.emptyList());
    }

    /**
     * POSTs {@code /rest/runs/list} grouped by an arbitrary RUN_LEVEL
     * attribute and returns a map of group-value &rarr;
     * {@code number_of_entities}. Insertion order is preserved from the
     * server response (sorted DESCENDING by {@code number_of_entities}).
     * Entries with {@code number_of_entities <= 0} are filtered out
     * server-side via the {@code postFilter}.
     *
     * @param baseUrl            vManager server base URL.
     * @param sessionNames       one or more session names; {@code null}/empty
     *                           returns an empty map.
     * @param creds              credentials for HTTP Basic auth; may be {@code null}.
     * @param listener           optional task listener; when non-null the URL,
     *                           headers and payload are echoed to the build log
     *                           (only when verbose logging is on).
     * @param groupByAttributeId id of the RUN_LEVEL attribute to group on
     *                           (e.g. {@code first_failure_description},
     *                           {@code status}, {@code computer}).
     * @param pageLength         maximum number of groups to return.
     * @param statusFilters      optional list of run statuses (e.g.
     *                           {@code ["failed"]}, {@code ["passed","failed"]}).
     *                           Empty / {@code null} means "no status filter".
     */
    public static java.util.LinkedHashMap<String, Integer> fetchGroupByCounts(
            String baseUrl,
            Collection<String> sessionNames,
            StandardUsernamePasswordCredentials creds,
            TaskListener listener,
            String groupByAttributeId,
            int pageLength,
            java.util.List<String> statusFilters) throws IOException {

        java.util.LinkedHashMap<String, Integer> out = new java.util.LinkedHashMap<>();
        if (sessionNames == null || sessionNames.isEmpty()
                || baseUrl == null || baseUrl.isBlank()
                || groupByAttributeId == null || groupByAttributeId.isBlank()) {
            return out;
        }
        if (pageLength <= 0) pageLength = 100;

        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        String url  = base + "/rest/runs/list";

        // ── filter: RelationFilter(session) → InFilter(session_name IN [...]) ──
        JSONArray sessionValues = new JSONArray();
        for (String session : sessionNames) {
            if (session == null || session.isBlank()) continue;
            sessionValues.add(session);
        }

        JSONObject inFilter = new JSONObject();
        inFilter.put("@c",      ".InFilter");
        inFilter.put("attName", "session_name");
        inFilter.put("operand", "IN");
        inFilter.put("values",  sessionValues);

        JSONObject filter = new JSONObject();
        filter.put("@c",           ".RelationFilter");
        filter.put("relationName", "session");
        filter.put("filter",       inFilter);

        // ── grouping: [groupByAttributeId] ──
        JSONArray grouping = new JSONArray();
        grouping.add(groupByAttributeId);

        // ── postFilter: number_of_entities > 0, AND-ed with an optional
        //    user-supplied status InFilter. When {@code statusFilters} is
        //    null/empty, only the count filter is applied. ──
        JSONObject countFilter = new JSONObject();
        countFilter.put("@c",       ".AttValueFilter");
        countFilter.put("operand",  "GREATER_THAN");
        countFilter.put("attName",  "number_of_entities");
        countFilter.put("attValue", "0");

        JSONObject postFilter;
        if (statusFilters != null && !statusFilters.isEmpty()) {
            JSONObject statusFilter = new JSONObject();
            statusFilter.put("@c",      ".InFilter");
            statusFilter.put("operand", "IN");
            statusFilter.put("attName", "status");
            JSONArray statusValues = new JSONArray();
            for (String s : statusFilters) {
                if (s != null && !s.isBlank()) statusValues.add(s.trim().toLowerCase());
            }
            statusFilter.put("values", statusValues);

            JSONArray chain = new JSONArray();
            chain.add(statusFilter);
            chain.add(countFilter);

            postFilter = new JSONObject();
            postFilter.put("@c",        ".ChainedFilter");
            postFilter.put("condition", "AND");
            postFilter.put("chain",     chain);
        } else {
            postFilter = countFilter;
        }

        // ── sortSpec: number_of_entities DESCENDING ──
        JSONArray sortSpec = new JSONArray();
        JSONObject sort = new JSONObject();
        sort.put("attName",   "number_of_entities");
        sort.put("direction", "DESCENDING");
        sortSpec.add(sort);

        // ── projection: SELECTION_ONLY [groupByAttributeId, number_of_entities] ──
        JSONArray selection = new JSONArray();
        selection.add(groupByAttributeId);
        selection.add("number_of_entities");

        JSONObject projection = new JSONObject();
        projection.put("type",      "SELECTION_ONLY");
        projection.put("selection", selection);

        JSONObject body = new JSONObject();
        body.put("filter",     filter);
        body.put("grouping",   grouping);
        body.put("postFilter", postFilter);
        body.put("sortSpec",   sortSpec);
        body.put("pageOffset", 0);
        body.put("pageLength", pageLength);
        body.put("projection", projection);

        String payload = body.toString();
        String debug = "[vManager Charts] POST " + url
                + "\n  headers: Content-Type=application/json; charset=UTF-8, "
                + "Accept=application/json, Authorization=Basic <redacted>"
                + "\n  payload: " + payload;
        if (listener != null && BuildLog.isVerbose()) {
            listener.getLogger().println(debug);
        }
        LOGGER.log(Level.FINE, debug);

        String responseBody = VManagerHttpClient.postJson(url, payload, creds);

        Object parsed = JSONSerializer.toJSON(responseBody);
        if (!(parsed instanceof JSONArray)) {
            return out;
        }
        JSONArray rows = (JSONArray) parsed;
        for (int i = 0; i < rows.size(); i++) {
            Object e = rows.get(i);
            if (!(e instanceof JSONObject)) continue;
            JSONObject row = (JSONObject) e;
            Object descRaw = row.opt(groupByAttributeId);
            String desc = (descRaw == null || net.sf.json.JSONNull.getInstance().equals(descRaw))
                    ? "" : String.valueOf(descRaw);
            int count = (int) Math.round(optDouble(row, "number_of_entities"));
            if (count <= 0) continue;
            Integer prev = out.get(desc);
            out.put(desc, prev == null ? count : prev + count);
        }
        return out;
    }
}
