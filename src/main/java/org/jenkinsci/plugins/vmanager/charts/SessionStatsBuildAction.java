package org.jenkinsci.plugins.vmanager.charts;

import hudson.model.Action;

import java.io.Serializable;

/**
 * Per-build action that records the aggregated vManager session run
 * counts (passed, failed, running, waiting, other) for the sessions
 * listed in the build's sessions input file.
 *
 * <p>Hidden from the sidebar (null icon/display/url).</p>
 */
public class SessionStatsBuildAction implements Action, Serializable {

    private static final long serialVersionUID = 1L;

    private final int passedRuns;
    private final int failedRuns;
    private final int running;
    private final int waiting;
    private final int otherRuns;
    private final int sessionCount;

    public SessionStatsBuildAction(int passedRuns, int failedRuns, int running,
                                    int waiting, int otherRuns, int sessionCount) {
        this.passedRuns   = passedRuns;
        this.failedRuns   = failedRuns;
        this.running      = running;
        this.waiting      = waiting;
        this.otherRuns    = otherRuns;
        this.sessionCount = sessionCount;
    }

    public int getPassedRuns()   { return passedRuns;   }
    public int getFailedRuns()   { return failedRuns;   }
    public int getRunning()      { return running;      }
    public int getWaiting()      { return waiting;      }
    public int getOtherRuns()    { return otherRuns;    }
    public int getSessionCount() { return sessionCount; }

    @Override public String getIconFileName() { return null; }
    @Override public String getDisplayName()  { return null; }
    @Override public String getUrlName()      { return null; }
}
