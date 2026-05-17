(function() {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    ready(initializeCharts);

    function initializeCharts() {
        // Pick up the root URL injected by index.jelly as a data attribute on
        // the container, so this script needs no inline jelly-evaluated JS.
        var container = document.querySelector('.vmanager-charts-container');
        window.vManagerChartsRootUrl = (container && container.dataset.rootUrl) || '';
        if (typeof echarts === 'undefined') {
            console.error('[vManager Charts] echarts library not loaded.');
            return;
        }
        if (typeof vManagerChartsProxy === 'undefined') {
            console.error('[vManager Charts] Stapler proxy not bound.');
            return;
        }
        initDurationChart();
        initSuccessRateChart();
        initTestResultsChart();
        initCustomMetricsCharts();
    }

    function initCustomMetricsCharts() {
        vManagerChartsProxy.getCustomMetricsData(function(response) {
            try {
                var chartsArray = response.responseObject();
                if (!chartsArray || chartsArray.length === 0) return;
                chartsArray.forEach(function(data, index) {
                    var chartDom = document.getElementById('customMetricChart_' + index);
                    if (!chartDom) return;
                    var myChart = echarts.init(chartDom);
                    renderMixedChart(myChart, data);
                });
            } catch (e) {
                console.error('[vManager Charts] custom metrics error:', e);
            }
        });
    }

    /**
     * Renders a chart that may mix line / bar / scatter series.
     * - 'line'    -> echarts type 'line'
     * - 'bar'     -> echarts type 'bar' (vertical bar)
     * - 'scatter' -> echarts type 'scatter'
     */
    function renderMixedChart(chart, data) {
        var hasBar = false;
        var series = data.series.map(function(s) {
            var t = (s.type || 'line').toLowerCase();
            if (t === 'bar') { hasBar = true; }
            var echartsType;
            if (t === 'bar') {
                echartsType = 'bar';
            } else if (t === 'scatter') {
                echartsType = 'scatter';
            } else {
                echartsType = 'line';
            }
            var def = {
                name: s.name,
                type: echartsType,
                data: s.data
            };
            if (echartsType === 'line') {
                def.smooth = true;
                def.symbol = 'circle';
                def.symbolSize = 6;
            } else if (echartsType === 'scatter') {
                def.symbolSize = 10;
            }
            return def;
        });

        var option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: hasBar ? 'shadow' : 'cross' }
            },
            legend: {
                data: data.series.map(function(s) { return s.name; }),
                top: 10,
                left: 'center'
            },
            grid: {
                top: 50,
                left: '3%',
                right: '4%',
                bottom: 110,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                boundaryGap: hasBar,
                data: data.labels,
                axisLabel: { rotate: 45 }
            },
            yAxis: { type: 'value' },
            dataZoom: [
                { type: 'slider', xAxisIndex: 0, bottom: 15, height: 18, start: 0, end: 100 },
                { type: 'inside', xAxisIndex: 0, start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: false }
            ],
            series: series,
            toolbox: { feature: { saveAsImage: { title: 'Save' } } }
        };

        chart.setOption(option);
        window.addEventListener('resize', function() { chart.resize(); });
    }

    function initDurationChart() {
        var chartDom = document.getElementById('durationChart');
        if (!chartDom) return;

        var myChart = echarts.init(chartDom);
        myChart.showLoading();

        vManagerChartsProxy.getBuildDurationData(function(response) {
            try {
                var data = response.responseObject();
                renderLineChart(myChart, data, 'Build Duration (seconds)');
            } catch (e) {
                console.error('[vManager Charts] duration data error:', e);
                myChart.hideLoading();
            }
        });
    }

    function initSuccessRateChart() {
        var chartDom = document.getElementById('successRateChart');
        if (!chartDom) return;

        var myChart = echarts.init(chartDom);
        myChart.showLoading();

        vManagerChartsProxy.getSuccessRateData(function(response) {
            try {
                var data = response.responseObject();
                renderStackedBarChart(myChart, data, 'Build Count');
            } catch (e) {
                console.error('[vManager Charts] success rate data error:', e);
                myChart.hideLoading();
            }
        });
    }

    function initTestResultsChart() {
        var chartDom = document.getElementById('testResultsChart');
        if (!chartDom) return;

        var myChart = echarts.init(chartDom);
        myChart.showLoading();

        vManagerChartsProxy.getTestResultsData(function(response) {
            try {
                var data = response.responseObject();
                renderStackedBarChart(myChart, data, 'Test Count');
                attachDrillDown(myChart, data, function(url) {
                    var root = window.vManagerChartsRootUrl || '';
                    return root.replace(/\/$/, '') + '/' + url;
                });
            } catch (e) {
                console.error('[vManager Charts] test results data error:', e);
                myChart.hideLoading();
            }
        });
    }

    function attachDrillDown(chart, data, urlBuilder) {
        if (!data || !data.urls || data.urls.length === 0) return;
        chart.getZr().on('mousemove', function(params) {
            var pointInPixel = [params.offsetX, params.offsetY];
            chart.getZr().setCursorStyle(chart.containPixel('grid', pointInPixel) ? 'pointer' : 'default');
        });
        chart.on('click', function(params) {
            var idx = params.dataIndex;
            if (idx == null || idx < 0 || idx >= data.urls.length) return;
            var url = data.urls[idx];
            if (!url) return;
            window.location.href = urlBuilder ? urlBuilder(url) : url;
        });
    }

    function renderLineChart(chart, data, yAxisLabel) {
        var series = data.series.map(function(s) {
            return {
                name: s.name,
                type: 'line',
                data: s.data,
                smooth: true,
                symbol: 'circle',
                symbolSize: 6
            };
        });

        var option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross'
                }
            },
            legend: {
                data: data.series.map(s => s.name),
                top: 10,
                left: 'center'
            },
            grid: {
                top: 50,
                left: '3%',
                right: '4%',
                bottom: 110,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: data.labels,
                axisLabel: {
                    rotate: 45
                }
            },
            yAxis: {
                type: 'value',
                name: yAxisLabel
            },
            dataZoom: [
                { type: 'slider', xAxisIndex: 0, bottom: 15, height: 18, start: 0, end: 100 },
                { type: 'inside', xAxisIndex: 0, start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: false }
            ],
            series: series,
            toolbox: {
                feature: {
                    saveAsImage: { title: 'Save' }
                }
            }
        };

        chart.hideLoading();
        chart.setOption(option);

        window.addEventListener('resize', function() {
            chart.resize();
        });
    }

    function renderStackedBarChart(chart, data, yAxisLabel) {
        var colors = {
            'Success': '#52c41a',
            'Passed': '#52c41a',
            'Failure': '#f5222d',
            'Failed': '#f5222d',
            'Running': '#1890ff',
            'Waiting': '#fa8c16',
            'Other': '#8c8c8c',
            'Unstable': '#faad14',
            'Skipped': '#d9d9d9'
        };

        var series = data.series.map(function(s) {
            return {
                name: s.name,
                type: 'bar',
                stack: 'total',
                data: s.data,
                itemStyle: {
                    color: colors[s.name] || undefined
                }
            };
        });

        var option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'shadow'
                }
            },
            legend: {
                data: data.series.map(s => s.name),
                top: 10,
                left: 'center'
            },
            grid: {
                top: 50,
                left: '3%',
                right: '4%',
                bottom: 110,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: data.labels,
                axisLabel: {
                    rotate: 45
                }
            },
            yAxis: {
                type: 'value',
                name: yAxisLabel
            },
            dataZoom: [
                { type: 'slider', xAxisIndex: 0, bottom: 15, height: 18, start: 0, end: 100 },
                { type: 'inside', xAxisIndex: 0, start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: false }
            ],
            series: series,
            toolbox: {
                feature: {
                    saveAsImage: { title: 'Save' }
                }
            }
        };

        chart.hideLoading();
        chart.setOption(option);

        window.addEventListener('resize', function() {
            chart.resize();
        });
    }
})();





