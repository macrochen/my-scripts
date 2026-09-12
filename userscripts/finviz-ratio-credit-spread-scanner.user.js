// ==UserScript==
// @name         Finviz 比例信用价差扫描器 (行权价精准高亮版)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  精准定位行权价单元格进行红绿框高亮，默认折叠停靠在右下角（位于 IV Skew 卡片上方）
// @match        *://*.finviz.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-ratio-credit-spread-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-ratio-credit-spread-scanner.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function createFloatingUI() {
        if (document.getElementById('rcs-calc-container')) return;

        const container = document.createElement('div');
        container.id = 'rcs-calc-container';
        // 改为 bottom: 114px; right: 30px; 堆叠在底层计算器(30px)与中层IV Skew(72px)正上方
        container.style.cssText = `
            position: fixed; bottom: 114px; right: 30px; z-index: 99999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            border-radius: 8px; background: #181a1b; color: #d1d5db;
            border: 1px solid #374151; width: 340px;
            max-height: 70vh; display: flex; flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px; background: #991b1b; color: #fecaca;
            font-size: 13px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; border-bottom: 1px solid #7f1d1d; flex-shrink: 0;
            touch-action: none;
        `;
        // 默认折叠状态图标 □
        header.innerHTML = `<span>Finviz 比例价差猎手 (精准高亮)</span><span id="rcs-calc-toggle" style="cursor:pointer; padding: 0 4px; font-size: 16px;">□</span>`;

        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;

        const dragStart = (e) => {
            if (e.target.id === 'rcs-calc-toggle' || e.target.tagName === 'INPUT') return;
            if (e.type === "touchstart") {
                initialX = e.touches[0].clientX - xOffset;
                initialY = e.touches[0].clientY - yOffset;
            } else {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
            }
            isDragging = true;
        };

        const drag = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX;
                currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
            }
            xOffset = currentX;
            yOffset = currentY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        };

        const dragEnd = () => {
            isDragging = false;
        };

        header.addEventListener('mousedown', dragStart);
        header.addEventListener('touchstart', dragStart, { passive: false });

        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });

        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);

        const contentBox = document.createElement('div');
        contentBox.id = 'rcs-calc-content';
        // 保持默认隐藏折叠
        contentBox.style.cssText = 'padding: 16px; display: none; overflow-y: auto; flex-grow: 1;';

        header.querySelector('#rcs-calc-toggle').addEventListener('click', (e) => {
            const isHidden = contentBox.style.display === 'none';
            contentBox.style.display = isHidden ? 'block' : 'none';
            e.target.innerText = isHidden ? '—' : '□';
        });

        const button = document.createElement('button');
        button.innerText = '按 Last 扫描并在表格中标出';
        button.style.cssText = `
            width: 100%; padding: 10px; background: #dc2626; color: white;
            border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
            margin-bottom: 10px; transition: background 0.2s; flex-shrink: 0;
        `;
        button.onmouseover = () => button.style.background = '#b91c1c';
        button.onmouseout = () => button.style.background = '#dc2626';

        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'font-size: 12px; line-height: 1.6; display: none; margin-top: 10px;';

        resultBox.addEventListener('input', (e) => {
            if (e.target.tagName !== 'INPUT') return;
            const box = e.target.closest('.combo-box');
            if (!box) return;

            const kind = box.dataset.kind;
            const longStrike = parseFloat(box.dataset.longStrike);
            const shortStrike = parseFloat(box.dataset.shortStrike);

            const longPrice = parseFloat(box.querySelector('.long-price').value) || 0;
            const shortPrice = parseFloat(box.querySelector('.short-price').value) || 0;

            const totalCredit = 3 * shortPrice;
            const netCredit = totalCredit - longPrice;
            const ratio = totalCredit === 0 ? 0 : longPrice / totalCredit;

            let breakEven = 0;
            if (kind === 'call') {
                breakEven = shortStrike + (netCredit + shortStrike - longStrike) / 2;
            } else {
                breakEven = shortStrike - (netCredit + longStrike - shortStrike) / 2;
            }

            const resDiv = box.querySelector('.calc-result');
            resDiv.innerHTML = `
                <div><strong>净权利金:</strong> ${netCredit > 0 ? '+' : ''}${netCredit.toFixed(2)} <span style="color:#9ca3af; font-size:10px;">(保护占比 ${(ratio*100).toFixed(0)}%)</span></div>
                <div style="color:${kind === 'call' ? '#f87171' : '#34d399'}; font-weight:bold; margin-top:4px;">💀 真实止损线: ${breakEven.toFixed(2)}</div>
            `;
        });

        const inputStyle = `width: 75px; margin-left:6px; background:#374151; color:white; border:1px solid #4b5563; border-radius:3px; padding:4px; text-align:center; font-size:14px; box-sizing: border-box;`;

        button.addEventListener('click', () => {
            try {
                // 1. 清除历史高亮单元格
                document.querySelectorAll('.rcs-highlight-cell').forEach(td => {
                    td.classList.remove('rcs-highlight-cell');
                    td.style.backgroundColor = td.dataset.origBg || '';
                    td.style.border = '';
                });

                const rows = document.querySelectorAll('tr');
                let optionsData = [];

                rows.forEach(row => {
                    const tds = Array.from(row.querySelectorAll('td'));
                    if (tds.length < 5) return;

                    let strikeIdx = -1;
                    let strikeLink = null;
                    for (let i = 0; i < tds.length; i++) {
                        const a = tds[i].querySelector('a');
                        if (a && !isNaN(parseFloat(a.innerText))) {
                            strikeIdx = i;
                            strikeLink = a;
                            break;
                        }
                    }

                    if (strikeIdx === -1) return;

                    const leftVals = tds.slice(0, strikeIdx).map(td => td.innerText.trim()).filter(t => t !== '');
                    const rightVals = tds.slice(strikeIdx + 1).map(td => td.innerText.trim()).filter(t => t !== '');

                    if (leftVals.length < 3 || rightVals.length < 3) return;

                    const parseNum = (text) => {
                        const t = text.trim();
                        if (!t || t === '-') return NaN;
                        const num = parseFloat(t.replace(/[%$,]/g, ''));
                        return isNaN(num) ? NaN : num;
                    };

                    const strike = parseNum(strikeLink.innerText);
                    if (isNaN(strike)) return;

                    // 将行权价对应的具体 <td> 节点存入数据结构
                    optionsData.push({
                        strike: strike,
                        callLast: parseNum(leftVals[0]),
                        callDelta: parseNum(leftVals[2]),
                        putLast: parseNum(rightVals[0]),
                        putDelta: parseNum(rightVals[2]),
                        strikeTd: tds[strikeIdx]
                    });
                });

                if (optionsData.length === 0) throw new Error("解析失败：请确保停留在 Volatility & Greeks 视图。");
                optionsData.sort((a, b) => a.strike - b.strike);

                let validCallCombos = [];
                let validPutCombos = [];

                for (let i = 0; i < optionsData.length; i++) {
                    const shortLeg = optionsData[i];
                    if (isNaN(shortLeg.callDelta) || isNaN(shortLeg.callLast) || Math.abs(shortLeg.callDelta) >= 0.20) continue;

                    for (let j = 0; j < i; j++) {
                        const longLeg = optionsData[j];
                        if (isNaN(longLeg.callLast) || isNaN(longLeg.callDelta) || Math.abs(longLeg.callDelta) >= 0.20) continue;

                        const totalCredit = 3 * shortLeg.callLast;
                        const netCredit = totalCredit - longLeg.callLast;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.callLast / totalCredit;
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validCallCombos.push({ short: shortLeg, long: longLeg, netCredit: netCredit, ratio: spendRatio });
                            }
                        }
                    }
                }

                for (let i = optionsData.length - 1; i >= 0; i--) {
                    const shortLeg = optionsData[i];
                    if (isNaN(shortLeg.putDelta) || isNaN(shortLeg.putLast) || Math.abs(shortLeg.putDelta) >= 0.20) continue;

                    for (let j = optionsData.length - 1; j > i; j--) {
                        const longLeg = optionsData[j];
                        if (isNaN(longLeg.putLast) || isNaN(longLeg.putDelta) || Math.abs(longLeg.putDelta) >= 0.20) continue;

                        const totalCredit = 3 * shortLeg.putLast;
                        const netCredit = totalCredit - longLeg.putLast;

                        if (netCredit > 0) {
                            const spendRatio = longLeg.putLast / totalCredit;
                            if (spendRatio >= 0.4 && spendRatio <= 0.6) {
                                validPutCombos.push({ short: shortLeg, long: longLeg, netCredit: netCredit, ratio: spendRatio });
                            }
                        }
                    }
                }

                validCallCombos.sort((a, b) => b.netCredit - a.netCredit);
                validPutCombos.sort((a, b) => b.netCredit - a.netCredit);

                const bestCallCombo = validCallCombos.length > 0 ? validCallCombos[0] : null;
                const bestPutCombo = validPutCombos.length > 0 ? validPutCombos[0] : null;

                // 2. 表格高亮执行函数：仅作用于行权价单元格
                const applyHighlightToCell = (leg, type) => {
                    if (!leg || !leg.strikeTd) return;
                    const color = type === 'call' ? '#ef4444' : '#10b981';
                    const bg = type === 'call' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
                    const td = leg.strikeTd;

                    td.classList.add('rcs-highlight-cell');
                    if (!td.dataset.origBg) td.dataset.origBg = td.style.backgroundColor || '';

                    td.style.backgroundColor = bg;
                    td.style.border = `2px solid ${color}`;
                };

                // 执行单元格高亮渲染
                if (bestCallCombo) {
                    applyHighlightToCell(bestCallCombo.long, 'call');
                    applyHighlightToCell(bestCallCombo.short, 'call');
                }
                if (bestPutCombo) {
                    applyHighlightToCell(bestPutCombo.long, 'put');
                    applyHighlightToCell(bestPutCombo.short, 'put');
                }

                // 3. 侧边栏卡片渲染
                resultBox.style.display = 'block';
                let html = '';

                if (bestPutCombo) {
                    const p = bestPutCombo;
                    const breakEven = p.short.strike - (p.netCredit + p.long.strike - p.short.strike) / 2;
                    html += `
                        <div class="combo-box" data-kind="put" data-long-strike="${p.long.strike}" data-short-strike="${p.short.strike}" style="margin-bottom:12px; padding:8px; border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.1);">
                            <div style="color:#10b981; font-weight:bold; margin-bottom:6px;">🐂 看跌比例价差 (双端 < 0.2)</div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                                <span>买入 1手 @ ${p.long.strike}</span>
                                <span>单价:<input type="number" step="0.01" class="long-price" value="${p.long.putLast.toFixed(2)}" style="${inputStyle}"></span>
                            </div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #4b5563; padding-bottom:6px;">
                                <span>卖出 3手 @ ${p.short.strike}</span>
                                <span>单价:<input type="number" step="0.01" class="short-price" value="${p.short.putLast.toFixed(2)}" style="${inputStyle}"></span>
                            </div>
                            <div class="calc-result">
                                <div><strong>净权利金:</strong> +${p.netCredit.toFixed(2)} <span style="color:#9ca3af; font-size:10px;">(保护占比 ${(p.ratio*100).toFixed(0)}%)</span></div>
                                <div style="color:#34d399; font-weight:bold; margin-top:4px;">💀 真实止损线: ${breakEven.toFixed(2)}</div>
                            </div>
                        </div>
                    `;
                }

                if (bestCallCombo) {
                    const c = bestCallCombo;
                    const breakEven = c.short.strike + (c.netCredit + c.short.strike - c.long.strike) / 2;
                    html += `
                        <div class="combo-box" data-kind="call" data-long-strike="${c.long.strike}" data-short-strike="${c.short.strike}" style="margin-bottom:8px; padding:8px; border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.1);">
                            <div style="color:#ef4444; font-weight:bold; margin-bottom:6px;">🐻 看涨比例价差 (双端 < 0.2)</div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                                <span>买入 1手 @ ${c.long.strike}</span>
                                <span>单价:<input type="number" step="0.01" class="long-price" value="${c.long.callLast.toFixed(2)}" style="${inputStyle}"></span>
                            </div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #4b5563; padding-bottom:6px;">
                                <span>卖出 3手 @ ${c.short.strike}</span>
                                <span>单价:<input type="number" step="0.01" class="short-price" value="${c.short.callLast.toFixed(2)}" style="${inputStyle}"></span>
                            </div>
                            <div class="calc-result">
                                <div><strong>净权利金:</strong> +${c.netCredit.toFixed(2)} <span style="color:#9ca3af; font-size:10px;">(保护占比 ${(c.ratio*100).toFixed(0)}%)</span></div>
                                <div style="color:#f87171; font-weight:bold; margin-top:4px;">💀 真实止损线: ${breakEven.toFixed(2)}</div>
                            </div>
                        </div>
                    `;
                }

                if (!bestCallCombo && !bestPutCombo) {
                    html = `<div style="color: #fbbf24;">当前无符合双端Delta<0.2且成本占比达标的组合。<br>原因：约束收紧后，系统只能在极深虚值中寻找，这些合约的成交价（Last）往往严重失真或缺失。</div>`;
                }

                resultBox.innerHTML = html;

            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `<span style="color: #ef4444; font-weight: bold;">❌ 解析错误:</span> <br/><span style="color: #fca5a5;">${err.message}</span>`;
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
