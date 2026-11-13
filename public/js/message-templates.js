'use strict';
// Walk-in template editor, shared by Email and SMS without registering a page renderer.
window.VMTL_MESSAGE_TEMPLATES = async function (CH, host) {
  const esc = VMTL.esc;
  const IS_EMAIL = CH === 'email'; const NOUN = IS_EMAIL ? 'email' : 'SMS';
  const api = async (path, options) => { const out = await VMTL.api(path, options); if (out.queued) throw new Error('Connect to the server to save templates.'); return out.data; };
  const toast = (message, kind) => VMTL.toast(message, kind === 'ok' ? 'success' : kind);
  if (!document.querySelector('link[href="/css/message-templates.css"]')) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/css/message-templates.css'; document.head.appendChild(style); }
  host.className = 'card pad message-templates';
  host.innerHTML = `<div class="msg-template-test"><label for="msgTplTestTo">Test recipient</label><input id="msgTplTestTo" type="${IS_EMAIL ? 'email' : 'tel'}" placeholder="${IS_EMAIL ? 'you@knust.edu.gh' : '0244000000'}"><span class="hint">Used only when you click Send as test. Previews do not send messages.</span></div><div data-template-editor></div>`;
  const tplEl = host.querySelector('[data-template-editor]');
  let tpl = null; let draft = {};
  const showEmailPreview = (label, html) => {
    const modal = VMTL.openModal(`<div class="modal-head"><h3>${esc(label)} — email preview</h3><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="modal-body" style="padding:0"><iframe title="Designed email preview" sandbox="" style="display:block;width:100%;height:70vh;border:0;background:#eef2ef"></iframe></div>`, { large: true });
    modal.el.querySelector('iframe').srcdoc = html;
  };
  const sendTest = async (key, button) => {
    const to = host.querySelector('#msgTplTestTo').value.trim();
    if (!to) { toast('Enter a test recipient first.', 'err'); host.querySelector('#msgTplTestTo').focus(); return; }
    const meta = tpl.meta.find(m => m.key === key); const selected = {};
    for (const field of [meta.subject, meta.body, meta.table]) if (field) selected[field] = value(field);
    button.disabled = true;
    try { const result = await api(`/admin/messaging/test-${CH}`, { method: 'POST', body: { to, template: key, draft: selected } }); toast(result.message || (result.ok ? 'Sent.' : 'Failed.'), result.ok ? 'ok' : 'err'); }
    catch (error) { toast(error.message, 'err'); }
    finally { button.disabled = false; }
  };
  async function loadTemplates() {
    try { tpl = await api(`/admin/messaging/${CH}/templates`); }
    catch (e) { tplEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    draft = {}; renderTemplates();
  }
  const value = (k) => (k in draft ? draft[k] : tpl.templates[k]);
  const dirty = () => Object.keys(draft).some((k) => draft[k] !== tpl.templates[k]);
  const fillSample = (text, own = {}) => { const v = { ...tpl.sample, ...own }; return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)); };
  // GSM-7 messages take 160 characters per SMS (153 when split); anything else 70 (67).
  const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
  function smsCount(text) {
    const gsm = GSM.test(text);
    const extra = gsm ? (text.match(/[\^{}\\[~\]|€]/g) || []).length : 0;
    const len = text.length + extra;
    const [one, many] = gsm ? [160, 153] : [70, 67];
    const parts = len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / many);
    return `${len} characters · ${parts} SMS${parts === 1 ? '' : ' parts'}${gsm ? '' : ' · contains special characters, so each part is shorter'}`;
  }
  const previewVersions=new Map();
  function updateSmsPreview(m){
    if(IS_EMAIL)return;
    const version=(previewVersions.get(m.key)||0)+1;previewVersions.set(m.key,version);
    const d={};if(m.body)d[m.body]=value(m.body);
    api('/admin/messaging/sms/preview',{method:'POST',body:{template:m.key,draft:d}}).then(e=>{
      if(previewVersions.get(m.key)!==version)return;
      const host=[...tplEl.querySelectorAll('[data-preview]')].find(el=>el.dataset.preview===m.key);
      if(host)host.innerHTML=`<div class="msg-preview sms"><div class="msg-preview-body">${esc(e.text)}</div></div><div class="faint msg-count">${esc(smsCount(e.text))} · sample values</div>`;
    }).catch(()=>{});
  }
  function preview(m) {
    const body = m.body ? fillSample(value(m.body), m.sample) : '';
    if (IS_EMAIL) {
      return `<div class="msg-preview"><div class="msg-preview-subj">${esc(fillSample(value(m.subject), m.sample))}</div>${m.body ? `<div class="msg-preview-body">${esc(body)}</div>` : '<div class="msg-preview-body faint">The body is generated when the summary is sent.</div>'}</div>`;
    }
    return `<div class="msg-preview sms"><div class="msg-preview-body">${esc(body)}</div></div><div class="faint msg-count">${esc(smsCount(body))}</div>`;
  }
  const isCustom = (m) => [m.subject, m.body, m.table].some((k) => k && value(k) !== tpl.defaults[k]);
  function renderTemplates() {
    if(!IS_EMAIL)setTimeout(()=>tpl.meta.forEach(updateSmsPreview),0);
    const open = new Set([...tplEl.querySelectorAll('details[open]')].map((d) => d.dataset.key));
    tplEl.innerHTML = `<div class="ua-head"><div><h2 id="msgTplTitle">Message templates</h2><p class="muted">The exact wording of each ${NOUN}. Placeholders in <span class="mono">{curly braces}</span> are filled in when the message is sent; click one to insert it.</p></div></div>
      <div class="msg-tpl-list">${tpl.meta.map((m) => `
        <details class="msg-tpl" data-key="${esc(m.key)}" ${open.has(m.key) ? 'open' : ''}>
          <summary><span class="msg-tpl-name"><b>${esc(m.label)}</b>${isCustom(m) ? '<span class="badge plain">Customised</span>' : ''}</span><small class="faint">${esc(m.when)}</small></summary>
          <div class="msg-tpl-body">
            <div class="msg-tpl-edit">
              ${m.subject ? `<label class="field"><span>Subject</span><input class="input" data-field="${esc(m.subject)}" value="${esc(value(m.subject))}"></label>` : ''}
              ${m.body ? `<label class="field"><span>${IS_EMAIL ? 'Body' : 'Text'}</span><textarea class="input" data-field="${esc(m.body)}" rows="${IS_EMAIL ? 7 : 4}" spellcheck="true">${esc(value(m.body))}</textarea></label>` : ''}
              ${IS_EMAIL && m.table ? `<label class="field"><span>Summary table</span><textarea class="input" data-field="${esc(m.table)}" rows="6" spellcheck="true">${esc(value(m.table))}</textarea><small class="hint">One row per line: Label | Value. Edit labels, text and placeholders, or remove rows. Use a single dash to hide the table.</small></label>` : ''}
              ${m.vars.length ? `<div class="msg-vars"><span class="faint">Insert:</span>${m.vars.map((v) => `<button type="button" class="msg-var" data-var="${esc(v)}">{${esc(v)}}</button>`).join('')}</div>` : ''}
              <div class="flex" style="gap:8px;flex-wrap:wrap;margin-top:10px">
                <button class="btn btn-sm" type="button" data-test="${esc(m.key)}">Send as test</button>
                ${IS_EMAIL ? `<button class="btn btn-sm" type="button" data-design="${esc(m.key)}">Preview designed email</button>` : ''}
                <button class="btn btn-ghost btn-sm" type="button" data-reset="${esc(m.key)}" ${isCustom(m) ? '' : 'disabled'}>Reset to default</button>
              </div>
            </div>
            <div class="msg-tpl-preview"><span class="faint" style="font-size:12px">Preview with sample values</span><div data-preview="${esc(m.key)}">${preview(m)}</div></div>
          </div>
        </details>`).join('')}</div>
      <div class="msg-tpl-actions"><span class="faint" id="msgTplDirty">${dirty() ? 'Unsaved changes' : ''}</span><span class="spacer"></span>
        <button class="btn btn-ghost" type="button" id="msgTplDiscard" ${dirty() ? '' : 'disabled'}>Discard changes</button>
        <button class="btn btn-primary" type="button" id="msgTplSave" ${dirty() ? '' : 'disabled'}>Save templates</button></div>`;

    let lastField = null;
    const byKey = (key) => tpl.meta.find((m) => m.key === key);
    const refresh = (details) => {
      const m = byKey(details.dataset.key);
      details.querySelector(`[data-preview]`).innerHTML = preview(m); updateSmsPreview(m);
      const name = details.querySelector('.msg-tpl-name');
      const badge = name.querySelector('.badge');
      if (isCustom(m) && !badge) name.insertAdjacentHTML('beforeend', '<span class="badge plain">Customised</span>');
      if (!isCustom(m) && badge) badge.remove();
      details.querySelector('[data-reset]').disabled = !isCustom(m);
      const d = dirty();
      tplEl.querySelector('#msgTplDirty').textContent = d ? 'Unsaved changes' : '';
      tplEl.querySelector('#msgTplSave').disabled = !d;
      tplEl.querySelector('#msgTplDiscard').disabled = !d;
    };
    tplEl.querySelectorAll('[data-field]').forEach((f) => {
      f.addEventListener('focus', () => { lastField = f; });
      f.addEventListener('input', () => { draft[f.dataset.field] = f.value; refresh(f.closest('details')); });
    });
    tplEl.querySelectorAll('.msg-var').forEach((b) => b.onclick = () => {
      const details = b.closest('details');
      const field = lastField && details.contains(lastField) ? lastField : details.querySelector('textarea[data-field]') || details.querySelector('[data-field]');
      const token = `{${b.dataset.var}}`;
      // Into the last-clicked field at its cursor; otherwise at the end of the text.
      const at = field === lastField ? field.selectionStart ?? field.value.length : field.value.length;
      field.setRangeText(token, at, field === lastField ? field.selectionEnd ?? at : at, 'end');
      field.focus();
      field.dispatchEvent(new Event('input'));
    });
    tplEl.querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => {
      const details = b.closest('details'); const m = byKey(b.dataset.reset);
      for (const k of [m.subject, m.body, m.table]) {
        if (!k) continue;
        draft[k] = tpl.defaults[k];
        const f = details.querySelector(`[data-field="${k}"]`); if (f) f.value = tpl.defaults[k];
      }
      refresh(details);
    });
    tplEl.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => {
      sendTest(b.dataset.test, b);
    });
    // The email as clients receive it: branded layout, sample values, unsaved edits included.
    tplEl.querySelectorAll('[data-design]').forEach((b) => b.onclick = async () => {
      const m = byKey(b.dataset.design);
      const d = {}; for (const k of [m.subject, m.body, m.table]) if (k) d[k] = value(k);
      try { showEmailPreview(m.label, (await api('/admin/messaging/email/preview', { method: 'POST', body: { template: m.key, draft: d } })).html); }
      catch (err) { toast(err.message, 'err'); }
    });
    tplEl.querySelector('#msgTplDiscard').onclick = () => { draft = {}; renderTemplates(); };
    tplEl.querySelector('#msgTplSave').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Saving…';
      const all = {}; for (const k of Object.keys(tpl.defaults)) all[k] = value(k);
      try {
        const out = await api(`/admin/messaging/${CH}/templates`, { method: 'PUT', body: { templates: all } });
        tpl.templates = out.templates; draft = {}; toast('Templates saved', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      renderTemplates();
    };
  }
  await loadTemplates();
};
