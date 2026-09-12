// ==UserScript==
// @name         预期波动计算器 (OpenVlab 全品种自适应版)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  自动解析 OpenVlab T型报价表虚拟列表(Virtual List)，提取现价与期限并计算预期波动
// @match        *://*.openvlab.cn/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-expected-move-calculator.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/openvlab-expected-move-calculator.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function calculateExpectedMove(price, callIv, putIv, daysToExpiry) {
        if (isNaN(price) || price <= 0) throw new Error("标的价格必须为正数");
        if (isNaN(callIv) || callIv <= 0) throw new Error("看涨 IV 必须为正数");
        if (isNaN(putIv) || putIv <= 0) throw new Error("看跌 IV 必须为正数");
        if (isNaN(daysToExpiry) || daysToExpiry <= 0) throw new Error("剩余天数必须大于0");

        const timeFactor = Math.sqrt(daysToExpiry / 365.0);
        const moveUpMoney = price * (callIv / 100) * timeFactor;
        const moveDownMoney = price * (putIv / 100) * timeFactor;

        return {
            centerPrice: price,
            expectedHigh: price + moveUpMoney,
            expectedLow: price - moveDownMoney,
            moveUpMoney,
            moveDownMoney,
            daysToExpiry
        };
    }

    function createFloatingUI() {
        if (document.getElementById('em-calc-container-vlab')) return;

        const container = document.createElement('div');
        container.id = 'em-calc-container-vlab';
        container.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 99999;
            font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border-radius: 8px; background: #1e2024; color: #d1d5db;
            border: 1px solid #374151; width: 280px; overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 8px 12px; background: #374151; color: #9ca3af;
            font-size: 12px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none;
        `;
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

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        const contentBox = document.createElement('div');
        contentBox.id = 'em-calc-content';
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
        button.innerText = '计算当前页面预期波动';
        button.style.cssText = `
            width: 100%; padding: 10px; background: #f59e0b; color: white;
            border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
            margin-bottom: 10px; transition: background 0.2s;
        `;
        button.onmouseover = () => button.style.background = '#d97706';
        button.onmouseout = () => button.style.background = '#f59e0b';

        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'font-size: 13px; line-height: 1.6; display: none;';

        button.addEventListener('click', () => {
            try {
                const pageText = document.body.innerText;
                let price = 0;
                let daysToExpiry = 0;

                // 1. 自动提取标的现价 (精准锁定T型表下方的买卖盘中心价)
                const buyMatch = pageText.match(/买价\s*([\d,\.]+)/);
                const sellMatch = pageText.match(/卖价\s*([\d,\.]+)/);
                if (buyMatch && sellMatch) {
                    const bid = parseFloat(buyMatch[1].replace(/,/g, ''));
                    const ask = parseFloat(sellMatch[1].replace(/,/g, ''));
                    price = (bid + ask) / 2;
                }

                if (!price || isNaN(price)) {
                    price = parseFloat(prompt("未自动侦测到标的价格，请手动输入现价：", "1.768"));
                }
                if (!price || isNaN(price)) throw new Error("缺少标的价格，计算中止。");

                // 2. 自动提取当前激活的剩余天数 (利用 URL 中的合约代号去匹配文本)
                const urlMatch = window.location.href.match(/(\d{4})(?=\?|$)/);
                if (urlMatch) {
                    const contractCode = urlMatch[1];
                    // 构造正则寻找类似于 "2609 49天" 或 "2608 主 26天" 的文本
                    const dayRegex = new RegExp(`${contractCode}[^\\d]*(\\d+)\\s*天`);
                    const dayMatch = pageText.match(dayRegex);
                    if (dayMatch) {
                        daysToExpiry = parseInt(dayMatch[1]);
                    }
                }

                if (!daysToExpiry || isNaN(daysToExpiry)) {
                    daysToExpiry = parseInt(prompt("未自动侦测到剩余期限，请手动输入剩余天数：", "26"));
                }
                if (!daysToExpiry || isNaN(daysToExpiry)) throw new Error("缺少剩余天数，计算中止。");

                // 3. 动态嗅探虚拟列表 (Virtual List) 的数据行
                const rows = Array.from(document.querySelectorAll('div[data-react-window-index]'));
                if (rows.length === 0) throw new Error("未能定位到行情数据行 (data-react-window-index)，请确认页面已完全加载，且处于 T型报价 视图。");

                let atmStrike = 0, minStrikeDiff = Infinity;
                let callIv = NaN, putIv = NaN;

                rows.forEach(row => {
                    // 确保是包含期权数据的行 (分为看涨、行权价、看跌 三部分)
                    if (row.children.length < 3) return;

                    const callGrid = row.children[0].querySelector('.grid');
                    const strikeDiv = row.children[1];
                    const putGrid = row.children[2].querySelector('.grid');

                    if (!callGrid || !putGrid || !strikeDiv) return;

                    // 提取行权价
                    const rowStrike = parseFloat(strikeDiv.innerText.trim());
                    if (isNaN(rowStrike)) return;

                    const strikeDiff = Math.abs(rowStrike - price);

                    // 寻找最接近现价的平值期权
                    if (strikeDiff < minStrikeDiff) {
                        minStrikeDiff = strikeDiff;
                        atmStrike = rowStrike;

                        // 提取隐波 (OpenVlab的隐波列带有 .italic 类名，且有 text-[var(--vlab-iv)] 属性)
                        const callIvEl = callGrid.querySelector('.italic');
                        const putIvEl = putGrid.querySelector('.italic');

                        if (callIvEl) callIv = parseFloat(callIvEl.innerText.replace('%', '').trim());
                        if (putIvEl) putIv = parseFloat(putIvEl.innerText.replace('%', '').trim());
                    }
                });

                if (minStrikeDiff === Infinity) {
                    throw new Error("表格数据提取失败，无法找到有效的行权价数据。");
                }
                if (isNaN(callIv) || isNaN(putIv) || callIv === 0) {
                    throw new Error(`找到了平值行权价(${atmStrike})，但未找到隐波数据！请确保右上角「列配置」中已开启「隐波」列。`);
                }

                const res = calculateExpectedMove(price, callIv, putIv, daysToExpiry);

                // --- 寻找最接近预期的实际行权价并高亮 (保守模式) ---
                let detectedInterval = 0;
                let visibleStrikes = [];
                rows.forEach(row => {
                    if (row.children.length >= 3) {
                        const s = parseFloat(row.children[1].innerText.trim());
                        if (!isNaN(s)) visibleStrikes.push(s);
                    }
                });
                visibleStrikes.sort((a,b) => a - b);
                for(let i=1; i<visibleStrikes.length; i++) {
                    let diff = visibleStrikes[i] - visibleStrikes[i-1];
                    if (diff > 0.001) {
                        detectedInterval = detectedInterval === 0 ? diff : Math.min(detectedInterval, diff);
                    }
                }

                function getConservativeStrike(targetPrice, isHigh) {
                    let interval = detectedInterval || (price * 0.01);

                    if (price < 100) { // A股 ETF 期权规则
                        if (targetPrice <= 3.0) interval = 0.05;
                        else if (targetPrice <= 5.0) interval = 0.10;
                        else if (targetPrice <= 10.0) interval = 0.25;
                        else if (targetPrice <= 20.0) interval = 0.50;
                        else if (targetPrice <= 50.0) interval = 1.00;
                        else interval = 2.50;
                    } else { // 股指期权
                        if (detectedInterval === 0) interval = 50;
                    }

                    let result;
                    if (isHigh) {
                        result = Math.ceil(targetPrice / interval) * interval;
                    } else {
                        result = Math.floor(targetPrice / interval) * interval;
                    }
                    return parseFloat(result.toFixed(4));
                }

                const targetHighStrike = getConservativeStrike(res.expectedHigh, true);
                const targetLowStrike = getConservativeStrike(res.expectedLow, false);

                window.__emCalcHighlight = {
                    high: targetHighStrike,
                    low: targetLowStrike
                };

                if (!window.__emCalcInterval) {
                    window.__emCalcInterval = setInterval(() => {
                        if (!window.__emCalcHighlight) return;
                        const vRows = document.querySelectorAll('div[data-react-window-index]');
                        vRows.forEach(row => {
                            if (row.children.length >= 3) {
                                const strikeDiv = row.children[1];
                                if (!strikeDiv) return;
                                const rowStrike = parseFloat(strikeDiv.innerText.trim());
                                if (isNaN(rowStrike)) return;

                                const { high, low } = window.__emCalcHighlight;
                                if (Math.abs(rowStrike - high) < 0.0001) {
                                    strikeDiv.style.outline = '2px solid #10b981';
                                    strikeDiv.style.outlineOffset = '-2px';
                                } else if (Math.abs(rowStrike - low) < 0.0001) {
                                    strikeDiv.style.outline = '2px solid #ef4444';
                                    strikeDiv.style.outlineOffset = '-2px';
                                } else {
                                    if (strikeDiv.style.outline) {
                                        strikeDiv.style.outline = '';
                                        strikeDiv.style.outlineOffset = '';
                                    }
                                }
                            }
                        });
                    }, 150);
                }

                const priceDecimals = price > 1000 ? 1 : 3;

                resultBox.style.display = 'block';
                resultBox.innerHTML = `
                    <div style="margin-bottom: 8px; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                        <div><strong>标的现价:</strong> ${price.toFixed(priceDecimals)}</div>
                        <div style="color: #a78bfa;"><strong>剩余天数:</strong> ${res.daysToExpiry} 天</div>
                        <div style="color: #60a5fa;"><strong>平值锚定 (ATM):</strong> ${atmStrike.toFixed(priceDecimals)}</div>
                        <div><strong>平值隐波:</strong> 认购(C) ${callIv.toFixed(2)}% ｜ 认沽(P) ${putIv.toFixed(2)}%</div>
                    </div>
                    <div style="color: #ef4444;"><strong>预期下界:</strong> ${res.expectedLow.toFixed(priceDecimals)} (-${res.moveDownMoney.toFixed(priceDecimals)})</div>
                    <div style="color: #10b981;"><strong>预期上界:</strong> ${res.expectedHigh.toFixed(priceDecimals)} (+${res.moveUpMoney.toFixed(priceDecimals)})</div>
                `;
            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `<span style="color: #ef4444; font-weight: bold;">❌ 解析阻断:</span> <br/><span style="color: #fca5a5;">${err.message}</span>`;
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
