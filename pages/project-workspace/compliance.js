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
    // Standalone mode (a general Compliance page not tied to any one project):
    // registers span ALL of the user's team members & attendance instead of one project.
    const standalone = !!ctx.standalone;
    const company = DB.companies.list(c=>c.ownerId===user.id)[0] || {};
    const employer = company.name || user.name || "—";
    const estAddress = [company.district||project.district, company.state||project.state].filter(Boolean).join(", ");

    let state = { view:"registers", formId:"A", period: new Date().toISOString().slice(0,7), docFormId:"F11", memberId:"", blankRows:25 };

    /* -------- data sources -------- */
    function members(){
      return DB.teamMembers.list(t=>t.ownerId===user.id && (standalone || (t.projectIds||[]).includes(project.id)))
        .sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    }
    function attSummary(memberId, period){
      const recs = DB.teamAttendance.list(a=>a.ownerId===user.id && (standalone || a.projectId===project.id) && a.memberId===memberId && (!period || (a.date||"").slice(0,7)===period));
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
      },
      XIII: { formNo:"XIII", monthly:false, title:"Register of Workmen Employed by Contractor", act:"Rule 75, Contract Labour (Regulation & Abolition) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl. No.",w:60},{k:"name",l:"Name of Workman",w:150},{k:"age",l:"Age & Sex",w:80},{k:"guardian",l:"Father's / Husband's Name",w:150},
          {k:"designation",l:"Nature of Employment / Designation",w:160},{k:"permaddr",l:"Permanent Home Address (Village, Tehsil, District)",w:210},
          {k:"localaddr",l:"Local Address",w:140},{k:"doc",l:"Date of Commencement",w:120},{k:"sign",l:"Signature / Thumb",w:110},
          {k:"dot",l:"Date of Termination",w:110},{k:"reason",l:"Reason for Termination",w:140},{k:"remarks",l:"Remarks",w:110}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name, designation:m.designation||m.skill||"", localaddr:m.phone?("Mob: "+m.phone):"" }))
      },
      XVI: { formNo:"XVI", monthly:true, title:"Muster Roll", act:"Rule 78(1)(a)(i), Contract Labour (R&A) Central Rules, 1971",
        columns:(p)=>{ const cols=[{k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:130},{k:"guardian",l:"Father's/Husband's Name",w:150},{k:"sex",l:"Sex",w:50}];
          const n=daysInMonth(p); for(let d=1;d<=n;d++) cols.push({k:"d"+d,l:String(d),w:26}); cols.push({k:"total",l:"Total",w:60}); return cols; },
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); const row={ code:i+1, name:m.name, total:s.manDays||"" }; Object.keys(s.byDay).forEach(d=> row["d"+d]=s.byDay[d]); return row; })
      },
      XVII: { formNo:"XVII", monthly:true, title:"Register of Wages", act:"Rule 78(1)(a)(i), Contract Labour (R&A) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:140},{k:"designation",l:"Designation / Nature of Work",w:150},{k:"days",l:"No. of Days Worked",w:90},
          {k:"units",l:"Units of Work Done",w:100},{k:"rate",l:"Daily / Piece Rate",w:100},{k:"basic",l:"Basic Wages",w:90},{k:"da",l:"Dearness Allowance",w:100},
          {k:"ot",l:"Overtime",w:75},{k:"other",l:"Other Cash Payments",w:110},{k:"total",l:"Total",w:90},{k:"ded",l:"Deductions",w:90},
          {k:"net",l:"Net Amount Paid",w:100},{k:"paydate",l:"Date of Payment",w:100},{k:"sign",l:"Signature / Thumb",w:110}
        ],
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); const gross=Math.round(s.manDays*(m.dailyRate||0));
          return { code:i+1, name:m.name, designation:m.designation||m.skill||"", days:s.manDays||"", rate:m.dailyRate||"", basic:gross||"", total:gross||"", net:gross||"" }; })
      },
      XX: { formNo:"XX", monthly:false, title:"Register of Deductions for Damage or Loss", act:"Rule 78(1)(a)(ii), Contract Labour (R&A) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},{k:"particulars",l:"Particulars of Damage or Loss",w:200},
          {k:"date",l:"Date of Damage / Loss",w:120},{k:"cause",l:"Whether Worker Showed Cause",w:160},{k:"amount",l:"Amount of Deduction (₹)",w:130},
          {k:"inst",l:"No. of Installments",w:110},{k:"remarks",l:"Remarks",w:120}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name, designation:m.designation||m.skill||"" }))
      },
      XXI: { formNo:"XXI", monthly:false, title:"Register of Fines", act:"Rule 78(1)(a)(ii), Contract Labour (R&A) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},{k:"offence",l:"Act / Omission for which Fine Imposed",w:210},
          {k:"date",l:"Date of Offence",w:110},{k:"cause",l:"Whether Showed Cause",w:150},{k:"amount",l:"Amount of Fine (₹)",w:110},
          {k:"realised",l:"Date Fine Realised",w:120},{k:"remarks",l:"Remarks",w:120}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name, designation:m.designation||m.skill||"" }))
      },
      XXII: { formNo:"XXII", monthly:false, title:"Register of Advances", act:"Rule 78(1)(a)(ii), Contract Labour (R&A) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},{k:"date",l:"Date & Amount of Advance (₹)",w:160},
          {k:"purpose",l:"Purpose",w:140},{k:"inst",l:"No. of Installments",w:110},{k:"repaid",l:"Date & Amount of Each Installment Repaid",w:210},
          {k:"balance",l:"Balance (₹)",w:100},{k:"remarks",l:"Remarks",w:110}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name, designation:m.designation||m.skill||"" }))
      },
      XXIII: { formNo:"XXIII", monthly:true, title:"Register of Overtime", act:"Rule 78(1)(a)(iii), Contract Labour (R&A) Central Rules, 1971",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},{k:"otdays",l:"Days OT Worked",w:100},
          {k:"othours",l:"Total OT Hours",w:100},{k:"normrate",l:"Normal Rate",w:90},{k:"otrate",l:"Overtime Rate",w:100},
          {k:"otearn",l:"OT Earnings (₹)",w:110},{k:"paydate",l:"Date of OT Payment",w:120},{k:"remarks",l:"Remarks",w:110}
        ],
        auto:(p)=> members().map((m,i)=>{ const s=attSummary(m.id,p); return { code:i+1, name:m.name, designation:m.designation||m.skill||"", otdays:s.ot||"" }; })
      },
      EPF5: { formNo:"5", monthly:true, title:"EPF — Return of Employees Qualifying (New Joinees)", act:"Para 36(2)(a), EPF Scheme 1952 — filed monthly for employees qualifying for the first time",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"uan",l:"Account No. / UAN",w:130},{k:"name",l:"Name of Employee",w:160},{k:"guardian",l:"Father's / Husband's Name",w:160},
          {k:"dob",l:"Date of Birth",w:100},{k:"sex",l:"Sex",w:60},{k:"doj",l:"Date of Joining / Eligibility",w:130},{k:"remarks",l:"Remarks",w:120}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name }))
      },
      EPF10: { formNo:"10", monthly:true, title:"EPF — Return of Members Leaving Service", act:"Para 36(2)(a) & (b), EPF Scheme 1952 — filed monthly for members who left service",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"uan",l:"Account No. / UAN",w:130},{k:"name",l:"Name of Member",w:160},{k:"guardian",l:"Father's / Husband's Name",w:160},
          {k:"dol",l:"Date of Leaving Service",w:130},{k:"reason",l:"Reason for Leaving",w:150},{k:"remarks",l:"Remarks",w:120}
        ],
        auto:()=> []
      },
      XII: { formNo:"XII", monthly:false, title:"Register of Contractors", act:"Rule 74, Contract Labour (R&A) Central Rules, 1971 — maintained by the Principal Employer",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"contractor",l:"Name & Address of Contractor",w:230},{k:"nature",l:"Nature of Work",w:160},
          {k:"location",l:"Location of Work",w:150},{k:"maxworkers",l:"Max. No. of Workmen Employed",w:150},
          {k:"from",l:"Period of Contract — From",w:120},{k:"to",l:"To",w:100},{k:"remarks",l:"Remarks",w:130}
        ],
        auto:()=> []
      },
      BONUS: { formNo:"C", monthly:false, title:"Bonus Register (Bonus Paid to Employees)", act:"Rule 4(c), Payment of Bonus Rules, 1975 — Form C",
        columns:()=>[
          {k:"code",l:"Sl.",w:46},{k:"name",l:"Name",w:150},{k:"designation",l:"Designation",w:120},{k:"days",l:"No. of Days Worked",w:110},
          {k:"salary",l:"Salary / Wage (₹)",w:120},{k:"bonuspct",l:"Bonus % (min 8.33%)",w:120},{k:"bonus",l:"Bonus Payable (₹)",w:120},
          {k:"deduction",l:"Deductions (₹)",w:110},{k:"net",l:"Net Bonus Paid (₹)",w:120},{k:"paydate",l:"Date of Payment",w:110}
        ],
        auto:()=> members().map((m,i)=>({ code:i+1, name:m.name, designation:m.designation||m.skill||"" }))
      }
    };
    const FORM_ORDER = [
      ["A","Form A · Employee"],["B","Form B · Wage"],["C","Form C · Loan/Fines"],["D","Form D · Attendance"],
      ["E","Form E · Leave"],["OT","Overtime"],["ESIC","ESIC"],["EPF","EPF / ECR"],["ACC","Accident"],
      ["XIII","CLRA XIII · Workmen"],["XVI","CLRA XVI · Muster"],["XVII","CLRA XVII · Wages"],["XX","CLRA XX · Deductions"],
      ["XXI","CLRA XXI · Fines"],["XXII","CLRA XXII · Advances"],["XXIII","CLRA XXIII · Overtime"],
      ["XII","CLRA XII · Contractors"],["BONUS","Bonus · Form C"],["EPF5","EPF 5 · Joins"],["EPF10","EPF 10 · Exits"]
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
        ] },
      XIX: { formNo:"XIX", title:"CLRA — Wage Slip (Form XIX)", act:"Rule 78(1)(b), Contract Labour (R&A) Central Rules, 1971",
        sections:[
          { h:"Worker & Wage Details", fields:[
            {k:"name",l:"Name of Workman",auto:m=>m.name},{k:"guardian",l:"S/o or W/o"},{k:"designation",l:"Designation / Nature of Work",auto:m=>m.designation||m.skill},
            {k:"period",l:"Wage Period"},{k:"rate",l:"Rate of Daily Wages (₹)",auto:m=>m.dailyRate},{k:"days",l:"Total Days Worked"},
            {k:"ot",l:"Overtime Hours / Amount"},{k:"gross",l:"Gross Wages (₹)"}
          ]},
          { h:"Deductions & Net", fields:[
            {k:"pf",l:"PF Deduction (₹)"},{k:"esi",l:"ESI Deduction (₹)"},{k:"fines",l:"Fines (₹)"},{k:"advances",l:"Advances Recovered (₹)"},
            {k:"other",l:"Other Deductions (₹)"},{k:"net",l:"Net Amount Paid (₹)"},{k:"paydate",l:"Date of Payment",type:"date"}
          ]}
        ] },
      E37: { formNo:"37", title:"ESIC — Certificate of Employment (Form 37)", act:"Regulation 61, ESI (General) Regulations, 1950",
        sections:[
          { h:"Insured Person", fields:[
            {k:"name",l:"Name of Insured Person",auto:m=>m.name},{k:"ip",l:"Insurance Number"},{k:"guardian",l:"Father's / Husband's Name"},
            {k:"designation",l:"Designation",auto:m=>m.designation||m.skill}
          ]},
          { h:"Employment Certificate", fields:[
            {k:"employedFrom",l:"Employed From (Date)",type:"date"},{k:"employedTo",l:"Employed Up To (Date)",type:"date"},
            {k:"continuing",l:"Whether Still in Employment?",type:"yesno"},{k:"nature",l:"Nature of Work"},{k:"wages",l:"Monthly Wages (₹)",auto:m=>m.dailyRate?m.dailyRate*26:""}
          ]}
        ] },
      BOCW1: { formNo:"I", title:"BOCW — Application for Registration of Establishment (Form I)", act:"Rule 23, BOCW (RE&CS) Central Rules, 1998",
        sections:[
          { h:"Establishment Details", fields:[
            {k:"estname",l:"Name & Address of Establishment",auto:()=>employer+(estAddress?", "+estAddress:"")},{k:"employer",l:"Name of Employer",auto:()=>employer},
            {k:"nature",l:"Nature of Building / Construction Work",auto:()=>"Building & Construction"},{k:"cost",l:"Estimated Cost of Construction (₹)"},
            {k:"commence",l:"Date of Commencement",type:"date"},{k:"complete",l:"Likely Date of Completion",type:"date"}
          ]},
          { h:"Workers & Principal Employer", fields:[
            {k:"maxworkers",l:"Maximum No. of Workers to be Employed"},{k:"principal",l:"Name & Address of Principal Employer"},{k:"contractor",l:"Name & Address of Contractor (if any)"}
          ]}
        ] },
      BOCWW: { formNo:"—", title:"BOCW — Registration of Building Worker as Beneficiary", act:"Section 12, BOCW Act, 1996 / State Welfare Board Rules",
        sections:[
          { h:"Worker Details", fields:[
            {k:"name",l:"Name of Construction Worker",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},{k:"dob",l:"Date of Birth / Age",type:"date"},
            {k:"gender",l:"Gender"},{k:"aadhaar",l:"Aadhaar Number"},{k:"mobile",l:"Mobile Number",auto:m=>m.phone},
            {k:"trade",l:"Nature of Work / Trade",auto:m=>m.skill||m.designation},{k:"address",l:"Permanent Address"}
          ]},
          { h:"Eligibility & Bank", fields:[
            {k:"employer",l:"Name & Address of Employer / Establishment",auto:()=>employer},{k:"days90",l:"Worked 90+ Days in Last 12 Months?",type:"yesno"},
            {k:"bank",l:"Bank A/c No. & IFSC"},{k:"nominee",l:"Nominee Name & Relationship"}
          ]}
        ] },
      E1A: { formNo:"1A", title:"ESIC — Family Declaration Form (Form 1A)", act:"Regulation 15A, ESI (General) Regulations, 1950",
        sections:[
          { h:"Insured Person", fields:[
            {k:"name",l:"Name of Insured Person",auto:m=>m.name},{k:"ip",l:"Insurance Number"}
          ]},
          { h:"Family Particulars", fields:[
            {k:"f1name",l:"Name of Family Member"},{k:"f1rel",l:"Relationship with IP"},{k:"f1dob",l:"Date of Birth",type:"date"},
            {k:"f1resides",l:"Residing with IP?",type:"yesno"},{k:"f1place",l:"If not, Place of Residence"},
            {k:"f2name",l:"Name of Family Member"},{k:"f2rel",l:"Relationship with IP"},{k:"f2dob",l:"Date of Birth",type:"date"}
          ]}
        ] },
      F3A: { formNo:"3A", title:"EPF — Member's Annual Contribution Card (Form 3A)", act:"Para 35 & 42, EPF Scheme 1952",
        sections:[
          { h:"Member Details", fields:[
            {k:"name",l:"Name of Member",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},{k:"uan",l:"Account No. / UAN"},
            {k:"year",l:"Financial Year"},{k:"designation",l:"Designation",auto:m=>m.designation||m.skill}
          ]},
          { h:"Annual Contribution", fields:[
            {k:"wages",l:"Total EPF Wages for the Year (₹)"},{k:"empShare",l:"Worker's Share (₹)"},{k:"erShare",l:"Employer's Share — EPF (₹)"},
            {k:"eps",l:"Pension Fund Contribution (₹)"},{k:"refund",l:"Refund of Advances (₹)"},{k:"remarks",l:"Remarks"}
          ]}
        ] },
      F19: { formNo:"19", title:"EPF — Application for Final PF Settlement (Form 19)", act:"Para 69 & 72(5), EPF Scheme 1952",
        sections:[
          { h:"Member Details", fields:[
            {k:"name",l:"Name of Member",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},{k:"uan",l:"UAN / PF Account Number"},
            {k:"dob",l:"Date of Birth",type:"date"},{k:"doj",l:"Date of Joining",type:"date"},{k:"dol",l:"Date of Leaving Service",type:"date"},{k:"reason",l:"Reason for Leaving"}
          ]},
          { h:"Payment / KYC", fields:[
            {k:"bank",l:"Bank Account Number"},{k:"ifsc",l:"IFSC Code"},{k:"pan",l:"PAN"},{k:"aadhaar",l:"Aadhaar Number"},
            {k:"mode",l:"Mode of Remittance"},{k:"address",l:"Full Postal Address"}
          ]}
        ] },
      F10C: { formNo:"10C", title:"EPF — Pension Withdrawal / Scheme Certificate (Form 10C)", act:"Para 14, Employees' Pension Scheme, 1995",
        sections:[
          { h:"Member Details", fields:[
            {k:"name",l:"Name of Member",auto:m=>m.name},{k:"guardian",l:"Father's / Husband's Name"},{k:"uan",l:"UAN / PF Account Number"},
            {k:"dob",l:"Date of Birth",type:"date"},{k:"doj",l:"Date of Joining",type:"date"},{k:"dol",l:"Date of Leaving Service",type:"date"}
          ]},
          { h:"Claim & Bank", fields:[
            {k:"claim",l:"Withdrawal Benefit or Scheme Certificate?"},{k:"bank",l:"Bank Account Number"},{k:"ifsc",l:"IFSC Code"},
            {k:"aadhaar",l:"Aadhaar Number"},{k:"address",l:"Full Postal Address"}
          ]}
        ] }
    };
    const FORM_DOC_ORDER = [
      ["F11","EPF Form 11"],["F2","EPF Form 2"],["E1","ESIC Form 1"],["E1A","ESIC Form 1A"],["GF","Gratuity Form F"],
      ["XIX","CLRA XIX · Wage Slip"],["E37","ESIC Form 37"],["F3A","EPF Form 3A"],["F19","EPF Form 19"],["F10C","EPF Form 10C"],
      ["BOCW1","BOCW Form I · Establishment"],["BOCWW","BOCW · Worker Reg."]
    ];

    /* -------- persistence -------- */
    function periodKey(formId){ return FORMS[formId].monthly ? state.period : ""; }
    function docFor(formId, period){ return DB.complianceData.list(d=> d.ownerId===user.id && d.projectId===project.id && d.formId===formId && (d.period||"")===(period||""))[0]; }
    function loadRows(formId, period){ const d=docFor(formId,period); return d ? d.rows.map(r=>Object.assign({},r)) : null; }
    function saveRows(formId, period, rows){ const d=docFor(formId,period); if(d) DB.complianceData.update(d.id,{rows}); else DB.complianceData.create({ ownerId:user.id, projectId:project.id, formId, period:period||"", rows }); }

    /* -------- render -------- */
    function esc(v){ return U.escapeHtml(v==null?"":String(v)); }
    // Smart sizing so a printed/blank form gives each field the writing space it
    // actually needs — wide fields (bank a/c, address) span full width, short
    // fields (dates, gender) sit three-to-a-row, the rest two-to-a-row.
    function fieldSize(fld){
      if(fld.size) return fld.size;
      const k=(fld.k||"").toLowerCase(), l=(fld.l||"");
      if(/address|bank|ifsc|estname|principal|contractor|nominee|particulars|nature|purpose|offence|remarks|scheme/.test(k) || l.length>36) return "lg";
      if(/dob|dol|doj|doa|date|gender|sex|age|share|days|rate|marital|continuing|resides|days90|prevepf|preveps|ppo|units|year|mode|claim/.test(k)) return "sm";
      return "md";
    }
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
          <div class="flex gap-2 items-center" style="flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" id="cmpResetBtn" title="Rebuild this register from current team & attendance data">↻ Reset to actual</button>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)">Blank rows <input type="number" id="cmpBlankRows" value="${state.blankRows}" min="1" max="500" class="input" style="width:64px;padding:4px 6px"></label>
            <button class="btn btn-outline btn-sm" id="cmpBlankBtn" title="Print an empty register template with the number of rows set at left; the header repeats on every page">🖨 Print Blank</button>
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
      container.querySelector("#cmpBlankRows").addEventListener("change", e=>{ state.blankRows = Math.max(1, Math.min(500, +e.target.value||25)); e.target.value = state.blankRows; });
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
      // Blank templates get exactly as many rows as the user asked for; they flow
      // across pages and the whole header block (title + establishment + column
      // headers) repeats at the top of every page via <thead>.
      const n = blank ? Math.max(1, Math.min(500, state.blankRows||25)) : 0;
      const rows = blank ? Array.from({length: n}, ()=>({})) : currentRows();
      const bodyRows = (rows.length?rows:[{}]).map((r,ri)=>`<tr class="${blank?'br':''}"><td>${ri+1}</td>${cols.map(c=>`<td>${blank?"":esc(r[c.k])}</td>`).join("")}</tr>`).join("");
      const totalCols = cols.length + 1;
      const colGroup = `<colgroup><col style="width:34px">${cols.map(c=>`<col style="width:${c.w||90}px">`).join("")}</colgroup>`;
      const periodLine = form.monthly ? `Period (Month): <b>${esc(state.period)}</b>` : `Register Date: <b>${esc(U.fmtDate(new Date()))}</b>`;
      const style = `<style>
        table.reg{table-layout:auto;border-collapse:collapse;width:100%;}
        table.reg th,table.reg td{white-space:normal;word-break:break-word;border:1px solid #444;}
        table.reg thead{display:table-header-group;}
        table.reg tbody tr.br td{height:32px;}
        table.reg thead th.rt-title{font-size:15px;text-transform:uppercase;letter-spacing:.03em;padding:7px 4px;border-bottom:2px solid #000;}
        table.reg thead th.rt-act{font-weight:400;font-size:10px;color:#555;padding:3px 4px;}
        table.reg thead th.rt-est{font-weight:400;font-size:11px;text-align:left;padding:5px 8px;}
        table.reg thead th.rt-col{font-size:11px;background:#f0f1f5;}
      </style>`;
      const body = `${style}
        <table class="reg">${colGroup}
          <thead>
            <tr><th class="rt-title" colspan="${totalCols}">${form.formNo==="—"?"":"FORM "+esc(form.formNo)+" — "}${esc(form.title.toUpperCase())}${blank?" (BLANK)":""}</th></tr>
            <tr><th class="rt-act" colspan="${totalCols}">${esc(form.act||"")}</th></tr>
            <tr><th class="rt-est" colspan="${totalCols}">Establishment: <b>${esc(employer)}${estAddress?", "+esc(estAddress):""}</b> &nbsp;|&nbsp; ${standalone?"Scope":"Project / Site"}: <b>${esc(project.name)}</b> &nbsp;|&nbsp; ${periodLine}</th></tr>
            <tr><th class="rt-col">Sr</th>${cols.map(c=>`<th class="rt-col">${esc(c.l)}</th>`).join("")}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
        <div class="signoff"><div>Prepared By</div><div>Authorised Signatory<br>For ${esc(employer)}</div></div>
        <div class="footer"><span>Generated via SubletWorks.com${blank?" — BLANK TEMPLATE ("+n+" rows)":""}</span><span>${esc(U.fmtDateTime(new Date()))}</span></div>`;
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
      def.sections.forEach(s=> s.fields.forEach(fld=>{ if(fld.auto){ try{ const v=fld.auto(member); if(v!=null && v!=="") f[fld.k]=v; }catch(e){} } }));
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
              <div class="cmp-form-grid">${s.fields.map(fld=>`<div class="field ${fieldSize(fld)==="lg"?"cmp-f-lg":""}"><label>${esc(fld.l)}</label>${fieldCtrl(fld)}</div>`).join("")}</div>
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
      // Each field becomes a bordered box; its width comes from fieldSize() so a
      // bank a/c or address gets a full-width writing area, a date only a third.
      const style = `<style>
        .fp-sec{margin:13px 0 5px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#333;border-bottom:1px solid #999;padding-bottom:3px;}
        .fp-grid{display:flex;flex-wrap:wrap;gap:7px;}
        .fp-f{border:1px solid #9aa3b0;border-radius:3px;padding:3px 8px 5px;min-height:42px;display:flex;flex-direction:column;box-sizing:border-box;}
        .fp-f .lbl{font-size:8.5px;color:#556;text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px;}
        .fp-f .val{font-size:12.5px;min-height:22px;line-height:1.5;}
        .fp-lg{flex:1 1 100%;} .fp-md{flex:1 1 calc(50% - 7px);} .fp-sm{flex:1 1 calc(33.333% - 7px);}
      </style>`;
      const sections = def.sections.map(s=>`
        <div class="fp-sec">${esc(s.h)}</div>
        <div class="fp-grid">${s.fields.map(fld=>`<div class="fp-f fp-${fieldSize(fld)}"><span class="lbl">${esc(fld.l)}</span><span class="val">${blank?"":esc(fields[fld.k]||"")}</span></div>`).join("")}</div>`).join("");
      const body = `${style}
        <div class="title">FORM ${esc(def.formNo)} — ${esc(def.title.replace(/\s*\(.*\)$/,"").toUpperCase())}</div>
        <p style="font-size:11px;text-align:center;margin:-8px 0 12px;color:#555">${esc(def.act)}</p>
        <table style="margin-bottom:6px"><tbody>
          <tr><th style="width:200px">Name &amp; Address of Establishment</th><td>${esc(employer)}${estAddress?", "+esc(estAddress):""}</td></tr>
          <tr><th>${standalone?"Scope":"Project / Site"}</th><td>${esc(project.name)}</td></tr>
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
