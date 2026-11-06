// ==UserScript==
// @name         Finviz Option Spread Hunter
// @namespace    http://tampermonkey.net/
// @version      3.8
// @description  Automated 1/3 Rule Put Credit Spread scanner for Finviz with DTE checks, Delta risk filters, and stacked floating UI.
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

    function updateDTEInfo() {
        const dteBox = document.getElementById('sh-dte-info');
        try {
            const today = new Date();
            today.setHours(0,0,0,0);

            const minTargetDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
            const maxTargetDate = new Date(today.getTime() + 50 * 24 * 60 * 60 * 1000);
            const idealDate = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000);

            const expiryButton = document.querySelector('button[aria-label="Expiry select"]');
            let rawExpiry = "";
            if (expiryButton && expiryButton.querySelector('span')) {
                rawExpiry = expiryButton.querySelector('span').innerText.trim();
            }

            let dteStatus = "";
            if (rawExpiry) {
                const [month, day, year] = rawExpiry.split('/');
                if (month && day && year) {
                    const expiryDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    expiryDate.setHours(0,0,0,0);
                    const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysToExpiry >= 30 && daysToExpiry <= 50) {
                        dteStatus = `<span style="color: #34d399; font-weight:bold;">✅ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - Optimal)</span>`;
                    } else if (daysToExpiry < 30) {
                        dteStatus = `<span style="color: #f87171; font-weight:bold;">⚠️ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - High Gamma Risk)</span>`;
                    } else {
                        dteStatus = `<span style="color: #60a5fa; font-weight:bold;">ℹ️ Selected: ${rawExpiry} (${daysToExpiry} Days DTE - Slower Decay)</span>`;
                    }
                }
            } else {
                dteStatus = `<span style="color: #9ca3af;">Could not locate Expiry selector.</span>`;
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

            let foundCount = 0;
            let htmlContent = '';

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
                                foundCount++;
                                htmlContent += `
                                    <div style="margin-bottom: 6px; border-bottom: 1px solid #374151; padding-bottom: 4px;">
                                        <div style="color: #f59e0b; font-weight: bold;">Put ${shortLeg.strike} / ${longLeg.strike}</div>
                                        <div>Credit: <span style="color: #34d399;">$${netCredit.toFixed(2)}</span> (${(ratio * 100).toFixed(1)}%)</div>
                                        <div style="color: #9ca3af;">Short Delta: ${shortLeg.delta}</div>
                                    </div>
                                `;

                                shortLeg.strikeTd.style.outline = '2px solid #10b981';
                                shortLeg.strikeTd.style.outlineOffset = '-2px';
                                longLeg.strikeTd.style.outline = '2px solid #ef4444';
                                longLeg.strikeTd.style.outlineOffset = '-2px';
                            }
                        }
                    }
                }
            }

            if (foundCount === 0) {
                resultBox.innerHTML = `<span style="color: #f87171;">No $${targetWidth} spreads found with Delta <= ${maxDelta} and Ratio between 25%-40%.</span>`;
            } else {
                resultBox.innerHTML = `<div style="color: #34d399; font-weight: bold; margin-bottom: 6px;">🎯 Found ${foundCount} Spreads (Highlighted):</div>` + htmlContent;
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
