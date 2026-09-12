// ==UserScript==
// @name         Google 页面快捷追问按钮
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  在 Google 页面添加一个悬浮按钮，一键在输入框追加内容并自动回车发送
// @author       You
// @match        *://www.google.com/search*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/google-quick-followup-button.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/google-quick-followup-button.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const appendBtn = document.createElement('button');
    appendBtn.innerText = '💬 展开讲讲';
    Object.assign(appendBtn.style, {
        position: 'fixed',
        bottom: '80px',
        right: '30px',
        padding: '10px 15px',
        backgroundColor: '#34a853',
        color: 'white',
        border: 'none',
        borderRadius: '24px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        zIndex: '9999',
        fontSize: '14px',
        fontWeight: 'bold'
    });

    appendBtn.onmouseover = () => appendBtn.style.backgroundColor = '#2d8744';
    appendBtn.onmouseout = () => appendBtn.style.backgroundColor = '#34a853';

    // 鼠标按下时阻止默认事件，防止输入框失去焦点
    appendBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    appendBtn.addEventListener('click', () => {
        const textToAppend = '就这个问题，请详细的展开讲讲。';

        // 寻找页面中所有的 textarea，提取可见的，并取最后一个（AI 聊天框通常在最下方）
        const textareas = Array.from(document.querySelectorAll('textarea')).filter(ta => ta.offsetParent !== null);
        let inputArea = textareas[textareas.length - 1];

        if (!inputArea) {
            const editables = document.querySelectorAll('[contenteditable="true"]');
            inputArea = editables[editables.length - 1];
        }

        if (inputArea) {
            if (inputArea.isContentEditable) {
                inputArea.innerText = inputArea.innerText + textToAppend;
                inputArea.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                const originalValue = inputArea.value;
                const newValue = originalValue ? originalValue + textToAppend : textToAppend;

                // 绕过前端框架(如 React)对 value 属性的劫持
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(inputArea, newValue);
                } else {
                    inputArea.value = newValue;
                }

                // 触发 input 事件让底层框架感知到数据变化
                inputArea.dispatchEvent(new Event('input', { bubbles: true }));
            }

            inputArea.focus();
            if (inputArea.setSelectionRange) {
                const len = inputArea.value.length;
                inputArea.setSelectionRange(len, len);
            }

            // 新增：延时触发回车发送逻辑
            // 给前端框架 150 毫秒的时间更新内部 State，避免把空字符串发送出去
            setTimeout(() => {
                // 模拟按下回车键
                const enterDown = new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13
                });
                inputArea.dispatchEvent(enterDown);

                // 为了兼容性，部分框架可能监听 keyup
                const enterUp = new KeyboardEvent('keyup', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13
                });
                inputArea.dispatchEvent(enterUp);
            }, 150);

        } else {
            alert('未找到底部的输入框！');
        }
    });

    document.body.appendChild(appendBtn);
})();
