package org.jenkinsci.plugins.vmanager.charts.model;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Data model for chart rendering.
 * This class is serialized to JSON and sent to the frontend.
 */
public class ChartData implements Serializable {

    private List<String> labels = new ArrayList<>();
    private List<String> urls = new ArrayList<>();
    private List<SeriesData> series = new ArrayList<>();
    private String chartType = "line";
    private boolean stacked = false;
    private Map<String, Object> options = new HashMap<>();

    public List<String> getLabels() {
        return labels;
    }

    public void setLabels(List<String> labels) {
        this.labels = labels;
    }

    public List<String> getUrls() {
        return urls;
    }

    public void setUrls(List<String> urls) {
        this.urls = urls;
    }

    public List<SeriesData> getSeries() {
        return series;
    }

    public void addSeries(String name, List<?> data) {
        series.add(new SeriesData(name, data, null));
    }

    public void addSeries(String name, List<?> data, String type) {
        series.add(new SeriesData(name, data, type));
    }

    public String getChartType() {
        return chartType;
    }

    public void setChartType(String chartType) {
        this.chartType = chartType;
    }

    public boolean isStacked() {
        return stacked;
    }

    public void setStacked(boolean stacked) {
        this.stacked = stacked;
    }

    public Map<String, Object> getOptions() {
        return options;
    }

    public void setOption(String key, Object value) {
        options.put(key, value);
    }

    /**
     * Inner class representing a data series.
     */
    public static class SeriesData implements Serializable {
        private String name;
        private List<?> data;
        /** Optional per-series chart type (line/bar/column); null = inherit chart-level. */
        private String type;

        public SeriesData(String name, List<?> data) {
            this(name, data, null);
        }

        public SeriesData(String name, List<?> data, String type) {
            this.name = name;
            this.data = data;
            this.type = type;
        }

        public String getName() {
            return name;
        }

        public List<?> getData() {
            return data;
        }

        public String getType() {
            return type;
        }
    }
}
