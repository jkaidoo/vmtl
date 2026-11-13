'use strict';
window.VMTL_PAGE = async function () {
 const esc=VMTL.esc;
 const api=async(path,opts)=>{const out=await VMTL.api(path,opts);if(out.queued)throw new Error('Connect to the server to save navigation.');return out.data;};
 const toast=(message,kind)=>VMTL.toast(message,kind==='ok'?'success':kind);
 const confirmModal=(message,opts)=>VMTL.confirm(message,{title:opts?.title});
 VMTL.view.innerHTML=VMTL.pageHead('Navigation menu','Arrange pages, create sections and rename labels for each role.')+"<div class=\"nav-settings-page\"><div class=\"card card-pad\"><label class=\"field\"><span>Role</span><select class=\"input\" id=\"navRole\"></select></label><p class=\"hint\">Choose a default menu for everyone, or override it for a role. Drag sections and pages, use the arrows, or move a page with its Section dropdown. Permissions still control which pages each person can access. Hidden pages remain reachable by URL.</p><div class=\"flex\" style=\"gap:8px;flex-wrap:wrap\"><button class=\"btn\" id=\"navAddSection\" type=\"button\">Add section</button><button class=\"btn\" id=\"navReset\" type=\"button\">Restore default</button><button class=\"btn btn-primary\" id=\"navSave\" type=\"button\">Save navigation</button><span class=\"hint\" role=\"status\" id=\"navDirty\"></span></div></div>\n<div class=\"navigation-editor\" id=\"navEditor\"></div><section class=\"card card-pad\"><h3>Menu preview</h3><div id=\"navPreview\"></div></section></div>";
function wireDragOrdering(list, rowSelector, onDrop, onStart = () => {}) {
  if (!list || list.dataset.dragOrdering) return;
  list.dataset.dragOrdering = '1';
  let drag = null;
  let saving = false;
  const rows = () => [...list.querySelectorAll(rowSelector)];
  list.addEventListener('click', (event) => {
    if (event.target.closest('.reorder-handle')) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  list.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.reorder-handle');
    if (!handle || event.button > 0 || saving || drag) return;
    const row = handle.closest(rowSelector);
    if (!row || rows().length < 2) return;
    event.preventDefault(); event.stopPropagation();
    onStart();
    drag = { row, handle, pointer: event.pointerId, original: rows() };
    list.setPointerCapture(event.pointerId);
    row.classList.add('reorder-dragging');
  });
  list.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    event.preventDefault();
    for (const row of rows()) {
      if (row === drag.row) continue;
      const box = row.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      if (event.clientY > box.top + box.height / 2) row.after(drag.row);
      else row.before(drag.row);
      break;
    }
    if (event.clientY < 60) window.scrollBy(0, -16);
    else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 16);
  });
  async function finish(event, cancel) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const current = drag; drag = null;
    current.row.classList.remove('reorder-dragging');
    if (list.hasPointerCapture(current.pointer)) list.releasePointerCapture(current.pointer);
    const ordered = rows();
    const changed = ordered.some((row, i) => row !== current.original[i]);
    const restore = () => current.original.forEach((row) => row.parentNode.appendChild(row));
    if (cancel) { restore(); return; }
    if (!changed) return;
    saving = true;
    try { await onDrop(ordered); }
    catch (error) { restore(); toast(error.message, 'err'); }
    finally { saving = false; }
  }
  list.addEventListener('pointerup', (event) => finish(event, false));
  list.addEventListener('pointercancel', (event) => finish(event, true));
  list.addEventListener('lostpointercapture', (event) => finish(event, true));
}

 const roleSelect=document.getElementById('navRole'),host=document.getElementById('navEditor'),note=document.getElementById('navDirty'),preview=document.getElementById('navPreview');
 const folds = new Map();
 let layout={sections:[]},dirty=false,currentRole='',catalogue=[];
 const mark=()=>{dirty=true;note.textContent='Unsaved changes';drawPreview();};
 const collect=()=>{host.querySelectorAll('[data-section-id]').forEach(el=>{const section=layout.sections.find(s=>s.id===el.dataset.sectionId);section.title=el.querySelector('[data-section-title]').value;el.querySelectorAll('[data-page-key]').forEach(row=>{const item=section.items.find(p=>p.key===row.dataset.pageKey);if(item)item.label=row.querySelector('[data-page-label]').value;});});};
 function drawPreview(){preview.innerHTML=layout.sections.map(s=>`<div class="nav-preview-section"><b>${esc(s.title)}</b>${s.items.filter(p=>p.visible!==false).map(p=>`<div>${esc(p.label)}</div>`).join('')}</div>`).join('');}
 function render(){
  host.innerHTML=layout.sections.map((s,index)=>`<details class="card nav-editor-section settings-fold" data-section-id="${esc(s.id)}"${folds.get(currentRole+':'+s.id) ? ' open' : ''}><summary><button class="reorder-handle" type="button" title="Drag section" aria-label="Drag section">⋮⋮</button><b>${esc(s.title)}</b><span class="faint">${s.items.length} pages</span></summary><div class="card-pad"><div class="flex nav-editor-heading"><label class="field"><span>Section heading</span><input class="input" data-section-title value="${esc(s.title)}" maxlength="80" required></label><button class="btn btn-sm" type="button" data-section-move="-1" ${index===0?'disabled':''} aria-label="Move section up">↑</button><button class="btn btn-sm" type="button" data-section-move="1" ${index===layout.sections.length-1?'disabled':''} aria-label="Move section down">↓</button>${!s.items.length?'<button class="btn btn-sm" type="button" data-remove-section>Remove empty section</button>':''}</div><div class="nav-editor-pages">${s.items.map((p,i)=>`<div class="nav-editor-page" data-page-key="${esc(p.key)}"><button class="reorder-handle" type="button" aria-label="Drag ${esc(p.label)}" title="Drag to reorder">⋮⋮</button><label class="field"><span>Page name <small class="faint">${esc(catalogue.find(c=>c.key===p.key)?.label||p.key)}</small></span><input class="input" data-page-label value="${esc(p.label)}" maxlength="80"></label><label class="field"><span>Section</span><select class="input" data-move-section>${layout.sections.map(x=>`<option value="${esc(x.id)}"${x.id===s.id?' selected':''}>${esc(x.title)}</option>`).join('')}</select></label><button type="button" class="switch" role="switch" data-page-visible aria-label="Show ${esc(p.label)}" aria-checked="${p.visible!==false}" ${p.key==='navigation'?'disabled':''}><span class="switch-knob"></span></button><button class="btn btn-sm" type="button" data-page-move="-1" ${i===0?'disabled':''} aria-label="Move page up">↑</button><button class="btn btn-sm" type="button" data-page-move="1" ${i===s.items.length-1?'disabled':''} aria-label="Move page down">↓</button></div>`).join('')||'<p class="hint">Move pages here using their Section dropdown.</p>'}</div></div></details>`).join('');
  host.querySelectorAll('[data-section-id]').forEach(el=>{
   el.addEventListener('toggle',()=>folds.set(currentRole+':'+el.dataset.sectionId,el.open));
   const section=layout.sections.find(s=>s.id===el.dataset.sectionId);
   el.querySelector('[data-section-title]').oninput=()=>{collect();el.querySelector('summary b').textContent=section.title;mark();};
   el.querySelectorAll('[data-section-move]').forEach(button=>button.onclick=()=>{collect();const i=layout.sections.indexOf(section),j=i+Number(button.dataset.sectionMove);[layout.sections[i],layout.sections[j]]=[layout.sections[j],layout.sections[i]];mark();render();});
   el.querySelector('[data-remove-section]')?.addEventListener('click',()=>{layout.sections=layout.sections.filter(s=>s!==section);mark();render();});
   el.querySelectorAll('[data-page-key]').forEach(row=>{
    const item=section.items.find(p=>p.key===row.dataset.pageKey);
    row.querySelector('[data-page-visible]').onclick=event=>{collect();item.visible=item.visible===false;mark();render();};
    row.querySelector('[data-page-label]').oninput=()=>{collect();mark();};
    row.querySelector('[data-move-section]').onchange=event=>{collect();section.items=section.items.filter(p=>p!==item);layout.sections.find(s=>s.id===event.target.value).items.push(item);mark();render();};
    row.querySelectorAll('[data-page-move]').forEach(button=>button.onclick=()=>{collect();const i=section.items.indexOf(item),j=i+Number(button.dataset.pageMove);[section.items[i],section.items[j]]=[section.items[j],section.items[i]];mark();render();});
   });
   wireDragOrdering(el.querySelector('.nav-editor-pages'),'.nav-editor-page',ordered=>{section.items=ordered.map(row=>section.items.find(p=>p.key===row.dataset.pageKey));mark();render();},collect);
  });drawPreview();
 }
 // Section drag starts only from its heading handle, never a page handle.
 wireDragOrdering(host,'.nav-editor-section',ordered=>{layout.sections=ordered.map(el=>layout.sections.find(s=>s.id===el.dataset.sectionId));mark();render();},collect);
 async function loadRole(){layout=(await api('/admin/navigation/'+encodeURIComponent(currentRole))).layout;dirty=false;note.textContent='';render();}
 let data;try{data=await api('/admin/navigation');}catch(error){VMTL.showErrors(error);return;}catalogue=data.pages;roleSelect.innerHTML=data.roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('');currentRole=roleSelect.value;
 roleSelect.onchange=async()=>{if(dirty&&!await confirmModal('Discard unsaved navigation changes?',{title:'Change role'})){roleSelect.value=currentRole;return;}currentRole=roleSelect.value;await loadRole();};
 document.getElementById('navAddSection').onclick=()=>{collect();const id='section-'+crypto.randomUUID();layout.sections.push({id,title:'New section',items:[]});folds.set(currentRole+':'+id,true);mark();render();};
 document.getElementById('navSave').onclick=async event=>{collect();const button=event.currentTarget;button.disabled=true;try{layout=(await api('/admin/navigation/'+encodeURIComponent(currentRole),{method:'PUT',body:layout})).layout;dirty=false;note.textContent='Saved';toast('Navigation saved','ok');await VMTL.refreshNavigation();render();}catch(error){toast(error.message,'err');}finally{button.disabled=false;}};
 document.getElementById('navReset').onclick=async()=>{if(!await confirmModal('Restore the default menu for this role?',{title:'Restore navigation'}))return;await api('/admin/navigation/'+encodeURIComponent(currentRole),{method:'PUT',body:{reset:true}});await loadRole();toast('Default navigation restored','ok');await VMTL.refreshNavigation();};
 await loadRole();
};
