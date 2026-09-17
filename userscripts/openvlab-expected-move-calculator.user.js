// ==UserScript==
// @name         预期波动计算器 (OpenVlab 全品种自适应版)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动解析 OpenVlab T型报价表 Canvas/React 实时数据，提取现价、期限、平值期权与隐波并计算预期波动
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

    /**
     * 从 OpenVlab 的 React Fiber 树或页面中提取底层实时数据快照
     */
    function extractVlabData() {
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

        // 向上搜寻承载行情数据源的 React 组件 Props
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

        // 1. 提取标的现价
        let price = 0;
        if (snapshot.underlyingQuote) {
            const uq = snapshot.underlyingQuote;
            price = uq.value || uq.last || ((uq.bid && uq.ask) ? (uq.bid + uq.ask) / 2 : 0);
        }
        // 降级兜底：从页面文本寻找现价
        if (!price || isNaN(price)) {
            const buyMatch = document.body.innerText.match(/买价\s*([\d,\.]+)/);
            const sellMatch = document.body.innerText.match(/卖价\s*([\d,\.]+)/);
            if (buyMatch && sellMatch) {
                price = (parseFloat(buyMatch[1].replace(/,/g, '')) + parseFloat(sellMatch[1].replace(/,/g, ''))) / 2;
            }
        }
        if (!price || isNaN(price)) {
            const inputPrice = prompt("未能自动侦测到标的最新价，请手动输入现价（如 1.700）：");
            price = parseFloat(inputPrice);
        }
        if (!price || isNaN(price)) {
            throw new Error("缺少有效的标的价格，计算中止。");
        }

        // 2. 提取当前激活合约的剩余到期天数
        let daysToExpiry = 0;
        // 方案 A: 寻找当前选中的到期日按钮 (带 data-variant="default" 或 bg-primary 类名)
        const activeTabBtn = Array.from(document.querySelectorAll('button')).find(btn => {
            const isSelected = btn.getAttribute('data-variant') === 'default' || 
                               btn.className.includes('bg-primary') ||
                               btn.getAttribute('aria-selected') === 'true';
            return isSelected && /\d+\s*天/.test(btn.innerText || btn.title || '');
        });

        if (activeTabBtn) {
            const match = (activeTabBtn.title || activeTabBtn.innerText).match(/(\d+)\s*天/);
            if (match) daysToExpiry = parseInt(match[1]);
        }

        // 方案 B: 根据 activeExpiration 匹配页面中的对应天数
        if (!daysToExpiry && tableProps.activeExpiration) {
            const expStr = String(tableProps.activeExpiration).slice(-4); // 如 202610 -> 2610
            const dayRegex = new RegExp(`${expStr}[^\\d]*(\\d+)\\s*天`);
            const dayMatch = document.body.innerText.match(dayRegex);
            if (dayMatch) daysToExpiry = parseInt(dayMatch[1]);
        }

        // 方案 C: 任意剩余天数匹配或弹窗
        if (!daysToExpiry) {
            const generalMatch = document.body.innerText.match(/剩余时间:\s*(\d+)\s*天/) || document.body.innerText.match(/(\d+)\s*天/);
            if (generalMatch) daysToExpiry = parseInt(generalMatch[1]);
        }

        if (!daysToExpiry || isNaN(daysToExpiry)) {
            const inputDays = prompt("未能自动侦测到剩余天数，请手动输入剩余天数（如 42）：", "42");
            daysToExpiry = parseInt(inputDays);
        }
        if (!daysToExpiry || isNaN(daysToExpiry)) {
            throw new Error("缺少剩余天数，计算中止。");
        }

        // 3. 提取所有期权行，并确定平值 (ATM) 行权价及隐波
        const rawRows = snapshot.staticRows || tableProps.rows || [];
        if (!rawRows || rawRows.length === 0) {
            throw new Error("行情数据表中未发现行权价数据 (rows 为空)。");
        }

        let minStrikeDiff = Infinity;
        let atmRow = null;
        const allStrikes = [];

        for (const item of rawRows) {
            const rowData = item.row || item;
            const strike = parseFloat(rowData.strike);
            if (isNaN(strike)) continue;
            allStrikes.push(strike);

            const diff = Math.abs(strike - price);
            if (diff < minStrikeDiff) {
                minStrikeDiff = diff;
                atmRow = rowData;
            }
        }

        if (!atmRow) {
            throw new Error("未能匹配到平值行权价行。");
        }

        const atmStrike = parseFloat(atmRow.strike);
        const quotes = snapshot.quotesByCode || {};
        const callQuote = quotes[atmRow.callCode] || {};
        const putQuote = quotes[atmRow.putCode] || {};

        let callIv = parseFloat(callQuote.iv);
        let putIv = parseFloat(putQuote.iv);

        // 如果字段里是小数（例如 0.4282 代表 42.82%），自动转为百分比
        if (!isNaN(callIv) && callIv < 2.0 && callIv > 0) callIv = callIv * 100;
        if (!isNaN(putIv) && putIv < 2.0 && putIv > 0) putIv = putIv * 100;

        if (isNaN(callIv) || isNaN(putIv) || callIv <= 0 || putIv <= 0) {
            throw new Error(`已找到平值行权价(${atmStrike})，但读取到的看涨/看跌隐波异常(Call: ${callQuote.iv}, Put: ${putQuote.iv})。请确保页面已加载完成并开启隐波显示。`);
        }

        allStrikes.sort((a, b) => a - b);

        return {
            price,
            daysToExpiry,
            atmStrike,
            callIv,
            putIv,
            allStrikes
        };
    }

    function createFloatingUI() {
        if (document.getElementById('em-calc-container-vlab')) return;

        const container = document.createElement('div');
        container.id = 'em-calc-container-vlab';
        container.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4); border-radius: 10px;
            background: #18191c; color: #d1d5db; border: 1px solid #374151;
            width: 300px; overflow: hidden; font-size: 13px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 9px 14px; background: #26282e; color: #9ca3af;
            font-size: 12px; font-weight: bold; cursor: move;
            display: flex; justify-content: space-between; align-items: center;
            user-select: none; border-bottom: 1px solid #374151;
        `;
        header.innerHTML = `<span>⚡ 预期波动计算器 (v4.0)</span><span id="em-calc-toggle" style="cursor:pointer; padding: 0 4px; font-size: 14px;" title="展开/折叠">□</span>`;

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
        contentBox.style.cssText = 'padding: 14px; display: none;';

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
        button.innerText = '一键计算当前合约预期波动';
        button.style.cssText = `
            width: 100%; padding: 9px; background: #f59e0b; color: white;
            border: none; border-radius: 6px; cursor: pointer; font-weight: bold;
            margin-bottom: 10px; transition: background 0.2s; font-size: 13px;
        `;
        button.onmouseover = () => button.style.background = '#d97706';
        button.onmouseout = () => button.style.background = '#f59e0b';

        const resultBox = document.createElement('div');
        resultBox.style.cssText = 'font-size: 13px; line-height: 1.7; display: none;';

        button.addEventListener('click', () => {
            try {
                const data = extractVlabData();
                const res = calculateExpectedMove(data.price, data.callIv, data.putIv, data.daysToExpiry);

                // 计算行权价格间距与保守行权价
                let detectedInterval = 0;
                for (let i = 1; i < data.allStrikes.length; i++) {
                    const diff = data.allStrikes[i] - data.allStrikes[i - 1];
                    if (diff > 0.0001) {
                        detectedInterval = detectedInterval === 0 ? diff : Math.min(detectedInterval, diff);
                    }
                }

                function getConservativeStrike(targetPrice, isHigh) {
                    let interval = detectedInterval || (data.price * 0.01);
                    if (data.price < 100) {
                        if (targetPrice <= 3.0) interval = 0.05;
                        else if (targetPrice <= 5.0) interval = 0.10;
                        else if (targetPrice <= 10.0) interval = 0.25;
                        else if (targetPrice <= 20.0) interval = 0.50;
                        else if (targetPrice <= 50.0) interval = 1.00;
                        else interval = 2.50;
                    } else {
                        if (detectedInterval === 0) interval = 50;
                    }
                    const result = isHigh ? Math.ceil(targetPrice / interval) * interval : Math.floor(targetPrice / interval) * interval;
                    return parseFloat(result.toFixed(4));
                }

                const targetHighStrike = getConservativeStrike(res.expectedHigh, true);
                const targetLowStrike = getConservativeStrike(res.expectedLow, false);

                const priceDecimals = data.price > 500 ? 1 : (data.price > 10 ? 2 : 3);

                resultBox.style.display = 'block';
                resultBox.innerHTML = `
                    <div style="margin-bottom: 8px; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                        <div><strong>标的现价:</strong> <span style="color: #f3f4f6; font-family: monospace;">${data.price.toFixed(priceDecimals)}</span></div>
                        <div><strong>剩余天数:</strong> <span style="color: #a78bfa; font-weight: bold;">${res.daysToExpiry} 天</span></div>
                        <div><strong>平值锚定 (ATM):</strong> <span style="color: #60a5fa; font-family: monospace; font-weight: bold;">${data.atmStrike.toFixed(priceDecimals)}</span></div>
                        <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">
                            平值 IV: 认购(C) <span style="color:#f59e0b;">${data.callIv.toFixed(2)}%</span> ｜ 认沽(P) <span style="color:#f59e0b;">${data.putIv.toFixed(2)}%</span>
                        </div>
                    </div>
                    <div style="color: #10b981; margin-bottom: 4px;">
                        <strong>预期上界:</strong> ${res.expectedHigh.toFixed(priceDecimals)}
                        <span style="font-size: 11px;">(+${res.moveUpMoney.toFixed(priceDecimals)})</span>
                        <div style="font-size: 11px; color: #6ee7b7;">➔ 保守参考行权价: <strong>${targetHighStrike}</strong></div>
                    </div>
                    <div style="color: #ef4444;">
                        <strong>预期下界:</strong> ${res.expectedLow.toFixed(priceDecimals)}
                        <span style="font-size: 11px;">(-${res.moveDownMoney.toFixed(priceDecimals)})</span>
                        <div style="font-size: 11px; color: #fca5a5;">➔ 保守参考行权价: <strong>${targetLowStrike}</strong></div>
                    </div>
                `;
            } catch (err) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = `
                    <div style="color: #ef4444; font-weight: bold; margin-bottom: 4px;">❌ 提取或计算中断:</div>
                    <div style="color: #fca5a5; font-size: 12px; line-height: 1.5;">${err.message}</div>
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
