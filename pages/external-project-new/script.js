(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"project-workspace" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  let boqRows = [{ description:"", unit:"Cum", qty:"", rate:"" }];

  function renderBoq(){
    document.getElementById("boqTbody").innerHTML = boqRows.map((r,idx)=>`
      <tr data-idx="${idx}">
        <td>${idx+1}</td>
        <td contenteditable="true" data-field="description">${U.escapeHtml(r.description)}</td>
        <td contenteditable="true" data-field="unit">${U.escapeHtml(r.unit)}</td>
        <td contenteditable="true" data-field="qty">${U.escapeHtml(r.qty)}</td>
        <td contenteditable="true" data-field="rate">${U.escapeHtml(r.rate)}</td>
        <td><button class="btn btn-icon btn-ghost" data-remove-row title="Remove">🗑</button></td>
      </tr>`).join("");
  }
  renderBoq();

  document.getElementById("addRowBtn").addEventListener("click", ()=>{ boqRows.push({description:"",unit:"Cum",qty:"",rate:""}); renderBoq(); });
  document.getElementById("boqTbody").addEventListener("click", e=>{
    if(e.target.closest("[data-remove-row]")){
      const idx = +e.target.closest("tr").dataset.idx;
      boqRows.splice(idx,1); if(!boqRows.length) boqRows.push({description:"",unit:"Cum",qty:"",rate:""});
      renderBoq();
    }
  });
  document.getElementById("boqTbody").addEventListener("blur", e=>{
    const td = e.target.closest("td[data-field]"); if(!td) return;
    const idx = +td.closest("tr").dataset.idx;
    boqRows[idx][td.dataset.field] = td.textContent.trim();
  }, true);
  document.getElementById("boqTbody").addEventListener("paste", e=>{
    const td = e.target.closest("td[data-field]"); if(!td) return;
    const text = (e.clipboardData||window.clipboardData).getData("text");
    if(!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = U.parsePastedTable(text);
    const startRow = +td.closest("tr").dataset.idx;
    const fields = ["description","unit","qty","rate"];
    const startFieldIdx = fields.indexOf(td.dataset.field);
    grid.forEach((row, rOff)=>{
      const rIdx = startRow + rOff;
      while(boqRows.length<=rIdx) boqRows.push({description:"",unit:"Cum",qty:"",rate:""});
      row.forEach((cell, cOff)=>{
        const fIdx = startFieldIdx + cOff;
        if(fIdx>=0 && fIdx<fields.length) boqRows[rIdx][fields[fIdx]] = cell.trim();
      });
    });
    renderBoq();
    U.toast(`Pasted ${grid.length} row(s) from clipboard.`, {type:"success"});
  });

  document.getElementById("lumpsumToggle").addEventListener("change", e=>{
    document.getElementById("boqSection").classList.toggle("hidden", e.target.checked);
  });

  document.getElementById("createBtn").addEventListener("click", ()=>{
    if(!U.validateForm(document.querySelector(".app-content"))) return;
    const isLumpsum = document.getElementById("lumpsumToggle").checked;
    const project = DB.projects.create({
      name: document.getElementById("fName").value.trim(),
      external: true,
      externalContractorName: document.getElementById("fContractorName").value.trim(),
      externalContractorPhone: document.getElementById("fContractorPhone").value.trim(),
      externalContractorEmail: document.getElementById("fContractorEmail").value.trim(),
      pmId: user.id, contractorId: null, tenderId: null, workOrderId: null,
      district: document.getElementById("fDistrict").value.trim(), state: document.getElementById("fState").value.trim(),
      startDate: document.getElementById("fStart").value, endDate: document.getElementById("fEnd").value,
      contractValue: +document.getElementById("fContractValue").value||0,
      paymentTerms: document.getElementById("fPaymentTerms").value.trim(),
      status: "running", progressPct: 0
    });
    if(!isLumpsum){
      boqRows.filter(r=>r.description.trim()).forEach((r,idx)=> DB.boqItems.create({
        projectId: project.id, srNo: idx+1, description: r.description, unit: r.unit||"Nos", qty: +r.qty||0, rate: +r.rate||0
      }));
    }
    U.toast("External project created.", {title:"Success", type:"success"});
    setTimeout(()=> location.href = "../project-workspace/index.html?id="+project.id, 500);
  });

  SW.UI.helpSection(document.querySelector(".app-content"), "External Projects", [
    "Use this when you already have a contractor lined up outside SubletWorks and just want the planning, MB Sheet, RA Billing, DPR and Hindrance tools — no tender or bidding needed.",
    "The BOQ here includes a Rate column (unlike tender BOQs, where the rate comes from the accepted bid) since there's no bid to pull rates from.",
    "Toggle \"lump sum contract\" if you don't want to track an item-wise BOQ — RA Bills for this project will then use a simple manual claim amount.",
    "External contractor details are free text — they are not a SubletWorks user account, so contact-unlock and in-app bidding don't apply here."
  ]);
})();
