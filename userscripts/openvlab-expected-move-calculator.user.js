// ==UserScript==
// @name         预期波动计算器 (OpenVlab 全品种自适应版)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动解析 OpenVlab T型报价表，基于视觉几何坐标提取现价与期限并计算预期波动
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

    // 视觉几何探测器：无视DOM层级，通过屏幕物理坐标寻找 T型报价表数据行
    function getValidOptionRowsData() {
        const rowsData = [];
        const divs = document.querySelectorAll('div');

        // 第一阶段：纯读DOM，找出所有像数据行的容器和它内部的纯数字节点
        divs.forEach(el => {
            const text = el.innerText.trim();
            // 匹配可能是行权价的纯数字节点（排除内部有更深层div的节点）
            if (/^\d+(\.\d{1,4})?$/.test(text) && el.querySelectorAll('div').length === 0) {
                let parent = el.parentElement;
                while (parent && parent.tagName.toLowerCase() === 'div') {
                    // 行的视觉特征：横向宽（>400），纵向窄（<100），且包含足够多的价格小数
                    if (parent.offsetWidth > 400 && parent.offsetHeight > 10 && parent.offsetHeight < 100) {
                        const nums = parent.innerText.match(/\d+\.\d{2,4}/g);
                        if (nums && nums.length >= 4) {
                            rowsData.push({
                                row: parent,
                                strikeEl: el,
                                strike: parseFloat(text)
                            });
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        });

        // 统一行容器
        const uniqueRowsMap = new Map();
        rowsData.forEach(item => {
            if (!uniqueRowsMap.has(item.row)) uniqueRowsMap.set(item.row, []);
            uniqueRowsMap.get(item.row).push(item);
        });

        const finalRows = [];
        // 第二阶段：利用几何坐标找出真正的行权价节点 (距离容器中心最接近的数字必定是 Strike)
        uniqueRowsMap.forEach((items, rowEl) => {
            const rowRect = rowEl.getBoundingClientRect();
            const rowCenter = rowRect.left + rowRect.width / 2;

            let bestItem = null;
            let minDistance = Infinity;

            items.forEach(item => {
                const cellRect = item.strikeEl.getBoundingClientRect();
                const cellCenter = cellRect.left + cellRect.width / 2;
                const dist = Math.abs(cellCenter - rowCenter);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestItem = item;
                }
            });

            if (bestItem) finalRows.push(bestItem);
        });

        return finalRows;
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
        header.innerHTML = `<span>预期波动计算器 (几何定位版)</span><span id="em-calc-toggle" style="cursor:pointer; padding: 0 4px;" title="展开/折叠">□</span>`;

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

                const buyMatch = pageText.match(/买价\s*([\d,\.]+)/);
                const sellMatch = pageText.match(/卖价\s*([\d,\.]+)/);
                if (buyMatch && sellMatch) {
                    const bid = parseFloat(buyMatch[1].replace(/,/g, ''));
                    const ask = parseFloat(sellMatch[1].replace(/,/g, ''));
                    price = (bid + ask) / 2;
                }

                if (!price || isNaN(price)) price = parseFloat(prompt("未自动侦测到标的价格，请手动输入现价：", "1.768"));
                if (!price || isNaN(price)) throw new Error("缺少标的价格，计算中止。");

                const urlMatch = window.location.href.match(/(\d{4})(?=\?|$)/);
                if (urlMatch) {
                    const contractCode = urlMatch[1];
                    const dayRegex = new RegExp(`${contractCode}[^\\d]*(\\d+)\\s*天`);
                    const dayMatch = pageText.match(dayRegex);
                    if (dayMatch) {
                        daysToExpiry = parseInt(dayMatch[1]);
                    }
                }

                if (!daysToExpiry || isNaN(daysToExpiry)) daysToExpiry = parseInt(prompt("未自动侦测到剩余期限，请手动输入剩余天数：", "26"));
                if (!daysToExpiry || isNaN(daysToExpiry)) throw new Error("缺少剩余天数，计算中止。");

                // 3. 利用视觉几何定位获取数据行
                const rows = getValidOptionRowsData();
                if (rows.length === 0) throw new Error("嗅探失败：未能在屏幕上识别出符合 T型表视觉特征的坐标行，请确认页面已完全加载。");

                let atmStrike = 0, minStrikeDiff = Infinity, atmRowData = null;

                rows.forEach(item => {
                    const strikeDiff = Math.abs(item.strike - price);
                    if (strikeDiff < minStrikeDiff) {
                        minStrikeDiff = strikeDiff;
                        atmStrike = item.strike;
                        atmRowData = item;
                    }
                });

                if (!atmRowData) throw new Error("表格数据提取失败，无法找到有效的行权价数据。");

                let callIv = NaN, putIv = NaN;

                // 提取平值行内所有带文字的叶子节点
                const allLeaves = Array.from(atmRowData.row.querySelectorAll('*')).filter(el => {
                    return el.children.length === 0 && el.innerText.trim() !== '';
                });

                // 以 Strike 节点为界，将行节点切割为左右两半
                const trueStrikeLeaf = allLeaves.find(el => atmRowData.strikeEl.contains(el));
                const strikeIdx = allLeaves.indexOf(trueStrikeLeaf);

                if (strikeIdx !== -1) {
                    const callLeaves = allLeaves.slice(0, strikeIdx);
                    const putLeaves = allLeaves.slice(strikeIdx + 1);

                    function extractIv(leaves) {
                        // 1. 优先找 italic 样式
                        let ivEl = leaves.find(el => el.classList.contains('italic'));
                        if (ivEl) return parseFloat(ivEl.innerText.replace('%', '').replace(/,/g, ''));
                        
                        // 2. 次选找紫颜色样式 (OpenVlab 隐波默认色)
                        ivEl = leaves.find(el => el.className.includes('vlab-iv') || el.className.includes('purple'));
                        if (ivEl) return parseFloat(ivEl.innerText.replace('%', '').replace(/,/g, ''));
                        
                        // 3. 降级安全处理：提取符合隐波特征范围 (2~300) 的无百分号数值
                        const candidates = leaves.map(el => el.innerText.trim())
                            .filter(t => !t.includes('%'))
                            .map(t => parseFloat(t.replace(/,/g, '')))
                            .filter(n => !isNaN(n) && n > 2 && n < 300);
                        return candidates.length > 0 ? candidates[0] : NaN;
                    }

                    callIv = extractIv(callLeaves);
                    putIv = extractIv(putLeaves);
                }

                if (isNaN(callIv) || isNaN(putIv) || callIv === 0) {
                    throw new Error(`找到了平值行权价(${atmStrike})，但提取隐波失败！请确保右上角「列配置」中已开启「隐波」列。`);
                }

                const res = calculateExpectedMove(price, callIv, putIv, daysToExpiry);

                // --- 寻找预期边界以做高亮 ---
                let detectedInterval = 0;
                let visibleStrikes = rows.map(r => r.strike).sort((a,b) => a - b);
                for(let i=1; i<visibleStrikes.length; i++) {
                    let diff = visibleStrikes[i] - visibleStrikes[i-1];
                    if (diff > 0.001) {
                        detectedInterval = detectedInterval === 0 ? diff : Math.min(detectedInterval, diff);
                    }
                }

                function getConservativeStrike(targetPrice, isHigh) {
                    let interval = detectedInterval || (price * 0.01);
                    if (price < 100) { 
                        if (targetPrice <= 3.0) interval = 0.05;
                        else if (targetPrice <= 5.0) interval = 0.10;
                        else if (targetPrice <= 10.0) interval = 0.25;
                        else if (targetPrice <= 20.0) interval = 0.50;
                        else if (targetPrice <= 50.0) interval = 1.00;
                        else interval = 2.50;
                    } else { 
                        if (detectedInterval === 0) interval = 50;
                    }
                    return parseFloat((isHigh ? Math.ceil(targetPrice / interval) * interval : Math.floor(targetPrice / interval) * interval).toFixed(4));
                }

                window.__emCalcHighlight = {
                    high: getConservativeStrike(res.expectedHigh, true),
                    low: getConservativeStrike(res.expectedLow, false)
                };

                // 高亮轮询器同步更新几何坐标
                if (!window.__emCalcInterval) {
                    window.__emCalcInterval = setInterval(() => {
                        if (!window.__emCalcHighlight) return;
                        const { high, low } = window.__emCalcHighlight;
                        
                        const currentRows = getValidOptionRowsData();
                        currentRows.forEach(item => {
                            const rowStrike = item.strike;
                            const strikeDiv = item.strikeEl;
                            
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
