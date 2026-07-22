/* ==========================================================================
   SUBLETWORKS.COM — Statutory Labour-Compliance Registers (per project)
   Consolidated registers per the "Ease of Compliance to Maintain Registers
   under various Labour Laws Rules, 2017" (Form A–E) plus Overtime, ESIC, EPF
   and Accident registers. Auto-filled from allotted team members + attendance,
   every cell editable, add-blank-row, reset, and print (filled OR blank).
   Exposes SW.Compliance.mount(container, { project, user }).
   ========================================================================== */
(function(global){
  "use strict";

  // Current statutory contribution rates (change here if rates are revised).
  const RATES = {
    esiEmployee: 0.0075, esiEmployer: 0.0325, esiWageCeiling: 21000,   // ESI: 0.75% / 3.25%, applicable up to ₹21,000/month
    epfEmployee: 0.12, epfEmployer: 0.12, epsShare: 0.0833, epsCeiling: 15000 // EPF 12% + 12% (EPS 8.33% capped at ₹15,000)
  };
  const ATT_FACTOR = { present:1, half:0.5, overtime:1.5, absent:0 };
  const ATT_MARK   = { present:"P", half:"H", overtime:"OT", absent:"A" };

  function mount(container, ctx){
    const DB = global.SW.DB, U = global.SW.Utils;
    const project = ctx.project, user = ctx.user;
    const company = DB.companies.list(c=>c.ownerId===user.id)[0] || {};
    const employer = company.name || user.name || "—";
    const estAddress = [company.district||project.district, company.state||project.state].filter(Boolean).join(", ");

    let state = { view:"registers", formId:"A", period: new Date().toISOString().slice(0,7), docFormId:"F11", memberId:"" };

    /* -------- data sources -------- */
    function members(){
      return DB.teamMembers.list(t=>t.ownerId===user.id && (t.projectIds||[]).includes(project.id))
        .sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    }
    function attSummary(memberId, period){
      const recs = DB.teamAttendance.list(a=>a.ownerId===user.id && a.projectId===project.id && a.memberId===memberId && (!period || (a.date||"").slice(0,7)===period));
      const s = { present:0, half:0, ot:0, absent:0, manDays:0, byDay:{} };
      recs.forEach(r=>{
        if(r.status==="present") s.present++; else if(r.status==="half") s.half++;
        else if(r.status==="overtime") s.ot++; else if(r.status==="absent") s.absent++;
        s.manDays += (ATT_FACTOR[r.status]||0);
        const d = parseInt((r.date||"").slice(8,10),10); if(d) s.byDay[d] = ATT_MARK[r.status]||"";
      });
      return s;
    }
    function daysInMonth(period){ const [y,m] = period.split("-").map(Number); return new Date(y, m, 0).getDate(); }

    /* -------- register definitions -------- */
    const FORMS = {
      A: { formNo:"A", monthly:false, title:"Employee Register", act:"Rule 3(1), Ease of Compliance to Maintain Registers Rules, 2017",
        columns:()=>[
          {k:"code",l:"Emp. Code",w:70},{k:"name",l:"Name of Employee",w:150},{k:"gender",l:"Gender",w:60},
          {k:"guardian",l:"Father's / Spouse Name",w:140},{k:"dob",l:"Date of Birth",w:90},{k:"doj",l:"Date of Joining",w:90},
          {k:"designation",l:"Designation",w:110},{k:"category",l:"Skilled / Semi / Unskilled",w:110},{k:"nature",l:"Nature of Work",w:120},
          {k:"uan",l:"UAN (EPF)",w:110},{k:"esic",l:"ESIC IP No.",w:110},{k:"bank",l:"Bank A/c No.",w:120},
          {k:"mobile",l:"Mobile No.",w:100},{k:"address",l:"Present Address",w:170},{k:"exit",l:"Date & Reason of Exit",w:130}
        ],
        auto:()=> members().map((m,i)=>({ code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"", category:m.skill||"", mobile:m.phone||"" }))
      },
      B: { formNo:"B", monthly:true, title:"Wage Register", act:"Rule 3(2), Ease of Compliance to Maintain Registers Rules, 2017",
        columns:()=>[
          {k:"code",l:"Emp. Code",w:70},{k:"name",l:"Name",w:140},{k:"designation",l:"Designation",w:110},
          {k:"days",l:"Days Worked",w:80},{k:"ot",l:"OT Hours",w:70},{k:"rate",l:"Rate of Wages",w:90},
          {k:"basic",l:"Basic + DA",w:90},{k:"hra",l:"HRA",w:70},{k:"otamt",l:"OT Amount",w:80},{k:"gross",l:"Gross Wages",w:95},
          {k:"pf",l:"PF Ded.",w:75},{k:"esi",l:"ESI Ded.",w:75},{k:"other",l:"Other Ded.",w:80},{k:"totded",l:"Total Ded.",w:85},
          {k:"net",l:"Net Paid",w:90},{k:"paydate",l:"Date of Payment",w:100},{k:"sign",l:"Signature / Thumb",w:110}
        ],
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); const gross=Math.round(s.manDays*(m.dailyRate||0));
          return { code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"", days:s.manDays||"", rate:m.dailyRate||"", gross:gross||"" }; })
      },
      C: { formNo:"C", monthly:false, title:"Register of Loan / Recoveries / Advances / Fines",
        act:"Rule 3(3), Ease of Compliance to Maintain Registers Rules, 2017",
        columns:()=>[
          {k:"code",l:"Emp. Code",w:70},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},
          {k:"purpose",l:"Purpose (Loan/Advance/Fine/Deduction)",w:200},{k:"date",l:"Date",w:90},{k:"amount",l:"Amount (₹)",w:100},
          {k:"inst",l:"No. of Installments",w:110},{k:"recdate",l:"Recovery Date",w:100},{k:"recamt",l:"Recovered (₹)",w:100},
          {k:"balance",l:"Balance (₹)",w:100},{k:"remarks",l:"Remarks",w:150}
        ],
        auto:()=> members().map((m,i)=>({ code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"" }))
      },
      D: { formNo:"D", monthly:true, title:"Attendance Register / Muster Roll", act:"Rule 3(4), Ease of Compliance to Maintain Registers Rules, 2017",
        columns:(p)=>{ const cols=[{k:"code",l:"Code",w:56},{k:"name",l:"Name",w:130},{k:"designation",l:"Designation",w:100}];
          const n=daysInMonth(p); for(let d=1;d<=n;d++) cols.push({k:"d"+d,l:String(d),w:26});
          cols.push({k:"total",l:"Total Days",w:70},{k:"oth",l:"OT",w:44}); return cols; },
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); const row={ code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"", total:s.manDays||"", oth:s.ot||"" };
          Object.keys(s.byDay).forEach(d=> row["d"+d]=s.byDay[d]); return row; })
      },
      E: { formNo:"E", monthly:false, title:"Register of Leave with Wages", act:"Rule 3(5), Ease of Compliance to Maintain Registers Rules, 2017",
        columns:()=>[
          {k:"code",l:"Emp. Code",w:70},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},
          {k:"entitled",l:"Leave Entitled",w:100},{k:"availed",l:"Leave Availed",w:100},{k:"balance",l:"Leave Balance",w:100},
          {k:"wages",l:"Wages for Leave (₹)",w:130},{k:"remarks",l:"Remarks",w:160}
        ],
        auto:()=> members().map((m,i)=>({ code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"" }))
      },
      OT: { formNo:"—", monthly:true, title:"Overtime Register", act:"Minimum Wages Act, 1948 / CLRA Rules",
        columns:()=>[
          {k:"code",l:"Emp. Code",w:70},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},
          {k:"otdays",l:"OT Days",w:80},{k:"othours",l:"OT Hours",w:80},{k:"otrate",l:"OT Rate (₹/hr)",w:100},
          {k:"otamt",l:"OT Amount (₹)",w:110},{k:"remarks",l:"Remarks",w:160}
        ],
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); return { code:"E"+String(i+1).padStart(2,"0"), name:m.name, designation:m.designation||m.skill||"", otdays:s.ot||"" }; })
      },
      ESIC: { formNo:"Reg. 32", monthly:true, title:"ESIC — Register of Employees & Contributions", act:"Employees' State Insurance Act, 1948 (0.75% employee / 3.25% employer, up to ₹21,000/month)",
        columns:()=>[
          {k:"ip",l:"ESIC IP No.",w:110},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:110},
          {k:"days",l:"Days Worked",w:85},{k:"wages",l:"Total Wages (₹)",w:110},
          {k:"emp",l:"Employee 0.75% (₹)",w:130},{k:"er",l:"Employer 3.25% (₹)",w:130},{k:"total",l:"Total (₹)",w:95}
        ],
        auto:(p)=> members().map(m=>{ const s=attSummary(m.id,p); const wages=Math.round(s.manDays*(m.dailyRate||0));
          const applicable = wages>0 && wages<=RATES.esiWageCeiling;
          const emp = applicable? Math.ceil(wages*RATES.esiEmployee):0, er = applicable? Math.ceil(wages*RATES.esiEmployer):0;
          return { name:m.name, designation:m.designation||m.skill||"", days:s.manDays||"", wages:wages||"", emp:emp||"", er:er||"", total:(emp+er)||"" }; })
      },
      EPF: { formNo:"ECR", monthly:true, title:"EPF — Contribution Register (ECR)", act:"Employees' Provident Funds Act, 1952 (Employee 12% / Employer 3.67% + EPS 8.33%, EPS capped at ₹15,000)",
        columns:()=>[
          {k:"uan",l:"UAN",w:120},{k:"name",l:"Name",w:140},{k:"designation",l:"Designation",w:100},
          {k:"gross",l:"Gross Wages (₹)",w:110},{k:"epfw",l:"EPF Wages (₹)",w:105},{k:"epsw",l:"EPS Wages (₹)",w:105},
          {k:"emp",l:"Employee 12% (₹)",w:120},{k:"erepf",l:"Employer EPF 3.67% (₹)",w:150},{k:"eps",l:"EPS 8.33% (₹)",w:110},{k:"total",l:"Total (₹)",w:95}
        ],
        auto:(p)=> members().map(m=>{ const s=attSummary(m.id,p); const wages=Math.round(s.manDays*(m.dailyRate||0));
          const epsWages = Math.min(wages, RATES.epsCeiling);
          const emp = Math.round(wages*RATES.epfEmployee), eps = Math.round(epsWages*RATES.epsShare), erEpf = Math.round(wages*RATES.epfEmployer)-eps;
          return { name:m.name, designation:m.designation||m.skill||"", gross:wages||"", epfw:wages||"", epsw:epsWages||"", emp:emp||"", erepf:(erEpf>0?erEpf:0)||"", eps:eps||"", total:(emp+erEpf+eps)||"" }; })
      },
      ACC: { formNo:"—", monthly:false, title:"Accident Register", act:"ESIC Reg. 66 / BOCW Act, 1996 — record every accident on site",
        columns:()=>[
          {k:"date",l:"Date & Time",w:120},{k:"name",l:"Name of Injured",w:150},{k:"designation",l:"Designation",w:110},
          {k:"place",l:"Place of Accident",w:150},{k:"nature",l:"Nature of Injury",w:150},{k:"cause",l:"Cause",w:150},
          {k:"witness",l:"Witnesses",w:130},{k:"action",l:"Action Taken",w:150},{k:"reported",l:"Reported to ESIC (Y/N)",w:120}
        ],
        auto:()=> []
      }
    };
    const FORM_ORDER = [
      ["A","Form A · Employee"],["B","Form B · Wage"],["C","Form C · Loan/Fines"],["D","Form D · Attendance"],
      ["E","Form E · Leave"],["OT","Overtime"],["ESIC","ESIC"],["EPF","EPF / ECR"],["ACC","Accident"]
    ];

    /* -------- per-employee declaration & nomination forms -------- */
    const FORM_DOCS = {
      F11: { formNo:"11", title:"EPF — Composite Declaration Form (Form No. 11)", act:"Para 34 & 57, Employees' Provident Funds Scheme 1952 — declaration by a new employee",
        sections:[
          { h:"Employee Details", fields:[
            {k:"name",l:"Name of the Member",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},
            {k:"dob",l:"Date of Birth",type:"date"},{k:"gender",l:"Gender"},{k:"marital",l:"Marital Status"},
            {k:"mobile",l:"Mobile Number",auto:m=>m.phone},{k:"email",l:"Email ID",auto:m=>m.email},{k:"designation",l:"Designation",auto:m=>m.designation||m.skill}
          ]},
          { h:"Previous Employment", fields:[
            {k:"prevEpf",l:"Earlier a member of EPF Scheme 1952?",type:"yesno"},{k:"prevEps",l:"Earlier a member of EPS 1995?",type:"yesno"},
            {k:"uan",l:"Universal Account Number (UAN)"},{k:"prevPf",l:"Previous PF Account Number"},
            {k:"exitDate",l:"Date of Exit from Previous Employment",type:"date"},{k:"scheme",l:"Scheme Certificate No. (if any)"},{k:"ppo",l:"PPO No. (if any)"}
          ]},
          { h:"KYC Details", fields:[
            {k:"aadhaar",l:"Aadhaar Number"},{k:"pan",l:"PAN"},{k:"bank",l:"Bank Account Number"},{k:"ifsc",l:"IFSC Code"}
          ]}
        ] },
      F2: { formNo:"2", title:"EPF & EPS — Nomination & Declaration Form (Form No. 2)", act:"Para 33 & 61(1), EPF Scheme 1952 / Para 18, EPS 1995",
        sections:[
          { h:"Member Details", fields:[
            {k:"name",l:"Name of the Member",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},
            {k:"dob",l:"Date of Birth",type:"date"},{k:"gender",l:"Gender"},{k:"marital",l:"Marital Status"},
            {k:"pf",l:"PF Account No. / UAN"},{k:"doj",l:"Date of Joining",type:"date"},{k:"address",l:"Permanent Address"}
          ]},
          { h:"Part A — EPF Nominee", fields:[
            {k:"n1name",l:"Nominee Name"},{k:"n1rel",l:"Relationship with Member"},{k:"n1dob",l:"Nominee Date of Birth",type:"date"},
            {k:"n1share",l:"Share of Accumulation (%)"},{k:"n1guardian",l:"Guardian (if nominee is a minor)"}
          ]},
          { h:"Part B — EPS Family Particulars", fields:[
            {k:"f1name",l:"Family Member Name"},{k:"f1rel",l:"Relationship"},{k:"f1dob",l:"Date of Birth",type:"date"}
          ]}
        ] },
      E1: { formNo:"1", title:"ESIC — Declaration Form (Form 1)", act:"Regulation 11 & 12, Employees' State Insurance (General) Regulations, 1950",
        sections:[
          { h:"Insured Person Details", fields:[
            {k:"ip",l:"Insurance Number (if already allotted)"},{k:"name",l:"Name of Insured Person",auto:m=>m.name},
            {k:"guardian",l:"Father's / Husband's Name"},{k:"dob",l:"Date of Birth",type:"date"},{k:"gender",l:"Gender"},
            {k:"marital",l:"Marital Status"},{k:"mobile",l:"Mobile Number",auto:m=>m.phone},{k:"doa",l:"Date of Appointment",type:"date"},
            {k:"address",l:"Present Address"},{k:"permAddress",l:"Permanent Address"}
          ]},
          { h:"Family Particulars & Nominee", fields:[
            {k:"f1name",l:"Family Member Name"},{k:"f1rel",l:"Relationship"},{k:"f1dob",l:"Date of Birth",type:"date"},
            {k:"f1resides",l:"Residing with IP?",type:"yesno"},{k:"nominee",l:"Nominee for Cash Benefit"},{k:"nomineeRel",l:"Nominee Relationship"}
          ]}
        ] },
      GF: { formNo:"F", title:"Gratuity — Nomination (Form F)", act:"Rule 6(1), Payment of Gratuity (Central) Rules, 1972",
        sections:[
          { h:"Employee Details", fields:[
            {k:"name",l:"Name of Employee",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},
            {k:"designation",l:"Designation",auto:m=>m.designation||m.skill},{k:"doj",l:"Date of Appointment",type:"date"},{k:"dept",l:"Department / Section"}
          ]},
          { h:"Nominee(s)", fields:[
            {k:"n1name",l:"Nominee Name"},{k:"n1rel",l:"Relationship with Employee"},{k:"n1age",l:"Age of Nominee"},
            {k:"n1share",l:"Proportion of Gratuity (%)"},{k:"n1address",l:"Nominee Address"}
          ]}
        ] }
    };
    const FORM_DOC_ORDER = [["F11","EPF Form 11"],["F2","EPF Form 2"],["E1","ESIC Form 1"],["GF","Gratuity Form F"]];

    /* -------- persistence -------- */
    function periodKey(formId){ return FORMS[formId].monthly ? state.period : ""; }
    function docFor(formId, period){ return DB.complianceData.list(d=> d.ownerId===user.id && d.projectId===project.id && d.formId===formId && (d.period||"")===(period||""))[0]; }
    function loadRows(formId, period){ const d=docFor(formId,period); return d ? d.rows.map(r=>Object.assign({},r)) : null; }
    function saveRows(formId, period, rows){ const d=docFor(formId,period); if(d) DB.complianceData.update(d.id,{rows}); else DB.complianceData.create({ ownerId:user.id, projectId:project.id, formId, period:period||"", rows }); }

    /* -------- render -------- */
    function esc(v){ return U.escapeHtml(v==null?"":String(v)); }
    function currentRows(){
      const p = periodKey(state.formId);
      let rows = loadRows(state.formId, p);
      if(rows===null){ rows = FORMS[state.formId].auto(p) || []; saveRows(state.formId, p, rows); }
      return rows;
    }

    function render(){ return state.view==="forms" ? renderForms() : renderRegisters(); }
    function viewToggleHtml(){
      return `<div class="cmp-viewtoggle">
        <button class="cmp-vt ${state.view==="registers"?"active":""}" data-view="registers">📋 Registers (A–E, ESIC, EPF…)</button>
        <button class="cmp-vt ${state.view==="forms"?"active":""}" data-view="forms">📝 Declaration &amp; Nomination Forms (11, 2, 1, F)</button>
      </div>`;
    }
    function bindViewToggle(){ container.querySelectorAll("[data-view]").forEach(b=> b.addEventListener("click", ()=>{ state.view=b.dataset.view; render(); })); }

    function renderRegisters(){
      const form = FORMS[state.formId], p = periodKey(state.formId);
      const cols = form.columns(state.period);
      const rows = currentRows();
      const monthCtrl = form.monthly ? `<div class="field" style="margin:0"><label>Month</label><input class="input" type="month" id="cmpMonth" value="${state.period}" style="max-width:170px"></div>` : "";
      container.innerHTML = `
        ${viewToggleHtml()}
        <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
          <h3 style="margin:0">Statutory Registers &amp; Forms</h3>
          <div class="flex gap-2">
            <button class="btn btn-outline btn-sm" id="cmpResetBtn" title="Rebuild this register from current team & attendance data">↻ Reset to actual</button>
            <button class="btn btn-outline btn-sm" id="cmpBlankBtn">🖨 Print Blank</button>
            <button class="btn btn-primary btn-sm" id="cmpPrintBtn">🖨 Print Filled</button>
          </div>
        </div>
        <div class="cmp-tabs" id="cmpTabs">${FORM_ORDER.map(([id,label])=>`<button class="cmp-tab ${id===state.formId?"active":""}" data-form="${id}">${label}</button>`).join("")}</div>
        <div class="card cmp-head">
          <div class="cmp-head-grid">
            <div><span>Form</span><b>${form.formNo==="—"?"":"Form "+form.formNo+" — "}${esc(form.title)}</b></div>
            <div><span>Establishment</span><b>${esc(employer)}</b></div>
            <div><span>Project / Site</span><b>${esc(project.name)}</b></div>
            <div><span>Location</span><b>${esc(estAddress||"—")}</b></div>
            ${form.monthly?`<div><span>Period</span><b>${esc(state.period)}</b></div>`:""}
          </div>
          <p class="cmp-act">${esc(form.act||"")}</p>
        </div>
        <div class="flex justify-between items-end mb-2" style="flex-wrap:wrap;gap:10px">
          ${monthCtrl}
          <button class="btn btn-outline btn-sm" id="cmpAddRowBtn">+ Add Blank Row</button>
        </div>
        <div class="table-wrap cmp-wrap">
          <table class="dtable cmp-table" id="cmpTable">
            <thead><tr><th style="width:40px">Sr</th>${cols.map(c=>`<th style="min-width:${c.w||90}px">${esc(c.l)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((r,ri)=> rowHtml(cols, r, ri)).join("")}</tbody>
          </table>
        </div>
        <p class="text-muted mt-2" style="font-size:12px">Every cell is editable — type directly to fill or correct any value; changes save automatically. Auto-filled columns (name, designation, days, wages, statutory contributions) come from your allotted team members and their attendance; the rest are for manual entry. Use <b>Print Blank</b> for an empty register template and <b>Print Filled</b> for the completed one.</p>`;

      // register tabs
      bindViewToggle();
      container.querySelectorAll("[data-form]").forEach(b=> b.addEventListener("click", ()=>{ state.formId=b.dataset.form; render(); }));
      if(form.monthly) container.querySelector("#cmpMonth").addEventListener("change", e=>{ state.period=e.target.value; render(); });
      container.querySelector("#cmpAddRowBtn").addEventListener("click", ()=>{ const rs=currentRows(); rs.push({}); saveRows(state.formId, p, rs); render(); });
      container.querySelector("#cmpResetBtn").addEventListener("click", ()=>{
        if(!confirm("Rebuild this register from current team & attendance data? Manual edits to this register will be replaced.")) return;
        const fresh = FORMS[state.formId].auto(p)||[]; saveRows(state.formId, p, fresh); render();
        U.toast("Register rebuilt from actual data.", {type:"success"});
      });
      container.querySelector("#cmpPrintBtn").addEventListener("click", ()=> printForm(false));
      container.querySelector("#cmpBlankBtn").addEventListener("click", ()=> printForm(true));

      // editable cells -> save on any change
      const table = container.querySelector("#cmpTable");
      table.addEventListener("focusout", ()=>{
        const collected = [];
        table.querySelectorAll("tbody tr").forEach(tr=>{
          const obj={}; tr.querySelectorAll("td[data-key]").forEach(td=> obj[td.dataset.key]=td.textContent.trim());
          collected.push(obj);
        });
        saveRows(state.formId, p, collected);
      });
    }
    function rowHtml(cols, r, ri){
      return `<tr data-row="${ri}"><td class="cmp-sr">${ri+1}</td>${cols.map(c=>`<td contenteditable="true" data-key="${c.k}">${esc(r[c.k])}</td>`).join("")}</tr>`;
    }

    /* -------- print -------- */
    function printForm(blank){
      const form = FORMS[state.formId], p = periodKey(state.formId);
      const cols = form.columns(state.period);
      const rows = blank ? Array.from({length: form.formId==="D"?18:18}, ()=>({})) : currentRows();
      const bodyRows = (rows.length?rows:[{}]).map((r,ri)=>`<tr><td>${ri+1}</td>${cols.map(c=>`<td>${blank?"":esc(r[c.k])}</td>`).join("")}</tr>`).join("");
      const body = `
        <div class="title">${form.formNo==="—"?"":"FORM "+form.formNo+" — "}${esc(form.title.toUpperCase())}</div>
        <p style="font-size:11px;text-align:center;margin:-8px 0 12px;color:#555">${esc(form.act||"")}</p>
        <table style="margin-bottom:10px"><tbody>
          <tr><th style="width:190px">Name &amp; Address of Establishment</th><td>${esc(employer)}${estAddress?", "+esc(estAddress):""}</td>
              <th style="width:120px">Project / Site</th><td>${esc(project.name)}</td></tr>
          <tr><th>Nature of Work</th><td>Building &amp; Construction</td>
              <th>${form.monthly?"Period (Month)":"Register Date"}</th><td>${form.monthly?esc(state.period):esc(U.fmtDate(new Date()))}</td></tr>
        </tbody></table>
        <table><thead><tr><th>Sr</th>${cols.map(c=>`<th>${esc(c.l)}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>
        <div class="signoff"><div>Prepared By</div><div>Authorised Signatory<br>For ${esc(employer)}</div></div>
        <div class="footer"><span>Generated via SubletWorks.com${blank?" — BLANK TEMPLATE":""}</span><span>${esc(U.fmtDateTime(new Date()))}</span></div>`;
      global.SW.UI.printDocument(`${form.formNo==="—"?"":"Form "+form.formNo+" — "}${form.title}`, body, {landscape:true});
    }

    /* -------- per-employee declaration & nomination forms -------- */
    function docFieldsFor(docFormId, memberId){
      const period = "doc:"+(memberId||"blank");
      const d = docFor("DOC_"+docFormId, period);
      return d ? Object.assign({}, d.rows[0]||{}) : null;
    }
    function saveDocFields(docFormId, memberId, fields){
      saveRows("DOC_"+docFormId, "doc:"+(memberId||"blank"), [fields]);
    }
    function seedDocFields(def, member){
      const f = {};
      def.sections.forEach(s=> s.fields.forEach(fld=>{ if(fld.auto && member){ const v=fld.auto(member); if(v) f[fld.k]=v; } }));
      return f;
    }
    function renderForms(){
      const def = FORM_DOCS[state.docFormId];
      const mem = state.memberId ? DB.teamMembers.get(state.memberId) : null;
      let fields = docFieldsFor(state.docFormId, state.memberId);
      if(fields===null){ fields = seedDocFields(def, mem); saveDocFields(state.docFormId, state.memberId, fields); }
      const memberOpts = `<option value="">— Blank form —</option>` + members().map(m=>`<option value="${m.id}" ${m.id===state.memberId?"selected":""}>${esc(m.name)}${m.designation?" ("+esc(m.designation)+")":""}</option>`).join("");

      function fieldCtrl(fld){
        const val = fields[fld.k]!=null ? fields[fld.k] : "";
        if(fld.type==="yesno") return `<select class="select" data-fkey="${fld.k}"><option value="" ${!val?"selected":""}>—</option><option ${val==="Yes"?"selected":""}>Yes</option><option ${val==="No"?"selected":""}>No</option></select>`;
        if(fld.type==="date") return `<input class="input" type="date" data-fkey="${fld.k}" value="${esc(val)}">`;
        return `<input class="input" data-fkey="${fld.k}" value="${esc(val)}">`;
      }

      container.innerHTML = `
        ${viewToggleHtml()}
        <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
          <h3 style="margin:0">Declaration &amp; Nomination Forms</h3>
          <div class="flex gap-2">
            <button class="btn btn-outline btn-sm" id="cmpFormBlankBtn">🖨 Print Blank</button>
            <button class="btn btn-primary btn-sm" id="cmpFormPrintBtn">🖨 Print Filled</button>
          </div>
        </div>
        <div class="cmp-tabs" id="cmpDocTabs">${FORM_DOC_ORDER.map(([id,label])=>`<button class="cmp-tab ${id===state.docFormId?"active":""}" data-docform="${id}">${label}</button>`).join("")}</div>
        <div class="card cmp-head">
          <div class="cmp-head-grid">
            <div><span>Form</span><b>Form ${esc(def.formNo)} — ${esc(def.title.replace(/\s*\(.*\)$/,""))}</b></div>
            <div><span>Establishment</span><b>${esc(employer)}</b></div>
            <div><span>Project / Site</span><b>${esc(project.name)}</b></div>
          </div>
          <p class="cmp-act">${esc(def.act)}</p>
        </div>
        <div class="flex items-end gap-3 mb-3" style="flex-wrap:wrap">
          <div class="field" style="margin:0;min-width:280px"><label>Fill for team member</label><select class="select" id="cmpMemberSel">${memberOpts}</select></div>
          <span class="text-muted" style="font-size:12px">Pick a member to auto-fill known details, or keep it blank. Every field below is editable and saves automatically.</span>
        </div>
        <div class="card cmp-form" id="cmpForm">
          ${def.sections.map(s=>`
            <div class="cmp-form-section"><h4>${esc(s.h)}</h4>
              <div class="cmp-form-grid">${s.fields.map(fld=>`<div class="field"><label>${esc(fld.l)}</label>${fieldCtrl(fld)}</div>`).join("")}</div>
            </div>`).join("")}
          <p class="text-muted" style="font-size:12px;margin:10px 0 0">Declaration: I hereby declare that the particulars given above are true to the best of my knowledge and belief.</p>
        </div>`;

      bindViewToggle();
      container.querySelectorAll("[data-docform]").forEach(b=> b.addEventListener("click", ()=>{ state.docFormId=b.dataset.docform; render(); }));
      container.querySelector("#cmpMemberSel").addEventListener("change", e=>{ state.memberId=e.target.value; render(); });
      const formEl = container.querySelector("#cmpForm");
      function gather(){ const obj={}; formEl.querySelectorAll("[data-fkey]").forEach(el=> obj[el.dataset.fkey]=el.value.trim()); saveDocFields(state.docFormId, state.memberId, obj); }
      formEl.addEventListener("change", gather);
      formEl.addEventListener("focusout", gather);
      container.querySelector("#cmpFormPrintBtn").addEventListener("click", ()=>{ gather(); printFormDoc(false); });
      container.querySelector("#cmpFormBlankBtn").addEventListener("click", ()=> printFormDoc(true));
    }
    function printFormDoc(blank){
      const def = FORM_DOCS[state.docFormId];
      const fields = blank ? {} : (docFieldsFor(state.docFormId, state.memberId) || {});
      const sections = def.sections.map(s=>`
        <h4>${esc(s.h)}</h4>
        <table class="kv"><tbody>${s.fields.map(fld=>`<tr><th style="width:280px">${esc(fld.l)}</th><td>${blank?"":esc(fields[fld.k]||"")}</td></tr>`).join("")}</tbody></table>`).join("");
      const body = `
        <div class="title">FORM ${esc(def.formNo)} — ${esc(def.title.replace(/\s*\(.*\)$/,"").toUpperCase())}</div>
        <p style="font-size:11px;text-align:center;margin:-8px 0 12px;color:#555">${esc(def.act)}</p>
        <table style="margin-bottom:10px"><tbody>
          <tr><th style="width:200px">Name &amp; Address of Establishment</th><td>${esc(employer)}${estAddress?", "+esc(estAddress):""}</td></tr>
          <tr><th>Project / Site</th><td>${esc(project.name)}</td></tr>
        </tbody></table>
        ${sections}
        <p style="font-size:12px;margin-top:14px">Declaration: I hereby declare that the particulars given above are true to the best of my knowledge and belief.</p>
        <div class="signoff"><div>Signature / Thumb Impression of Employee<br>Date:</div><div>Authorised Signatory<br>For ${esc(employer)}</div></div>
        <div class="footer"><span>Generated via SubletWorks.com${blank?" — BLANK TEMPLATE":""}</span><span>${esc(U.fmtDateTime(new Date()))}</span></div>`;
      global.SW.UI.printDocument(`Form ${def.formNo} — ${def.title}`, body);
    }

    render();
  }

  global.SW = global.SW || {};
  global.SW.Compliance = { mount };
})(window);
