// ==UserScript==
// @name         屏蔽B站视频页分享悬浮窗
// @namespace    https://bilibili.com/
// @version      1.0
// @description  屏蔽视频下方“分享/复制”按钮在鼠标悬停时弹出的遮挡画面的浮窗
// @author       You
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-hide-share-popover.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/bilibili-hide-share-popover.user.js
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // 针对 B 站分享弹出面板的类名与选择器
    const css = `
        /* 屏蔽新版与旧版播放器下方的分享弹出面板（保留分享图标本身，仅干掉悬停浮窗） */
        .video-share-popover,
        .bili-share-popover,
        .share-box,
        .video-share-info,
        .video-toolbar-v1 .video-share .share-popover,
        .video-toolbar-right-share-popover {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }

        /* 补充：防止部分基于 popper/tippy 挂载到 body 下的分享面板冒泡显示 */
        div[id^="tippy-"]:has(.share-box),
        div[class*="popover"]:has(.share-box),
        div[class*="popover"]:has([class*="share"]) {
            display: none !important;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }
})();
