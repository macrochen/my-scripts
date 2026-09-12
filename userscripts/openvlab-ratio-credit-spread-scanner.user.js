// ==UserScript==
// @name         比例信用价差扫描器 (1:3 利润优先修正版)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  基于 Delta < 0.2 且买入腿成本在 40%-60% 之间，优先选取净收入最高的组合
// @match        *://*.openvlab.cn/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-ratio-credit-spread-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-ratio-credit-spread-scanner.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function createFloatingUI() {
        if (document.getElementById('rcs-calc-container')) return;

        const container = document.createElement('div');
        container.id = 'rcs-calc-container';
        container.style.cssText = `
            position: fixed; bottom: 30px; left: 30px; z-index: 99999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            border-radius: 8px; background: #181a1b; color: #d1d5db;
            border: 1px solid #374151; width: 320px; overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px; background: #991b1b; color: #fecaca;
            font-size: 13px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; border-bottom: 1px solid #7f1d1d;
        `;
        header.innerHTML = `<span>比例价差猎手 (1:3 利润版)</span><span id="rcs-calc-toggle" style="cursor:pointer; padding: 0 4px;" title="展开/折叠">□</span>`;

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
        contentBox.style.cssText = 'padding: 16px; display: none;';

        header.querySelector('#rcs-calc-toggle').addEventListener('click', (e) => {
            if (contentBox.style.display === 'none') {
                contentBox.style.display = 'block';
                e.target.innerText = '—';
            } else {
                contentBox.style.display = 'none';
                e.target.innerText = '□';
            }
        });

        const warnText = document.createElement('div');
        warnText.style.cssText = 'font-size: 11px; color: #fbbf24; margin-bottom: 10px; line-height: 1.4;';
        warnText.innerText = "⚠️ 提示：请先上下滚动期权链，确保深虚值(Delta<0.2)合约已加载到页面中再计算。";

        const button = document.createElement('button');
        button.innerText = '扫描合规策略组合';
        button.style.cssText = `
            width: 100%; padding: 10px; background: #dc2626; color: white;
            border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
            margin-bottom: 10px; transition: background 0.2s;
        `;
        button.onmouseover = () => button.style.background = '#b91c1c';
        button.onmouseout = () => button.style.background = '#dc2626';

        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'font-size: 12px; line-height: 1.6; display: none; margin-top: 10px;';

        button.addEventListener('click', () => {
            try {
                const rows = Array.from(document.querySelectorAll('div[data-react-window-index]'));
                if (rows.length === 0) throw new Error("未能定位到行情数据，请处于 T型报价 视图。");

                let optionsData = [];

                rows.forEach(row => {
                    if (row.children.length < 3) return;

                    const callGrid = row.children[0].querySelector('.grid');
                    const strikeDiv = row.children[1];
                    const putGrid = row.children[2].querySelector('.grid');
                    if (!callGrid || !putGrid || !strikeDiv) return;

                    const strike = parseFloat(strikeDiv.innerText.trim());
                    if (isNaN(strike)) return;

                    const extractNums = (grid) => {
                        return Array.from(grid.children).map(c => {
                            const match = c.innerText.match(/[-]?\d+\.\d+/);
                            return match ? parseFloat(match[0]) : NaN;
                        }).filter(n => !isNaN(n));
                    };

                    const callNums = extractNums(callGrid);
                    const putNums = extractNums(putGrid);

                    if (callNums.length >= 3 && putNums.length >= 3) {
                        optionsData.push({
                            strike: strike,
                            callAsk: callNums[callNums.length - 3],
                            callBid: callNums[callNums.length - 2],
                            callDelta: callNums[callNums.length - 1],
                            putDelta: putNums[0],
                            putBid: putNums[1],
                            putAsk: putNums[2]
                        });
                    }
                });

                if (optionsData.length === 0) throw new Error("无法提取价格/Delta，请检查列配置。");
                optionsData.sort((a, b) => a.strike - b.strike);

                let validCallCombos = [];
                let validPutCombos = [];

                // 2. 核心推演：筛选看涨比例价差 (Call)
                for (let i = 0; i < optionsData.length; i++) {
                    const shortLeg = optionsData[i];
                    // 卖出腿铁律：Delta < 0.20
                    if (Math.abs(shortLeg.callDelta) >= 0.20) continue;

                    for (let j = 0; j < i; j++) {
                        const longLeg = optionsData[j];
                        const totalCredit = 3 * shortLeg.callBid;
                        const netCredit = totalCredit - longLeg.callAsk;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.callAsk / totalCredit;
                            // 容忍度：买入腿花费占总收入的 40% 到 60% 之间
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validCallCombos.push({ short: shortLeg, long: longLeg, netCredit: netCredit, ratio: spendRatio });
                            }
                        }
                    }
                }

                // 3. 核心推演：筛选看跌比例价差 (Put)
                for (let i = optionsData.length - 1; i >= 0; i--) {
                    const shortLeg = optionsData[i];
                    if (Math.abs(shortLeg.putDelta) >= 0.20) continue;

                    for (let j = optionsData.length - 1; j > i; j--) {
                        const longLeg = optionsData[j];
                        const totalCredit = 3 * shortLeg.putBid;
                        const netCredit = totalCredit - longLeg.putAsk;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.putAsk / totalCredit;
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validPutCombos.push({ short: shortLeg, long: longLeg, netCredit: netCredit, ratio: spendRatio });
                            }
                        }
                    }
                }

                // 按净权利金从大到小排序，优先展示利润最大的组合（自然逼近 Delta 0.2）
                validCallCombos.sort((a, b) => b.netCredit - a.netCredit);
                validPutCombos.sort((a, b) => b.netCredit - a.netCredit);

                const bestCallCombo = validCallCombos.length > 0 ? validCallCombos[0] : null;
                const bestPutCombo = validPutCombos.length > 0 ? validPutCombos[0] : null;

                // 4. 渲染结果
                resultBox.style.display = 'block';
                let html = '';

                if (bestCallCombo) {
                    const c = bestCallCombo;
                    const breakEven = c.short.strike + (c.netCredit + c.short.strike - c.long.strike) / 2;
                    html += `
                        <div style="margin-bottom:12px; padding:8px; border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.1);">
                            <div style="color:#ef4444; font-weight:bold; margin-bottom:4px;">🐻 看涨比例价差 (做空上方)</div>
                            <div>买入 1手 @ ${c.long.strike} (花费 ${c.long.callAsk.toFixed(4)})</div>
                            <div>卖出 3手 @ ${c.short.strike} (Delta: ${c.short.callDelta.toFixed(3)}, 收入 ${(3 * c.short.callBid).toFixed(4)})</div>
                            <div><strong>净权利金:</strong> +${c.netCredit.toFixed(4)} <span style="color:#9ca3af; font-size:10px;">(保护支出占比 ${(c.ratio*100).toFixed(0)}%)</span></div>
                            <div><strong>保护位/最大利润点:</strong> ${c.short.strike}</div>
                            <div style="color:#f87171; font-weight:bold; margin-top:4px;">💀 真实止损线 (Breakeven): ${breakEven.toFixed(4)}</div>
                        </div>
                    `;
                }

                if (bestPutCombo) {
                    const p = bestPutCombo;
                    const breakEven = p.short.strike - (p.netCredit + p.long.strike - p.short.strike) / 2;
                    html += `
                        <div style="margin-bottom:8px; padding:8px; border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.1);">
                            <div style="color:#10b981; font-weight:bold; margin-bottom:4px;">🐂 看跌比例价差 (做多下方)</div>
                            <div>买入 1手 @ ${p.long.strike} (花费 ${p.long.putAsk.toFixed(4)})</div>
                            <div>卖出 3手 @ ${p.short.strike} (Delta: ${p.short.putDelta.toFixed(3)}, 收入 ${(3 * p.short.putBid).toFixed(4)})</div>
                            <div><strong>净权利金:</strong> +${p.netCredit.toFixed(4)} <span style="color:#9ca3af; font-size:10px;">(保护支出占比 ${(p.ratio*100).toFixed(0)}%)</span></div>
                            <div><strong>保护位/最大利润点:</strong> ${p.short.strike}</div>
                            <div style="color:#34d399; font-weight:bold; margin-top:4px;">💀 真实止损线 (Breakeven): ${breakEven.toFixed(4)}</div>
                        </div>
                    `;
                }

                if (!bestCallCombo && !bestPutCombo) {
                    html = `<div style="color: #fbbf24;">当前可见视图中没有符合严格策略的组合。请尝试上下滚动页面加载更多远端期权后重试。</div>`;
                }

                resultBox.innerHTML = html;

            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `<span style="color: #ef4444; font-weight: bold;">❌ 解析错误:</span> <br/><span style="color: #fca5a5;">${err.message}</span>`;
            }
        });

        contentBox.appendChild(warnText);
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
