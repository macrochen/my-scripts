// ==UserScript==
// @name         Finviz Options Column Hider (Pro)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  动态隐藏Finviz期权T型报价表中的Gamma, Theta, Vega, Rho列（适配异步加载与复杂表头）
// @match        *://finviz.com/stock*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-options-column-hider.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/finviz-options-column-hider.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const targetColumns = ['Gamma', 'Theta', 'Vega', 'Rho'];

    function hideColumns() {
        const tables = document.querySelectorAll('table');

        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            let headerRow = null;
            let hideIndices = [];

            // 遍历寻找真实表头行
            for (let i = 0; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td, th');
                let foundTarget = false;

                cells.forEach((cell, index) => {
                    if (targetColumns.includes(cell.textContent.trim())) {
                        hideIndices.push(index);
                        foundTarget = true;
                    }
                });

                if (foundTarget) {
                    headerRow = rows[i];
                    break; // 锁定表头后立即跳出
                }
            }

            // 执行隐藏逻辑
            if (hideIndices.length > 0 && headerRow) {
                const baselineLength = headerRow.querySelectorAll('td, th').length;

                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    // 强制校验列数一致性，规避干扰行
                    if (cells.length === baselineLength) {
                        hideIndices.forEach(index => {
                            if (cells[index] && cells[index].style.display !== 'none') {
                                cells[index].style.display = 'none';
                            }
                        });
                    }
                });
            }
        });
    }

    // 首次执行
    hideColumns();

    // 启用MutationObserver监听DOM变化，无缝处理AJAX异步加载
    const observer = new MutationObserver((mutations) => {
        let shouldRun = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldRun = true;
                break;
            }
        }
        if (shouldRun) {
            hideColumns();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
