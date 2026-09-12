// ==UserScript==
// @name         小宇宙音频强力下载器 (解决401错误)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在小宇宙网页端添加下载按钮，通过伪装请求解决 401 防盗链问题
// @author       Gemini
// @match        https://www.xiaoyuzhoufm.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/xiaoyuzhou-audio-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/xiaoyuzhou-audio-downloader.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. 创建下载按钮
    function createDownloadBtn() {
        const btnId = 'xyz-download-btn-custom';
        // 防止重复添加
        if (document.getElementById(btnId)) return;

        const btn = document.createElement('button');
        btn.id = btnId;
        btn.innerText = '下载本期音频';

        // 简单的按钮样式：悬浮在页面右下角
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '100px',
            right: '20px',
            zIndex: '9999',
            padding: '10px 20px',
            backgroundColor: '#3e3e3e',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            fontSize: '14px',
            fontWeight: 'bold'
        });

        // 鼠标悬停变色
        btn.onmouseover = () => btn.style.backgroundColor = '#555';
        btn.onmouseout = () => btn.style.backgroundColor = '#3e3e3e';

        // 绑定点击事件
        btn.onclick = downloadAudio;

        document.body.appendChild(btn);
    }

    // 2. 核心下载逻辑
    async function downloadAudio() {
        const btn = document.getElementById('xyz-download-btn-custom');

        // 寻找页面中的 audio 标签
        const audioTag = document.querySelector('audio');

        if (!audioTag || !audioTag.src) {
            alert('未找到音频文件，请先点击播放一下音频，让页面加载资源。');
            return;
        }

        const audioUrl = audioTag.src;

        // 获取当前页面标题作为文件名（去掉多余的文字）
        let fileName = document.title.replace(' | 小宇宙 - 听播客，上小宇宙', '').trim() + '.m4a';

        try {
            btn.innerText = '正在下载中...';
            btn.disabled = true;

            // 关键步骤：使用 fetch 请求音频数据
            // 这样会带上当前页面的“身份信息”（Referer），骗过服务器
            const response = await fetch(audioUrl);

            if (!response.ok) {
                throw new Error(`下载失败，服务器返回状态: ${response.status}`);
            }

            // 将数据转化为二进制“大块头” (Blob)
            const blob = await response.blob();

            // 创建一个临时的下载链接并点击
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();

            // 清理垃圾
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            btn.innerText = '下载成功！';
            setTimeout(() => {
                btn.innerText = '下载本期音频';
                btn.disabled = false;
            }, 2000);

        } catch (err) {
            console.error(err);
            alert('下载出错：' + err.message);
            btn.innerText = '下载本期音频';
            btn.disabled = false;
        }
    }

    // 3. 监听页面变化，确保按钮一直存在
    // 因为小宇宙是单页应用（切换页面不刷新），需要定时检查按钮是否还在
    setInterval(createDownloadBtn, 1000);

})();
