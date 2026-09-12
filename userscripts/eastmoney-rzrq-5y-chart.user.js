// ==UserScript==
// @name         东方财富两融5年宏观走势图 (精锐缓存终极版)
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  修复清理机制误杀当前缓存的Bug，实现真正的日内秒开与跨日增量。
// @author       Gemini
// @match        *://data.eastmoney.com/rzrq/total/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/eastmoney-rzrq-5y-chart.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/eastmoney-rzrq-5y-chart.user.js
// @grant        GM_xmlhttpRequest
// @connect      datacenter-web.eastmoney.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function() {
    'use strict';

    const CACHE_KEY = 'EM_RZRQ_5Y_DATA_V8';
    const LAST_FETCH_KEY = 'EM_RZRQ_LAST_DATE_V8';

    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    const endDate = new Date();
    const beginDate = new Date();
    beginDate.setFullYear(endDate.getFullYear() - 5);
    const strBeginDate = formatDate(beginDate);
    const todayStr = formatDate(endDate);

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '10px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.width = '1200px';
    container.style.height = '600px';
    container.style.backgroundColor = '#ffffff';
    container.style.boxShadow = '0 -5px 20px rgba(0,0,0,0.15)';
    container.style.borderRadius = '8px 8px 0 0';
    container.style.padding = '15px 20px';
    container.style.zIndex = '99999';
    container.style.fontFamily = '"Microsoft YaHei", sans-serif';
    container.style.transition = 'all 0.3s ease';

    const titleBar = document.createElement('div');
    titleBar.style.display = 'flex';
    titleBar.style.justifyContent = 'space-between';
    titleBar.style.alignItems = 'center';
    titleBar.style.borderBottom = '1px solid #e8e8e8';
    titleBar.style.paddingBottom = '10px';
    titleBar.style.marginBottom = '10px';

    const titleText = document.createElement('span');
    titleText.innerText = '正在初始化本地两融数据引擎...';
    titleText.style.fontWeight = 'bold';
    titleText.style.color = '#df351a';
    titleText.style.fontSize = '16px';

    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = '隐藏图表';
    toggleBtn.style.padding = '4px 12px';
    toggleBtn.style.border = '1px solid #df351a';
    toggleBtn.style.backgroundColor = '#fff';
    toggleBtn.style.color = '#df351a';
    toggleBtn.style.borderRadius = '4px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.fontSize = '12px';

    titleBar.appendChild(titleText);
    titleBar.appendChild(toggleBtn);
    container.appendChild(titleBar);

    const canvasContainer = document.createElement('div');
    canvasContainer.style.width = '100%';
    canvasContainer.style.height = '530px';
    const canvas = document.createElement('canvas');
    canvasContainer.appendChild(canvas);
    container.appendChild(canvasContainer);
    document.body.appendChild(container);

    let isCollapsed = false;
    toggleBtn.addEventListener('click', () => {
        if (isCollapsed) {
            container.style.height = '600px';
            canvasContainer.style.display = 'block';
            toggleBtn.innerText = '隐藏图表';
        } else {
            container.style.height = '45px';
            canvasContainer.style.display = 'none';
            toggleBtn.innerText = '展开走势图';
        }
        isCollapsed = !isCollapsed;
    });

    function requestData(pageNo, pageSize) {
        const apiUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=ALL&source=WEB&sortColumns=dim_date&sortTypes=-1&pageNumber=${pageNo}&pageSize=${pageSize}&_=${Date.now()}`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: apiUrl,
                headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (e) {
                            reject(new Error('数据回执解析失败'));
                        }
                    } else {
                        reject(new Error('网络请求异常'));
                    }
                },
                onerror: reject
            });
        });
    }

    let dynamicIndexKey = null;

    function parseDataArray(dataArray) {
        let parsed = [];
        if (!dataArray || dataArray.length === 0) return parsed;

        if (!dynamicIndexKey) {
            const firstItem = dataArray[0];
            const candidates = ['BINDEX_VALUE', 'INDEX_VALUE', 'SH000300_CLOSE', 'HS300_CLOSE'];
            dynamicIndexKey = candidates.find(k => firstItem[k] !== undefined && firstItem[k] !== null);

            if (!dynamicIndexKey) {
                for (const key in firstItem) {
                    const rawStr = String(firstItem[key]);
                    if (rawStr.includes('-') || rawStr.includes('/')) continue;

                    const val = parseFloat(rawStr);
                    if (!isNaN(val) && val > 2000 && val < 8000 && !key.includes('YE') && !key.includes('DATE')) {
                        dynamicIndexKey = key;
                        break;
                    }
                }
            }
        }

        for (const item of dataArray) {
            const dateStr = item.DIM_DATE.split(' ')[0];
            if (dateStr < strBeginDate) continue;

            const hs300Price = dynamicIndexKey ? item[dynamicIndexKey] : 0;

            parsed.push({
                opDate: dateStr,
                rzrqye: item.RZRQYE || 0,
                hs300: parseFloat(hs300Price) || 0
            });
        }
        return parsed;
    }

    async function initDataEngine() {
        let localData = [];
        try {
            localData = JSON.parse(localStorage.getItem(CACHE_KEY)) || [];
        } catch(e) { localData = []; }

        const hasBadCache = localData.some(item => !item.hs300 || item.hs300 < 2000 || item.hs300 > 8000);
        if (hasBadCache) {
            localData = [];
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(LAST_FETCH_KEY);
        }

        const lastFetchDate = localStorage.getItem(LAST_FETCH_KEY);

        if (lastFetchDate === todayStr && localData.length > 0) {
            titleText.innerText = `数据已就绪 (日内读取本地缓存)`;
            processAndRenderChart(localData);
            return;
        }

        if (localData.length === 0) {
            let allData = [];
            let pageNo = 1;
            const pageSize = 500;
            let hasMore = true;

            try {
                while(hasMore) {
                    titleText.innerText = `首次部署：正在同步5年全量数据网关... (第 ${pageNo} 页)`;
                    const result = await requestData(pageNo, pageSize);
                    const rawArray = result.result ? result.result.data : [];

                    if (rawArray && rawArray.length > 0) {
                        const parsed = parseDataArray(rawArray);
                        allData = allData.concat(parsed);

                        const lastItemDate = rawArray[rawArray.length - 1].DIM_DATE.split(' ')[0];
                        if (lastItemDate < strBeginDate || rawArray.length < pageSize) {
                            hasMore = false;
                        }
                        pageNo++;
                        await new Promise(r => setTimeout(r, 200));
                    } else {
                        hasMore = false;
                    }
                }

                localStorage.setItem(CACHE_KEY, JSON.stringify(allData));
                localStorage.setItem(LAST_FETCH_KEY, todayStr);
                processAndRenderChart(allData);
            } catch (err) {
                titleText.innerText = '网络同步异常，请刷新重试';
            }
            return;
        }

        if (localData.length > 0) {
            try {
                titleText.innerText = `正在检查并缝合最新的交易日差值数据...`;
                const result = await requestData(1, 30);
                const rawArray = result.result ? result.result.data : [];
                const newParsed = parseDataArray(rawArray);

                let mergedMap = new Map();
                localData.forEach(item => mergedMap.set(item.opDate, item));
                newParsed.forEach(item => mergedMap.set(item.opDate, item));

                let mergedData = Array.from(mergedMap.values())
                                      .filter(item => item.opDate >= strBeginDate);

                localStorage.setItem(CACHE_KEY, JSON.stringify(mergedData));
                localStorage.setItem(LAST_FETCH_KEY, todayStr);
                titleText.innerText = `智能增量同步成功`;
                processAndRenderChart(mergedData);
            } catch(e) {
                titleText.innerText = `差值同步超时，降级渲染历史缓存`;
                processAndRenderChart(localData);
            }
        }
    }

    function processAndRenderChart(rawData) {
        rawData.sort((a, b) => new Date(a.opDate) - new Date(b.opDate));

        const dates = [];
        const totalValues = [];
        const hs300Values = [];

        rawData.forEach(item => {
            dates.push(item.opDate);
            totalValues.push((parseFloat(item.rzrqye) || 0) / 1e8);
            hs300Values.push(parseFloat(item.hs300) || 0);
        });

        titleText.innerText = `东方财富全市场 - 两融总余额与沪深300走势对比 (共 ${dates.length} 个交易日)`;
        titleText.style.color = '#333';

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: '两融总余额 (亿元)',
                        data: totalValues,
                        borderColor: '#df351a',
                        borderWidth: 2,
                        pointRadius: 0,
                        yAxisID: 'y',
                        tension: 0.1
                    },
                    {
                        label: '沪深300收盘价',
                        data: hs300Values,
                        borderColor: '#3792ef',
                        borderWidth: 2,
                        pointRadius: 0,
                        yAxisID: 'y2',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.datasetIndex === 0) {
                                    label += context.parsed.y.toFixed(2) + ' 亿元';
                                } else {
                                    label += context.parsed.y.toFixed(2) + ' 点';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 20 } },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '两融总余额 (亿元)', font: { weight: 'bold' } }
                    },
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: '沪深300收盘价 (点)', font: { weight: 'bold' } },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    setTimeout(cleanAndInit, 1000);

    function cleanAndInit() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 核心修正：仅清理带 EM_RZRQ 且非当前最新版本标识的旧缓存
            if (key && key.includes('EM_RZRQ') && key !== CACHE_KEY && key !== LAST_FETCH_KEY) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        initDataEngine();
    }
})();
