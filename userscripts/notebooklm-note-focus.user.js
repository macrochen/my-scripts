// ==UserScript==
// @name         NotebookLM Note Focus (Large Font) - Trusted Types Fix
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  点击笔记时，自动在大浮窗中以大字体展示内容。修复 TrustedHTML 报错问题。
// @author       AI Assistant
// @match        https://notebook.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-note-focus.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-note-focus.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const CONFIG = {
        triggerSelector: '.artifact-item-button', // 笔记卡片的选择器
        contentContainerSelector: '.artifact-content', // 笔记详情的最外层容器
        contentInnerSelector: 'report-viewer', // 实际内容的标签
    };

    let isNoteClickPending = false;
    let modal, modalContent, closeButton, backdrop;

    // --- 样式定义 ---
    GM_addStyle(`
        /* 遮罩层 */
        #noteFocusBackdrop {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background-color: rgba(0, 0, 0, 0.65); z-index: 20000;
            display: none; opacity: 0; transition: opacity 0.3s ease;
            backdrop-filter: blur(3px);
        }
        #noteFocusBackdrop.active { display: block; opacity: 1; }

        /* 浮窗容器 */
        #noteFocusModal {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95);
            width: 75%; max-width: 1000px; height: 85vh;
            background-color: #ffffff; border-radius: 16px;
            box-shadow: 0 12px 24px rgba(0,0,0,0.3);
            z-index: 20001; display: none; flex-direction: column;
            opacity: 0; transition: all 0.3s ease;
            overflow: hidden;
        }
        #noteFocusModal.active { display: flex; opacity: 1; transform: translate(-50%, -50%) scale(1); }

        /* 浮窗内容区域 */
        #noteFocusContent {
            flex: 1; overflow-y: auto; padding: 40px 60px;
            color: #37352f;
            font-family: 'Google Sans', Roboto, sans-serif;
            line-height: 1.8;
        }

        /* --- 样式优化 --- */
        #noteFocusContent .paragraph {
            margin-bottom: 1.5em !important;
            font-size: 18px !important;
        }
        #noteFocusContent .heading1 {
            font-size: 28px !important;
            font-weight: 700 !important;
            margin-top: 1em !important;
            margin-bottom: 0.8em !important;
            color: #202124 !important;
        }
        #noteFocusContent b, #noteFocusContent strong {
            font-weight: 700 !important;
            color: #000 !important;
        }
        #noteFocusContent span {
            font-size: inherit !important;
        }
        #noteFocusContent .citation {
            font-size: 0.8em !important;
            color: #5f6368 !important;
        }

        /* 关闭按钮 */
        #noteFocusCloseBtn {
            position: absolute; top: 15px; right: 20px;
            background: transparent; border: none; font-size: 28px;
            color: #5f6368; cursor: pointer; width: 40px; height: 40px;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            transition: background 0.2s;
            z-index: 10;
        }
        #noteFocusCloseBtn:hover { background-color: #f1f3f4; color: #000; }

        /* 隐藏侧边栏原始位置的内容 */
        body.note-focus-active .artifact-content {
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
        }
    `);

    // --- 核心修复：纯 DOM 构建 UI (避开 innerHTML) ---
    function initUI() {
        if (document.getElementById('noteFocusModal')) return;

        // 1. 创建遮罩
        backdrop = document.createElement('div');
        backdrop.id = 'noteFocusBackdrop';
        document.body.appendChild(backdrop);

        // 2. 创建主浮窗容器
        modal = document.createElement('div');
        modal.id = 'noteFocusModal';

        // 3. 创建关闭按钮
        closeButton = document.createElement('button');
        closeButton.id = 'noteFocusCloseBtn';
        closeButton.textContent = '×';
        closeButton.title = '关闭 (Esc)';

        // 4. 创建内容容器
        modalContent = document.createElement('div');
        modalContent.id = 'noteFocusContent';

        // 5. 组装 DOM
        modal.appendChild(closeButton);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // 事件绑定
        closeButton.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
        });
    }

    function openModal(sourceElement) {
        if (!sourceElement) return;

        console.log('NotebookLM Note Focus: Cloning content...');

        // 1. 清空旧内容 (使用 replaceChildren 代替 innerHTML = '')
        modalContent.replaceChildren();

        // 2. 深度克隆内容
        const contentClone = sourceElement.cloneNode(true);

        // 3. 注入到浮窗
        modalContent.appendChild(contentClone);

        // 4. 显示浮窗
        backdrop.style.display = 'block';
        modal.style.display = 'flex';
        // 强制回流
        void modal.offsetWidth;
        backdrop.classList.add('active');
        modal.classList.add('active');

        // 5. 隐藏原侧边栏
        document.body.classList.add('note-focus-active');
    }

    function closeModal() {
        backdrop.classList.remove('active');
        modal.classList.remove('active');
        document.body.classList.remove('note-focus-active');

        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                backdrop.style.display = 'none';
                modal.style.display = 'none';
                modalContent.replaceChildren(); // 清理内存
            }
        }, 300);
        isNoteClickPending = false;
    }

    // --- 监听器 ---
    function setupObservers() {
        document.addEventListener('click', (e) => {
            const card = e.target.closest(CONFIG.triggerSelector);
            if (card) {
                console.log('NotebookLM Note Focus: Note card clicked.');
                isNoteClickPending = true;
                setTimeout(() => { isNoteClickPending = false; }, 3000);
            }
        }, true);

        const observer = new MutationObserver((mutations) => {
            if (!isNoteClickPending) return;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    const addedNode = mutation.addedNodes[0];
                    if (addedNode.nodeType === 1) {
                        const viewer = addedNode.matches && addedNode.matches(CONFIG.contentInnerSelector) ? addedNode :
                                       (addedNode.querySelector ? addedNode.querySelector(CONFIG.contentInnerSelector) : null);

                        if (viewer) {
                             const container = viewer.closest(CONFIG.contentContainerSelector);
                             if (container) {
                                 console.log('NotebookLM Note Focus: Content captured.');
                                 setTimeout(() => openModal(viewer), 50);
                                 isNoteClickPending = false;
                                 return;
                             }
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        initUI();
        setupObservers();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
