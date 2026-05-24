(function() {
    'use strict';

    // Pin the tooltip when the user left-clicks a data point so they can move
    // the mouse into the tooltip and copy text from it. A second click on an
    // empty area of the chart (or on another point) restores the default
    // hover behaviour. Not applied to charts that already consume click for
    // drill-down navigation (e.g. test-results).
    function enablePinnableTooltip(chart) {
        var pinned = false;
        chart.on('click', function (params) {
            if (!params || params.componentType !== 'series') return;
            pinned = true;
            chart.setOption({ tooltip: { enterable: true, triggerOn: 'none' } });
            chart.dispatchAction({
                type: 'showTip',
                seriesIndex: params.seriesIndex,
                dataIndex: params.dataIndex
            });
        });
        chart.getZr().on('click', function (event) {
            if (pinned && (!event || !event.target)) {
                pinned = false;
                chart.dispatchAction({ type: 'hideTip' });
                chart.setOption({ tooltip: { enterable: true, triggerOn: 'mousemove|click' } });
            }
        });
    }

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
        initGroupedRunsCharts();
        initCustomMetricsCharts();
    }

    function initGroupedRunsCharts() {
        vManagerChartsProxy.getGroupedRunsChartsData(function (response) {
            try {
                var arr = response.responseObject();
                if (!arr || arr.length === 0) return;
                arr.forEach(function (data, index) {
                    var chartDom = document.getElementById('groupedRunsChart_' + index);
                    if (!chartDom) return;
                    var myChart = echarts.init(chartDom);
                    registerWithDashboard(chartDom, myChart);
                    renderGroupedRunsHeatmap(myChart, data);
                });
            } catch (e) {
                console.error('[vManager Charts] grouped runs data error:', e);
            }
        });
    }

    function renderGroupedRunsHeatmap(chart, data) {
        var chartTitle    = (data && data.title)    ? data.title    : 'Grouped Runs';
        var chartSubtitle = (data && data.subtitle) ? data.subtitle : '';
        if (!data || !data.labels || data.labels.length === 0
                || !data.yLabels || data.yLabels.length === 0) {
            chart.setOption({
                title: {
                    text: chartTitle,
                    subtext: chartSubtitle
                        ? chartSubtitle
                        : 'No data yet \u2014 enable the chart and run a build.',
                    left: 'center'
                }
            });
            return;
        }

        var xLabels = data.labels;
        var yLabels = data.yLabels;
        var yTitles = data.yTitles;
        var cells   = data.cells;
        var maxVal  = data.maxValue > 0 ? data.maxValue : 1;

        var rowHeight = 28;
        var overhead  = 220;
        var dom = chart.getDom();
        if (dom) {
            var desiredHeight = Math.max(420, overhead + yLabels.length * rowHeight);
            dom.style.height = desiredHeight + 'px';
            chart.resize();
        }

        var option = {
            title: {
                text: chartTitle,
                subtext: chartSubtitle,
                left: 'center',
                textStyle: { fontSize: 14, fontWeight: 'bold' },
                subtextStyle: { fontSize: 11, color: '#666' }
            },
            tooltip: {
                show: true,
                triggerOn: 'none',
                enterable: true,
                position: 'top',
                appendToBody: true,
                extraCssText: 'max-width: 520px; max-height: 320px; overflow-x: auto; overflow-y: auto; white-space: normal; user-select: text; z-index: 20000;',
                formatter: function (params) {
                    var v = params.value || [];
                    var xi = v[0], yi = v[1], count = v[2];
                    var build = xLabels[xi] || '';
                    var full  = (yTitles && yTitles[yi]) ? yTitles[yi] : (yLabels[yi] || '');
                    var safeBuild = String(build).replace(/[&<>]/g, function (c) {
                        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
                    });
                    var safeFull = String(full).replace(/[&<>]/g, function (c) {
                        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
                    });
                    return '<div><strong>Build:</strong> ' + safeBuild + '</div>'
                         + '<div><strong>Count:</strong> ' + count + '</div>'
                         + '<div style="margin-top:4px;"><strong>Group value:</strong></div>'
                         + '<div style="margin-top:2px;">' + safeFull + '</div>';
                }
            },
            grid: {
                left: 360,
                right: 60,
                top: 80,
                bottom: 80,
                containLabel: false
            },
            xAxis: {
                type: 'category',
                data: xLabels,
                splitArea: { show: true },
                axisLabel: { rotate: 45, fontSize: 11 }
            },
            yAxis: {
                type: 'category',
                data: yLabels,
                splitArea: { show: true },
                axisLabel: {
                    fontSize: 11,
                    width: 340,
                    overflow: 'truncate',
                    formatter: function (val) { return val; }
                }
            },
            visualMap: {
                min: 0,
                max: maxVal,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: 10,
                inRange: {
                    color: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d']
                }
            },
            series: [{
                name: 'Count',
                type: 'heatmap',
                data: cells,
                label: { show: true, fontSize: 10 },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                }
            }],
            toolbox: {
                showTitle: false,
                tooltip: {
                    show: true,
                    position: 'top',
                    backgroundColor: 'rgba(50,50,50,0.9)',
                    textStyle: { color: '#fff', fontSize: 12 }
                },
                feature: {
                    dataView:    { title: 'Data View', lang: ['Data View', 'Close', 'Refresh'], readOnly: true },
                    restore:     { title: 'Restore' },
                    saveAsImage: { title: 'Save' }
                }
            }
        };

        chart.setOption(option);

        chart.on('click', function (params) {
            if (params.componentType !== 'series') return;
            chart.dispatchAction({
                type:        'showTip',
                seriesIndex: params.seriesIndex,
                dataIndex:   params.dataIndex
            });
        });

        var chartDom = chart.getDom();
        if (chartDom && !chartDom._groupedRunsOutsideHandler) {
            var outsideHandler = function (e) {
                if (!chartDom.contains(e.target)) {
                    chart.dispatchAction({ type: 'hideTip' });
                }
            };
            document.addEventListener('click', outsideHandler);
            chartDom._groupedRunsOutsideHandler = outsideHandler;
        }

        window.addEventListener('resize', function () { chart.resize(); });
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
                    registerWithDashboard(chartDom, myChart);
                    enablePinnableTooltip(myChart);
                    renderMixedChart(myChart, data);
                });
            } catch (e) {
                console.error('[vManager Charts] custom metrics error:', e);
            }
        });
    }

    function registerWithDashboard(chartDom, chartInstance) {
        if (!window.VmgrDashboard) return;
        var section = chartDom.closest('.chart-section[data-chart-id]');
        if (!section) return;
        window.VmgrDashboard.register(section.dataset.chartId, [chartInstance]);
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
                enterable: true,
                triggerOn: 'mousemove|click',
                extraCssText: 'user-select: text; -webkit-user-select: text; -ms-user-select: text;',
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
            toolbox: {
                showTitle: false,
                tooltip: {
                    show: true,
                    position: 'top',
                    backgroundColor: 'rgba(50,50,50,0.9)',
                    textStyle: { color: '#fff', fontSize: 12 }
                },
                feature: {
                    dataZoom:    { title: { zoom: 'Zoom', back: 'Reset Zoom' }, yAxisIndex: 'none' },
                    dataView:    { title: 'Data View', lang: ['Data View', 'Close', 'Refresh'], readOnly: true },
                    restore:     { title: 'Restore' },
                    saveAsImage: { title: 'Save' }
                }
            }
        };

        chart.setOption(option);
        window.addEventListener('resize', function() { chart.resize(); });
    }

    function initDurationChart() {
        var chartDom = document.getElementById('durationChart');
        if (!chartDom) return;

        var myChart = echarts.init(chartDom);
        registerWithDashboard(chartDom, myChart);
        enablePinnableTooltip(myChart);
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
        registerWithDashboard(chartDom, myChart);
        enablePinnableTooltip(myChart);
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
        registerWithDashboard(chartDom, myChart);
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
                enterable: true,
                triggerOn: 'mousemove|click',
                extraCssText: 'user-select: text; -webkit-user-select: text; -ms-user-select: text;',
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
                showTitle: false,
                tooltip: {
                    show: true,
                    position: 'top',
                    backgroundColor: 'rgba(50,50,50,0.9)',
                    textStyle: { color: '#fff', fontSize: 12 }
                },
                feature: {
                    dataZoom:    { title: { zoom: 'Zoom', back: 'Reset Zoom' }, yAxisIndex: 'none' },
                    dataView:    { title: 'Data View', lang: ['Data View', 'Close', 'Refresh'], readOnly: true },
                    restore:     { title: 'Restore' },
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
                enterable: true,
                triggerOn: 'mousemove|click',
                extraCssText: 'user-select: text; -webkit-user-select: text; -ms-user-select: text;',
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
                showTitle: false,
                tooltip: {
                    show: true,
                    position: 'top',
                    backgroundColor: 'rgba(50,50,50,0.9)',
                    textStyle: { color: '#fff', fontSize: 12 }
                },
                feature: {
                    dataZoom:    { title: { zoom: 'Zoom', back: 'Reset Zoom' }, yAxisIndex: 'none' },
                    dataView:    { title: 'Data View', lang: ['Data View', 'Close', 'Refresh'], readOnly: true },
                    restore:     { title: 'Restore' },
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





