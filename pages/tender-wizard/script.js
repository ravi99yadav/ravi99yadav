(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"tender-wizard" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  let tender = editId ? DB.tenders.get(editId) : null;
  let boqRows = tender ? DB.boqItems.list(i=>i.tenderId===tender.id).map(r=>({description:r.description, unit:r.unit, qty:r.qty})) : [
    { description:"", unit:"Cum", qty:"" }
  ];
  let files = tender ? (tender.drawings||[]) : [];
  let milestones = tender ? (tender.milestones||[]) : [];
  let boqMode = tender ? (tender.boqMode||"full") : "full";
  let currentStep = 1;

  const ITEM_LIBRARY = [
    {description:"Excavation in ordinary soil", unit:"Cum"},
    {description:"PCC 1:4:8 in foundation", unit:"Cum"},
    {description:"RCC M25 in columns including formwork", unit:"Cum"},
    {description:"RCC M25 in beams & slabs including formwork", unit:"Cum"},
    {description:"TMT Fe500 reinforcement steel", unit:"MT"},
    {description:"Brickwork in superstructure 1:6", unit:"Cum"},
    {description:"Internal plastering 12mm thick", unit:"Sqm"},
    {description:"Flooring – vitrified tiles", unit:"Sqm"},
    {description:"Painting – 2 coats emulsion", unit:"Sqm"},
    {description:"Electrical conduit wiring", unit:"Point"}
  ];

  // ---------- Prefill (edit mode) ----------
  if(tender){
    document.getElementById("fTitle").value = tender.title||"";
    document.getElementById("fWorkType").value = tender.workType||"Civil";
    document.getElementById("fDistrict").value = tender.district||"";
    document.getElementById("fState").value = tender.state||"";
    document.getElementById("fDescription").value = tender.description||"";
    document.getElementById("fStartDate").value = tender.startDate||"";
    document.getElementById("fEndDate").value = tender.endDate||"";
    document.getElementById("fDeadline").value = tender.bidSubmissionDeadline||"";
    document.getElementById("fEstValue").value = tender.estimatedValue||"";
    document.getElementById("fPaymentTerms").value = tender.paymentTerms||"";
    document.getElementById("fRetention").value = tender.retentionPct ?? 5;
    document.getElementById("fBG").value = tender.bgRequiredPct ?? 5;
    document.getElementById("fSD").value = tender.securityDepositPct ?? 3;
    document.getElementById("fTechSpec").value = tender.techSpec||"";
    U.qsa("[data-boqmode]").forEach(b=> b.classList.toggle("active", b.dataset.boqmode===boqMode));
  }

  // ---------- Duplicate detection ----------
  function checkDuplicate(){
    const title = document.getElementById("fTitle").value.trim().toLowerCase();
    const district = document.getElementById("fDistrict").value.trim().toLowerCase();
    const workType = document.getElementById("fWorkType").value;
    if(!title) return;
    const words = new Set(title.split(/\s+/).filter(w=>w.length>3));
    const others = DB.tenders.list(t=> t.pmId===user.id && t.id!==(tender&&tender.id) && !t.archived);
    const dup = others.find(t=>{
      if(t.district.toLowerCase()!==district || t.workType!==workType) return false;
      const oWords = new Set(t.title.toLowerCase().split(/\s+/).filter(w=>w.length>3));
      const overlap = [...words].filter(w=>oWords.has(w)).length;
      return overlap >= Math.min(2, words.size);
    });
    const banner = document.getElementById("duplicateBanner");
    if(dup){
      banner.classList.remove("hidden");
      banner.innerHTML = `⚠️ This looks similar to your existing tender <b>"${U.escapeHtml(dup.title)}"</b> (${dup.status}). <a href="../pm-tenders/index.html">Review your tenders</a> to avoid duplicate floats.`;
    } else banner.classList.add("hidden");
  }
  document.getElementById("fTitle").addEventListener("input", U.debounce(checkDuplicate,300));
  document.getElementById("fDistrict").addEventListener("input", U.debounce(checkDuplicate,300));

  // ---------- BOQ mode toggle ----------
  U.qsa("[data-boqmode]").forEach(btn=> btn.addEventListener("click", ()=>{
    U.qsa("[data-boqmode]").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    boqMode = btn.dataset.boqmode;
  }));

  // ---------- BOQ table ----------
  function renderBoq(){
    const tbody = document.getElementById("boqTbody");
    tbody.innerHTML = boqRows.map((r,idx)=>`
      <tr data-idx="${idx}">
        <td>${idx+1}</td>
        <td contenteditable="true" data-field="description">${U.escapeHtml(r.description)}</td>
        <td contenteditable="true" data-field="unit">${U.escapeHtml(r.unit)}</td>
        <td contenteditable="true" data-field="qty">${U.escapeHtml(r.qty)}</td>
        <td><button class="btn btn-icon btn-ghost" data-remove-row title="Remove">🗑</button></td>
      </tr>`).join("");
    document.getElementById("boqCount").textContent = boqRows.filter(r=>r.description.trim()).length + " items";
  }
  document.getElementById("addRowBtn").addEventListener("click", ()=>{ boqRows.push({description:"",unit:"Cum",qty:""}); renderBoq(); });
  document.getElementById("boqTbody").addEventListener("click", e=>{
    if(e.target.closest("[data-remove-row]")){
      const idx = +e.target.closest("tr").dataset.idx;
      boqRows.splice(idx,1); if(!boqRows.length) boqRows.push({description:"",unit:"Cum",qty:""});
      renderBoq();
    }
  });
  document.getElementById("boqTbody").addEventListener("blur", e=>{
    const td = e.target.closest("td[data-field]");
    if(!td) return;
    const idx = +td.closest("tr").dataset.idx;
    boqRows[idx][td.dataset.field] = td.textContent.trim();
  }, true);

  // Excel/TSV paste directly into table
  document.getElementById("boqTbody").addEventListener("paste", e=>{
    const td = e.target.closest("td[data-field]");
    if(!td) return;
    const text = (e.clipboardData||window.clipboardData).getData("text");
    if(!text.includes("\t") && !text.includes("\n")) return; // let normal single-cell paste happen
    e.preventDefault();
    const grid = U.parsePastedTable(text);
    const startRow = +td.closest("tr").dataset.idx;
    const fields = ["description","unit","qty"];
    let startFieldIdx = fields.indexOf(td.dataset.field);
    grid.forEach((row, rOff)=>{
      const rIdx = startRow + rOff;
      while(boqRows.length<=rIdx) boqRows.push({description:"",unit:"Cum",qty:""});
      row.forEach((cell, cOff)=>{
        const fIdx = startFieldIdx + cOff;
        if(fIdx>=0 && fIdx<fields.length) boqRows[rIdx][fields[fIdx]] = cell.trim();
      });
    });
    renderBoq();
    U.toast(`Pasted ${grid.length} row(s) from clipboard.`, {type:"success"});
  });

  // CSV import
  document.getElementById("csvImportInput").addEventListener("change", e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const grid = U.parsePastedTable(reader.result.replace(/,/g,"\t"));
      boqRows = grid.filter(r=>r.length>=2).map(r=>({description:r[0]||r[1]||"", unit:r[2]||r[1]||"Nos", qty:r[3]||r[2]||""}));
      if(!boqRows.length) boqRows=[{description:"",unit:"Cum",qty:""}];
      renderBoq();
      U.toast("CSV imported into BOQ table.", {type:"success"});
    };
    reader.readAsText(file);
  });

  // Item library quick add
  document.getElementById("addItemLibraryBtn").addEventListener("click", ()=>{
    const modal = document.createElement("div");
    modal.className="modal-overlay open";
    modal.innerHTML = `<div class="modal"><div class="modal-head"><h3>Item Library</h3><button class="btn-icon" id="closeLib">✕</button></div>
      <div class="modal-body">${ITEM_LIBRARY.map((it,i)=>`<label class="checkbox-row mb-2"><input type="checkbox" data-lib="${i}"> ${it.description} (${it.unit})</label>`).join("")}</div>
      <div class="modal-foot"><button class="btn btn-primary" id="addLibItems">Add Selected</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector("#closeLib").addEventListener("click", ()=>modal.remove());
    modal.addEventListener("click", e=>{ if(e.target===modal) modal.remove(); });
    modal.querySelector("#addLibItems").addEventListener("click", ()=>{
      const checked = U.qsa("[data-lib]:checked", modal);
      if(boqRows.length===1 && !boqRows[0].description) boqRows=[];
      checked.forEach(c=> boqRows.push(Object.assign({qty:""}, ITEM_LIBRARY[+c.dataset.lib])));
      if(!boqRows.length) boqRows.push({description:"",unit:"Cum",qty:""});
      renderBoq(); modal.remove();
      U.toast(`${checked.length} item(s) added from library.`, {type:"success"});
    });
  });
  renderBoq();

  // ---------- Files ----------
  function renderFiles(){
    document.getElementById("fileList").innerHTML = files.map((f,idx)=>`<span class="file-chip">📄 ${U.escapeHtml(f.name)} <small>${f.size}</small> <button data-rm-file="${idx}" class="btn-icon" style="width:18px;height:18px;padding:0">✕</button></span>`).join("") || `<span class="text-muted" style="font-size:13px">No files uploaded yet.</span>`;
  }
  const dropzone = document.getElementById("dropzone");
  dropzone.addEventListener("click", ()=> document.getElementById("fileInput").click());
  ["dragover","dragleave","drop"].forEach(evt=> dropzone.addEventListener(evt, e=>{
    e.preventDefault();
    dropzone.classList.toggle("dragover", evt==="dragover");
    if(evt==="drop") handleFiles(e.dataTransfer.files);
  }));
  document.getElementById("fileInput").addEventListener("change", e=> handleFiles(e.target.files));
  function handleFiles(fileList){
    Array.from(fileList).forEach(f=> files.push({name:f.name, size:(f.size/1024).toFixed(0)+" KB"}));
    renderFiles();
  }
  document.getElementById("fileList").addEventListener("click", e=>{
    const btn = e.target.closest("[data-rm-file]"); if(!btn) return;
    files.splice(+btn.dataset.rmFile,1); renderFiles();
  });
  renderFiles();

  // ---------- Milestones ----------
  function renderMilestones(){
    document.getElementById("milestoneList").innerHTML = milestones.map((m,idx)=>`
      <div class="milestone-row">
        <input class="input" placeholder="Milestone name" value="${U.escapeHtml(m.name||"")}" data-ms="${idx}" data-msfield="name">
        <input class="input" type="date" value="${m.date||""}" data-ms="${idx}" data-msfield="date">
        <button class="btn btn-icon btn-ghost" data-rm-ms="${idx}">🗑</button>
      </div>`).join("") || `<p class="text-muted" style="font-size:13px">No milestones added yet.</p>`;
  }
  document.getElementById("addMilestoneBtn").addEventListener("click", ()=>{ milestones.push({name:"",date:""}); renderMilestones(); });
  document.getElementById("milestoneList").addEventListener("input", e=>{
    const idx = e.target.dataset.ms; if(idx===undefined) return;
    milestones[idx][e.target.dataset.msfield] = e.target.value;
  });
  document.getElementById("milestoneList").addEventListener("click", e=>{
    const btn = e.target.closest("[data-rm-ms]"); if(!btn) return;
    milestones.splice(+btn.dataset.rmMs,1); renderMilestones();
  });
  renderMilestones();

  // ---------- Step navigation ----------
  function showStep(n){
    currentStep = n;
    U.qsa(".step").forEach(s=> s.classList.toggle("active", +s.dataset.step===n));
    U.qsa(".step-panel").forEach(p=> p.classList.toggle("hidden", +p.dataset.panel!==n));
    document.getElementById("backBtn").classList.toggle("hidden", n===1);
    document.getElementById("nextBtn").classList.toggle("hidden", n===5);
    document.getElementById("publishBtn").classList.toggle("hidden", n!==5);
    if(n===5) renderReview();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function renderReview(){
    const items = boqRows.filter(r=>r.description.trim());
    document.getElementById("reviewSummary").innerHTML = `
      <div class="review-row"><span>Title</span><b>${U.escapeHtml(document.getElementById("fTitle").value)}</b></div>
      <div class="review-row"><span>Location</span><b>${U.escapeHtml(document.getElementById("fDistrict").value)}, ${U.escapeHtml(document.getElementById("fState").value)}</b></div>
      <div class="review-row"><span>Work Type</span><b>${document.getElementById("fWorkType").value}</b></div>
      <div class="review-row"><span>BOQ Items</span><b>${boqMode==="lumpsum-only" ? "Lump Sum (no item BOQ)" : items.length+" items"}</b></div>
      <div class="review-row"><span>Bid Deadline</span><b>${U.fmtDate(document.getElementById("fDeadline").value)}</b></div>
      <div class="review-row"><span>Estimated Value</span><b>${U.fmtINR(document.getElementById("fEstValue").value)}</b></div>
      <div class="review-row"><span>Retention / BG / SD</span><b>${document.getElementById("fRetention").value}% / ${document.getElementById("fBG").value}% / ${document.getElementById("fSD").value}%</b></div>
      <div class="review-row"><span>Drawings</span><b>${files.length} file(s)</b></div>
      <div class="review-row"><span>Milestones</span><b>${milestones.filter(m=>m.name).length}</b></div>
      <p class="hint mt-3">Publishing will notify contractors in ${U.escapeHtml(document.getElementById("fDistrict").value)} whose trade matches "${document.getElementById("fWorkType").value}".</p>`;
  }

  document.getElementById("nextBtn").addEventListener("click", ()=>{
    if(currentStep===1){
      const panel = document.querySelector('[data-panel="1"]');
      if(!U.validateForm(panel)) return;
    }
    if(currentStep===2 && boqMode!=="lumpsum-only" && !boqRows.some(r=>r.description.trim())){
      U.toast("Add at least one BOQ item, or switch to Lump Sum Only.", {type:"danger"}); return;
    }
    showStep(Math.min(5,currentStep+1));
  });
  document.getElementById("backBtn").addEventListener("click", ()=> showStep(Math.max(1,currentStep-1)));
  U.qsa(".step").forEach(s=> s.addEventListener("click", ()=> showStep(+s.dataset.step)));

  // ---------- Save / Publish ----------
  function collectTenderData(status){
    return {
      pmId:user.id, title:document.getElementById("fTitle").value.trim()||"Untitled Tender",
      workType:document.getElementById("fWorkType").value, district:document.getElementById("fDistrict").value.trim(),
      state:document.getElementById("fState").value.trim(), description:document.getElementById("fDescription").value.trim(),
      startDate:document.getElementById("fStartDate").value, endDate:document.getElementById("fEndDate").value,
      bidSubmissionDeadline:document.getElementById("fDeadline").value, estimatedValue:+document.getElementById("fEstValue").value||0,
      paymentTerms:document.getElementById("fPaymentTerms").value.trim(), retentionPct:+document.getElementById("fRetention").value||0,
      bgRequiredPct:+document.getElementById("fBG").value||0, securityDepositPct:+document.getElementById("fSD").value||0,
      techSpec:document.getElementById("fTechSpec").value.trim(), drawings:files, milestones:milestones.filter(m=>m.name),
      boqMode, status, published: status==="published", publishedAt: status==="published" ? SW.DB.nowISO() : null
    };
  }

  function persistBoq(tenderId){
    DB.boqItems.list(i=>i.tenderId===tenderId).forEach(i=> DB.boqItems.remove(i.id));
    boqRows.filter(r=>r.description.trim()).forEach((r,idx)=> DB.boqItems.create({ tenderId, srNo:idx+1, description:r.description, unit:r.unit||"Nos", qty:+r.qty||0 }));
  }

  function saveTender(status){
    const data = collectTenderData(status);
    if(tender){ DB.tenders.update(tender.id, data); }
    else { tender = DB.tenders.create(data); }
    persistBoq(tender.id);
    return tender;
  }

  document.getElementById("saveDraftBtn").addEventListener("click", ()=>{
    if(!document.getElementById("fTitle").value.trim()){ U.toast("Give the tender a title before saving.", {type:"danger"}); return; }
    const t = saveTender("draft");
    U.toast("Draft saved. You can continue anytime from \"My Tenders\".", {title:"Saved", type:"success"});
    history.replaceState(null,"", "?id="+t.id);
  });

  document.getElementById("publishBtn").addEventListener("click", ()=>{
    const t = saveTender("published");
    // Notify matching contractors
    const matches = DB.companies.list(c=> (c.trades||[]).includes(t.workType) && (c.district||"").toLowerCase()===t.district.toLowerCase());
    matches.forEach(c=> DB.notifications.create({ userId:c.ownerId, title:"New tender in your area", body:`"${t.title}" — ${t.workType} work in ${t.district}. Bid deadline ${U.fmtDate(t.bidSubmissionDeadline)}.`, read:false, link:"/pages/tender-detail/index.html?id="+t.id }));
    U.confetti();
    U.toast(`Tender published! ${matches.length} matching contractor(s) notified.`, {title:"🎉 Live", type:"success", duration:5000});
    setTimeout(()=> location.href = "../pm-tenders/index.html", 1200);
  });

  SW.UI.helpSection(document.querySelector(".app-content"), "Tender Wizard", [
    "Step 1 captures project basics. Step 2 lets you paste a BOQ straight from Excel/Google Sheets, import a CSV, or add from the common item library.",
    "Choose \"Lump Sum Only\" in Step 1 if you don't want to break the work into item-wise quantities.",
    "SubletWorks warns you if a similar tender already exists for the same district & trade to prevent duplicate floats.",
    "You can save as draft at any step and come back later from \"My Tenders\".",
    "Publishing instantly notifies contractors registered in the matching district & trade."
  ]);

  if(tender) checkDuplicate();
})();
