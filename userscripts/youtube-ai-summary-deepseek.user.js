// ==UserScript==
// @name         YouTube AI 总结 (跳转 DeepSeek 网页端)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  在视频右上角添加按钮，抓取 YouTube 字幕，跳转 DeepSeek 网页端自动填入提示词并发送。不调用 API。
// @author       You
// @match        https://www.youtube.com/watch*
// @match        https://chat.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/youtube-ai-summary-deepseek.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/youtube-ai-summary-deepseek.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'YT_DEEPSEEK_PENDING_PROMPT';

    const SUMMARY_PROMPT = `请把我给定的内容（文字/视频）总结成一个"读完能记住"的版本。

不是做摘要，是用你自己的话把这个东西重新讲一遍。讲完之后，别人应该能记住核心观点，还能复述出一两个关键细节。

# 怎么写

1. 先找到全文的一条主线。所有内容围绕这条线展开，偏离主线的素材直接扔掉。
2. 沿着主线，挑出几个真正值得记住的点。每个点讲清楚：它在说什么、凭什么值得信。
3. 细节不要全删。有画面感的例子、反常识的事实、作者自己说的原话，如果它能帮人记住观点，就留着。每个重点最多留一个这样的细节，不要贪多。
4. 一段只说一件事。观点是一段，例子是一段，结论是一段。宁可多分段，不要挤成一堵墙。
5. 如果是网页内容，在开头写上标题和原文链接。

# 不要做的事

- 不要加"解释："、"举例："、"关系："、"小结："这类标签。你在讲东西，不是在填表。
- 不要用生硬的栏目标题把内容切成块。可以有结构，但不要让人看到骨架。
- 不要为了工整而凑排比、凑对仗。
- 不要在结尾写"总而言之"然后把前面说过的话再说一遍。
- 不要用这些词："底层逻辑"、"认知升级"、"本质上"（一篇里最多出现1次）、"深度"、"维度"、"赋能"、"颗粒度"。
- 不要用破折号（——）。

# 补一段"但是"（仅在需要时）

如果原文是在表达一个观点、给一个建议、或者论证一件事，总结写完之后，补一小段提醒：
- 这个观点成立的前提是什么？换个场景还成立吗？
- 读者最容易把什么当成绝对真理，但其实是有条件的？

只在确实有值得说的时候写，写两三句就够。不要硬挑刺，不要为了显得"批判性思维"而强行唱反调。

# 抛几个问题

最后扔三四个值得接着想的问题。目的不是考记忆力，而是帮读者把内容接到自己的经验上。

要求很简单：每个问题都得让人真的停下来想一想，不能是搜一下就有答案的。比如：
- 内容里没有明说、但整个论证其实站在上面的那个前提，把它翻出来问
- 把观点放到一个完全相反的场景里，看看还能不能站住
- 跟读者自己正在做的事或正在纠结的决定挂上钩

问的语气随意一点，像聊完天顺嘴说的，不要像出考题。

# 语言

- 简体中文。
- 像在跟人说话，不像在写报告。
- 平实、干净。不用刻意幽默，不用刻意深刻。把事情说清楚就是最好的风格。`;

    // ---------------------------------------------------------------
    // YouTube 分支
    // ---------------------------------------------------------------
    if (location.hostname.includes('youtube.com')) {
        // 修复 YouTube Trusted Types
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                window.trustedTypes.createPolicy('default', {
                    createHTML: (s) => s,
                    createScriptURL: (s) => s,
                    createScript: (s) => s,
                });
            } catch (e) { /* 已存在则忽略 */ }
        }

        runYouTube();
    }

    // ---------------------------------------------------------------
    // DeepSeek 分支
    // ---------------------------------------------------------------
    if (location.hostname.includes('deepseek.com')) {
        runDeepSeek();
    }


    // =================================================================
    //  YouTube 侧
    // =================================================================
    function runYouTube() {
        // 注入样式，改用 absolute 相对视频容器定位
        const style = document.createElement('style');
        style.textContent = `
            #yt-ai-summary-btn {
                position: absolute;
                top: 20px;
                right: 20px;
                z-index: 6000; /* 保证在视频画面之上 */
                padding: 8px 16px;
                background: linear-gradient(135deg, rgba(102,126,234,0.9) 0%, rgba(118,75,162,0.9) 100%);
                color: #fff;
                border: none;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: transform 0.2s, background 0.2s;
                backdrop-filter: blur(4px); /* 磨砂玻璃效果 */
            }
            #yt-ai-summary-btn:hover {
                transform: scale(1.05);
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            #yt-ai-summary-btn:disabled {
                background: #999;
                cursor: not-allowed;
                transform: none;
            }
        `;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.id = 'yt-ai-summary-btn';
        btn.textContent = '✨ AI 总结';

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '⏳ 抓取字幕...';
            try {
                const transcript = await getTranscript();
                if (!transcript || transcript.length < 50) {
                    throw new Error('字幕内容过短或为空。');
                }

                const fullPrompt = SUMMARY_PROMPT + '\n\n--- 视频字幕 ---\n' + transcript;
                GM_setValue(STORAGE_KEY, fullPrompt);

                btn.textContent = '↗ 跳转中...';
                location.href = 'https://chat.deepseek.com/';
            } catch (err) {
                alert('抓取失败：' + err.message);
                btn.disabled = false;
                btn.textContent = '✨ AI 总结';
            }
        });

        // 将按钮挂载到视频播放器容器内
        function mountButton() {
            const player = document.getElementById('movie_player');
            if (player) {
                // 如果播放器加载出来了，把按钮放进播放器里
                if (!player.contains(btn)) {
                    player.appendChild(btn);
                }
            } else {
                // 如果不在视频页或者播放器还没加载，先把按钮隐藏掉
                if (document.body.contains(btn)) {
                    btn.remove();
                }
            }
        }

        // 初次尝试挂载
        mountButton();

        // YouTube 是单页应用(SPA)，切换视频时 DOM 会变，监听导航事件重新挂载
        document.addEventListener('yt-navigate-finish', mountButton);
        // 备用轮询，防止漏掉状态变化
        setInterval(mountButton, 2000);

        // --- 字幕抓取逻辑不变 ---
        async function getTranscript() {
            let playerResponse = null;
            const moviePlayer = document.getElementById('movie_player');
            if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
                try { playerResponse = moviePlayer.getPlayerResponse(); } catch (e) {}
            }
            if (!playerResponse) playerResponse = window.ytInitialPlayerResponse;
            if (!playerResponse || !playerResponse.captions) {
                throw new Error('当前视频没有字幕。');
            }

            const tracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
            if (!tracks || tracks.length === 0) throw new Error('当前视频没有字幕轨道。');

            let track = tracks.find(t => t.languageCode === 'zh' || t.languageCode === 'zh-Hans');
            if (!track) track = tracks.find(t => t.languageCode === 'en');
            if (!track) track = tracks[0];

            const baseUrl = track.baseUrl;
            if (!baseUrl) throw new Error('无法获取字幕 URL。');

            const isPoTokenGated = /[?&]exp=xpe\b/.test(baseUrl) && !/[?&]pot=/.test(baseUrl);

            if (!isPoTokenGated) {
                try {
                    const resp = await fetch(baseUrl + '&fmt=json3', { credentials: 'include' });
                    if (resp.ok) {
                        const text = await resp.text();
                        if (text && text.trim().length > 0) return parseTranscript(text);
                    }
                } catch (e) { /* 回退到 DOM */ }
            }
            return await scrapeTranscriptFromDOM();
        }

        function parseTranscript(text) {
            try {
                const data = JSON.parse(text);
                if (data.events) {
                    return data.events
                        .filter(e => e.segs)
                        .map(e => e.segs.map(s => s.utf8).join(''))
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }
            } catch (e) {}
            return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        async function scrapeTranscriptFromDOM() {
            const transcriptBtn = document.querySelector(
                'button[aria-label*="transcript" i], button[aria-label*="字幕" i]'
            );
            if (transcriptBtn) {
                transcriptBtn.click();
            } else {
                const moreBtn = document.querySelector(
                    'button[aria-label*="更多" i], button[aria-label*="More" i]'
                );
                if (moreBtn) {
                    moreBtn.click();
                    await new Promise(r => setTimeout(r, 500));
                    const items = document.querySelectorAll('ytd-menu-service-item-renderer');
                    for (const item of items) {
                        if (item.textContent.includes('字幕') || item.textContent.toLowerCase().includes('transcript')) {
                            item.click();
                            break;
                        }
                    }
                }
            }

            await new Promise(r => setTimeout(r, 2000));
            const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length === 0) {
                throw new Error('无法抓取字幕，请确认视频包含字幕。');
            }
            return Array.from(segments)
                .map(seg => {
                    const t = seg.querySelector('.segment-text, yt-formatted-string');
                    return t ? t.textContent.trim() : '';
                })
                .filter(Boolean)
                .join(' ');
        }
    }


    // =================================================================
    //  DeepSeek 侧（纯网页操作，无 API）
    // =================================================================
    function runDeepSeek() {
        const pending = GM_getValue(STORAGE_KEY, null);
        if (!pending) return;

        GM_deleteValue(STORAGE_KEY);

        console.log('[YT-AI] 检测到待发送内容，等待 DeepSeek 输入框...');

        waitForInputBox(20000).then(inputBox => {
            if (!inputBox) {
                console.warn('[YT-AI] 未找到 DeepSeek 输入框，自动填充中止');
                return;
            }
            setTimeout(() => fillAndSend(inputBox, pending), 800);
        });
    }

    function waitForInputBox(timeout = 20000) {
        return new Promise(resolve => {
            const findInput = () => {
                let el = document.querySelector('textarea#chat-input');
                if (el) return el;
                const tas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
                if (tas.length) return tas[0];
                const ces = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(t => t.offsetParent !== null);
                if (ces.length) return ces[0];
                return null;
            };

            const existing = findInput();
            if (existing) { resolve(existing); return; }

            const observer = new MutationObserver(() => {
                const el = findInput();
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(findInput());
            }, timeout);
        });
    }

    function fillAndSend(inputBox, text) {
        console.log('[YT-AI] 开始填充 DeepSeek 输入框，长度:', text.length);
        inputBox.focus();

        if (inputBox.tagName === 'TEXTAREA') {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(inputBox, text);
            inputBox.dispatchEvent(new InputEvent('input', {
                bubbles: true, cancelable: true, inputType: 'insertText', data: text
            }));
            inputBox.dispatchEvent(new Event('change', { bubbles: true }));
            if (inputBox.setSelectionRange) {
                const len = text.length;
                inputBox.setSelectionRange(len, len);
            }
        } else {
            inputBox.innerText = text;
            inputBox.dispatchEvent(new InputEvent('input', {
                bubbles: true, cancelable: true, inputType: 'insertText', data: text
            }));
        }

        setTimeout(() => trySend(inputBox), 500);
    }

    function trySend(inputBox) {
        const sendBtn = findSendButton();
        if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
            sendBtn.click();
            return;
        }

        const enterOpts = {
            bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        };
        inputBox.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        inputBox.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        inputBox.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    }

    function findSendButton() {
        const candidates = [
            'button[aria-label="Send message"]',
            'button[aria-label*="发送"]',
            'button[data-testid="send-button"]',
            'div[role="button"][aria-label*="发送"]',
            'button[type="submit"]',
        ];
        for (const sel of candidates) {
            const btns = document.querySelectorAll(sel);
            for (const b of btns) {
                if (b.offsetParent !== null) return b;
            }
        }
        return null;
    }

})();
