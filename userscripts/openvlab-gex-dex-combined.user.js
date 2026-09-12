// ==UserScript==
// @name         OpenVlab GEX & DEX 双分布图 (期权卖方视角版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  将 GEX 与 DEX 合二为一，左右同屏展示，并提供基于期权卖方的深度策略解读。
// @match        *://*.openvlab.cn/*
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @grant        none
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-gex-dex-combined.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-gex-dex-combined.user.js
// ==/UserScript==

(function() {
    'use strict';

    let gexChartInstance = null;
    let dexChartInstance = null;
    let cachedData = new Map();

    const clearCacheAndUI = () => {
        cachedData.clear();
        const spotInput = document.getElementById('gdex-spot');
        if (spotInput) {
            spotInput.value = '';
            spotInput.style.backgroundColor = '#7f1d1d';
            setTimeout(() => { spotInput.style.backgroundColor = '#4b5563'; }, 800);
        }
        if (gexChartInstance) { gexChartInstance.destroy(); gexChartInstance = null; }
        if (dexChartInstance) { dexChartInstance.destroy(); dexChartInstance = null; }
        const resBox = document.getElementById('gdex-result');
        if (resBox) resBox.style.display = 'none';
    };

    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(this, arguments);
        window.dispatchEvent(new Event('pushstate'));
    };
    window.addEventListener('popstate', clearCacheAndUI);
    window.addEventListener('pushstate', clearCacheAndUI);

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            clearCacheAndUI();
        }
    }, 500);

    function createFloatingUI() {
        if (document.getElementById('gdex-vlab-container')) return;

        const container = document.createElement('div');
        container.id = 'gdex-vlab-container';
        container.style.cssText = `
            position: fixed; top: 40px; left: 40px; z-index: 99999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 24px rgba(0,0,0,0.8);
            border-radius: 8px; background: #181a1b; color: #d1d5db;
            border: 1px solid #374151; width: 1100px;
            max-height: 95vh; display: flex; flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 16px; background: linear-gradient(90deg, #047857 0%, #4338ca 100%); color: white;
            font-size: 14px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; border-bottom: 1px solid #1f2937; flex-shrink: 0;
            border-radius: 7px 7px 0 0;
        `;
        header.innerHTML = `
            <span>📊 OpenVlab GEX & DEX 卖方决策看板</span>
            <div>
                <span id="gdex-help-toggle" style="cursor:pointer; padding: 2px 8px; font-size: 13px; color: #fbbf24; border: 1px solid #fbbf24; border-radius: 4px; margin-right: 12px; background: rgba(0,0,0,0.2);">📖 怎么看?</span>
                <span id="gdex-toggle" style="cursor:pointer; padding: 0 4px; font-size: 16px;">□</span>
            </div>
        `;

        let isDragging = false, currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;
        const dragStart = (e) => {
            if (e.target.tagName === 'SPAN' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
            if (e.type === "touchstart") {
                initialX = e.touches[0].clientX - xOffset; initialY = e.touches[0].clientY - yOffset;
            } else {
                initialX = e.clientX - xOffset; initialY = e.clientY - yOffset;
            }
            isDragging = true;
        };
        const drag = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX; currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX; currentY = e.clientY - initialY;
            }
            xOffset = currentX; yOffset = currentY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        };
        const dragEnd = () => isDragging = false;

        header.addEventListener('mousedown', dragStart);
        header.addEventListener('touchstart', dragStart, { passive: false });
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);

        const contentBox = document.createElement('div');
        contentBox.id = 'gdex-content';
        contentBox.style.cssText = 'padding: 16px; display: none; overflow-y: auto; flex-grow: 1;';

        header.querySelector('#gdex-toggle').addEventListener('click', (e) => {
            const isHidden = contentBox.style.display === 'none';
            contentBox.style.display = isHidden ? 'block' : 'none';
            e.target.innerText = isHidden ? '—' : '□';
        });

        const helpPanel = document.createElement('div');
        helpPanel.style.cssText = 'display: none; background: #262626; padding: 12px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; line-height: 1.6; border: 1px solid #4b5563;';
        helpPanel.innerHTML = `
            <div style="font-weight:bold; color:#fbbf24; margin-bottom:6px; font-size: 13px;">GEX & DEX 双图合并实战指南</div>
            <div style="display:flex; gap:16px;">
                <div style="flex:1;">
                    <strong style="color:#10b981;">左侧：GEX (伽马敞口)</strong>
                    <ul style="padding-left: 16px; margin: 4px 0 0 0; color: #d1d5db;">
                        <li>绿柱最长为 <b>阻力(Call Wall)</b>，红柱最深为 <b>支撑(Put Wall)</b>。</li>
                        <li>黄线穿0轴为反转点。现价>反转点为正伽马(震荡/高抛低吸)，反之为负伽马(单边/追涨杀跌)。</li>
                    </ul>
                </div>
                <div style="flex:1;">
                    <strong style="color:#3b82f6;">右侧：DEX (德尔塔敞口)</strong>
                    <ul style="padding-left: 16px; margin: 4px 0 0 0; color: #d1d5db;">
                        <li>反映期权转化为名义正股的资金规模。绿柱代表多头敞口，红柱代表空头敞口。</li>
                        <li>黄线为净敞口(Net DEX)，为正代表市场总体偏多，为负代表总体偏空。</li>
                    </ul>
                </div>
            </div>
        `;

        header.querySelector('#gdex-help-toggle').addEventListener('click', () => {
            helpPanel.style.display = helpPanel.style.display === 'none' ? 'block' : 'none';
        });

        const inputStyle = "width: 50px; background:#374151; color:white; border:1px solid #4b5563; border-radius:4px; padding:4px; text-align:center; font-size: 12px; transition: background-color 0.3s;";

        const configArea = document.createElement('div');
        configArea.style.cssText = 'margin-bottom: 16px; font-size: 13px; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border: 1px solid #374151;';
        configArea.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; font-weight: bold;">
                    <span style="color:#fbbf24; margin-right: 8px;">⚙️ 数据列配置</span>
                    <span style="color:#9ca3af; font-size: 11px; font-weight: normal;">(以行权价为中轴向两侧数的列数)</span>
                </div>
                <div style="display: flex; align-items: center;">
                    <span style="margin-right: 12px;">标的价格: 
                        <input type="number" id="gdex-spot" value="" placeholder="自动抓取" step="0.001" style="${inputStyle} width:80px; margin-left: 4px;">
                        <button id="btn-sync-spot" style="margin-left: 4px; background: #4f46e5; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">🔄 同步</button>
                    </span>
                    <span>合约乘数: <input type="number" id="gdex-multiplier" value="10000" step="1" style="${inputStyle} width:70px;"></span>
                </div>
            </div>
            <div style="display: flex; gap: 20px; border-top: 1px solid #4b5563; padding-top: 10px;">
                <span style="color:#d1d5db;">OI 列数: <input type="number" id="gdex-oi" value="7" style="${inputStyle}"></span>
                <span style="color:#d1d5db;">Delta 列数: <input type="number" id="gdex-delta" value="1" style="${inputStyle}"></span>
                <span style="color:#d1d5db;">Gamma 列数: <input type="number" id="gdex-gamma" value="9" style="${inputStyle}"></span>
            </div>
        `;

        const button = document.createElement('button');
        button.innerText = '⚡ 抓取当前可见数据并生成合并看板';
        button.style.cssText = `
            width: 100%; padding: 12px; background: linear-gradient(90deg, #059669 0%, #2563eb 100%); color: white;
            border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;
            margin-bottom: 16px; transition: opacity 0.2s; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `;
        button.onmouseover = () => button.style.opacity = '0.9';
        button.onmouseout = () => button.style.opacity = '1';

        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'display: flex; gap: 16px; width: 100%; margin-bottom: 10px;';
        
        const leftBox = document.createElement('div');
        leftBox.style.cssText = 'width: 50%; height: 380px; position: relative; background: rgba(0,0,0,0.2); border: 1px solid #374151; border-radius: 6px; padding: 8px;';
        const gexCanvas = document.createElement('canvas');
        gexCanvas.id = 'gexCanvas';
        leftBox.appendChild(gexCanvas);

        const rightBox = document.createElement('div');
        rightBox.style.cssText = 'width: 50%; height: 380px; position: relative; background: rgba(0,0,0,0.2); border: 1px solid #374151; border-radius: 6px; padding: 8px;';
        const dexCanvas = document.createElement('canvas');
        dexCanvas.id = 'dexCanvas';
        rightBox.appendChild(dexCanvas);

        chartContainer.appendChild(leftBox);
        chartContainer.appendChild(rightBox);

        const resultBox = document.createElement('div');
        resultBox.id = 'gdex-result';
        resultBox.style.cssText = 'display: none;';

        configArea.querySelector('#btn-sync-spot').addEventListener('click', () => {
            const spotInput = document.getElementById('gdex-spot');
            let foundPrice = null;
            const rows = Array.from(document.querySelectorAll('div[data-react-window-index]')).filter(r => r.offsetParent !== null);
            for (let row of rows) {
                const rowText = row.innerText || '';
                const spotMatch = rowText.match(/(?:买价|卖价|最新价|标的)\s*[:：]?\s*(\d+\.\d+)/);
                if (spotMatch && spotMatch[1]) { foundPrice = parseFloat(spotMatch[1]); break; }
            }
            if (!foundPrice) {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while (node = walker.nextNode()) {
                    if (node.parentElement && node.parentElement.offsetParent === null) continue;
                    const match = node.nodeValue.trim().match(/(?:买价|卖价|最新价|标的)\s*[:：]?\s*(\d+\.\d+)/);
                    if (match) { foundPrice = parseFloat(match[1]); break; }
                }
            }
            if (foundPrice && !isNaN(foundPrice)) {
                spotInput.value = foundPrice;
                spotInput.style.backgroundColor = '#065f46';
                setTimeout(() => { spotInput.style.backgroundColor = '#374151'; }, 800);
            }
        });

        const verticalLinePlugin = {
            id: 'verticalLines',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                const labels = chart.data.labels;
                const lines = chart.config.options.plugins.verticalLines || [];

                if (!labels || labels.length === 0) return;

                function getXPixel(val) {
                    if (val <= labels[0]) return xAxis.getPixelForValue(0);
                    if (val >= labels[labels.length - 1]) return xAxis.getPixelForValue(labels.length - 1);
                    for (let i = 0; i < labels.length - 1; i++) {
                        if (val >= labels[i] && val <= labels[i+1]) {
                            const ratio = (val - labels[i]) / (labels[i+1] - labels[i]);
                            const x1 = xAxis.getPixelForValue(i);
                            const x2 = xAxis.getPixelForValue(i+1);
                            return x1 + ratio * (x2 - x1);
                        }
                    }
                    return xAxis.getPixelForValue(0);
                }

                lines.forEach(line => {
                    if (line.val === undefined || line.val === null || isNaN(line.val)) return;
                    const x = getXPixel(line.val);
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = line.color;
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();

                    ctx.fillStyle = line.textColor;
                    ctx.textAlign = 'center';
                    ctx.font = 'bold 11px Arial';
                    ctx.fillText(line.text, x, yAxis.top + line.yOffset);
                    ctx.restore();
                });
            }
        };

        button.addEventListener('click', () => {
            try {
                cachedData.clear();
                if (gexChartInstance) { gexChartInstance.destroy(); gexChartInstance = null; }
                if (dexChartInstance) { dexChartInstance.destroy(); dexChartInstance = null; }
                resultBox.style.display = 'block';

                const spotInput = document.getElementById('gdex-spot');
                const multiplier = parseFloat(document.getElementById('gdex-multiplier').value);
                const oiOffset = parseInt(document.getElementById('gdex-oi').value);
                const deltaOffset = parseInt(document.getElementById('gdex-delta').value);
                const gammaOffset = parseInt(document.getElementById('gdex-gamma').value);

                let autoFoundPrice = null;
                const visibleRows = Array.from(document.querySelectorAll('div[data-react-window-index]')).filter(r => r.offsetParent !== null);

                for (let row of visibleRows) {
                    const rowText = row.innerText || '';
                    const spotMatch = rowText.match(/(?:买价|卖价|最新价|标的)\s*[:：]?\s*(\d+\.\d+)/);
                    if (spotMatch && spotMatch[1]) { autoFoundPrice = parseFloat(spotMatch[1]); break; }
                }
                if (!autoFoundPrice) {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.parentElement && node.parentElement.offsetParent === null) continue;
                        const match = node.nodeValue.trim().match(/(?:买价|卖价|最新价|标的)\s*[:：]?\s*(\d+\.\d+)/);
                        if (match) { autoFoundPrice = parseFloat(match[1]); break; }
                    }
                }

                if (autoFoundPrice && !isNaN(autoFoundPrice)) {
                    spotInput.value = autoFoundPrice;
                }

                let spotPrice = parseFloat(spotInput.value);

                if (isNaN(spotPrice)) throw new Error("无法抓取标的价格，请手动填写。");
                if (isNaN(multiplier)) throw new Error("请输入有效的合约乘数。");
                if (isNaN(oiOffset) || isNaN(deltaOffset) || isNaN(gammaOffset)) throw new Error("列序设置不正确。");

                if (visibleRows.length === 0) throw new Error("未检测到数据，请确保已加载期权链。");

                visibleRows.forEach(row => {
                    if (row.children.length < 3) return;
                    const strikeDiv = row.children[1];
                    if (!strikeDiv) return;

                    const strikeText = strikeDiv.innerText.replace(/[%$,]/g, '').trim();
                    if (strikeText.includes('买价') || strikeText.includes('卖价')) return;

                    const strike = parseFloat(strikeText);
                    if (isNaN(strike)) return;

                    const callGrid = row.children[0].querySelector('.grid');
                    const putGrid = row.children[2].querySelector('.grid');
                    if (!callGrid || !putGrid) return;

                    const callLen = callGrid.children.length;

                    const parseCell = (grid, idx) => {
                        if (idx < 0 || idx >= grid.children.length || !grid.children[idx]) return NaN;
                        const text = grid.children[idx].innerText.replace(/[%$,]/g, '').trim();
                        return text === '-' || text === '' ? NaN : parseFloat(text);
                    };

                    const callGamma = parseCell(callGrid, callLen - gammaOffset);
                    const callOI = parseCell(callGrid, callLen - oiOffset);
                    const callDelta = parseCell(callGrid, callLen - deltaOffset);
                    
                    const putGamma = parseCell(putGrid, gammaOffset - 1);
                    const putOI = parseCell(putGrid, oiOffset - 1);
                    const putDelta = parseCell(putGrid, deltaOffset - 1);

                    if (!isNaN(callGamma) && !isNaN(callOI) && !isNaN(putGamma) && !isNaN(putOI) && !isNaN(callDelta) && !isNaN(putDelta)) {
                        cachedData.set(strike, { strike, callGamma, callOI, putGamma, putOI, callDelta, putDelta });
                    }
                });

                if (cachedData.size === 0) throw new Error("提取失败：未找到完整数据，请确认页面已开启 Delta, Gamma 和 OI。");

                const sortedData = Array.from(cachedData.values()).sort((a, b) => a.strike - b.strike);

                let labels = [];
                let callGexData = [], putGexData = [], netGexData = [];
                let callDexData = [], putDexData = [], netDexData = [];

                let maxCallGex = -Infinity, callWall = null;
                let minPutGex = Infinity, putWall = null;
                let exactGexFlipPoint = null, minGexFlipDist = Infinity;
                let exactDexFlipPoint = null, minDexFlipDist = Infinity;
                
                let prevNetGex = null, prevStrike = null;
                let prevNetDex = null, prevDexStrike = null;
                let totalNetDex = 0;

                sortedData.forEach(item => {
                    // GEX
                    const callGex = item.callGamma * item.callOI * multiplier * Math.pow(spotPrice, 2) * 1;
                    const putGex = item.putGamma * item.putOI * multiplier * Math.pow(spotPrice, 2) * -1;
                    const netGex = callGex + putGex;
                    const cGexB = callGex / 100000000;
                    const pGexB = putGex / 100000000;
                    const nGexB = netGex / 100000000;

                    // DEX
                    const callDex = item.callDelta * item.callOI * multiplier * spotPrice;
                    const putDex = item.putDelta * item.putOI * multiplier * spotPrice;
                    const netDex = callDex + putDex;
                    const cDexB = callDex / 100000000;
                    const pDexB = putDex / 100000000;
                    const nDexB = netDex / 100000000;

                    if (cGexB > maxCallGex) { maxCallGex = cGexB; callWall = item.strike; }
                    if (pGexB < minPutGex) { minPutGex = pGexB; putWall = item.strike; }

                    if (prevNetGex !== null && prevStrike !== null) {
                        if ((prevNetGex < 0 && nGexB > 0) || (prevNetGex > 0 && nGexB < 0)) {
                            let calculatedFlip = prevStrike - prevNetGex * (item.strike - prevStrike) / (nGexB - prevNetGex);
                            let distToSpot = Math.abs(calculatedFlip - spotPrice);
                            if (distToSpot < minGexFlipDist) {
                                minGexFlipDist = distToSpot;
                                exactGexFlipPoint = calculatedFlip;
                            }
                        }
                    }
                    prevNetGex = nGexB;
                    prevStrike = item.strike;

                    if (prevNetDex !== null && prevDexStrike !== null) {
                        if ((prevNetDex < 0 && nDexB > 0) || (prevNetDex > 0 && nDexB < 0)) {
                            let calculatedFlip = prevDexStrike - prevNetDex * (item.strike - prevDexStrike) / (nDexB - prevNetDex);
                            let distToSpot = Math.abs(calculatedFlip - spotPrice);
                            if (distToSpot < minDexFlipDist) {
                                minDexFlipDist = distToSpot;
                                exactDexFlipPoint = calculatedFlip;
                            }
                        }
                    }
                    prevNetDex = nDexB;
                    prevDexStrike = item.strike;
                    totalNetDex += nDexB;

                    labels.push(item.strike);
                    callGexData.push(cGexB); putGexData.push(pGexB); netGexData.push(nGexB);
                    callDexData.push(cDexB); putDexData.push(pDexB); netDexData.push(nDexB);
                });

                const commonOptions = {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { stacked: true, ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 }, grid: { color: '#374151', drawBorder: false } },
                        y: { stacked: true, ticks: { color: '#9ca3af' }, grid: { color: '#4b5563', drawBorder: false, zeroLineColor: '#9ca3af', zeroLineWidth: 2 } }
                    },
                    plugins: { legend: { labels: { color: '#d1d5db', font: { size: 10 } } } }
                };

                const ctxGex = document.getElementById('gexCanvas').getContext('2d');
                gexChartInstance = new Chart(ctxGex, {
                    type: 'bar',
                    plugins: [verticalLinePlugin],
                    data: {
                        labels: labels,
                        datasets: [
                            { type: 'line', label: '净 GEX', data: netGexData, borderColor: '#fbbf24', backgroundColor: '#fbbf24', borderWidth: 2, pointRadius: 2, fill: false, order: 1 },
                            { type: 'bar', label: 'Call GEX', data: callGexData, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#059669', borderWidth: 1, order: 2 },
                            { type: 'bar', label: 'Put GEX', data: putGexData, backgroundColor: 'rgba(239, 68, 68, 0.7)', borderColor: '#dc2626', borderWidth: 1, order: 3 }
                        ]
                    },
                    options: Object.assign({}, commonOptions, {
                        plugins: Object.assign({}, commonOptions.plugins, {
                            tooltip: { callbacks: { label: function(c) { let v = c.raw.toFixed(4); return `${c.dataset.label}: ${v > 0 && c.datasetIndex===0?'+':''}${v} 亿`; }}},
                            verticalLines: [
                                { val: spotPrice, color: 'rgba(59, 130, 246, 0.8)', text: '现价', yOffset: 15, textColor: '#60a5fa' },
                                { val: exactGexFlipPoint, color: 'rgba(251, 191, 36, 0.8)', text: '反转', yOffset: 32, textColor: '#fcd34d' },
                                { val: callWall, color: 'rgba(16, 185, 129, 0.8)', text: '阻力', yOffset: 49, textColor: '#10b981' },
                                { val: putWall, color: 'rgba(239, 68, 68, 0.8)', text: '支撑', yOffset: 66, textColor: '#ef4444' }
                            ]
                        })
                    })
                });

                const ctxDex = document.getElementById('dexCanvas').getContext('2d');
                dexChartInstance = new Chart(ctxDex, {
                    type: 'bar',
                    plugins: [verticalLinePlugin],
                    data: {
                        labels: labels,
                        datasets: [
                            { type: 'line', label: '净 DEX', data: netDexData, borderColor: '#fbbf24', backgroundColor: '#fbbf24', borderWidth: 2, pointRadius: 2, fill: false, order: 1 },
                            { type: 'bar', label: 'Call DEX', data: callDexData, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#059669', borderWidth: 1, order: 2 },
                            { type: 'bar', label: 'Put DEX', data: putDexData, backgroundColor: 'rgba(239, 68, 68, 0.7)', borderColor: '#dc2626', borderWidth: 1, order: 3 }
                        ]
                    },
                    options: Object.assign({}, commonOptions, {
                        plugins: Object.assign({}, commonOptions.plugins, {
                            tooltip: { callbacks: { label: function(c) { let v = c.raw.toFixed(4); return `${c.dataset.label}: ${v > 0 && c.datasetIndex===0?'+':''}${v} 亿`; }}},
                            verticalLines: [
                                { val: spotPrice, color: 'rgba(59, 130, 246, 0.8)', text: '现价', yOffset: 15, textColor: '#60a5fa' },
                                { val: exactDexFlipPoint, color: 'rgba(251, 191, 36, 0.8)', text: '中性点', yOffset: 32, textColor: '#fcd34d' }
                            ]
                        })
                    })
                });

                let regimeText = "";
                if (exactGexFlipPoint !== null) {
                    if (spotPrice > exactGexFlipPoint) regimeText = "<span style='color:#10b981; font-weight:bold;'>正伽马 (震荡 / 均值回归)</span>";
                    else if (spotPrice < exactGexFlipPoint) regimeText = "<span style='color:#ef4444; font-weight:bold;'>负伽马 (单边 / 趋势加速)</span>";
                    else regimeText = "<span style='color:#9ca3af; font-weight:bold;'>中性 (多空平衡)</span>";
                } else {
                    regimeText = "<span style='color:#9ca3af; font-weight:bold;'>未知</span>";
                }

                let biasText = totalNetDex > 0 ? "<span style='color:#10b981; font-weight:bold;'>偏多 (看涨敞口主导)</span>" : "<span style='color:#ef4444; font-weight:bold;'>偏空 (看跌敞口主导)</span>";
                let flipPointStr = exactGexFlipPoint ? exactGexFlipPoint.toFixed(4) : "未找到";
                let putWallStr = putWall ? putWall : "未知";
                let callWallStr = callWall ? callWall : "未知";

                resultBox.innerHTML = `
                <div style="background: #1c1917; border: 1px solid #44403c; border-radius: 8px; padding: 16px; margin-top: 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #44403c; padding-bottom:12px;">
                        <h3 style="margin:0; color:#fbbf24; font-size:15px; display:flex; align-items:center;">
                            <span style="margin-right:8px; font-size:18px;">💡</span> 期权卖方视角深度解读
                        </h3>
                        <span style="font-size:11px; color:#9ca3af;">数据节点: ${cachedData.size} 个</span>
                    </div>
                    
                    <p style="margin: 12px 0 16px 0; font-size:13px; line-height: 1.6; color:#e5e7eb;">
                        针对本次分布图，盘面定性为：当前处于 ${regimeText} 环境，全市场底层敞口呈现 ${biasText}。
                    </p>
                    
                    <div style="display: flex; gap: 16px; margin-top: 12px;">
                        <div style="flex:1; background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.2); padding: 12px; border-radius: 6px;">
                            <h4 style="margin: 0 0 8px 0; color:#10b981; font-size:13px; display:flex; align-items:center;"><span style="margin-right:4px;">🛡️</span> 策略一：稳健收租型</h4>
                            <div style="font-size:12px; color:#d1d5db; margin-bottom:6px;"><b>操作</b>：Sell Put 于 <b style="color:#10b981; font-size:13px;">${putWallStr}</b> 及以下</div>
                            <div style="font-size:11px; color:#9ca3af; line-height:1.5;"><b>理由</b>：GEX 支撑墙在 ${putWallStr}，做市商在此有强烈“高抛低吸”买盘支撑。结合 DEX 负敞口防御区，安全度极高。</div>
                        </div>

                        <div style="flex:1; background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.2); padding: 12px; border-radius: 6px;">
                            <h4 style="margin: 0 0 8px 0; color:#3b82f6; font-size:13px; display:flex; align-items:center;"><span style="margin-right:4px;">📉</span> 策略二：顺势压制型</h4>
                            <div style="font-size:12px; color:#d1d5db; margin-bottom:6px;"><b>操作</b>：Sell Call 于 <b style="color:#3b82f6; font-size:13px;">${callWallStr}</b> 及以上</div>
                            <div style="font-size:11px; color:#9ca3af; line-height:1.5;"><b>理由</b>：GEX 阻力墙在 ${callWallStr}。标的向上遇正 GEX 机械性抛压，且上方缺乏正 DEX 引力，上攻极其困难。</div>
                        </div>
                        
                        <div style="flex:1; background: rgba(139,92,246,0.05); border: 1px solid rgba(139,92,246,0.2); padding: 12px; border-radius: 6px;">
                            <h4 style="margin: 0 0 8px 0; color:#a78bfa; font-size:13px; display:flex; align-items:center;"><span style="margin-right:4px;">🦅</span> 策略三：区间包饺子</h4>
                            <div style="font-size:12px; color:#d1d5db; margin-bottom:6px;"><b>操作</b>：双卖锁定 <b style="color:#a78bfa; font-size:13px;">[${putWallStr}, ${callWallStr}]</b></div>
                            <div style="font-size:11px; color:#9ca3af; line-height:1.5;"><b>理由</b>：现价 ${spotPrice.toFixed(4)}。在正伽马压制下大盘大概率反复震荡，Theta 流逝极快，是卖方的黄金时间。</div>
                        </div>
                    </div>

                    <div style="background: rgba(239,68,68,0.08); border-left: 4px solid #ef4444; padding: 12px; margin-top: 16px; border-radius: 0 6px 6px 0;">
                        <h4 style="margin: 0 0 8px 0; color:#ef4444; font-size:13px; display:flex; align-items:center;"><span style="margin-right:4px;">🚨</span> 卖方风控红线警示</h4>
                        <div style="font-size:12px; color:#fca5a5; line-height:1.6;">
                            <b>现价考验</b>：现价 <b style="color:#f87171;">${spotPrice.toFixed(4)}</b>，零伽马反转点 <b style="color:#f87171;">${flipPointStr}</b>。<br/>
                            <b style="color:#ef4444;">极端风险</b>：一旦有效跌破(或突破)反转点，市场瞬间切换至负 GEX (波动率放大) 环境，底层天量敞口极易引发做市商恐慌性抛盘踩踏，导致 IV 和 Gamma 双重暴涨。所有卖方头寸必须果断平仓或移仓，绝不能硬扛！
                        </div>
                    </div>
                </div>
                `;

            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `<div style="padding:16px; background:rgba(239,68,68,0.1); border-left:4px solid #ef4444; color:#fca5a5; font-size:13px; margin-top:16px;">
                    <span style="color: #ef4444; font-weight: bold; font-size:14px;">❌ 执行错误:</span> <br/>${err.message}
                </div>`;
            }
        });

        contentBox.appendChild(helpPanel);
        contentBox.appendChild(configArea);
        contentBox.appendChild(button);
        contentBox.appendChild(chartContainer);
        contentBox.appendChild(resultBox);
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
