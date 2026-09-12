// ==UserScript==
// @name         AI chatbox 页面快捷粘贴按钮 (Kimi 适配版)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  在 Kimi 页面添加一个悬浮按钮，一键将剪贴板内容粘贴到当前输入框
// @author       You
// @match        *://www.google.com/search*
// @match        *://kimi.moonshot.cn/*
// @match        *://www.kimi.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/kimi-ai-chatbox-quick-paste.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/kimi-ai-chatbox-quick-paste.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const pasteBtn = document.createElement('button');
    pasteBtn.innerText = '📋 粘贴剪贴板';
    Object.assign(pasteBtn.style, {
        position: 'fixed',
        bottom: '30px',
        right: '30px',
        padding: '10px 15px',
        backgroundColor: '#1a73e8',
        color: 'white',
        border: 'none',
        borderRadius: '24px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        zIndex: '9999',
        fontSize: '14px',
        fontWeight: 'bold'
    });

    pasteBtn.onmouseover = () => pasteBtn.style.backgroundColor = '#1557b0';
    pasteBtn.onmouseout = () => pasteBtn.style.backgroundColor = '#1a73e8';

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) {
                alert('剪贴板为空！');
                return;
            }

            // 优先寻找当前获焦点的输入框
            let inputArea = document.activeElement;
            const isInput = inputArea && (inputArea.tagName === 'TEXTAREA' || inputArea.tagName === 'INPUT' || inputArea.isContentEditable);

            if (!isInput) {
                // 专门针对 Kimi 寻找富文本 div，找不到再降级找 Google 的 textarea
                inputArea = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea') || document.querySelector('input[type="text"]');
            }

            if (inputArea) {
                // 必须先获取焦点，否则 execCommand 可能会作用在 body 上
                inputArea.focus();

                if (inputArea.isContentEditable) {
                    // Kimi 核心修改：使用 execCommand 模拟真实的粘贴输入，从而触发 React 的状态更新
                    document.execCommand('insertText', false, text);
                } else {
                    // Google/普通 textarea 修改：绕过 React/Angular 的 value setter 拦截
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                    if (nativeInputValueSetter) {
                        nativeInputValueSetter.call(inputArea, inputArea.value + text);
                    } else {
                        inputArea.value = inputArea.value + text;
                    }
                    inputArea.dispatchEvent(new Event('input', { bubbles: true }));
                    inputArea.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                alert('未找到可用的输入框！');
            }
        } catch (err) {
            console.error('读取剪贴板失败:', err);
            alert('读取剪贴板失败，请确保浏览器允许该网页访问剪贴板。');
        }
    });

    document.body.appendChild(pasteBtn);
})();
