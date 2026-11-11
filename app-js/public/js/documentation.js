'use strict';
// Documentation viewer (minimal Markdown rendering).
window.VMTL_PAGE = async function () {
  const view = VMTL.view; const esc = VMTL.esc;
  view.innerHTML = VMTL.pageHead('Documentation', 'Project and system reference.') + '<div class="doc-layout"><div class="card" id="docList"><div class="loading"><span class="spinner"></span></div></div><div class="card" id="docCard"><div class="card-body"><div class="dim">Select a document.</div></div></div></div>';
  let docs; try { docs = (await VMTL.api('/admin/documentation')).data; } catch (e) { view.querySelector('#docList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  view.querySelector('#docList').innerHTML = `<div class="doc-nav">${docs.map((d) => `<button class="doc-nav-item" data-slug="${d.slug}" type="button"><span class="t">${esc(d.title)}</span><span class="s">${esc(d.summary)}</span></button>`).join('')}</div>`;
  const items = view.querySelectorAll('[data-slug]');
  const open = async (slug) => {
    items.forEach((b) => b.classList.toggle('active', b.dataset.slug === slug));
    const panel = view.querySelector('#docCard'); panel.innerHTML = '<div class="card-body"><div class="loading"><span class="spinner"></span></div></div>';
    try { const d = (await VMTL.api(`/admin/documentation/${slug}`)).data; panel.innerHTML = `<div class="card-body doc-content">${md(d.content)}</div>`; } catch (e) { panel.innerHTML = `<div class="card-body"><div class="empty">${esc(e.message)}</div></div>`; }
  };
  items.forEach((a) => a.onclick = () => open(a.dataset.slug));
  if (docs.length) open(docs[0].slug);
};
// Tiny Markdown: headings, bold, lists, paragraphs (content is trusted, server-authored).
function md(src) {
  const esc = VMTL.esc;
  const lines = String(src).split('\n'); const out = []; let inList = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^### /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h4>${inline(line.slice(4))}</h4>`); }
    else if (/^## /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3>${inline(line.slice(3))}</h3>`); }
    else if (/^# /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2>${inline(line.slice(2))}</h2>`); }
    else if (/^\s*[-*] /.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`); }
    else if (line.trim() === '') { if (inList) { out.push('</ul>'); inList = false; } }
    else { if (inList) { out.push('</ul>'); inList = false; } out.push(`<p>${inline(line)}</p>`); }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
