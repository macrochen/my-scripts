// ==UserScript==
// @name         比例信用价差扫描器 (1:3 利润优先修正版)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  基于 OpenVlab Canvas/React 实时数据，全量扫描 Delta < 0.2 且买入腿成本在 40%-60% 之间的最优 1:3 比例价差组合
// @match        *://*.openvlab.cn/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-ratio-credit-spread-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-ratio-credit-spread-scanner.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /**
     * 从 OpenVlab 的 React Fiber 树中提取全部期权行与实时行情快照
     */
    function extractVlabOptionsData() {
        const canvas = document.querySelector('canvas');
        if (!canvas) {
            throw new Error("页面上未找到行情 Canvas 元素，请确认处于 T 型报价页面且行情已加载。");
        }

        const fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (!fiberKey || !canvas[fiberKey]) {
            throw new Error("未侦测到 React Fiber 节点，请刷新页面后重试。");
        }

        let cur = canvas[fiberKey];
        let tableProps = null;

        while (cur) {
            if (cur.memoizedProps) {
                const p = cur.memoizedProps;
                if (p.source && typeof p.source.getSnapshot === 'function') {
                    tableProps = p;
                    break;
                }
                if (p.rows && Array.isArray(p.rows)) {
                    tableProps = p;
                }
            }
            cur = cur.return;
        }

        if (!tableProps || !tableProps.source) {
            throw new Error("未能定位到行情数据源 (source.getSnapshot)，请确认页面渲染完成。");
        }

        const snapshot = tableProps.source.getSnapshot();
        if (!snapshot) {
            throw new Error("获取行情数据快照失败。");
        }

        const rawRows = snapshot.staticRows || tableProps.rows || [];
        if (!rawRows || rawRows.length === 0) {
            throw new Error("行情数据表中未发现行权价数据 (rows 为空)。");
        }

        const quotes = snapshot.quotesByCode || {};
        const optionsData = [];

        rawRows.forEach((item, index) => {
            const rowData = item.row || item;
            const strike = parseFloat(rowData.strike);
            if (isNaN(strike)) return;

            const callQuote = quotes[rowData.callCode] || {};
            const putQuote = quotes[rowData.putCode] || {};

            const callAsk = parseFloat(callQuote.ask);
            const callBid = parseFloat(callQuote.bid);
            const callDelta = parseFloat(callQuote.delta);

            const putAsk = parseFloat(putQuote.ask);
            const putBid = parseFloat(putQuote.bid);
            const putDelta = parseFloat(putQuote.delta);

            optionsData.push({
                rowIndex: index,
                strike: strike,
                callAsk: isNaN(callAsk) ? 0 : callAsk,
                callBid: isNaN(callBid) ? 0 : callBid,
                callDelta: isNaN(callDelta) ? 0 : callDelta,
                putAsk: isNaN(putAsk) ? 0 : putAsk,
                putBid: isNaN(putBid) ? 0 : putBid,
                putDelta: isNaN(putDelta) ? 0 : putDelta
            });
        });

        if (optionsData.length === 0) {
            throw new Error("未能提取到有效的期权行情与 Greeks 数据。");
        }

        return optionsData;
    }

    function createFloatingUI() {
        if (document.getElementById('rcs-calc-container')) return;

        const container = document.createElement('div');
        container.id = 'rcs-calc-container';
        container.style.cssText = `
            position: fixed; bottom: 30px; left: 30px; z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            border-radius: 10px; background: #18191c; color: #d1d5db;
            border: 1px solid #374151; width: 330px; overflow: hidden; font-size: 13px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 9px 14px; background: #991b1b; color: #fecaca;
            font-size: 13px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; border-bottom: 1px solid #7f1d1d;
        `;
        header.innerHTML = `<span>⚡ 比例价差猎手 (1:3 利润版 v2.0)</span><span id="rcs-calc-toggle" style="cursor:pointer; padding: 0 4px; font-size: 14px;" title="展开/折叠">□</span>`;

        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'rcs-calc-toggle') return;
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

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        const contentBox = document.createElement('div');
        contentBox.id = 'rcs-calc-content';
        contentBox.style.cssText = 'padding: 14px; display: none;';

        header.querySelector('#rcs-calc-toggle').addEventListener('click', (e) => {
            if (contentBox.style.display === 'none') {
                contentBox.style.display = 'block';
                e.target.innerText = '—';
            } else {
                contentBox.style.display = 'none';
                e.target.innerText = '□';
            }
        });

        const button = document.createElement('button');
        button.innerText = '一键扫描最优策略组合';
        button.style.cssText = `
            width: 100%; padding: 9px; background: #dc2626; color: white;
            border: none; border-radius: 6px; cursor: pointer; font-weight: bold;
            margin-bottom: 10px; transition: background 0.2s; font-size: 13px;
        `;
        button.onmouseover = () => button.style.background = '#b91c1c';
        button.onmouseout = () => button.style.background = '#dc2626';

        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'font-size: 12px; line-height: 1.6; display: none; margin-top: 6px;';

        button.addEventListener('click', () => {
            try {
                const optionsData = extractVlabOptionsData();
                optionsData.sort((a, b) => a.strike - b.strike);

                let validCallCombos = [];
                let validPutCombos = [];

                // 1. 核心推演：筛选看涨比例价差 (Call: 买近卖远)
                for (let i = 0; i < optionsData.length; i++) {
                    const shortLeg = optionsData[i];
                    // 卖出腿：Delta < 0.20 且 Bid > 0
                    if (Math.abs(shortLeg.callDelta) >= 0.20 || shortLeg.callBid <= 0) continue;

                    for (let j = 0; j < i; j++) {
                        const longLeg = optionsData[j];
                        if (longLeg.callAsk <= 0) continue;

                        const totalCredit = 3 * shortLeg.callBid;
                        const netCredit = totalCredit - longLeg.callAsk;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.callAsk / totalCredit;
                            // 买入腿花费占总收入的 40% 到 60% 之间
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validCallCombos.push({
                                    short: shortLeg,
                                    long: longLeg,
                                    netCredit: netCredit,
                                    ratio: spendRatio
                                });
                            }
                        }
                    }
                }

                // 2. 核心推演：筛选看跌比例价差 (Put: 买近卖远)
                for (let i = optionsData.length - 1; i >= 0; i--) {
                    const shortLeg = optionsData[i];
                    if (Math.abs(shortLeg.putDelta) >= 0.20 || shortLeg.putBid <= 0) continue;

                    for (let j = optionsData.length - 1; j > i; j--) {
                        const longLeg = optionsData[j];
                        if (longLeg.putAsk <= 0) continue;

                        const totalCredit = 3 * shortLeg.putBid;
                        const netCredit = totalCredit - longLeg.putAsk;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.putAsk / totalCredit;
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validPutCombos.push({
                                    short: shortLeg,
                                    long: longLeg,
                                    netCredit: netCredit,
                                    ratio: spendRatio
                                });
                            }
                        }
                    }
                }

                // 净权利金从大到小排序，优先展示利润最大的组合
                validCallCombos.sort((a, b) => b.netCredit - a.netCredit);
                validPutCombos.sort((a, b) => b.netCredit - a.netCredit);

                const bestCallCombo = validCallCombos.length > 0 ? validCallCombos[0] : null;
                const bestPutCombo = validPutCombos.length > 0 ? validPutCombos[0] : null;

                // 3. 渲染结果
                resultBox.style.display = 'block';
                let html = '';

                // 保存当前选中的行权价用于高亮
                window.__rcsHighlight = {
                    callLong: bestCallCombo ? bestCallCombo.long.strike : null,
                    callShort: bestCallCombo ? bestCallCombo.short.strike : null,
                    putLong: bestPutCombo ? bestPutCombo.long.strike : null,
                    putShort: bestPutCombo ? bestPutCombo.short.strike : null
                };

                function updateRcsHighlightBoxes() {
                    const highlight = window.__rcsHighlight;
                    if (!highlight) return;

                    const canvas = document.querySelector('canvas');
                    if (!canvas) return;

                    const strikeHeader = Array.from(document.querySelectorAll('*'))
                        .find(el => el.children.length === 0 && el.innerText?.trim() === '行权价');
                    if (!strikeHeader) return;

                    const fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
                    if (!fiberKey || !canvas[fiberKey]) return;

                    let cur = canvas[fiberKey];
                    let rows = null;
                    while (cur) {
                        if (cur.memoizedProps && cur.memoizedProps.rows) {
                            rows = cur.memoizedProps.rows;
                            break;
                        }
                        cur = cur.return;
                    }
                    if (!rows || rows.length === 0) return;

                    const canvasRect = canvas.getBoundingClientRect();
                    const strikeRect = strikeHeader.getBoundingClientRect();
                    const rowHeight = canvasRect.height / rows.length;

                    function findRowIndex(targetStrike) {
                        if (targetStrike === null || targetStrike === undefined) return -1;
                        let bestIdx = -1, minDiff = Infinity;
                        rows.forEach((item, idx) => {
                            const rowData = item.row || item;
                            const strike = parseFloat(rowData.strike);
                            if (isNaN(strike)) return;
                            const diff = Math.abs(strike - targetStrike);
                            if (diff < minDiff && diff < 0.001) {
                                minDiff = diff;
                                bestIdx = idx;
                            }
                        });
                        return bestIdx;
                    }

                    function renderBox(id, rowIndex, color, isDashed) {
                        let box = document.getElementById(id);
                        if (rowIndex === -1) {
                            if (box) box.remove();
                            return;
                        }
                        if (!box) {
                            box = document.createElement('div');
                            box.id = id;
                            box.className = 'rcs-highlight-box';
                            document.body.appendChild(box);
                        }
                        const top = canvasRect.top + window.scrollY + rowIndex * rowHeight;
                        const left = strikeRect.left + window.scrollX;
                        const borderStyle = isDashed ? 'dashed' : 'solid';
                        box.style.cssText = `
                            position: absolute;
                            left: ${left}px;
                            top: ${top}px;
                            width: ${strikeRect.width}px;
                            height: ${rowHeight}px;
                            border: 2px ${borderStyle} ${color};
                            border-radius: 4px;
                            pointer-events: none;
                            box-sizing: border-box;
                            z-index: 999;
                            background: ${color}22;
                            box-shadow: 0 0 8px ${color}88;
                            transition: top 0.15s ease, left 0.15s ease;
                        `;
                    }

                    // Call 组合用红色：虚线表示买入腿，实线表示卖出3手腿
                    renderBox('rcs-box-call-long', findRowIndex(highlight.callLong), '#ef4444', true);
                    renderBox('rcs-box-call-short', findRowIndex(highlight.callShort), '#ef4444', false);

                    // Put 组合用绿色：虚线表示买入腿，实线表示卖出3手腿
                    renderBox('rcs-box-put-long', findRowIndex(highlight.putLong), '#10b981', true);
                    renderBox('rcs-box-put-short', findRowIndex(highlight.putShort), '#10b981', false);
                }

                updateRcsHighlightBoxes();

                if (!window.__rcsInterval) {
                    window.__rcsInterval = setInterval(updateRcsHighlightBoxes, 200);
                    window.addEventListener('resize', updateRcsHighlightBoxes);
                    window.addEventListener('scroll', updateRcsHighlightBoxes, true);
                }

                if (bestCallCombo) {
                    const c = bestCallCombo;
                    const breakEven = c.short.strike + (c.netCredit + c.short.strike - c.long.strike) / 2;
                    html += `
                        <div style="margin-bottom:12px; padding:10px; border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.08); border-radius: 4px;">
                            <div style="color:#ef4444; font-weight:bold; margin-bottom:4px; font-size:13px;">🐻 看涨比例价差 (做空上方)</div>
                            <div>买入 1手 @ <span style="font-family:monospace; font-weight:bold;">${c.long.strike}</span> (花费 ${c.long.callAsk.toFixed(4)})</div>
                            <div>卖出 3手 @ <span style="font-family:monospace; font-weight:bold;">${c.short.strike}</span> (Delta: ${c.short.callDelta.toFixed(3)}, 收入 ${(3 * c.short.callBid).toFixed(4)})</div>
                            <div><strong>净权利金:</strong> <span style="color:#34d399; font-weight:bold;">+${c.netCredit.toFixed(4)}</span> <span style="color:#9ca3af; font-size:10px;">(保护支出占比 ${(c.ratio*100).toFixed(0)}%)</span></div>
                            <div><strong>保护位/最大利润点:</strong> ${c.short.strike}</div>
                            <div style="color:#f87171; font-weight:bold; margin-top:4px;">💀 真实止损线 (Breakeven): ${breakEven.toFixed(4)}</div>
                        </div>
                    `;
                }

                if (bestPutCombo) {
                    const p = bestPutCombo;
                    const breakEven = p.short.strike - (p.netCredit + p.long.strike - p.short.strike) / 2;
                    html += `
                        <div style="margin-bottom:8px; padding:10px; border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.08); border-radius: 4px;">
                            <div style="color:#10b981; font-weight:bold; margin-bottom:4px; font-size:13px;">🐂 看跌比例价差 (做多下方)</div>
                            <div>买入 1手 @ <span style="font-family:monospace; font-weight:bold;">${p.long.strike}</span> (花费 ${p.long.putAsk.toFixed(4)})</div>
                            <div>卖出 3手 @ <span style="font-family:monospace; font-weight:bold;">${p.short.strike}</span> (Delta: ${p.short.putDelta.toFixed(3)}, 收入 ${(3 * p.short.putBid).toFixed(4)})</div>
                            <div><strong>净权利金:</strong> <span style="color:#34d399; font-weight:bold;">+${p.netCredit.toFixed(4)}</span> <span style="color:#9ca3af; font-size:10px;">(保护支出占比 ${(p.ratio*100).toFixed(0)}%)</span></div>
                            <div><strong>保护位/最大利润点:</strong> ${p.short.strike}</div>
                            <div style="color:#34d399; font-weight:bold; margin-top:4px;">💀 真实止损线 (Breakeven): ${breakEven.toFixed(4)}</div>
                        </div>
                    `;
                }

                if (!bestCallCombo && !bestPutCombo) {
                    html = `<div style="color: #fbbf24; padding: 6px;">当前合约中没有符合 Delta < 0.2 且花费占比 40%~60% 的严格策略组合。</div>`;
                }

                resultBox.innerHTML = html;

            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `
                    <div style="color: #ef4444; font-weight: bold; margin-bottom: 4px;">❌ 解析错误:</div>
                    <div style="color: #fca5a5; font-size: 11px;">${err.message}</div>
                `;
            }
        });

        contentBox.appendChild(button);
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
