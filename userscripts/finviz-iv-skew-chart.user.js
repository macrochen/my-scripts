// ==UserScript==
// @name         IV Skew 可视化图表 (Finviz 紧凑右下角版)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  单线展示虚值 IV，缩小卡片尺寸，默认折叠停靠在预期波动计算器正上方（右下角）
// @match        *://finviz.com/stock.ashx*
// @match        *://finviz.com/stock*
// @match        *://*.finviz.com/stock*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-iv-skew-chart.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-iv-skew-chart.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 动态加载 Chart.js
    function loadChartJS(callback) {
        if (window.Chart) {
            callback();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = callback;
        document.head.appendChild(script);
    }

    // 提取并重组单线 OTM 期权数据
    function extractOptionsData() {
        const rows = document.querySelectorAll('tr');
        let strikeIdx = -1, callIvIdx = -1, putIvIdx = -1;
        let dataRows = [];

        // 定位表头索引
        for (let i = 0; i < rows.length; i++) {
            const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.textContent.trim());
            const sIdx = cells.findIndex(c => c.includes('Strike'));

            if (sIdx !== -1) {
                strikeIdx = sIdx;
                callIvIdx = cells.indexOf('IV');
                putIvIdx = cells.indexOf('IV', strikeIdx);

                if (strikeIdx !== -1 && callIvIdx !== -1 && putIvIdx !== -1) {
                    const baselineLength = cells.length;
                    for (let j = i + 1; j < rows.length; j++) {
                        const dataCells = rows[j].querySelectorAll('td, th');
                        if (dataCells.length === baselineLength) {
                            dataRows.push(dataCells);
                        }
                    }
                    break;
                }
            }
        }

        if (strikeIdx === -1 || callIvIdx === -1 || putIvIdx === -1) {
            throw new Error("请确保当前处于 'Volatility & Greeks' 视图，且页面表格已加载完毕。");
        }

        // 抓取现价
        let currentPrice = 0;
        const priceMatch = document.body.innerText.match(/Last Close\s*([\d,]+\.\d+)/);
        if (priceMatch) {
            currentPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
        } else {
            throw new Error("无法在页面中匹配到现价 (Last Close)。");
        }

        let rawStrikes = [];
        let rawCallIvs = [];
        let rawPutIvs = [];

        dataRows.forEach(tds => {
            const strike = parseFloat(tds[strikeIdx].textContent.replace(/,/g, '').trim());
            const callIv = parseFloat(tds[callIvIdx].textContent.replace('%', '').trim());
            const putIv = parseFloat(tds[putIvIdx].textContent.replace('%', '').trim());

            if (!isNaN(strike) && !isNaN(callIv) && !isNaN(putIv)) {
                rawStrikes.push(strike);
                rawCallIvs.push(callIv);
                rawPutIvs.push(putIv);
            }
        });

        if (rawStrikes.length === 0) throw new Error("未抓取到任何有效的行权价与 IV 数据。");

        // 计算 ATM (距离现价最近的行权价)
        let atmStrike = rawStrikes[0];
        let minDiff = Infinity;
        rawStrikes.forEach(s => {
            const diff = Math.abs(s - currentPrice);
            if (diff < minDiff) {
                minDiff = diff;
                atmStrike = s;
            }
        });

        // 重组为单线数据 (Strike <= ATM 取 Put, 否则取 Call)
        let skewData = [];
        rawStrikes.forEach((s, i) => {
            if (s <= atmStrike) {
                skewData.push({ x: s, y: rawPutIvs[i] }); // 虚值 Put
            } else {
                skewData.push({ x: s, y: rawCallIvs[i] }); // 虚值 Call
            }
        });

        return { skewData, currentPrice, atmStrike };
    }

    // Chart.js 垂直线自定义插件
    const verticalLinePlugin = {
        id: 'verticalLines',
        afterDraw: (chart) => {
            if (!chart.config.options.plugins.verticalLines) return;
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            const { currentPrice, atmStrike } = chart.config.options.plugins.verticalLines;

            const drawLine = (val, color, text) => {
                const x = xAxis.getPixelForValue(val);
                if (x >= xAxis.left && x <= xAxis.right) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]); // 虚线样式
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = color;
                    ctx.stroke();

                    // 绘制顶部文字
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.font = 'bold 11px Arial';
                    ctx.fillText(text, x, yAxis.top - 4);
                    ctx.restore();
                }
            };

            const pricePixel = xAxis.getPixelForValue(currentPrice);
            const atmPixel = xAxis.getPixelForValue(atmStrike);

            // 绘制现价线 (蓝色)
            drawLine(currentPrice, '#60a5fa', '现价');

            // 如果 ATM 与现价在图表上的像素距离大于 35，则额外标记 ATM 线 (紫色)，避免重叠
            if (Math.abs(pricePixel - atmPixel) > 35) {
                drawLine(atmStrike, '#a78bfa', 'ATM');
            }
        }
    };

    let chartInstance = null;

    // 创建悬浮 UI
    function createFloatingUI() {
        if (document.getElementById('iv-skew-container')) return;

        const container = document.createElement('div');
        container.id = 'iv-skew-container';
        // 计算器卡片高 33px，间距预留 9px，底边距设为 72px 避免覆盖
        container.style.cssText = `
            position: fixed; bottom: 72px; right: 30px; z-index: 9999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border-radius: 8px; background: #1e2024; color: #d1d5db;
            border: 1px solid #374151; width: 400px; overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px; background: #374151; color: #9ca3af;
            font-size: 12px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center; user-select: none;
        `;
        // 默认折叠状态图标 □
        header.innerHTML = `<span>IV Skew (OTM 波动率偏斜)</span><span id="iv-skew-toggle" style="cursor:pointer; padding: 0 4px;" title="展开/折叠">□</span>`;

        // 拖拽逻辑
        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'iv-skew-toggle') return;
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        });

        document.addEventListener('mouseup', () => { isDragging = false; });

        const contentBox = document.createElement('div');
        contentBox.id = 'iv-skew-content';
        // 默认隐藏内容面板
        contentBox.style.cssText = 'padding: 16px; display: none;';

        // 折叠切换逻辑
        header.querySelector('#iv-skew-toggle').addEventListener('click', (e) => {
            if (contentBox.style.display === 'none') {
                contentBox.style.display = 'block';
                e.target.innerText = '—';
            } else {
                contentBox.style.display = 'none';
                e.target.innerText = '□';
            }
        });

        const button = document.createElement('button');
        button.innerText = '生成/刷新 IV Skew';
        button.style.cssText = `
            width: 100%; padding: 8px 12px; background: #10b981; color: white;
            border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;
        `;

        const errorBox = document.createElement('div');
        errorBox.style.cssText = 'color: #ef4444; font-size: 13px; display: none; margin-bottom: 10px;';

        // Canvas 容器
        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = 'position: relative; height: 220px; width: 100%; display: none;';
        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);

        button.addEventListener('click', () => {
            errorBox.style.display = 'none';
            button.innerText = '加载中...';

            loadChartJS(() => {
                try {
                    const data = extractOptionsData();

                    canvasContainer.style.display = 'block';
                    button.innerText = '刷新 IV Skew';

                    if (chartInstance) chartInstance.destroy();

                    // 注册插件并绘制
                    Chart.register(verticalLinePlugin);
                    chartInstance = new Chart(canvas.getContext('2d'), {
                        type: 'line',
                        data: {
                            datasets: [{
                                label: 'OTM IV (%)',
                                data: data.skewData,
                                borderColor: '#f59e0b',
                                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                borderWidth: 2,
                                pointRadius: 2,
                                fill: false,
                                tension: 0.3
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            layout: {
                                padding: { top: 18 }
                            },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                    callbacks: {
                                        title: (ctx) => `Strike: ${ctx[0].parsed.x}`,
                                        label: (ctx) => `IV: ${ctx.parsed.y}%`
                                    }
                                },
                                verticalLines: {
                                    currentPrice: data.currentPrice,
                                    atmStrike: data.atmStrike
                                }
                            },
                            scales: {
                                x: {
                                    type: 'linear',
                                    grid: { color: '#374151' },
                                    ticks: { color: '#9ca3af', maxTicksLimit: 8 },
                                    title: { display: true, text: 'Strike', color: '#9ca3af', font: { size: 10 } }
                                },
                                y: {
                                    grid: { color: '#374151' },
                                    ticks: { color: '#9ca3af', maxTicksLimit: 6 },
                                    title: { display: true, text: 'IV (%)', color: '#9ca3af', font: { size: 10 } }
                                }
                            }
                        }
                    });

                } catch (err) {
                    canvasContainer.style.display = 'none';
                    errorBox.style.display = 'block';
                    errorBox.innerHTML = `<strong>抓取失败:</strong> ${err.message}`;
                    button.innerText = '生成/刷新 IV Skew';
                }
            });
        });

        contentBox.appendChild(button);
        contentBox.appendChild(errorBox);
        contentBox.appendChild(canvasContainer);

        container.appendChild(header);
        container.appendChild(contentBox);
        document.body.appendChild(container);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createFloatingUI);
    } else {
        createFloatingUI();
    }
})();
