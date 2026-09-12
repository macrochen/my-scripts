// ==UserScript==
// @name         科创板超大单与指数双轴走势图 (大屏版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  引入Chart.js，在科创板资金页面右下角生成大尺寸双轴走势悬浮窗
// @author       Gemini
// @match        *://data.eastmoney.com/zjlx/zs000680.html*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/star-super-order-chart.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/star-super-order-chart.user.js
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function() {
    'use strict';

    const checkTimer = setInterval(() => {
        if (document.getElementById('star-super-order-chart-container')) {
            clearInterval(checkTimer);
            return;
        }

        const rows = document.querySelectorAll('table tbody tr, .datatable tr');
        const validRows = Array.from(rows).filter(row => {
            const firstTd = row.querySelector('td');
            return firstTd && /^\d{4}-\d{2}-\d{2}$/.test(firstTd.innerText.trim());
        });

        if (validRows.length > 0) {
            clearInterval(checkTimer);
            initDashboard(validRows);
        }
    }, 500);

    function initDashboard(rows) {
        const dates = [];
        const superInflowValues = [];
        const indexValues = [];

        rows.forEach(row => {
            const cols = row.querySelectorAll('td');
            // 科创板页面表格列数较少，第2列（索引1）为收盘价，第6列（索引5）为超大单净流入净额
            if (cols.length >= 6) {
                const dateText = cols[0].innerText.trim();
                const indexText = cols[1].innerText.trim();
                const inflowText = cols[5].innerText.trim(); // 此处为科创板专属列索引

                const indexPrice = parseFloat(indexText);
                let inflowValue = parseFloat(inflowText);

                if (inflowText.includes('万')) {
                    inflowValue = inflowValue / 10000;
                }

                if (dateText && !isNaN(indexPrice) && !isNaN(inflowValue)) {
                    dates.push(dateText.substring(5));
                    superInflowValues.push(inflowValue.toFixed(2));
                    indexValues.push(indexPrice);
                }
            }
        });

        dates.reverse();
        superInflowValues.reverse();
        indexValues.reverse();

        const minIndex = Math.min(...indexValues);
        const maxIndex = Math.max(...indexValues);
        const indexRange = maxIndex - minIndex;
        const y2Min = minIndex - (indexRange * 0.1);
        const y2Max = maxIndex + (indexRange * 0.1);

        const container = document.createElement('div');
        container.id = 'star-super-order-chart-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 1000px;
            height: 550px;
            background-color: #ffffff;
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            border-radius: 12px;
            padding: 15px;
            z-index: 99999;
            font-family: sans-serif;
            transition: all 0.3s ease;
        `;

        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            border-bottom: 1px solid #f0f0f0;
            padding-bottom: 8px;
        `;

        const titleText = document.createElement('span');
        titleText.innerText = '超大单净流入 vs 科创综指';
        titleText.style.cssText = 'font-weight: bold; color: #333; font-size: 14px;';

        const toggleBtn = document.createElement('button');
        toggleBtn.innerText = '收起';
        toggleBtn.style.cssText = `
            padding: 4px 8px;
            border: none;
            background-color: #d9534f;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        titleBar.appendChild(titleText);
        titleBar.appendChild(toggleBtn);
        container.appendChild(titleBar);

        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = 'width: 100%; height: 480px;';
        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);
        container.appendChild(canvasContainer);
        document.body.appendChild(container);

        let isCollapsed = false;
        toggleBtn.addEventListener('click', () => {
            if (isCollapsed) {
                container.style.height = '550px';
                container.style.width = '1000px';
                canvasContainer.style.display = 'block';
                toggleBtn.innerText = '收起';
                toggleBtn.style.backgroundColor = '#d9534f';
            } else {
                container.style.height = '45px';
                container.style.width = '210px';
                canvasContainer.style.display = 'none';
                toggleBtn.innerText = '展开图表';
                toggleBtn.style.backgroundColor = '#007bff';
            }
            isCollapsed = !isCollapsed;
        });

        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: '超大单净额 (亿元)',
                        data: superInflowValues,
                        backgroundColor: function(context) {
                            const value = context.dataset.data[context.dataIndex];
                            return value >= 0 ? 'rgba(255, 77, 79, 0.7)' : 'rgba(82, 196, 26, 0.7)';
                        },
                        borderColor: function(context) {
                            const value = context.dataset.data[context.dataIndex];
                            return value >= 0 ? '#ff4d4f' : '#52c41a';
                        },
                        borderWidth: 1,
                        yAxisID: 'y',
                        order: 2
                    },
                    {
                        label: '科创综指收盘价',
                        data: indexValues,
                        type: 'line',
                        borderColor: '#1890ff',
                        borderWidth: 2,
                        pointRadius: 2,
                        backgroundColor: 'transparent',
                        yAxisID: 'y2',
                        order: 1,
                        tension: 0.2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { boxWidth: 12, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 9 }, maxTicksLimit: 20, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '净流入 (亿元)', font: { size: 11, weight: 'bold' } },
                        ticks: { font: { size: 10 } },
                        grid: { color: 'rgba(0, 0, 0, 0.05)' }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: '指数点位', font: { size: 11, weight: 'bold' } },
                        min: y2Min,
                        max: y2Max,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            font: { size: 10 },
                            callback: function(value) { return value.toFixed(1); }
                        }
                    }
                }
            }
        });
    }
})();
