// ==UserScript==
// @name         NotebookLM Focus Mode
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Enhance NotebookLM reading: display source material in a floating window, dimming the rest. Button appears when specific source content is visible. Includes a copy button. 中文描述：增强 NotebookLM 阅读体验：将来源材料显示在浮动窗口中，并将其余部分变暗。仅当特定来源内容可见时，按钮才会出现。新增复制内容功能。
// @author       AI Assistant
// @match        https://notebook.google.com/*
// @updateURL    https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-focus-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/macrochen/my-scripts/main/userscripts/notebooklm-focus-mode.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    console.log('NotebookLM Focus Mode: Script execution started (v1.3).');

    // --- Configuration ---
    const TARGET_CONTENT_SELECTOR = 'source-viewer div.scroll-container';
    const APP_CONTENT_AREA_SELECTOR = 'body';

    // --- Styles ---
    GM_addStyle(`
        #focusModeBackdrop {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background-color: rgba(0, 0, 0, 0.75); z-index: 19998; display: none;
        }
        #focusModeModal {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 70%; max-width: 900px; min-width: 320px; height: 85vh; max-height: 85vh;
            background-color: #ffffff; color: #202124; border: 1px solid #dadce0;
            border-radius: 12px; box-shadow: 0 8px 16px rgba(0, 0, 0, 0.25);
            z-index: 19999; display: none; padding: 24px; box-sizing: border-box;
            /* Add bottom padding for the new copy button */
            padding-bottom: 70px;
        }
        #focusModeModalContent {
            width: 100%; height: 100%; /* Adjusted height due to parent's padding */
            overflow-y: auto;
            -webkit-overflow-scrolling: touch; background-color: #f8f9fa;
        }
        #focusModeModalContent h1, #focusModeModalContent h2, #focusModeModalContent h3,
        #focusModeModalContent h4, #focusModeModalContent h5, #focusModeModalContent h6 {
            color: #1f1f1f; margin-top: 1em; margin-bottom: 0.5em;
        }
        #focusModeModalContent p { line-height: 1.7; margin-bottom: 1em; color: #3c4043; }
        #focusModeModalContent a { color: #1a73e8; text-decoration: none; }
        #focusModeModalContent a:hover { text-decoration: underline; }
        #focusModeModalContent ul, #focusModeModalContent ol { margin-left: 20px; margin-bottom: 1em; }
        #focusModeModalContent li { margin-bottom: 0.5em; }
        #focusModeCloseButton {
            position: absolute; top: 12px; right: 12px; background: transparent; color: #5f6368;
            border: none; border-radius: 50%; width: 36px; height: 36px; font-size: 24px;
            line-height: 36px; text-align: center; cursor: pointer; transition: background-color 0.2s, color 0.2s;
        }
        #focusModeCloseButton:hover { background-color: #f1f3f4; color: #202124; }
        /* --- NEW STYLE FOR COPY BUTTON --- */
        #focusModeCopyButton {
            position: absolute; bottom: 20px; right: 24px;
            background-color: #f1f3f4; color: #3c4043;
            border: 1px solid #dadce0; padding: 8px 16px;
            font-size: 14px; font-weight: 500; border-radius: 18px;
            cursor: pointer; transition: all 0.2s ease-in-out;
        }
        #focusModeCopyButton:hover { background-color: #e8eaed; border-color: #c6c6c6; }
        #focusModeCopyButton.copied { background-color: #e6f4ea; color: #1e8e3e; border-color: #a8d5b5; }
        /* --- END NEW STYLE --- */
        #focusModeToggleButton {
            position: fixed; bottom: 25px; right: 25px; background-color: #1a73e8; color: white;
            border: none; padding: 12px 20px; text-align: center; text-decoration: none;
            font-size: 16px; font-weight: 500; border-radius: 24px; cursor: pointer;
            z-index: 19997; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: background-color 0.2s, box-shadow 0.2s, opacity 0.3s, visibility 0.3s;
            display: none; opacity: 0; visibility: hidden;
        }
        #focusModeToggleButton.visible { display: inline-block; opacity: 1; visibility: visible; }
        #focusModeToggleButton:hover { background-color: #1765cc; box-shadow: 0 4px 8px rgba(0,0,0,0.25); }
        body.focus-mode-active > *:not(#focusModeBackdrop):not(#focusModeModal):not(#focusModeToggleButton) {
            filter: blur(4px) brightness(0.6);
            transition: filter 0.3s ease-out, opacity 0.3s ease-out; pointer-events: none;
        }
    `);

    // --- MODIFIED: Added copyButton variable ---
    let backdrop, modal, modalContentContainer, closeButton, toggleButton, copyButton;
    let targetContentElement;

    // --- NEW FUNCTION: To handle copying content ---
    function copyContentToClipboard() {
        if (!targetContentElement) {
            console.error('NotebookLM Focus Mode: Target content for copying not found.');
            alert('复制失败：未能找到原文内容。');
            return;
        }

        const textToCopy = targetContentElement.innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('NotebookLM Focus Mode: Content copied to clipboard.');
            const originalText = copyButton.textContent;
            copyButton.textContent = '已复制!';
            copyButton.classList.add('copied');

            setTimeout(() => {
                copyButton.textContent = originalText;
                copyButton.classList.remove('copied');
            }, 2000); // Revert back after 2 seconds
        }).catch(err => {
            console.error('NotebookLM Focus Mode: Failed to copy content: ', err);
            alert('复制失败，请检查浏览器权限或手动复制。');
        });
    }

    function createFocusElements() {
        if (document.getElementById('focusModeToggleButton')) {
            console.log('NotebookLM Focus Mode: Elements seem to exist. Re-assigning.');
            toggleButton = document.getElementById('focusModeToggleButton');
            backdrop = document.getElementById('focusModeBackdrop');
            modal = document.getElementById('focusModeModal');
            if (modal) {
                modalContentContainer = modal.querySelector('#focusModeModalContent');
                closeButton = modal.querySelector('#focusModeCloseButton');
                // --- MODIFIED: Re-assign copy button ---
                copyButton = modal.querySelector('#focusModeCopyButton');
            } else { console.error('NotebookLM Focus Mode: Modal not found during re-assignment!'); }
            return;
        }
        console.log('NotebookLM Focus Mode: Creating focus elements...');
        if (!document.body) {
            console.error('NotebookLM Focus Mode: document.body not found.');
            setTimeout(createFocusElements, 500); return;
        }
        backdrop = document.createElement('div'); backdrop.id = 'focusModeBackdrop'; document.body.appendChild(backdrop);
        modal = document.createElement('div'); modal.id = 'focusModeModal';

        closeButton = document.createElement('button'); closeButton.id = 'focusModeCloseButton'; closeButton.textContent = '\u00D7'; closeButton.setAttribute('aria-label', '关闭专注模式'); modal.appendChild(closeButton);
        modalContentContainer = document.createElement('div'); modalContentContainer.id = 'focusModeModalContent'; modal.appendChild(modalContentContainer);

        // --- NEW: Create and append the copy button ---
        copyButton = document.createElement('button');
        copyButton.id = 'focusModeCopyButton';
        copyButton.textContent = '复制内容';
        copyButton.setAttribute('aria-label', '复制内容到剪贴板');
        modal.appendChild(copyButton);
        // --- END NEW ---

        document.body.appendChild(modal);
        toggleButton = document.createElement('button'); toggleButton.id = 'focusModeToggleButton'; toggleButton.textContent = '专注阅读'; document.body.appendChild(toggleButton);
        console.log('NotebookLM Focus Mode: Toggle button created.', toggleButton);

        toggleButton.addEventListener('click', toggleFocusMode);
        backdrop.addEventListener('click', hideFocusMode);
        closeButton.addEventListener('click', hideFocusMode);
        // --- NEW: Add event listener for the copy button ---
        copyButton.addEventListener('click', copyContentToClipboard);

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal && modal.style.display === 'block') hideFocusMode();
        });
        console.log('NotebookLM Focus Mode: Event listeners attached.');
    }

    // No changes to the functions below this point, they remain as they were.

    function findTargetContentElement() {
        targetContentElement = document.querySelector(TARGET_CONTENT_SELECTOR);
        return !!targetContentElement;
    }

    function manageFocusButtonVisibility() {
        if (!toggleButton) { console.warn("NotebookLM Focus Mode: Toggle button not ready."); return; }
        if (findTargetContentElement()) toggleButton.classList.add('visible');
        else {
            toggleButton.classList.remove('visible');
            if (modal && modal.style.display === 'block') hideFocusMode();
        }
    }

    function applyImportantStyles(element, styles) {
        for (const property in styles) {
            element.style.setProperty(property, styles[property], 'important');
        }
    }

    function showFocusMode() {
        console.log('NotebookLM Focus Mode: showFocusMode called.');
        if (!backdrop || !modal || !modalContentContainer) {
            console.error('NotebookLM Focus Mode: Core UI elements not initialized.');
            createFocusElements();
            if (!backdrop || !modal || !modalContentContainer) {
                alert('专注阅读脚本：核心界面元素未能创建，请尝试刷新页面。'); return;
            }
        }
        if (!findTargetContentElement() || !targetContentElement) {
            alert('专注阅读脚本：未能定位到具体内容区域。请先打开一个项目。'); return;
        }
        console.log('NotebookLM Focus Mode: Original targetContentElement:', targetContentElement);
        console.log('NotebookLM Focus Mode: Original targetContentElement.innerHTML (first 200):', targetContentElement.innerHTML.substring(0, 200));

        const clonedContent = targetContentElement.cloneNode(true);
        console.log('NotebookLM Focus Mode: Content cloned. clonedContent.innerHTML (first 200):', clonedContent.innerHTML.substring(0, 200));

        // Style the root of the cloned content
        applyImportantStyles(clonedContent, {
            'display': 'block',
            'visibility': 'visible',
            'width': '100%',
            'height': 'auto', // Let it grow with content
            'color': '#202124', // Default text color
            'background-color': 'transparent', // Avoid overriding modal content background
            'overflow': 'visible' // Ensure its own content isn't clipped
        });
        console.log('NotebookLM Focus Mode: Styles applied to clonedContent root.');

        // Specifically target and style key internal containers if they exist
        const scrollArea = clonedContent.querySelector('.scroll-area');
        if (scrollArea) {
            console.log('NotebookLM Focus Mode: Found .scroll-area in clone.');
            applyImportantStyles(scrollArea, {
                'display': 'block', 'visibility': 'visible', 'opacity': '1',
                'height': 'auto', 'overflow': 'visible'
            });
            const elementsContainer = scrollArea.querySelector('.elements-container');
            if (elementsContainer) {
                console.log('NotebookLM Focus Mode: Found .elements-container in clone.');
                applyImportantStyles(elementsContainer, {
                    'display': 'block', 'visibility': 'visible', 'opacity': '1',
                    'height': 'auto', 'overflow': 'visible'
                });
                const docViewer = elementsContainer.querySelector('labs-tailwind-doc-viewer');
                if (docViewer) {
                    console.log('NotebookLM Focus Mode: Found labs-tailwind-doc-viewer in clone.');
                    applyImportantStyles(docViewer, {
                        'display': 'block', 'visibility': 'visible', 'opacity': '1', 'height': 'auto'
                    });
                } else {
                    console.log('NotebookLM Focus Mode: labs-tailwind-doc-viewer NOT found in clone.');
                }
            } else {
                console.log('NotebookLM Focus Mode: .elements-container NOT found in .scroll-area.');
            }
        } else {
            console.log('NotebookLM Focus Mode: .scroll-area NOT found in clonedContent.');
        }

        // General style reset for other descendants to ensure visibility
        Array.from(clonedContent.querySelectorAll('*')).forEach(el => {
            // Avoid re-styling elements we've specifically handled above if they are caught by querySelectorAll
            if (el !== scrollArea && el !== scrollArea?.querySelector('.elements-container') && el !== scrollArea?.querySelector('labs-tailwind-doc-viewer')) {
                el.style.setProperty('visibility', 'visible', 'important');
                el.style.setProperty('opacity', '1', 'important');
                // If an element is explicitly display:none from its class, this might be needed
                if (window.getComputedStyle(el).display === 'none') {
                    el.style.setProperty('display', 'initial', 'important');
                }
            }
        });
        console.log('NotebookLM Focus Mode: General descendant styles updated.');
        console.log('NotebookLM Focus Mode: clonedContent.innerHTML (first 200) after all style changes:', clonedContent.innerHTML.substring(0, 200));

        while (modalContentContainer.firstChild) {
            modalContentContainer.removeChild(modalContentContainer.firstChild);
        }
        modalContentContainer.appendChild(clonedContent);
        console.log('NotebookLM Focus Mode: clonedContent appended. modalContentContainer.innerHTML (first 200):', modalContentContainer.innerHTML.substring(0, 200));

        backdrop.style.display = 'block';
        modal.style.display = 'block';
        console.log('NotebookLM Focus Mode: Backdrop and Modal display set to block.');
        console.log('NotebookLM Focus Mode: modalContentContainer.scrollHeight:', modalContentContainer.scrollHeight);


        document.body.classList.add('focus-mode-active');
        document.documentElement.style.overflow = 'hidden';
        modal.focus();
        console.log('NotebookLM Focus Mode: Focus mode activated.');
    }

    function hideFocusMode() {
        console.log('NotebookLM Focus Mode: hideFocusMode called.');
        if (backdrop) backdrop.style.display = 'none';
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('focus-mode-active');
        document.documentElement.style.overflow = '';
        console.log('NotebookLM Focus Mode: Focus mode deactivated.');
        manageFocusButtonVisibility();
    }

    function toggleFocusMode() {
        console.log('NotebookLM Focus Mode: toggleFocusMode called.');
        if (modal && modal.style.display === 'block') hideFocusMode();
        else showFocusMode();
    }

    function initializeScript() {
        console.log('NotebookLM Focus Mode: initializeScript called. Ready state:', document.readyState);
        if (!document.body) {
            console.warn('NotebookLM Focus Mode: Document body not available. Retrying...');
            setTimeout(initializeScript, 300); return;
        }
        createFocusElements();
        manageFocusButtonVisibility();
        const observerTargetNode = document.querySelector(APP_CONTENT_AREA_SELECTOR) || document.body;
        console.log('NotebookLM Focus Mode: MutationObserver targeting:', observerTargetNode);
        const observer = new MutationObserver(() => { manageFocusButtonVisibility(); });
        observer.observe(observerTargetNode, { childList: true, subtree: true });
        console.log('NotebookLM Focus Mode: MutationObserver started.');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') initializeScript();
    else document.addEventListener('DOMContentLoaded', initializeScript);
    console.log('NotebookLM Focus Mode: Script initialization sequence set up.');

})();
