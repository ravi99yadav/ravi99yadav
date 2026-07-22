(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"spreadsheets" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, F = SW.Formula;

  const DEFAULT_ROWS = 30, DEFAULT_COLS = 12, DEFAULT_COL_W = 110, DEFAULT_ROW_H = 26;
  let doc = null;        // current workbook DB record (live object)
  let sheetIdx = 0;      // active sheet index
  let selKey = "A1";     // selected cell
  let selAnchor = "A1";  // anchor for shift-click range selection
  let selRange = null;   // {r1,c1,r2,c2} or null (single cell)
  let saveTimer = null;

  /* ---------------- persistence ---------------- */
  function newSheet(name){ return { name: name||"Sheet 1", rows: DEFAULT_ROWS, cols: DEFAULT_COLS, cells: {}, colW: {}, rowH: {} }; }
  function myDocs(){ return DB.spreadsheets.list(d=>d.ownerId===user.id).sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt)); }
  function sheet(){ return doc.sheets[sheetIdx]; }
  function cellOf(key, create){ let c = sheet().cells[key]; if(!c && create){ c = sheet().cells[key] = {}; } return c; }
  function colW(c){ const s=sheet(); return (s.colW && s.colW[c]) || DEFAULT_COL_W; }
  function rowH(r){ const s=sheet(); return (s.rowH && s.rowH[r]) || DEFAULT_ROW_H; }
  function setColW(c,w){ const s=sheet(); if(!s.colW) s.colW={}; s.colW[c]=Math.max(36, Math.round(w)); }
  function setRowH(r,h){ const s=sheet(); if(!s.rowH) s.rowH={}; s.rowH[r]=Math.max(20, Math.round(h)); }

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
    td.classList.toggle("wrapped", !!s.wrap);
    td.classList.toggle("has-formula", !!(c && typeof c.v==="string" && c.v[0]==="="));
  }
  function renderGrid(){
    const s = sheet(), resolve = buildResolver();
    let html = `<table class="ss-grid"><colgroup><col class="ss-corner-col">`;
    for(let c=0;c<s.cols;c++) html += `<col data-colw="${c}" style="width:${colW(c)}px">`;
    html += `</colgroup><thead><tr><th class="ss-corner"></th>`;
    for(let c=0;c<s.cols;c++) html += `<th class="ss-colhead" data-col="${c}">${F.idxToCol(c)}<span class="ss-col-resize" data-col="${c}" title="Drag to resize · double-click to auto-fit"></span></th>`;
    html += `</tr></thead><tbody>`;
    for(let r=0;r<s.rows;r++){
      html += `<tr style="height:${rowH(r)}px"><th class="ss-rowhead" data-row="${r}">${r+1}<span class="ss-row-resize" data-row="${r}" title="Drag to resize row"></span></th>`;
      for(let c=0;c<s.cols;c++){
        const key = F.cellKey(r,c);
        html += `<td class="ss-cell" data-key="${key}" data-c="${c}" tabindex="-1"></td>`;
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
      td.addEventListener("mousedown", e=>{ if(e.shiftKey){ e.preventDefault(); extendRange(td.dataset.key); } });
    });
    wrap.querySelectorAll(".ss-colhead").forEach(th=> th.addEventListener("click", e=>{ if(!e.target.classList.contains("ss-col-resize")) selectColumn(+th.dataset.col); }));
    wrap.querySelectorAll(".ss-col-resize").forEach(h=> attachColResize(h));
    wrap.querySelectorAll(".ss-row-resize").forEach(h=> attachRowResize(h));
    selectCell(selKey, false); highlightRange();
  }

  /* ---- column / row resize + auto-fit ---- */
  function attachColResize(handle){
    const c = +handle.dataset.col;
    handle.addEventListener("mousedown", e=>{
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = colW(c);
      const colEl = document.querySelector(`#gridWrap col[data-colw="${c}"]`);
      function mm(ev){ const w = Math.max(36, startW + (ev.clientX-startX)); if(colEl) colEl.style.width = w+"px"; }
      function mu(ev){ document.removeEventListener("mousemove",mm); document.removeEventListener("mouseup",mu); setColW(c, Math.max(36, startW + (ev.clientX-startX))); markSaving(); }
      document.addEventListener("mousemove",mm); document.addEventListener("mouseup",mu);
    });
    handle.addEventListener("dblclick", e=>{ e.preventDefault(); e.stopPropagation(); autoFitCol(c); });
  }
  function attachRowResize(handle){
    const r = +handle.dataset.row;
    handle.addEventListener("mousedown", e=>{
      e.preventDefault(); e.stopPropagation();
      const startY = e.clientY, startH = rowH(r), tr = handle.closest("tr");
      function mm(ev){ const h = Math.max(20, startH + (ev.clientY-startY)); if(tr) tr.style.height = h+"px"; }
      function mu(ev){ document.removeEventListener("mousemove",mm); document.removeEventListener("mouseup",mu); setRowH(r, Math.max(20, startH + (ev.clientY-startY))); markSaving(); }
      document.addEventListener("mousemove",mm); document.addEventListener("mouseup",mu);
    });
  }
  function autoFitCol(c){
    const meas = document.createElement("span");
    meas.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-size:13px;padding:0 6px;font-family:inherit;";
    document.body.appendChild(meas);
    let max = 48;
    meas.textContent = F.idxToCol(c); max = Math.max(max, meas.offsetWidth + 26);
    document.querySelectorAll(`#gridWrap .ss-cell[data-c="${c}"]`).forEach(td=>{ meas.textContent = td.textContent||""; const w = meas.offsetWidth + 20; if(w>max) max=w; });
    document.body.removeChild(meas);
    setColW(c, Math.min(Math.max(max,48), 460)); markSaving(); renderGrid();
  }

  /* ---- range selection (shift-click) ---- */
  function extendRange(key){
    const a = F.parseRef(selAnchor), b = F.parseRef(key);
    if(!a || !b) return;
    selRange = { r1:Math.min(a.row,b.row), c1:Math.min(a.col,b.col), r2:Math.max(a.row,b.row), c2:Math.max(a.col,b.col) };
    highlightRange();
    document.getElementById("cellRef").textContent = `${F.cellKey(selRange.r1,selRange.c1)}:${F.cellKey(selRange.r2,selRange.c2)}`;
  }
  function highlightRange(){
    document.querySelectorAll("#gridWrap .ss-cell.in-range").forEach(td=>td.classList.remove("in-range"));
    if(!selRange) return;
    for(let r=selRange.r1;r<=selRange.r2;r++) for(let c=selRange.c1;c<=selRange.c2;c++){
      const td = document.querySelector(`#gridWrap .ss-cell[data-key="${F.cellKey(r,c)}"]`); if(td) td.classList.add("in-range");
    }
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
    selKey = key; selAnchor = key; selRange = null; highlightRange();
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
    document.querySelector('[data-cmd="wrap"]')?.classList.toggle("active", !!s.wrap);
  }
  // Apply a style change to the selected range (or just the selected cell).
  function eachTargetKey(fn){
    if(selRange){ for(let r=selRange.r1;r<=selRange.r2;r++) for(let c=selRange.c1;c<=selRange.c2;c++) fn(F.cellKey(r,c)); }
    else fn(selKey);
  }
  function cmd(name){
    if(name==="add-row"){ sheet().rows++; markSaving(); renderGrid(); return; }
    if(name==="add-col"){ sheet().cols++; markSaving(); renderGrid(); return; }
    eachTargetKey(key=>{
      const s = styleOf(key, true);
      if(name==="bold") s.b = !s.b;
      else if(name==="italic") s.i = !s.i;
      else if(name==="align-left") s.a = s.a==="left"?"":"left";
      else if(name==="align-center") s.a = s.a==="center"?"":"center";
      else if(name==="align-right") s.a = s.a==="right"?"":"right";
      else if(name==="wrap") s.wrap = !s.wrap;
      else if(name==="clear-fmt"){ const c=sheet().cells[key]; if(c){ delete c.s; if(c.v==null) delete sheet().cells[key]; } }
    });
    markSaving();
    refreshDisplays(); highlightRange(); syncToolbar();
  }
  document.querySelectorAll(".ss-toolbar [data-cmd]").forEach(b=> b.addEventListener("mousedown", e=>{ e.preventDefault(); cmd(b.dataset.cmd); }));
  document.getElementById("fmtSelect").addEventListener("change", e=>{ eachTargetKey(k=>{ styleOf(k,true).fmt = e.target.value; }); markSaving(); refreshDisplays(); highlightRange(); });
  document.getElementById("textColor").addEventListener("input", e=>{ eachTargetKey(k=>{ styleOf(k,true).color = e.target.value; const td=tdFor(k); if(td) applyStyle(td,k); }); markSaving(); highlightRange(); });
  document.getElementById("fillColor").addEventListener("input", e=>{ eachTargetKey(k=>{ styleOf(k,true).bg = e.target.value; const td=tdFor(k); if(td) applyStyle(td,k); }); markSaving(); highlightRange(); });

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
  document.getElementById("printSelBtn").addEventListener("click", printSelection);
  function printRegion(r1,c1,r2,c2, suffix){
    const s=sheet(), resolve=buildResolver();
    let head=`<tr><th></th>`; for(let c=c1;c<=c2;c++) head+=`<th>${F.idxToCol(c)}</th>`; head+=`</tr>`;
    let rows="";
    for(let r=r1;r<=r2;r++){
      rows+=`<tr><th>${r+1}</th>`;
      for(let c=c1;c<=c2;c++){
        const key=F.cellKey(r,c), cell=s.cells[key], st=cell&&cell.s?cell.s:{};
        const style=[st.b?"font-weight:700":"",st.i?"font-style:italic":"",st.a?("text-align:"+st.a):"",st.color?("color:"+st.color):"",st.bg?("background:"+st.bg):"",st.wrap?"white-space:normal":"white-space:nowrap"].filter(Boolean).join(";");
        rows+=`<td style="${style}">${U.escapeHtml(displayVal(key,resolve))}</td>`;
      }
      rows+=`</tr>`;
    }
    const body=`<div class="title">${U.escapeHtml(doc.name)} — ${U.escapeHtml(s.name)}${suffix?` <span style="font-weight:400;font-size:13px">(${U.escapeHtml(suffix)})</span>`:""}</div>
      <table class="ssp">${head}${rows}</table>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
    SW.UI.printDocument(`${doc.name} — ${s.name}`, body, {landscape:true});
  }
  function printSheet(){
    const s=sheet();
    let maxR=0, maxC=0;
    Object.keys(s.cells).forEach(k=>{ const p=F.parseRef(k); if(p && (s.cells[k].v!=null)){ maxR=Math.max(maxR,p.row); maxC=Math.max(maxC,p.col); } });
    printRegion(0,0,maxR,maxC,"");
  }
  function printSelection(){
    if(!selRange){ U.toast("Select an area first — click a cell, then Shift-click another to mark the range.", {type:"danger"}); return; }
    const {r1,c1,r2,c2} = selRange;
    printRegion(r1,c1,r2,c2, `Selected area ${F.cellKey(r1,c1)}:${F.cellKey(r2,c2)}`);
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
