// ==UserScript==
// @name         上交所两融余额3年宏观走势图 (宽屏满载版)
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  全表与图表数据统一下拉至亿级单位，图表视窗自适应宽屏物理分辨率，实现横向全屏铺满。
// @author       Gemini
// @match        *://www.sse.com.cn/market/othersdata/margin/sum/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/sse-margin-sum-3y-chart.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/sse-margin-sum-3y-chart.user.js
// @grant        GM_xmlhttpRequest
// @connect      query.sse.com.cn
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 模块一：表格全量单位降维 (统一转换为亿级)
    // ==========================================
    function observeAndFormatTable() {
        const formatTable = () => {
            const headers = document.querySelectorAll('table thead th');
            const rows = document.querySelectorAll('table tbody tr');

            if (headers.length === 0 || rows.length === 0) return;

            if (headers[1] && headers[1].innerText.includes('(亿元)') &&
                headers[3] && headers[3].innerText.includes('(亿)')) {
                return;
            }

            headers.forEach((th, index) => {
                if (th.innerText.includes('(元)')) {
                    th.innerText = th.innerText.replace('(元)', '(亿元)');
                }
                if ((index === 3 || index === 5) && !th.innerText.includes('(亿)')) {
                    th.innerText += '(亿)';
                }
            });

            const targetCols = [1, 2, 3, 4, 5, 6];
            rows.forEach(row => {
                const tds = row.querySelectorAll('td');
                if (tds.length >= 7) {
                    targetCols.forEach(idx => {
                        const td = tds[idx];

                        if (!td.dataset.converted) {
                            const rawText = td.innerText.replace(/,/g, '');
                            const rawVal = parseFloat(rawText);

                            if (!isNaN(rawVal)) {
                                const convertedVal = (rawVal / 1e8).toFixed(2);
                                td.innerText = Number(convertedVal).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                                td.dataset.converted = 'true';
                            }
                        }
                    });
                }
            });
        };

        const initialTimer = setInterval(() => {
            const tbody = document.querySelector('table tbody');
            if (tbody) {
                clearInterval(initialTimer);
                formatTable();

                const observer = new MutationObserver(() => {
                    formatTable();
                });
                observer.observe(tbody, { childList: true });
            }
        }, 500);
    }

    observeAndFormatTable();

    // ==========================================
    // 模块二：3年宏观走势图静默抓取与渲染
    // ==========================================
    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}${m}${d}`;
    }

    const endDate = new Date();
    const beginDate = new Date();
    beginDate.setFullYear(endDate.getFullYear() - 3);

    const strEndDate = formatDate(endDate);
    const strBeginDate = formatDate(beginDate);

    // 【核心修改】替换固定像素，采用计算属性自适应全屏宽度
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.width = 'calc(100% - 40px)';
    container.style.height = '700px';
    container.style.backgroundColor = '#ffffff';
    container.style.boxShadow = '0 15px 40px rgba(0,0,0,0.2)';
    container.style.borderRadius = '16px';
    container.style.padding = '20px';
    container.style.zIndex = '99999';
    container.style.fontFamily = 'sans-serif';
    container.style.transition = 'all 0.3s ease';

    const titleBar = document.createElement('div');
    titleBar.style.display = 'flex';
    titleBar.style.justifyContent = 'space-between';
    titleBar.style.alignItems = 'center';
    titleBar.style.marginBottom = '15px';
    titleBar.style.borderBottom = '1px solid #f0f0f0';
    titleBar.style.paddingBottom = '10px';

    const titleText = document.createElement('span');
    titleText.innerText = '正在对接近真实数据网关...';
    titleText.style.fontWeight = 'bold';
    titleText.style.color = '#ff4d4f';
    titleText.style.fontSize = '16px';

    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = '收起';
    toggleBtn.style.padding = '6px 12px';
    toggleBtn.style.border = 'none';
    toggleBtn.style.backgroundColor = '#007bff';
    toggleBtn.style.color = '#fff';
    toggleBtn.style.borderRadius = '6px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.fontSize = '13px';

    titleBar.appendChild(titleText);
    titleBar.appendChild(toggleBtn);
    container.appendChild(titleBar);

    const canvasContainer = document.createElement('div');
    canvasContainer.style.width = '100%';
    canvasContainer.style.height = '630px';
    const canvas = document.createElement('canvas');
    canvasContainer.appendChild(canvas);
    container.appendChild(canvasContainer);
    document.body.appendChild(container);

    let isCollapsed = false;
    toggleBtn.addEventListener('click', () => {
        if (isCollapsed) {
            // 【核心修改】展开时恢复全屏宽度
            container.style.height = '700px';
            container.style.width = 'calc(100% - 40px)';
            canvasContainer.style.display = 'block';
            toggleBtn.innerText = '收起';
        } else {
            container.style.height = '50px';
            container.style.width = '200px';
            canvasContainer.style.display = 'none';
            toggleBtn.innerText = '展开';
        }
        isCollapsed = !isCollapsed;
    });

    async function fetchThreeYearsData() {
        let allData = [];
        let pageNo = 1;
        const pageSize = 100;
        let hasMore = true;

        try {
            while(hasMore) {
                titleText.innerText = `正在抽取通用网关数据... (已加载 ${pageNo} 页)`;

                const apiUrl = `https://query.sse.com.cn/commonSoaQuery.do?isPagination=true&pageHelp.pageSize=${pageSize}&pageHelp.pageNo=${pageNo}&beginDate=${strBeginDate}&endDate=${strEndDate}&sqlId=RZRQ_HZ_INFO&_=${Date.now()}`;

                const result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: apiUrl,
                        headers: {
                            'Referer': 'https://www.sse.com.cn/',
                            'Accept': 'application/json, text/javascript, */*; q=0.01'
                        },
                        onload: function(response) {
                            if (response.status === 200) {
                                try {
                                    resolve(JSON.parse(response.responseText));
                                } catch (e) {
                                    reject(new Error('网关响应非合法JSON结构'));
                                }
                            } else {
                                reject(new Error('HTTP状态异常: ' + response.status));
                            }
                        },
                        onerror: function(err) {
                            reject(err);
                        }
                    });
                });

                const dataArray = result.pageHelp ? result.pageHelp.data : result.result;

                if (dataArray && dataArray.length > 0) {
                    allData = allData.concat(dataArray);
                    pageNo++;
                    if (dataArray.length < pageSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }

                await new Promise(r => setTimeout(r, 100));
            }

            processAndRenderChart(allData);

        } catch (error) {
            titleText.innerText = '数据网关连接失败，请检查控制台网络报错';
            console.error('GM_Fetch Error:', error);
        }
    }

    function processAndRenderChart(rawData) {
        rawData.sort((a, b) => parseInt(a.opDate) - parseInt(b.opDate));

        const dates = [];
        const marginBuyValues = [];
        const shortSellingValues = [];
        const totalValues = [];

        rawData.forEach(item => {
            dates.push(item.opDate);

            const marginBuy = (parseFloat(item.rzye) || 0) / 1e8;
            const shortSelling = (parseFloat(item.rqylje) || 0) / 1e8;

            marginBuyValues.push(marginBuy);
            shortSellingValues.push(shortSelling);
            totalValues.push(marginBuy + shortSelling);
        });

        titleText.innerText = `近3年两融宏观全景走势 (共 ${dates.length} 个交易日)`;
        titleText.style.color = '#333';
        titleText.style.fontSize = '18px';

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: '两融总余额',
                        data: totalValues,
                        borderColor: '#ff4d4f',
                        borderWidth: 4,
                        pointRadius: 0,
                        yAxisID: 'y',
                        tension: 0.1
                    },
                    {
                        label: '融资余额',
                        data: marginBuyValues,
                        borderColor: '#1890ff',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        yAxisID: 'y',
                        tension: 0.1
                    },
                    {
                        label: '融券金额',
                        data: shortSellingValues,
                        borderColor: '#52c41a',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        yAxisID: 'y2',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { font: { size: 12 } }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + ' 亿元';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 }, maxTicksLimit: 12 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '融资/总额 (亿元)', font: { size: 12, weight: 'bold' } },
                        ticks: {
                            font: { size: 11 },
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: '融券余额 (亿元)', font: { size: 12, weight: 'bold' } },
                        grid: { drawOnChartArea: false },
                        ticks: {
                            font: { size: 11 },
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    setTimeout(fetchThreeYearsData, 1500);

})();
