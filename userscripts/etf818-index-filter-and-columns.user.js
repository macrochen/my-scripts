// ==UserScript==
// @name         指数浏览器-重点宽基筛选与列重排(单按钮开关)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  单按钮开关：一键切换“仅看重点宽基”与“完整表格”，并将估值与分位数移至最新价左侧
// @match        https://etf818.com/red-rocket/*
// @match        https://newtab.etf818.com/red-rocket/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/etf818-index-filter-and-columns.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/etf818-index-filter-and-columns.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 目标关注的宽基指数名单
    const TARGET_INDICES = [
        '沪深300',
        '中证A500',
        '中证500',
        '中证1000',
        '科创50',
        '创业板指',
        '上证50',
        '中证A50'
    ];

    let isFilterActive = false;
    let isProcessing = false;

    // 创建单按钮 Toggle 悬浮面板
    function createControlPanel() {
        if (document.getElementById('tm-panel')) return;

        const container = document.createElement('div');
        container.id = 'tm-panel';
        container.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            z-index: 999999;
            background: #ffffff;
            padding: 4px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border: 1px solid #e8e8e8;
        `;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'tm-toggle-btn';

        // 初始状态样式与文字（关：显示全部；开：仅看重点宽基）
        updateBtnStyle(toggleBtn, false);

        toggleBtn.onclick = () => {
            isFilterActive = !isFilterActive;
            updateBtnStyle(toggleBtn, isFilterActive);
            processTable();
        };

        container.appendChild(toggleBtn);
        document.body.appendChild(container);
    }

    // 动态更新按钮状态样式
    function updateBtnStyle(btn, active) {
        if (active) {
            btn.innerText = '🎯 重点宽基：开启';
            btn.style.cssText = `
                padding: 6px 14px;
                background: #1890ff;
                color: #fff;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                font-weight: bold;
                transition: all 0.2s ease;
            `;
        } else {
            btn.innerText = '🌐 重点宽基：关闭';
            btn.style.cssText = `
                padding: 6px 14px;
                background: #f0f0f0;
                color: #595959;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s ease;
            `;
        }
    }

    // 核心处理逻辑（行筛选与列重排）
    function processTable() {
        if (isProcessing) return;

        const table = document.querySelector('table');
        if (!table) return;

        isProcessing = true;

        try {
            // 1. 调整列位置（估值水平、PE/PB分位移到最新价左侧）
            rearrangeColumns(table);

            // 2. 根据开关状态过滤行
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                if (isFilterActive) {
                    const text = row.textContent || '';
                    const isMatch = TARGET_INDICES.some(name => text.includes(name));
                    row.style.display = isMatch ? '' : 'none';
                } else {
                    row.style.display = ''; // 关闭时恢复全部显示
                }
            });
        } finally {
            isProcessing = false;
        }
    }

    // 列重排逻辑
    function rearrangeColumns(table) {
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        if (!headerRow) return;

        const headerCells = Array.from(headerRow.children);
        const headerTexts = headerCells.map(c => c.textContent.trim());

        const valIdx = headerTexts.findIndex(t => t.includes('估值水平'));
        const priceIdx = headerTexts.findIndex(t => t.includes('最新价'));
        const peIdx = headerTexts.findIndex(t => t.includes('PE分位'));
        const pbIdx = headerTexts.findIndex(t => t.includes('PB分位'));

        if (valIdx === -1 || priceIdx === -1) return;
        if (valIdx === priceIdx - 1 && peIdx === valIdx + 1 && pbIdx === peIdx + 1) return;

        const allRows = table.querySelectorAll('tr');
        allRows.forEach(row => {
            const cells = Array.from(row.children);
            if (cells.length <= Math.max(valIdx, priceIdx, peIdx, pbIdx)) return;

            const valCell = cells[valIdx];
            const peCell = peIdx !== -1 ? cells[peIdx] : null;
            const pbCell = pbIdx !== -1 ? cells[pbIdx] : null;
            const priceCell = cells[priceIdx];

            if (valCell && priceCell) row.insertBefore(valCell, priceCell);
            if (peCell && priceCell) row.insertBefore(peCell, priceCell);
            if (pbCell && priceCell) row.insertBefore(pbCell, priceCell);
        });
    }

    // 循环监听挂载控制按钮及首次调整
    setInterval(() => {
        const table = document.querySelector('table');
        if (table) {
            createControlPanel();
            rearrangeColumns(table);
        }
    }, 1000);

})();
