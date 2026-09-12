// ==UserScript==
// @name         NotebookLM 对话折叠优化 (NotebookLM Chat Collapser)
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  点击用户提问可折叠/展开 AI 回答。单按钮切换模式，保留所有样式修复。
// @author       Gemini Partner
// @match        https://notebook.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-chat-collapser.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-chat-collapser.user.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. CSS 样式定义 (保留 v1.8 的完美修复) ---
    const css = `
        /* === A. 用户提问气泡交互样式 === */
        .from-user-container {
            cursor: pointer !important;
            transition: all 0.2s ease;
            position: relative;
        }

        .from-user-container:hover .from-user-message-card-content {
            background-color: #f1f3f4 !important;
        }

        /* 气泡内箭头 */
        .from-user-container::before {
            content: '🔽';
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 12px;
            opacity: 0.5;
            z-index: 10;
        }

        .from-user-message-card-content {
            padding-left: 35px !important;
        }

        /* === B. 核心：纯文本替身样式 === */
        .nlm-plaintext-preview {
            display: none;
            font-family: 'Google Sans', Roboto, sans-serif;
            font-size: 14px !important;
            line-height: 20px !important;
            font-weight: 400 !important;
            color: #3c4043 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            flex: 1;
            min-width: 0;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* === C. 折叠状态 (.collapsed) === */
        .chat-message-pair.collapsed .from-user-container::before {
            content: '▶';
            transform: translateY(-50%) rotate(0deg);
        }

        .chat-message-pair.collapsed .from-user-message-card-content {
            background-color: #e8f0fe !important;
            border-left: 4px solid #1a73e8;
            padding-left: 31px !important;
            padding-right: 16px !important;
            min-height: 40px !important;
            display: flex !important;
            align-items: center !important;
            overflow: hidden !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
        }

        .chat-message-pair.collapsed .from-user-message-inner-content {
            display: none !important;
        }

        .chat-message-pair.collapsed .nlm-plaintext-preview {
            display: block !important;
        }

        .chat-message-pair.collapsed .to-user-container,
        .chat-message-pair.collapsed .suggestions-container,
        .chat-message-pair.collapsed .message-actions {
            display: none !important;
        }

        /* === D. 嵌入式按钮样式 === */
        .nlm-inject-btn {
            background: transparent;
            border: 1px solid #dadce0;
            color: #5f6368;
            border-radius: 4px;
            padding: 0 12px;
            margin-right: 8px;
            font-size: 13px;
            cursor: pointer;
            font-family: 'Google Sans', Roboto, Arial, sans-serif;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 40px;
            vertical-align: middle;
            transition: background 0.2s, color 0.2s;
            min-width: 90px; /* 给一个最小宽度，防止文字变化时按钮抖动 */
        }

        .nlm-inject-btn:hover {
            background-color: #f1f3f4;
            color: #202124;
            border-color: #202124;
        }

        .nlm-btn-icon {
            font-size: 14px;
            margin-right: 6px;
        }
    `;
    GM_addStyle(css);

    // --- 2. 核心逻辑：单条折叠处理 ---
    function initMessagePair(pairElement) {
        if (pairElement.dataset.collapseProcessed) return;
        pairElement.dataset.collapseProcessed = "true";

        const userContainer = pairElement.querySelector('.from-user-container');
        if (!userContainer) return;

        const card = userContainer.querySelector('.from-user-message-card-content');
        const originalContentDiv = userContainer.querySelector('.message-text-content');

        if (card && originalContentDiv) {
            let cleanText = originalContentDiv.innerText.replace(/[\r\n]+/g, ' ').trim();
            const previewDiv = document.createElement('div');
            previewDiv.className = 'nlm-plaintext-preview';
            previewDiv.textContent = cleanText;
            card.appendChild(previewDiv);
        }

        userContainer.addEventListener('click', function(e) {
            if (window.getSelection().toString().length > 0) return;
            pairElement.classList.toggle('collapsed');
        });
    }

    // --- 3. 核心逻辑：注入“合并版”按钮 ---
    function injectHeaderButtons() {
        const headerContainer = document.querySelector('.chat-header-buttons');

        // 检查按钮是否已存在 (ID 变更为 nlm-toggle-all)
        if (headerContainer && !document.getElementById('nlm-toggle-all')) {

            // 1. 创建按钮容器
            const btn = document.createElement('button');
            btn.id = 'nlm-toggle-all';
            btn.className = 'nlm-inject-btn';
            btn.type = 'button';
            btn.title = "切换折叠/展开状态";
            btn.dataset.mode = 'collapse'; // 初始模式：点击执行“折叠”

            // 2. 创建图标 span
            const iconSpan = document.createElement('span');
            iconSpan.className = 'nlm-btn-icon';
            iconSpan.textContent = '➖'; // 初始图标

            // 3. 创建文本 span
            const textSpan = document.createElement('span');
            textSpan.textContent = '全部折叠'; // 初始文本

            // 4. 组装
            btn.appendChild(iconSpan);
            btn.appendChild(textSpan);

            // 5. 绑定点击事件 (切换逻辑)
            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                const allPairs = document.querySelectorAll('.chat-message-pair');
                const isCollapsing = btn.dataset.mode === 'collapse';

                if (isCollapsing) {
                    // 执行：全部折叠
                    allPairs.forEach(el => el.classList.add('collapsed'));

                    // 状态翻转 -> 下次点击执行“展开”
                    btn.dataset.mode = 'expand';
                    iconSpan.textContent = '➕';
                    textSpan.textContent = '全部展开';
                } else {
                    // 执行：全部展开
                    allPairs.forEach(el => el.classList.remove('collapsed'));

                    // 状态翻转 -> 下次点击执行“折叠”
                    btn.dataset.mode = 'collapse';
                    iconSpan.textContent = '➖';
                    textSpan.textContent = '全部折叠';
                }
            });

            // 6. 插入
            headerContainer.insertBefore(btn, headerContainer.firstChild);
        }
    }

    // --- 4. 全局监控 ---
    const observer = new MutationObserver((mutations) => {
        injectHeaderButtons();
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    if (node.classList.contains('chat-message-pair')) {
                        initMessagePair(node);
                    } else {
                        const pairs = node.querySelectorAll && node.querySelectorAll('.chat-message-pair');
                        if (pairs) pairs.forEach(initMessagePair);
                    }
                    if (node.querySelector && node.querySelector('.chat-header-buttons')) {
                        injectHeaderButtons();
                    }
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        document.querySelectorAll('.chat-message-pair').forEach(initMessagePair);
        injectHeaderButtons();
    }, 1000);

})();
