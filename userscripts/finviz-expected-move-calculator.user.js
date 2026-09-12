// ==UserScript==
// @name         预期波动计算器 (默认折叠版)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  修复千分位解析问题，并将计算器面板设置为默认折叠状态
// @match        *://finviz.com/stock.ashx*
// @match        *://finviz.com/stock*
// @match        *://*.finviz.com/stock*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-expected-move-calculator.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-expected-move-calculator.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function calculateExpectedMove(price, callIv, putIv, expiryDateStr, market = 'us', forwardPrice = null) {
        if (isNaN(price) || price <= 0) throw new Error("标的价格必须为正数");
        if (isNaN(callIv) || callIv <= 0) throw new Error("看涨 IV 必须为大于0的正数");
        if (isNaN(putIv) || putIv <= 0) throw new Error("看跌 IV 必须为大于0的正数");
        if (!expiryDateStr) throw new Error("请输入到期日");

        const nowUtc = new Date();
        const todayMarket = new Date();
        todayMarket.setHours(0, 0, 0, 0);
        if (market === 'us' && nowUtc.getUTCHours() < 5) {
            todayMarket.setDate(todayMarket.getDate() - 1);
        }

        const cleanDate = expiryDateStr.toString().replace(/\D/g, '');
        const year = parseInt(cleanDate.substring(0, 4));
        const month = parseInt(cleanDate.substring(4, 6));
        const day = parseInt(cleanDate.substring(6, 8));

        const expiryDate = new Date(year, month - 1, day);
        expiryDate.setHours(0, 0, 0, 0);

        const daysToExpiry = Math.ceil((expiryDate.getTime() - todayMarket.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry <= 0) throw new Error(`到期日必须晚于今天`);

        const timeFactor = Math.sqrt(daysToExpiry / 365.0);
        const centerPrice = (forwardPrice !== null && !isNaN(forwardPrice) && forwardPrice > 0) ? forwardPrice : price;

        const moveUpMoney = centerPrice * (callIv / 100) * timeFactor;
        const moveDownMoney = centerPrice * (putIv / 100) * timeFactor;

        return {
            centerPrice: centerPrice,
            expectedHigh: centerPrice + moveUpMoney,
            expectedLow: centerPrice - moveDownMoney,
            moveUpMoney,
            moveDownMoney,
            daysToExpiry
        };
    }

    function createFloatingUI() {
        if (document.getElementById('em-calc-container')) return;

        const container = document.createElement('div');
        container.id = 'em-calc-container';
        container.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 9999;
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
        // 默认设置为折叠图标
        header.innerHTML = `<span>预期波动计算器</span><span id="em-calc-toggle" style="cursor:pointer; padding: 0 4px;" title="展开/折叠">□</span>`;

        let isDragging = false;
        let currentX = 0, currentY = 0, initialX = 0, initialY = 0, xOffset = 0, yOffset = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'em-calc-toggle') return;
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
        contentBox.id = 'em-calc-content';
        // 默认折叠隐藏面板
        contentBox.style.cssText = 'padding: 16px; display: none;';

        header.querySelector('#em-calc-toggle').addEventListener('click', (e) => {
            if (contentBox.style.display === 'none') {
                contentBox.style.display = 'block';
                e.target.innerText = '—';
            } else {
                contentBox.style.display = 'none';
                e.target.innerText = '□';
            }
        });

        const button = document.createElement('button');
        button.innerText = '计算预期波动';
        button.style.cssText = `
            width: 100%; padding: 8px 12px; background: #2563eb; color: white;
            border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 10px;
        `;

        const resultBox = document.createElement('div');
        resultBox.id = 'em-calc-result';
        resultBox.style.cssText = 'font-size: 13px; line-height: 1.6; display: none;';

        button.addEventListener('click', () => {
            try {
                const rows = document.querySelectorAll('tr');
                let strikeIdx = -1, callIvIdx = -1, callDeltaIdx = -1, putIvIdx = -1;
                let dataRows = [];

                for (let i = 0; i < rows.length; i++) {
                    const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.textContent.trim());
                    const sIdx = cells.findIndex(c => c.includes('Strike'));

                    if (sIdx !== -1) {
                        strikeIdx = sIdx;
                        callIvIdx = cells.indexOf('IV');
                        callDeltaIdx = cells.indexOf('Delta');
                        putIvIdx = cells.indexOf('IV', strikeIdx);

                        if (strikeIdx !== -1 && callIvIdx !== -1 && callDeltaIdx !== -1 && putIvIdx !== -1) {
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

                if (strikeIdx === -1 || callIvIdx === -1 || callDeltaIdx === -1 || putIvIdx === -1) {
                    throw new Error("当前处于 'Prices' 视图无法获取完整数据，请在期权链上方点击切换到 'Volatility & Greeks' 选项卡！");
                }

                const priceMatch = document.body.innerText.match(/Last Close\s*(\d+\.\d+)/);
                if (!priceMatch) throw new Error("无法获取当前正股价格，请检查页面内容");
                const price = parseFloat(priceMatch[1].replace(/,/g, ''));

                const expiryButton = document.querySelector('button[aria-label="Expiry select"]');
                if (!expiryButton) throw new Error("无法定位到期日组件，请检查页面DOM结构");

                const expirySpan = expiryButton.querySelector('span');
                if (!expirySpan) throw new Error("定位到组件，但无法提取日期文本");

                const rawExpiry = expirySpan.innerText.trim();
                const [month, day, year] = rawExpiry.split('/');
                if (!month || !day || !year) throw new Error(`日期格式解析失败: ${rawExpiry}`);
                const expiryDateStr = `${year}${month}${day}`;

                let atmStrike = 0, callIv = 0, putIv = 0, atmCallDelta = 0, minDeltaDiff = Infinity;

                dataRows.forEach(tds => {
                    const strikeText = tds[strikeIdx].textContent.replace(/,/g, '').trim();
                    const strikeVal = parseFloat(strikeText);
                    const currentCallDelta = parseFloat(tds[callDeltaIdx].textContent.trim());

                    if (!isNaN(strikeVal) && !isNaN(currentCallDelta)) {
                        const deltaDiff = Math.abs(currentCallDelta - 0.5);
                        if (deltaDiff < minDeltaDiff) {
                            minDeltaDiff = deltaDiff;
                            atmStrike = strikeVal;
                            atmCallDelta = currentCallDelta;
                            callIv = parseFloat(tds[callIvIdx].textContent.replace('%', '').trim());
                            putIv = parseFloat(tds[putIvIdx].textContent.replace('%', '').trim());
                        }
                    }
                });

                if (minDeltaDiff === Infinity) throw new Error("DOM 遍历未找到有效期权行，请确认表格已完全渲染");

                if (atmCallDelta < 0.2 || atmCallDelta > 0.8) {
                    throw new Error(`抓取到的 Delta (${atmCallDelta}) 偏离正常极值，存在解析错位。请确认页面结构是否发生改变。`);
                }
                if (isNaN(callIv) || isNaN(putIv) || callIv <= 0 || putIv <= 0) {
                    throw new Error(`行权价 ${atmStrike} 对应的 IV 数据提取异常 (C: ${callIv}%, P: ${putIv}%)，禁止计算。`);
                }

                const res = calculateExpectedMove(price, callIv, putIv, expiryDateStr, 'us', atmStrike);

                let strikes = [];
                dataRows.forEach(tds => {
                    const strikeText = tds[strikeIdx].textContent.replace(/,/g, '').trim();
                    const s = parseFloat(strikeText);
                    if (!isNaN(s)) strikes.push(s);
                });
                strikes.sort((a,b) => a - b);

                let targetHighStrike = strikes[strikes.length - 1];
                for (let s of strikes) {
                    if (s >= res.expectedHigh) {
                        targetHighStrike = s;
                        break;
                    }
                }

                let targetLowStrike = strikes[0];
                for (let i = strikes.length - 1; i >= 0; i--) {
                    if (strikes[i] <= res.expectedLow) {
                        targetLowStrike = strikes[i];
                        break;
                    }
                }

                dataRows.forEach(tds => {
                    const strikeTd = tds[strikeIdx];
                    const strikeText = strikeTd.textContent.replace(/,/g, '').trim();
                    const strikeVal = parseFloat(strikeText);
                    if (!isNaN(strikeVal)) {
                        strikeTd.style.outline = '';
                        strikeTd.style.backgroundColor = '';

                        if (Math.abs(strikeVal - targetHighStrike) < 0.0001) {
                            strikeTd.style.outline = '2px solid #10b981';
                            strikeTd.style.outlineOffset = '-2px';
                        } else if (Math.abs(strikeVal - targetLowStrike) < 0.0001) {
                            strikeTd.style.outline = '2px solid #ef4444';
                            strikeTd.style.outlineOffset = '-2px';
                        }
                    }
                });

                resultBox.style.display = 'block';
                resultBox.innerHTML = `
                    <div style="margin-bottom: 8px; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                        <div><strong>标的现价:</strong> ${price.toFixed(2)}</div>
                        <div style="color: #a78bfa;"><strong>目标期限:</strong> ${rawExpiry} (剩余 ${res.daysToExpiry} 天)</div>
                        <div style="color: #60a5fa;"><strong>远期中心点 (ATM):</strong> ${atmStrike.toFixed(2)} (Delta: ${atmCallDelta.toFixed(4)})</div>
                        <div><strong>ATM IV:</strong> C: ${callIv.toFixed(2)}% | P: ${putIv.toFixed(2)}%</div>
                    </div>
                    <div style="color: #ef4444;"><strong>预期下界:</strong> ${res.expectedLow.toFixed(2)} (-${res.moveDownMoney.toFixed(2)})</div>
                    <div style="color: #10b981;"><strong>预期上界:</strong> ${res.expectedHigh.toFixed(2)} (+${res.moveUpMoney.toFixed(2)})</div>
                `;
            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `<span style="color: #ef4444; font-weight: bold;">❌ 错误阻断:</span> <br/><span style="color: #fca5a5;">${err.message}</span>`;
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
