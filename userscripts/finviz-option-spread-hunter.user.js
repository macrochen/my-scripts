// ==UserScript==
// @name         Finviz Option Spread Hunter
// @namespace    http://tampermonkey.net/
// @version      3.11
// @description  Automated 1/3 Rule Put Credit Spread scanner for Finviz with DTE checks, Delta risk filters, per-trade ROC ranking, and stacked floating UI.
// @match        *://finviz.com/stock.ashx*
// @match        *://finviz.com/stock*
// @match        *://*.finviz.com/stock*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-option-spread-hunter.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-option-spread-hunter.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function createFloatingUI() {
        if (document.getElementById('spread-hunter-container')) return;

        const container = document.createElement('div');
        container.id = 'spread-hunter-container';
        // 将 bottom 从 140px 提高到 185px，与下方的比例价差猎手、预期波动计算器并排向上依次排列，彻底解决重叠问题
        container.style.cssText = `
            position: fixed; bottom: 185px; right: 30px; z-index: 9999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-radius: 8px; background: #1e2024; color: #d1d5db;
            border: 1px solid #374151; width: 280px; overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px; background: #374151; color: #9ca3af;
            font-size: 12px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center; user-select: none;
        `;
        header.innerHTML = `<span>🎯 Finviz Option Spread Hunter</span><span id="sh-calc-toggle" style="cursor:pointer; padding: 0 4px;" title="Toggle">□</span>`;

        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'sh-calc-toggle') return;
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            const rect = container.getBoundingClientRect();
            if (rect.top < 8 && currentY < yOffset) {
                return;
            }

            xOffset = currentX;
            yOffset = currentY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        });

        document.addEventListener('mouseup', () => { isDragging = false; });

        const contentBox = document.createElement('div');
        contentBox.id = 'sh-calc-content';
        contentBox.style.cssText = 'padding: 16px; display: none;';

        header.querySelector('#sh-calc-toggle').addEventListener('click', (e) => {
            if (contentBox.style.display === 'none') {
                contentBox.style.display = 'block';
                e.target.innerText = '—';
                updateDTEInfo();

                setTimeout(() => {
                    const rect = container.getBoundingClientRect();
                    if (rect.top < 8) {
                        currentY += (8 - rect.top);
                        yOffset = currentY;
                        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
                    }
                }, 10);
            } else {
                contentBox.style.display = 'none';
                e.target.innerText = '□';
            }
        });

        contentBox.innerHTML = `
            <div id="sh-dte-info" style="margin-bottom: 12px; padding: 8px; background: #111827; border-radius: 4px; font-size: 11px; border-left: 3px solid #60a5fa; line-height: 1.5;">
                Reading Expiry Date...
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-size: 12px; color: #9ca3af; display: block; margin-bottom: 4px;">Spread Width ($):</label>
                <input type="number" id="sh-width" value="10" style="width: 100%; box-sizing: border-box; background: #374151; color: #fff; border: 1px solid #4b5563; padding: 6px 8px; border-radius: 4px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-size: 12px; color: #9ca3af; display: block; margin-bottom: 4px;">Max Short Delta (Abs):</label>
                <input type="number" id="sh-max-delta" value="0.33" step="0.01" style="width: 100%; box-sizing: border-box; background: #374151; color: #fff; border: 1px solid #4b5563; padding: 6px 8px; border-radius: 4px;">
            </div>
            <div style="margin-bottom: 12px; font-size: 12px; color: #9ca3af;">
                Target Premium Ratio: <strong style="color: #34d399;">25% - 40%</strong>
            </div>
            <button id="sh-scan-btn" style="width: 100%; padding: 8px 12px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;">
                Scan & Highlight Spreads
            </button>
            <div id="sh-result-box" style="font-size: 12px; line-height: 1.5; display: none; background: #111827; padding: 10px; border-radius: 4px; max-height: 180px; overflow-y: auto;"></div>
        `;

        container.appendChild(header);
        container.appendChild(contentBox);
        document.body.appendChild(container);

        document.getElementById('sh-scan-btn').addEventListener('click', scanAndHighlight);
    }

    // 从 Finviz 的 Expiry 选择器读取当前到期日，用于 DTE 窗口提示
    // 返回 { days, raw }；选择器缺失或日期非法时返回 null（不抛错，扫描仍可继续）
    function getDaysToExpiry() {
        const button = document.querySelector('button[aria-label="Expiry select"]');
        const span = button && button.querySelector('span');
        const raw = span ? span.innerText.trim() : '';
        if (!raw) return null;

        const [month, day, year] = raw.split('/');
        if (!month || !day || !year) return null;

        const expiryDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        if (isNaN(expiryDate.getTime())) return null;
        expiryDate.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 用 round 而非 ceil：夏令时切换会让整天数出现 ±1 小时的毫秒偏差
        const days = Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (!isFinite(days) || days <= 0) return null;

        return { days, raw };
    }

    function updateDTEInfo() {
        const dteBox = document.getElementById('sh-dte-info');
        try {
            const today = new Date();
            today.setHours(0,0,0,0);

            const minTargetDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
            const maxTargetDate = new Date(today.getTime() + 50 * 24 * 60 * 60 * 1000);
            const idealDate = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000);

            const expiryInfo = getDaysToExpiry();

            let dteStatus = "";
            if (expiryInfo) {
                const { days: daysToExpiry, raw: rawExpiry } = expiryInfo;
                if (daysToExpiry >= 30 && daysToExpiry <= 50) {
                    dteStatus = `<span style="color: #34d399; font-weight:bold;">✅ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - Optimal)</span>`;
                } else if (daysToExpiry < 30) {
                    dteStatus = `<span style="color: #f87171; font-weight:bold;">⚠️ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - High Gamma Risk)</span>`;
                } else {
                    dteStatus = `<span style="color: #60a5fa; font-weight:bold;">ℹ️ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - Slower Decay)</span>`;
                }
            } else {
                dteStatus = `<span style="color: #9ca3af;">Could not read selected Expiry date.</span>`;
            }

            dteBox.innerHTML = `
                ${dteStatus}
                <div style="margin-top: 6px; border-top: 1px dashed #374151; padding-top: 6px; color: #9ca3af;">
                    🎯 <strong>Target DTE Window (30-50 Days):</strong><br/>
                    Ideal Date: <strong>${formatDate(idealDate)}</strong><br/>
                    (Range: ${formatDate(minTargetDate)} ~ ${formatDate(maxTargetDate)})
                </div>
            `;
        } catch (err) {
            dteBox.innerHTML = `<span style="color: #f87171;">Expiry Parse Error: ${err.message}</span>`;
        }
    }

    function scanAndHighlight() {
        const resultBox = document.getElementById('sh-result-box');
        resultBox.style.display = 'block';
        resultBox.innerHTML = '<span style="color: #60a5fa;">Scanning options chain...</span>';

        try {
            const targetWidth = parseFloat(document.getElementById('sh-width').value) || 10;
            const maxDelta = parseFloat(document.getElementById('sh-max-delta').value) || 0.33;

            const rows = document.querySelectorAll('tr');
            let strikeIdx = -1, putLastIdx = -1, putDeltaIdx = -1;
            let dataRows = [];

            for (let i = 0; i < rows.length; i++) {
                const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.textContent.trim());
                const sIdx = cells.findIndex(c => c.includes('Strike'));

                if (sIdx !== -1) {
                    strikeIdx = sIdx;
                    for (let k = strikeIdx + 1; k < cells.length; k++) {
                        if (cells[k].includes('Last') && putLastIdx === -1) putLastIdx = k;
                        if (cells[k].includes('Delta') && putDeltaIdx === -1) putDeltaIdx = k;
                    }

                    if (strikeIdx !== -1 && putLastIdx !== -1 && putDeltaIdx !== -1) {
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

            if (strikeIdx === -1 || putLastIdx === -1 || putDeltaIdx === -1) {
                throw new Error("Could not find Strike/Last/Delta columns. Switch to 'Volatility & Greeks' tab.");
            }

            dataRows.forEach(tds => {
                tds[strikeIdx].style.backgroundColor = '';
                tds[strikeIdx].style.outline = '';
                if (tds[putLastIdx]) tds[putLastIdx].style.backgroundColor = '';
            });

            const putsData = [];
            dataRows.forEach(tds => {
                const strikeVal = parseFloat(tds[strikeIdx].textContent.replace(/,/g, '').trim());
                const putLastVal = parseFloat(tds[putLastIdx].textContent.replace(/,/g, '').trim());
                const putDeltaVal = parseFloat(tds[putDeltaIdx].textContent.replace(/,/g, '').trim());

                if (!isNaN(strikeVal) && !isNaN(putLastVal) && !isNaN(putDeltaVal) && putLastVal > 0) {
                    putsData.push({
                        strike: strikeVal,
                        last: putLastVal,
                        delta: putDeltaVal,
                        strikeTd: tds[strikeIdx],
                        lastTd: tds[putLastIdx]
                    });
                }
            });

            const matches = [];

            for (let i = 0; i < putsData.length; i++) {
                for (let j = 0; j < putsData.length; j++) {
                    const shortLeg = putsData[i];
                    const longLeg = putsData[j];

                    if (shortLeg.strike > longLeg.strike) {
                        const width = shortLeg.strike - longLeg.strike;

                        if (Math.abs(width - targetWidth) < 0.1) {
                            const netCredit = shortLeg.last - longLeg.last;
                            if (netCredit <= 0) continue;

                            const ratio = netCredit / width;
                            const absDelta = Math.abs(shortLeg.delta);

                            if (ratio >= 0.25 && ratio <= 0.40 && absDelta <= maxDelta) {
                                // Put Credit Spread: 最大亏损 = 价差宽度 - 净权利金；
                                // ROC = 最大盈利 / 最大亏损，只表示「这一笔交易」本身。
                                // 不做任何时间外推：把 42 天换算成一年重复 8.69 次，
                                // 隐含「每期都能满仓复投、每期都赚满、且从不亏损」的假设，不成立。
                                const maxRisk = width - netCredit;
                                const roc = maxRisk > 0 ? (netCredit / maxRisk) * 100 : 0;

                                matches.push({
                                    shortStrike: shortLeg.strike,
                                    longStrike: longLeg.strike,
                                    netCredit,
                                    ratio,
                                    maxRisk,
                                    roc,
                                    delta: shortLeg.delta,
                                    shortTd: shortLeg.strikeTd,
                                    longTd: longLeg.strikeTd
                                });
                            }
                        }
                    }
                }
            }

            // 按这一笔交易的 ROC 从高到低排列，最优组合落在结果框默认可见的顶部
            matches.sort((a, b) => b.roc - a.roc);

            let htmlContent = '';
            matches.forEach((m, idx) => {
                htmlContent += `
                    <div style="margin-bottom: 6px; border-bottom: 1px solid #374151; padding-bottom: 4px;">
                        <div style="color: #f59e0b; font-weight: bold;">${idx === 0 ? '🏆 ' : ''}Put ${m.shortStrike} / ${m.longStrike}</div>
                        <div>Credit: <span style="color: #34d399;">$${m.netCredit.toFixed(2)}</span> (Credit/Width ${(m.ratio * 100).toFixed(1)}%)</div>
                        <div>Max Risk: $${m.maxRisk.toFixed(2)} · <span style="color: #34d399; font-weight: bold;">ROC: ${m.roc.toFixed(1)}%</span></div>
                        <div style="color: #9ca3af;">Short Delta: ${m.delta}</div>
                    </div>
                `;

                m.shortTd.style.outline = '2px solid #10b981';
                m.shortTd.style.outlineOffset = '-2px';
                m.longTd.style.outline = '2px solid #ef4444';
                m.longTd.style.outlineOffset = '-2px';
            });

            const foundCount = matches.length;

            if (foundCount === 0) {
                resultBox.innerHTML = `<span style="color: #f87171;">No $${targetWidth} spreads found with Delta <= ${maxDelta} and Ratio between 25%-40%.</span>`;
            } else {
                resultBox.innerHTML = `
                    <div style="color: #34d399; font-weight: bold; margin-bottom: 2px;">🎯 Found ${foundCount} Spreads (Highlighted):</div>
                    <div style="color: #9ca3af; font-size: 10px; margin-bottom: 6px;">Per-trade ROC = Credit / (Width - Credit) · sorted high to low</div>
                ` + htmlContent;
            }

        } catch (err) {
            resultBox.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Scan Interrupted:</span> <br/>${err.message}`;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createFloatingUI);
    } else {
        createFloatingUI();
    }
})();
