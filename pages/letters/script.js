(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"letters" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, LT = SW.LetterTemplates, isPM = user.role==="pm";

  let activeCat = isPM ? "pm" : "contractor";
  let activeTemplate = null;
  let projects = [];
  let selectedProjectId = "";

  function myProjects(){ return DB.projects.list(p=> (isPM ? p.pmId===user.id : p.contractorId===user.id)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)); }

  function renderProjectSelect(){
    projects = myProjects();
    const sel = document.getElementById("ltProjectSel");
    if(!projects.length){ sel.innerHTML = `<option value="">No projects yet</option>`; sel.disabled = true; return; }
    sel.disabled = false;
    sel.innerHTML = projects.map(p=>`<option value="${p.id}" ${p.id===selectedProjectId?"selected":""}>${U.escapeHtml(p.name)}</option>`).join("");
    if(!selectedProjectId) selectedProjectId = projects[0].id;
    sel.value = selectedProjectId;
  }
  document.getElementById("ltProjectSel").addEventListener("change", e=>{ selectedProjectId = e.target.value; if(activeTemplate) renderEditor(); });

  function renderCatTabs(){
    document.querySelectorAll("#ltCatTabs button").forEach(b=> b.classList.toggle("active", b.dataset.cat===activeCat));
  }
  document.querySelectorAll("#ltCatTabs button").forEach(b=> b.addEventListener("click", ()=>{ activeCat=b.dataset.cat; renderCatTabs(); renderTemplateList(); }));

  function renderTemplateList(){
    const all = LT.list();
    const list = activeCat==="all" ? all : all.filter(t=>t.category===activeCat);
    document.getElementById("ltTemplateList").innerHTML = list.map(t=>`
      <button class="lt-tpl-btn ${activeTemplate&&activeTemplate.id===t.id?"active":""}" data-tpl="${t.id}">
        <span class="lt-tpl-icon">${t.icon||"📄"}</span>
        <span>
          <div class="lt-tpl-title">${U.escapeHtml(t.title)}</div>
          <div class="lt-tpl-desc">${U.escapeHtml(t.desc||"")}</div>
          <span class="lt-tpl-cat">${U.escapeHtml(LT.CATEGORY_LABEL[t.category]||t.category)}</span>
        </span>
      </button>`).join("");
    document.querySelectorAll("[data-tpl]").forEach(b=> b.addEventListener("click", ()=>{ activeTemplate = LT.get(b.dataset.tpl); renderTemplateList(); renderEditor(); }));
  }

  /* ---------------- context assembly ---------------- */
  function buildCtx(project){
    const pm = DB.users.get(project.pmId);
    const pmCompany = pm ? (DB.companies.list(c=>c.ownerId===pm.id)[0]||{}) : {};
    const contractorUser = project.external ? null : DB.users.get(project.contractorId);
    const contractorCompany = contractorUser ? (DB.companies.list(c=>c.ownerId===contractorUser.id)[0]||{}) : {};
    const contractorName = project.external ? (project.externalContractorName||"External Contractor") : (contractorUser?.name||"—");
    const wo = project.workOrderId ? DB.workOrders.get(project.workOrderId) : (project.tenderId ? DB.workOrders.list(w=>w.tenderId===project.tenderId)[0] : null);
    const loi = wo && wo.loiId ? DB.lois.get(wo.loiId) : null;
    const tender = project.tenderId ? DB.tenders.get(project.tenderId) : null;
    const issuerUser = isPM ? pm : contractorUser;
    const issuerCompany = isPM ? pmCompany : contractorCompany;
    return { project, pm, pmCompany, contractorUser, contractorCompany, contractorName, pmName: pm?pm.name:"—",
      wo, loi, tender, issuerUser: issuerUser||user, issuerCompany, recipientName: isPM ? contractorName : (pm?pm.name:"—") };
  }

  /* ---------------- editor (fields + preview) ---------------- */
  function fieldCtrl(fld, val){
    val = val==null ? (fld.default!=null?fld.default:"") : val;
    const full = fld.type==="textarea" ? "field-full" : "";
    let ctrl;
    if(fld.type==="textarea") ctrl = `<textarea class="textarea" data-lf="${fld.k}" rows="3">${U.escapeHtml(val)}</textarea>`;
    else if(fld.type==="select") ctrl = `<select class="select" data-lf="${fld.k}">${(fld.options||[]).map(o=>`<option ${o===val?"selected":""}>${U.escapeHtml(o)}</option>`).join("")}</select>`;
    else if(fld.type==="date") ctrl = `<input class="input" type="date" data-lf="${fld.k}" value="${U.escapeHtml(val)}">`;
    else if(fld.type==="number") ctrl = `<input class="input" type="number" data-lf="${fld.k}" value="${U.escapeHtml(val)}">`;
    else ctrl = `<input class="input" data-lf="${fld.k}" value="${U.escapeHtml(val)}">`;
    return `<div class="field ${full}" style="margin:0"><label>${U.escapeHtml(fld.l)}${fld.required?' <span style="color:var(--sw-danger)">*</span>':""}</label>${ctrl}</div>`;
  }

  function gatherFields(t){
    const f = { letterDate: document.getElementById("ltDate")?.value || new Date().toISOString().slice(0,10) };
    document.querySelectorAll("#ltFieldsCard [data-lf]").forEach(el=> f[el.dataset.lf] = el.value);
    return f;
  }
  function missingRequired(t, f){
    return (t.fields||[]).filter(fld=> fld.required && !String(f[fld.k]||"").trim());
  }

  function renderEditor(){
    document.getElementById("ltEmpty").classList.toggle("hidden", !!activeTemplate);
    document.getElementById("ltEditorWrap").classList.toggle("hidden", !activeTemplate);
    if(!activeTemplate) return;
    if(!projects.length){
      document.getElementById("ltFieldsCard").innerHTML = `<div class="empty-state"><div class="es-icon">🏗️</div>You need at least one project to draft a letter — its parties, work order and contract details are pulled in automatically.</div>`;
      document.getElementById("ltPreview").innerHTML = "";
      return;
    }
    const t = activeTemplate;
    document.getElementById("ltFieldsCard").innerHTML = `
      <div class="flex justify-between items-start mb-3"><div><h3 style="margin:0">${t.icon||"📄"} ${U.escapeHtml(t.title)}</h3><p class="text-muted" style="margin:2px 0 0;font-size:12.5px">${U.escapeHtml(t.desc||"")}</p></div></div>
      <div class="lt-field-grid mb-2">
        <div class="field" style="margin:0"><label>Letter Date</label><input class="input" type="date" id="ltDate" value="${new Date().toISOString().slice(0,10)}"></div>
        ${(t.fields||[]).map(fld=> fieldCtrl(fld, "")).join("")}
      </div>`;
    document.querySelectorAll("#ltFieldsCard [data-lf], #ltFieldsCard #ltDate").forEach(el=> el.addEventListener("input", renderPreview));
    document.querySelectorAll("#ltFieldsCard select[data-lf]").forEach(el=> el.addEventListener("change", renderPreview));
    renderPreview();
  }

  function letterHtml(t, ctx, f){
    const subject = t.overrideSubject ? f.subjectLine : t.subject(ctx);
    const bodyHtml = t.body(ctx, f);
    const dateStr = U.fmtDate(f.letterDate);
    const counter = t.counterSign ? `
      <div class="lt-signoff">
        <div>${U.signatureImg(ctx.issuerUser)}${U.escapeHtml(ctx.issuerUser?ctx.issuerUser.name:"—")}<br>Issued By — For ${U.escapeHtml(ctx.issuerCompany.name||"")}</div>
        <div>${U.escapeHtml(ctx.recipientName)}<br>Received &amp; Accepted By</div>
      </div>` : `
      <div class="lt-signoff" style="justify-content:flex-start">
        <div style="text-align:left;width:260px;border-top:1px solid #111">${U.signatureImg(ctx.issuerUser)}${U.escapeHtml(ctx.issuerUser?ctx.issuerUser.name:"—")}<br>For ${U.escapeHtml(ctx.issuerCompany.name||"")}</div>
      </div>`;
    return `
      <div class="lh"><div class="brand">${U.escapeHtml(ctx.issuerCompany.name||user.name)}</div><div class="meta">${U.escapeHtml(ctx.issuerCompany.gst||"")}<br>${U.escapeHtml(ctx.project.district||"")}, ${U.escapeHtml(ctx.project.state||"")}</div></div>
      <p style="font-size:12px;text-align:right;margin:0 0 10px">Date: ${dateStr}</p>
      ${subject?`<div class="lt-title">${U.escapeHtml(t.title)}</div><p class="lt-subject"><b>Subject:</b> ${U.escapeHtml(subject)}</p>`:""}
      ${bodyHtml}
      ${counter}
      <p style="font-size:10px;color:#888;margin-top:30px;border-top:1px solid #eee;padding-top:8px;display:flex;justify-content:space-between">
        <span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></p>`;
  }

  function renderPreview(){
    if(!activeTemplate || !projects.length) return;
    const project = DB.projects.get(selectedProjectId) || projects[0];
    const ctx = buildCtx(project);
    const f = gatherFields(activeTemplate);
    document.getElementById("ltPreview").innerHTML = letterHtml(activeTemplate, ctx, f);
  }

  document.getElementById("ltPrintBtn").addEventListener("click", ()=>{
    if(!activeTemplate || !projects.length) return;
    const project = DB.projects.get(selectedProjectId) || projects[0];
    const ctx = buildCtx(project);
    const f = gatherFields(activeTemplate);
    const missing = missingRequired(activeTemplate, f);
    if(missing.length){ U.toast(`Please fill: ${missing.map(m=>m.l).join(", ")}`, {type:"danger"}); return; }
    SW.UI.printDocument(`${activeTemplate.title} — ${project.name}`, letterHtmlForPrint(activeTemplate, ctx, f));
  });
  // Print uses the shared printDocument letterhead classes (.letterhead/.title/.signoff/.footer)
  // for consistency with every other document in the app, rather than the on-page preview's own CSS.
  function letterHtmlForPrint(t, ctx, f){
    const subject = t.overrideSubject ? f.subjectLine : t.subject(ctx);
    const bodyHtml = t.body(ctx, f);
    const dateStr = U.fmtDate(f.letterDate);
    const counter = t.counterSign ? `
      <div class="signoff">
        <div>${U.signatureImg(ctx.issuerUser)}${U.escapeHtml(ctx.issuerUser?ctx.issuerUser.name:"—")}<br>Issued By — For ${U.escapeHtml(ctx.issuerCompany.name||"")}</div>
        <div>${U.escapeHtml(ctx.recipientName)}<br>Received &amp; Accepted By</div>
      </div>` : `
      <div class="signoff" style="justify-content:flex-start">
        <div style="width:260px">${U.signatureImg(ctx.issuerUser)}${U.escapeHtml(ctx.issuerUser?ctx.issuerUser.name:"—")}<br>For ${U.escapeHtml(ctx.issuerCompany.name||"")}</div>
      </div>`;
    return `
      <div class="letterhead"><div class="brand">${U.escapeHtml(ctx.issuerCompany.name||user.name)}</div><div class="meta">${U.escapeHtml(ctx.issuerCompany.gst||"")}<br>${U.escapeHtml(ctx.project.district||"")}, ${U.escapeHtml(ctx.project.state||"")}</div></div>
      <p style="font-size:12px;text-align:right">Date: ${dateStr}</p>
      ${subject?`<div class="title">${U.escapeHtml(t.title)}</div><p style="font-size:13px;text-align:center"><b>Subject:</b> ${U.escapeHtml(subject)}</p>`:""}
      ${bodyHtml}
      ${counter}
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
  }

  /* ---------------- drafts ---------------- */
  function renderDrafts(){
    const drafts = DB.letterDrafts.list(d=>d.ownerId===user.id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    document.getElementById("ltDraftsList").innerHTML = drafts.length ? drafts.map(d=>{
      const t = LT.get(d.templateId);
      const p = DB.projects.get(d.projectId);
      return `<div class="draft-row">
        <div><b>${t?U.escapeHtml(t.title):"Letter"}</b> <span class="text-muted" style="font-size:12px">— ${p?U.escapeHtml(p.name):"—"} · ${U.relativeTime(d.updatedAt)}</span></div>
        <div class="flex gap-2"><button class="btn btn-outline btn-sm" data-open-draft="${d.id}">Open</button><button class="btn-icon" data-rm-draft="${d.id}" title="Delete">✕</button></div>
      </div>`;
    }).join("") : `<div class="empty-state"><div class="es-icon">💾</div>No saved drafts yet.</div>`;
    document.querySelectorAll("[data-open-draft]").forEach(b=> b.addEventListener("click", ()=>{
      const d = DB.letterDrafts.get(b.dataset.openDraft);
      const t = LT.get(d.templateId);
      if(!t){ U.toast("Template no longer available.", {type:"danger"}); return; }
      activeTemplate = t; activeCat = t.category==="pm"||t.category==="contractor" ? t.category : activeCat;
      selectedProjectId = d.projectId;
      renderCatTabs(); renderTemplateList(); renderProjectSelect(); renderEditor();
      document.querySelectorAll("#ltFieldsCard [data-lf]").forEach(el=>{ if(d.fields && d.fields[el.dataset.lf]!=null) el.value = d.fields[el.dataset.lf]; });
      if(d.fields && d.fields.letterDate) document.getElementById("ltDate").value = d.fields.letterDate;
      renderPreview();
      U.toast("Draft loaded — continue editing below.", {type:"success"});
      window.scrollTo({top:0, behavior:"smooth"});
    }));
    document.querySelectorAll("[data-rm-draft]").forEach(b=> b.addEventListener("click", ()=>{
      if(!confirm("Delete this saved draft?")) return;
      DB.letterDrafts.remove(b.dataset.rmDraft); renderDrafts();
    }));
  }
  document.getElementById("ltSaveDraftBtn").addEventListener("click", ()=>{
    if(!activeTemplate || !projects.length) return;
    const f = gatherFields(activeTemplate);
    DB.letterDrafts.create({ ownerId:user.id, projectId:selectedProjectId, templateId:activeTemplate.id, fields:f });
    U.toast("Draft saved.", {type:"success"});
    renderDrafts();
  });

  /* ---------------- boot ---------------- */
  renderProjectSelect();
  renderCatTabs();
  renderTemplateList();
  renderDrafts();

  SW.UI.helpSection(document.querySelector(".app-content"), "Letter Templates", [
    "Over 20 professional, pre-formatted construction letters — Notice to Proceed, Site Handover, Show Cause, Warning, Notice of Default, Suspension, Termination, EOT response, Liquidated Damages recovery, Completion Certificates, NOC for sub-letting, Insurance reminder (Project Manager side); EOT covering letter, Rate Analysis submission, Material approval, Drawing request, Payment follow-up, Final Bill covering letter, Defect rectification, Joint measurement request (Contractor side); plus Force Majeure and a flexible General Covering Letter for anything else.",
    "Pick a project first — the letterhead, parties, Work Order/LOI reference and contract details are pulled in automatically. Fill in the template-specific fields (dates, amounts, reasons) and the preview updates live.",
    "Save Draft keeps your work for later — reopen it anytime from \"My Saved Drafts\" below. Print / Save PDF opens a clean, letterhead-formatted print view, consistent with every other document in SubletWorks."
  ]);
})();
