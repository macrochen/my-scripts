// ==UserScript==
// @name         集思录ETF数据格式化 & 净申购走势悬浮窗 (二合一完整版)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  隐藏净值日期列、换算单位、涨跌着色，并在右下角生成自适应边界的历史净申购金额走势图。
// @author       Gemini
// @match        *://*.jisilu.cn/data/etf/detail/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/jisilu-etf-chart-and-formatter.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/jisilu-etf-chart-and-formatter.user.js
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 模块一：ETF数据高阶格式化（隐藏冗余列、换算单位、涨跌变色）
    // ==========================================
    function formatData() {
        const tables = document.querySelectorAll('table');

        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            if (rows.length < 2) return;

            let turnoverIndex = -1;
            let shareAmountIndex = -1;
            let shareChangeIndex = -1;
            let indexChangeIndex = -1;
            let netDateIndex = -1;
            let headerRowIndex = -1;

            // 1. 动态寻找真正的表头行及目标列索引
            for (let r = 0; r < Math.min(rows.length, 5); r++) {
                const cells = rows[r].children;
                for (let c = 0; c < cells.length; c++) {
                    const text = cells[c].textContent || '';

                    if (text.includes('成交额')) {
                        turnoverIndex = c;
                        headerRowIndex = r;
                        if (text.includes('万元')) {
                            cells[c].innerHTML = cells[c].innerHTML.replace('万元', '亿元');
                        }
                    }
                    if (text.includes('场内份额')) {
                        shareAmountIndex = c;
                        headerRowIndex = r;
                        if (text.includes('万份')) {
                            cells[c].innerHTML = cells[c].innerHTML.replace('万份', '亿份');
                        }
                    }
                    if (text.includes('份额涨幅')) {
                        shareChangeIndex = c;
                        headerRowIndex = r;
                    }
                    if (text.includes('指数涨幅')) {
                        indexChangeIndex = c;
                        headerRowIndex = r;
                    }
                    if (text.includes('净值日期')) {
                        netDateIndex = c;
                        headerRowIndex = r;
                        cells[c].style.display = 'none'; // 隐藏表头单元格
                    }
                }
                if (headerRowIndex !== -1) break;
            }

            if (headerRowIndex === -1) return;

            // 涨跌颜色渲染通用函数
            const renderColor = (cell, flagAttr) => {
                if (cell && !cell.hasAttribute(flagAttr)) {
                    const rawText = cell.textContent.trim().replace('%', '');
                    if (rawText !== '' && !isNaN(rawText)) {
                        const val = parseFloat(rawText);
                        if (val > 0) {
                            cell.style.color = '#f5222d';
                            cell.style.fontWeight = 'bold';
                        } else if (val < 0) {
                            cell.style.color = '#52c41a';
                            cell.style.fontWeight = 'bold';
                        }
                        cell.setAttribute(flagAttr, 'true');
                    }
                }
            };

            // 2. 转换数据行
            for (let i = headerRowIndex + 1; i < rows.length; i++) {
                if (netDateIndex !== -1) {
                    const cell = rows[i].children[netDateIndex];
                    if (cell && cell.style.display !== 'none') {
                        cell.style.display = 'none';
                    }
                }
                if (turnoverIndex !== -1) {
                    const cell = rows[i].children[turnoverIndex];
                    if (cell && !cell.hasAttribute('data-converted')) {
                        const rawText = cell.textContent.trim().replace(/,/g, '');
                        if (rawText !== '' && !isNaN(rawText)) {
                            cell.textContent = (parseFloat(rawText) / 10000).toFixed(2);
                            cell.setAttribute('data-converted', 'true');
                        }
                    }
                }
                if (shareAmountIndex !== -1) {
                    const cell = rows[i].children[shareAmountIndex];
                    if (cell && !cell.hasAttribute('data-share-converted')) {
                        const rawText = cell.textContent.trim().replace(/,/g, '');
                        if (rawText !== '' && !isNaN(rawText)) {
                            cell.textContent = (parseFloat(rawText) / 10000).toFixed(2);
                            cell.setAttribute('data-share-converted', 'true');
                        }
                    }
                }
                if (shareChangeIndex !== -1) {
                    renderColor(rows[i].children[shareChangeIndex], 'data-colored');
                }
                if (indexChangeIndex !== -1) {
                    renderColor(rows[i].children[indexChangeIndex], 'data-idx-colored');
                }
            }
        });
    }

    // 启动格式化模块，每500ms执行一次以应对动态加载
    setInterval(formatData, 500);

    // ==========================================
    // 模块二：历史净申购走势图悬浮窗 (自适应Y轴版)
    // ==========================================
    const checkTimer = setInterval(() => {
        // 避免重复创建图表容器
        if (document.getElementById('jsl-etf-chart-container')) {
            clearInterval(checkTimer);
            return;
        }

        const rows = document.querySelectorAll('table tbody tr');
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
        // 动态定位列索引 (规避因模块一隐藏列或官方改版导致的列号错乱)
        let dateIdx = 0, navIdx = 3, newSharesIdx = 7;
        const headerRow = Array.from(document.querySelectorAll('table tr')).find(r => r.textContent.includes('场内新增'));

        if (headerRow) {
            Array.from(headerRow.children).forEach((cell, i) => {
                const text = cell.textContent.trim();
                if (text === '日期') dateIdx = i;
                if (text === '净值') navIdx = i;
                if (text.includes('场内新增')) newSharesIdx = i;
            });
        }

        const dates = [];
        const netInflowAmountsValues = [];
        const navValues = [];

        // 提取并计算数据
        rows.forEach(row => {
            const cols = row.querySelectorAll('td');
            if (cols.length > Math.max(navIdx, newSharesIdx)) {
                const dateText = cols[dateIdx].innerText.trim();
                const navText = cols[navIdx].innerText.trim();
                const shareText = cols[newSharesIdx].innerText.trim();

                const nav = parseFloat(navText);
                const netNewSharesWan = parseFloat(shareText);

                let netInflowAmountYi = 0;
                if (!isNaN(nav) && !isNaN(netNewSharesWan)) {
                    netInflowAmountYi = (netNewSharesWan * nav) / 10000;
                }

                if (dateText && !isNaN(nav)) {
                    dates.push(dateText);
                    netInflowAmountsValues.push(netInflowAmountYi.toFixed(3));
                    navValues.push(nav);
                }
            }
        });

        // 按日期升序排列
        dates.reverse();
        netInflowAmountsValues.reverse();
        navValues.reverse();

        // 自动计算净值轴安全边界
        const minNav = Math.min(...navValues);
        const maxNav = Math.max(...navValues);
        const navRange = maxNav - minNav;
        const y2Min = minNav - (navRange * 0.1);
        const y2Max = maxNav + (navRange * 0.1);

        // 创建悬浮容器
        const container = document.createElement('div');
        container.id = 'jsl-etf-chart-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.width = '600px';
        container.style.height = '400px';
        container.style.backgroundColor = '#ffffff';
        container.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
        container.style.borderRadius = '12px';
        container.style.padding = '15px';
        container.style.zIndex = '99999';
        container.style.fontFamily = 'sans-serif';
        container.style.transition = 'all 0.3s ease';

        // 标题与按钮
        const titleBar = document.createElement('div');
        titleBar.style.display = 'flex';
        titleBar.style.justifyContent = 'space-between';
        titleBar.style.alignItems = 'center';
        titleBar.style.marginBottom = '10px';
        titleBar.style.borderBottom = '1px solid #f0f0f0';
        titleBar.style.paddingBottom = '8px';

        const titleText = document.createElement('span');
        titleText.innerText = '历史净申购走势(估算亿元)';
        titleText.style.fontWeight = 'bold';
        titleText.style.color = '#333';
        titleText.style.fontSize = '14px';

        const toggleBtn = document.createElement('button');
        toggleBtn.innerText = '收起';
        toggleBtn.style.padding = '4px 8px';
        toggleBtn.style.border = 'none';
        toggleBtn.style.backgroundColor = '#d9534f';
        toggleBtn.style.color = '#fff';
        toggleBtn.style.borderRadius = '4px';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.fontSize = '12px';

        titleBar.appendChild(titleText);
        titleBar.appendChild(toggleBtn);
        container.appendChild(titleBar);

        const canvasContainer = document.createElement('div');
        canvasContainer.style.width = '100%';
        canvasContainer.style.height = '320px';
        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);
        container.appendChild(canvasContainer);
        document.body.appendChild(container);

        // 折叠逻辑
        let isCollapsed = false;
        toggleBtn.addEventListener('click', () => {
            if (isCollapsed) {
                container.style.height = '400px';
                container.style.width = '600px';
                canvasContainer.style.display = 'block';
                toggleBtn.innerText = '收起';
                toggleBtn.style.backgroundColor = '#d9534f';
            } else {
                container.style.height = '45px';
                container.style.width = '200px';
                canvasContainer.style.display = 'none';
                toggleBtn.innerText = '展开走势图';
                toggleBtn.style.backgroundColor = '#007bff';
            }
            isCollapsed = !isCollapsed;
        });

        // 渲染图表
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: '估算净流入 (亿元)',
                        data: netInflowAmountsValues,
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
                        label: '基金净值',
                        data: navValues,
                        type: 'line',
                        borderColor: '#1890ff',
                        borderWidth: 2.5,
                        pointRadius: 1,
                        backgroundColor: 'transparent',
                        yAxisID: 'y2',
                        order: 1,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { boxWidth: 12, font: { size: 10 } } }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 9 }, maxTicksLimit: 10, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '净流入/流出 (亿元)', font: { size: 11, weight: 'bold' } },
                        ticks: { font: { size: 10 } },
                        grid: { color: 'rgba(0, 0, 0, 0.05)' }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: '基金净值', font: { size: 11, weight: 'bold' } },
                        min: y2Min,
                        max: y2Max,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            font: { size: 10 },
                            callback: function(value) { return value.toFixed(2); }
                        }
                    }
                }
            }
        });
    }
})();
