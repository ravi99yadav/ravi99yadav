(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"spreadsheets" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, F = SW.Formula;

  const DEFAULT_ROWS = 30, DEFAULT_COLS = 12;
  let doc = null;        // current workbook DB record (live object)
  let sheetIdx = 0;      // active sheet index
  let selKey = "A1";     // selected cell
  let saveTimer = null;

  /* ---------------- persistence ---------------- */
  function newSheet(name){ return { name: name||"Sheet 1", rows: DEFAULT_ROWS, cols: DEFAULT_COLS, cells: {} }; }
  function myDocs(){ return DB.spreadsheets.list(d=>d.ownerId===user.id).sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt)); }
  function sheet(){ return doc.sheets[sheetIdx]; }
  function cellOf(key, create){ let c = sheet().cells[key]; if(!c && create){ c = sheet().cells[key] = {}; } return c; }

  function flushSave(){
    if(!doc) return;
    clearTimeout(saveTimer); saveTimer = null;
    DB.spreadsheets.update(doc.id, { name:doc.name, sheets:doc.sheets });
    const tag = document.getElementById("savedTag");
    if(tag){ tag.textContent = "Saved"; tag.classList.remove("saving"); }
  }
  function markSaving(){
    const tag = document.getElementById("savedTag");
    tag.textContent = "Saving…"; tag.classList.add("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }
  // Never lose edits to the debounce window when navigating away / switching tabs.
  window.addEventListener("beforeunload", ()=>{ if(saveTimer) flushSave(); });
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden && saveTimer) flushSave(); });

  /* ---------------- workbook / sheet chrome ---------------- */
  function renderDocSelect(){
    const docs = myDocs();
    const sel = document.getElementById("docSelect");
    sel.innerHTML = docs.map(d=>`<option value="${d.id}" ${doc&&d.id===doc.id?"selected":""}>${U.escapeHtml(d.name)}</option>`).join("");
    document.getElementById("emptyState").classList.toggle("hidden", docs.length>0);
    document.getElementById("editorWrap").classList.toggle("hidden", docs.length===0);
    document.getElementById("fnHelp").classList.toggle("hidden", docs.length===0);
  }
  function renderSheetTabs(){
    const tabs = document.getElementById("sheetTabs");
    tabs.innerHTML = doc.sheets.map((s,i)=>`<button class="ss-sheet-tab ${i===sheetIdx?"active":""}" data-sheet="${i}">${U.escapeHtml(s.name)}</button>`).join("")
      + `<button class="ss-sheet-tab ss-add" id="addSheetBtn" title="Add sheet">＋</button>`;
    tabs.querySelectorAll("[data-sheet]").forEach(b=> b.addEventListener("click", ()=>{ sheetIdx=+b.dataset.sheet; selKey="A1"; renderSheetTabs(); renderGrid(); }));
    tabs.querySelectorAll("[data-sheet]").forEach(b=> b.addEventListener("dblclick", ()=>{
      const nm = prompt("Rename sheet:", doc.sheets[+b.dataset.sheet].name);
      if(nm && nm.trim()){ doc.sheets[+b.dataset.sheet].name = nm.trim(); markSaving(); renderSheetTabs(); }
    }));
    document.getElementById("addSheetBtn").addEventListener("click", ()=>{
      doc.sheets.push(newSheet("Sheet "+(doc.sheets.length+1)));
      sheetIdx = doc.sheets.length-1; selKey="A1"; markSaving(); renderSheetTabs(); renderGrid();
    });
  }

  /* ---------------- evaluation ---------------- */
  function isNumericStr(s){ s=String(s).trim(); return s!=="" && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s); }
  function buildResolver(){
    const cells = sheet().cells, cache={}, computing={};
    function resolve(key){
      if(key in cache) return cache[key];
      const c = cells[key];
      const raw = c && c.v!=null ? String(c.v) : "";
      const fmt = c && c.s ? c.s.fmt : null;
      if(fmt==="text"){ cache[key]=raw; return raw; }
      if(raw===""){ cache[key]=""; return ""; }
      if(raw[0]==="="){
        if(computing[key]) return "#CIRC!";
        computing[key]=true;
        const val = F.evaluate(raw.slice(1), resolve);
        delete computing[key];
        cache[key]=val; return val;
      }
      const v = isNumericStr(raw) ? Number(raw) : raw;
      cache[key]=v; return v;
    }
    return resolve;
  }
  function fmtNum(n, dec){ return n.toLocaleString("en-IN",{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
  function displayVal(key, resolve){
    const c = sheet().cells[key];
    const fmt = c && c.s ? (c.s.fmt||"general") : "general";
    let v = resolve(key);
    if(v==="") return "";
    if(F.isErr(v)) return v;
    if(fmt==="text") return String(v);
    const isNum = typeof v==="number";
    if(fmt==="currency") return isNum ? U.fmtINR(v) : String(v);
    if(fmt==="percent")  return isNum ? fmtNum(v*100,2)+"%" : String(v);
    if(fmt==="number")   return isNum ? fmtNum(v,2) : String(v);
    if(fmt==="integer")  return isNum ? fmtNum(Math.round(v),0) : String(v);
    if(typeof v==="boolean") return v?"TRUE":"FALSE";
    if(isNum){ return String(Math.round(v*1e10)/1e10); }
    return String(v);
  }

  /* ---------------- grid ---------------- */
  function applyStyle(td, key){
    const c = sheet().cells[key], s = c && c.s ? c.s : {};
    td.style.fontWeight = s.b ? "700" : "";
    td.style.fontStyle  = s.i ? "italic" : "";
    td.style.textAlign  = s.a || "";
    td.style.color      = s.color || "";
    td.style.background = s.bg || "";
    td.classList.toggle("has-formula", !!(c && typeof c.v==="string" && c.v[0]==="="));
  }
  function renderGrid(){
    const s = sheet(), resolve = buildResolver();
    let html = `<table class="ss-grid"><thead><tr><th class="ss-corner"></th>`;
    for(let c=0;c<s.cols;c++) html += `<th class="ss-colhead" data-col="${c}">${F.idxToCol(c)}</th>`;
    html += `</tr></thead><tbody>`;
    for(let r=0;r<s.rows;r++){
      html += `<tr><th class="ss-rowhead">${r+1}</th>`;
      for(let c=0;c<s.cols;c++){
        const key = F.cellKey(r,c);
        html += `<td class="ss-cell" data-key="${key}" tabindex="-1"></td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    const wrap = document.getElementById("gridWrap");
    wrap.innerHTML = html;
    // fill display + styles
    wrap.querySelectorAll(".ss-cell").forEach(td=>{
      const key = td.dataset.key;
      td.textContent = displayVal(key, resolve);
      applyStyle(td, key);
      td.contentEditable = "true";
      td.addEventListener("focus", ()=> onCellFocus(td));
      td.addEventListener("blur", ()=> onCellBlur(td));
      td.addEventListener("input", ()=>{ document.getElementById("formulaInput").value = td.textContent; });
      td.addEventListener("keydown", e=> onCellKey(e, td));
    });
    wrap.querySelectorAll(".ss-colhead").forEach(th=> th.addEventListener("click", ()=> selectColumn(+th.dataset.col)));
    selectCell(selKey, false);
  }
  function refreshDisplays(exceptKey){
    const resolve = buildResolver();
    document.querySelectorAll("#gridWrap .ss-cell").forEach(td=>{
      const key = td.dataset.key;
      applyStyle(td, key);
      if(key===exceptKey) return;
      td.textContent = displayVal(key, resolve);
    });
  }

  function tdFor(key){ return document.querySelector(`#gridWrap .ss-cell[data-key="${key}"]`); }
  function selectCell(key, focus){
    selKey = key;
    document.querySelectorAll("#gridWrap .ss-cell.selected").forEach(td=>td.classList.remove("selected"));
    const td = tdFor(key); if(!td) return;
    td.classList.add("selected");
    document.getElementById("cellRef").textContent = key;
    const c = sheet().cells[key];
    document.getElementById("formulaInput").value = c && c.v!=null ? String(c.v) : "";
    syncToolbar();
    if(focus) td.focus();
  }
  function selectColumn(c){ selectCell(F.cellKey(0,c), true); }

  function onCellFocus(td){
    const key = td.dataset.key;
    selectCell(key, false);
    const c = sheet().cells[key];
    td.textContent = c && c.v!=null ? String(c.v) : "";  // show raw for editing
    td.classList.add("editing");
  }
  function commit(td){
    const key = td.dataset.key;
    const raw = td.textContent.replace(/ /g," ").trim();
    const c = cellOf(key, true);
    if(raw==="") { if(c.v!=null) { delete c.v; } }
    else c.v = raw;
    if(c.v==null && !c.s) delete sheet().cells[key];
    markSaving();
  }
  function onCellBlur(td){
    td.classList.remove("editing");
    commit(td);
    refreshDisplays();
  }
  function onCellKey(e, td){
    const p = F.parseRef(td.dataset.key);
    if(e.key==="Enter"){ e.preventDefault(); td.blur(); const n=F.cellKey(Math.min(sheet().rows-1,p.row+1), p.col); selectCell(n,true); }
    else if(e.key==="Tab"){ e.preventDefault(); td.blur(); const n=F.cellKey(p.row, Math.min(sheet().cols-1,p.col+1)); selectCell(n,true); }
    else if(e.key==="Escape"){ e.preventDefault(); const c=sheet().cells[td.dataset.key]; td.textContent = c&&c.v!=null?String(c.v):""; td.blur(); }
  }

  /* ---------------- formula bar ---------------- */
  const formulaInput = document.getElementById("formulaInput");
  formulaInput.addEventListener("keydown", e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      const c = cellOf(selKey, true);
      const raw = formulaInput.value.trim();
      if(raw==="") { delete c.v; if(!c.s) delete sheet().cells[selKey]; }
      else c.v = raw;
      markSaving(); refreshDisplays();
      const p=F.parseRef(selKey); selectCell(F.cellKey(Math.min(sheet().rows-1,p.row+1),p.col), true);
    }
  });

  /* ---------------- toolbar ---------------- */
  function styleOf(key, create){ const c=cellOf(key, create); if(create && !c.s) c.s={}; return c.s || {}; }
  function syncToolbar(){
    const c = sheet().cells[selKey], s = c && c.s ? c.s : {};
    document.querySelector('[data-cmd="bold"]').classList.toggle("active", !!s.b);
    document.querySelector('[data-cmd="italic"]').classList.toggle("active", !!s.i);
    document.querySelectorAll('[data-cmd^="align-"]').forEach(b=> b.classList.toggle("active", ("align-"+(s.a||""))===b.dataset.cmd));
    document.getElementById("fmtSelect").value = s.fmt || "general";
    document.getElementById("textColor").value = s.color || "#111111";
    document.getElementById("fillColor").value = s.bg || "#ffffff";
  }
  function cmd(name){
    const s = styleOf(selKey, true);
    if(name==="bold") s.b = !s.b;
    else if(name==="italic") s.i = !s.i;
    else if(name==="align-left") s.a = s.a==="left"?"":"left";
    else if(name==="align-center") s.a = s.a==="center"?"":"center";
    else if(name==="align-right") s.a = s.a==="right"?"":"right";
    else if(name==="clear-fmt"){ const c=sheet().cells[selKey]; if(c){ delete c.s; if(c.v==null) delete sheet().cells[selKey]; } }
    else if(name==="add-row"){ sheet().rows++; markSaving(); renderGrid(); return; }
    else if(name==="add-col"){ sheet().cols++; markSaving(); renderGrid(); return; }
    markSaving();
    const td = tdFor(selKey); if(td) applyStyle(td, selKey);
    refreshDisplays(); syncToolbar();
  }
  document.querySelectorAll(".ss-toolbar [data-cmd]").forEach(b=> b.addEventListener("mousedown", e=>{ e.preventDefault(); cmd(b.dataset.cmd); }));
  document.getElementById("fmtSelect").addEventListener("change", e=>{ styleOf(selKey,true).fmt = e.target.value; markSaving(); refreshDisplays(); });
  document.getElementById("textColor").addEventListener("input", e=>{ styleOf(selKey,true).color = e.target.value; markSaving(); const td=tdFor(selKey); if(td) applyStyle(td,selKey); });
  document.getElementById("fillColor").addEventListener("input", e=>{ styleOf(selKey,true).bg = e.target.value; markSaving(); const td=tdFor(selKey); if(td) applyStyle(td,selKey); });

  /* ---------------- workbook actions ---------------- */
  function openDoc(id){ doc = DB.spreadsheets.get(id); if(!doc) return; sheetIdx=0; selKey="A1"; renderDocSelect(); renderSheetTabs(); renderGrid(); }
  function createDoc(){
    const name = (prompt("Workbook name:", "Untitled Workbook")||"").trim() || "Untitled Workbook";
    doc = DB.spreadsheets.create({ ownerId:user.id, name, sheets:[ newSheet("Sheet 1") ] });
    sheetIdx=0; selKey="A1"; renderDocSelect(); renderSheetTabs(); renderGrid();
  }
  document.getElementById("newDocBtn").addEventListener("click", createDoc);
  document.getElementById("createFirstBtn")?.addEventListener("click", createDoc);
  document.getElementById("docSelect").addEventListener("change", e=> openDoc(e.target.value));
  document.getElementById("renameDocBtn").addEventListener("click", ()=>{
    if(!doc) return; const nm=(prompt("Rename workbook:", doc.name)||"").trim(); if(!nm) return;
    doc.name = nm; DB.spreadsheets.update(doc.id, {name:nm}); renderDocSelect();
  });
  document.getElementById("deleteDocBtn").addEventListener("click", ()=>{
    if(!doc) return; if(!confirm(`Delete workbook "${doc.name}"? This cannot be undone.`)) return;
    DB.spreadsheets.remove(doc.id);
    const docs = myDocs();
    if(docs.length){ openDoc(docs[0].id); } else { doc=null; renderDocSelect(); }
    U.toast("Workbook deleted.", {type:"warning"});
  });

  /* ---------------- import / export / print ---------------- */
  document.getElementById("importCsvBtn").addEventListener("click", ()=>{ document.getElementById("importText").value=""; U.openModal("importModal"); });
  document.getElementById("importDoBtn").addEventListener("click", ()=>{
    const text = document.getElementById("importText").value;
    if(!text.trim()){ U.closeModal("importModal"); return; }
    const hasTab = text.indexOf("\t")>=0;
    const rows = text.replace(/\r/g,"").split("\n").filter(r=>r.length).map(r=> hasTab? r.split("\t") : r.split(","));
    const start = F.parseRef(selKey) || {row:0,col:0};
    let maxRow = start.row, maxCol = start.col;
    rows.forEach((cols,ri)=> cols.forEach((val,ci)=>{
      const r=start.row+ri, c=start.col+ci, key=F.cellKey(r,c);
      const cell = cellOf(key, true); cell.v = String(val).trim();
      maxRow=Math.max(maxRow,r); maxCol=Math.max(maxCol,c);
    }));
    if(maxRow+1 > sheet().rows) sheet().rows = maxRow+2;
    if(maxCol+1 > sheet().cols) sheet().cols = maxCol+2;
    markSaving(); U.closeModal("importModal"); renderGrid();
    U.toast(`Imported ${rows.length} row(s).`, {type:"success"});
  });
  document.getElementById("exportCsvBtn").addEventListener("click", ()=>{
    const s=sheet(), resolve=buildResolver(); const all=[];
    for(let r=0;r<s.rows;r++){ const row=[]; for(let c=0;c<s.cols;c++){ const v=resolve(F.cellKey(r,c)); row.push(v===""?"":v); } all.push(row); }
    // trim trailing empty rows/cols
    while(all.length && all[all.length-1].every(v=>v==="")) all.pop();
    U.exportCSV(`${doc.name}-${s.name}`, all.length?all[0]:[], all.slice(1));
  });
  document.getElementById("printBtn").addEventListener("click", printSheet);
  function printSheet(){
    const s=sheet(), resolve=buildResolver();
    // find used bounds
    let maxR=0, maxC=0;
    Object.keys(s.cells).forEach(k=>{ const p=F.parseRef(k); if(p && (s.cells[k].v!=null)){ maxR=Math.max(maxR,p.row); maxC=Math.max(maxC,p.col); } });
    let head=`<tr><th></th>`; for(let c=0;c<=maxC;c++) head+=`<th>${F.idxToCol(c)}</th>`; head+=`</tr>`;
    let rows="";
    for(let r=0;r<=maxR;r++){
      rows+=`<tr><th>${r+1}</th>`;
      for(let c=0;c<=maxC;c++){
        const key=F.cellKey(r,c), cell=s.cells[key], st=cell&&cell.s?cell.s:{};
        const style=[st.b?"font-weight:700":"",st.i?"font-style:italic":"",st.a?("text-align:"+st.a):"",st.color?("color:"+st.color):"",st.bg?("background:"+st.bg):""].filter(Boolean).join(";");
        rows+=`<td style="${style}">${U.escapeHtml(displayVal(key,resolve))}</td>`;
      }
      rows+=`</tr>`;
    }
    const body=`<div class="title">${U.escapeHtml(doc.name)} — ${U.escapeHtml(s.name)}</div>
      <table class="ssp">${head}${rows}</table>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
    SW.UI.printDocument(`${doc.name} — ${s.name}`, body, {landscape:true});
  }

  /* keyboard shortcuts */
  document.addEventListener("keydown", e=>{
    if((e.ctrlKey||e.metaKey) && !e.shiftKey){
      const k=e.key.toLowerCase();
      if(k==="b"){ e.preventDefault(); cmd("bold"); }
      else if(k==="i"){ e.preventDefault(); cmd("italic"); }
      else if(k==="s"){ e.preventDefault(); if(doc){ DB.spreadsheets.update(doc.id,{name:doc.name,sheets:doc.sheets}); U.toast("Saved.",{type:"success"}); } }
    }
  });

  /* ---------------- boot ---------------- */
  (function boot(){
    const docs = myDocs();
    if(docs.length){ openDoc(docs[0].id); }
    else { renderDocSelect(); }
  })();

  SW.UI.helpSection(document.querySelector(".app-content"), "Spreadsheets", [
    "Create multiple workbooks, each with multiple sheets — everything is saved to your account automatically as you type.",
    "Start any cell with = to write a formula: reference cells (A1), ranges (A1:A10) and use + - * / ^ % plus functions like SUM, AVERAGE, IF, ROUND, MIN, MAX, COUNT, PRODUCT and CONCAT.",
    "Format cells as Number, Integer, Currency (₹) or Percent, make them bold/italic, align them and set text/fill colours from the toolbar.",
    "Paste rows straight from Excel or Google Sheets via Import, export any sheet to CSV, or print a clean copy — ideal for estimates, BOQs, rate analysis and abstracts."
  ]);
})();
