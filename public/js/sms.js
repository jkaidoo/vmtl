'use strict';
window.VMTL_PAGE = async function () {
  const current = window.WalkinUI?.captureView() || (() => true);
  try {
    if (!window.VMTL_MESSAGING_PAGE) {
      window.__messagingPageLoad ||= new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = '/js/messaging-page.js';
        script.onload = resolve; script.onerror = () => { window.__messagingPageLoad = null; reject(new Error('Could not load messaging settings. Reload to try again.')); };
        document.head.appendChild(script);
      });
      await window.__messagingPageLoad;
    }
    if (current()) await window.VMTL_MESSAGING_PAGE('sms');
  } catch (error) { if (current()) VMTL.view.innerHTML = `<div class="empty">${VMTL.esc(error.message)}</div>`; }
};
