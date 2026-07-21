/* ==========================================================================
   SUBLETWORKS.COM — Demo Data Seeder (runs once, first load)
   ========================================================================== */
(function(global){
  "use strict";
  function seed(){
    const DB = global.SW.DB;
    if(DB.isSeeded()) return;

    DB.settings.set("contactUnlockRegularPrice", 999);
    DB.settings.set("contactUnlockOfferPrice", 99);
    DB.settings.set("marketplaceFee", 49);
    DB.settings.set("marketplaceFeeEnabled", false); // admin can flip to true
    DB.settings.set("platformCommissionPct", 2);

    const pm = DB.users.create({ name:"Rohit Malhotra", email:"pm@demo.subletworks.com", phone:"9811122233", password:"demo1234", role:"pm", status:"active", isDemo:true, district:"Gurugram", state:"Haryana" });
    const contractor = DB.users.create({ name:"Suresh Yadav", email:"contractor@demo.subletworks.com", phone:"9822233344", password:"demo1234", role:"contractor", status:"active", isDemo:true, district:"Noida", state:"Uttar Pradesh" });
    const contractor2 = DB.users.create({ name:"Anil Sharma Constructions", email:"anil@builders.com", phone:"9833344455", password:"demo1234", role:"contractor", status:"active", isDemo:false, district:"Gurugram", state:"Haryana" });
    const contractor3 = DB.users.create({ name:"Deepak Infra Works", email:"deepak@infra.com", phone:"9844455566", password:"demo1234", role:"contractor", status:"active", isDemo:false, district:"Delhi", state:"Delhi" });
    const admin = DB.users.create({ name:"SubletWorks Admin", email:"admin@demo.subletworks.com", phone:"9999900000", password:"demo1234", role:"admin", status:"active", isDemo:true });

    DB.companies.create({ ownerId:pm.id, name:"Malhotra Infra Developers Pvt Ltd", gst:"06AAAPL1234C1Z5", pan:"AAAPL1234C", district:"Gurugram", state:"Haryana", trades:["Civil","MEP"] });
    DB.companies.create({ ownerId:contractor.id, name:"Suresh Yadav & Co.", gst:"09AAACS4321B1Z2", pan:"AAACS4321B", msme:"UDYAM-UP-04-1234567", iso:"ISO 9001:2015", district:"Noida", state:"Uttar Pradesh", trades:["Civil","Structural"], rating:4.6, experienceYears:12, labourStrength:45, equipment:["Concrete Mixer","JCB","Tower Crane"] });
    DB.companies.create({ ownerId:contractor2.id, name:"Anil Sharma Constructions", gst:"06AAACS7788Q1Z1", pan:"AAACS7788Q", msme:"UDYAM-HR-06-9988776", iso:"", district:"Gurugram", state:"Haryana", trades:["Electrical","MEP"], rating:4.2, experienceYears:8, labourStrength:22, equipment:["Cable Puller","Generator"] });
    DB.companies.create({ ownerId:contractor3.id, name:"Deepak Infra Works", gst:"07AAACD5566R1Z9", pan:"AAACD5566R", msme:"", iso:"ISO 45001:2018", district:"Delhi", state:"Delhi", trades:["Civil","Plumbing","Fire Fighting"], rating:4.8, experienceYears:15, labourStrength:60, equipment:["Excavator","Batching Plant"] });

    // ---- Tender 1: Published, receiving bids ----
    const t1 = DB.tenders.create({
      pmId:pm.id, title:"Structural & Civil Work – Sector 82 Residential Tower B",
      workType:"Civil", district:"Gurugram", state:"Haryana", status:"published",
      description:"RCC structural work including columns, beams, slabs for a G+14 residential tower.",
      startDate:"2026-08-01", endDate:"2027-02-28", estimatedValue:8500000,
      paymentTerms:"30% Advance, 60% RA Bills against measured work, 10% on completion.",
      retentionPct:5, bgRequiredPct:5, securityDepositPct:3,
      bidSubmissionDeadline:"2026-08-05", boqMode:"full",
      drawings:[{name:"Structural-GFC-Rev2.pdf", size:"4.2 MB"}], published:true, publishedAt:new Date().toISOString()
    });
    const t1Items = [
      { srNo:1, description:"Excavation in ordinary soil up to 1.5m depth", unit:"Cum", qty:1200 },
      { srNo:2, description:"PCC 1:4:8 in foundation", unit:"Cum", qty:180 },
      { srNo:3, description:"RCC M25 in columns including formwork", unit:"Cum", qty:420 },
      { srNo:4, description:"RCC M25 in beams & slabs including formwork", unit:"Cum", qty:960 },
      { srNo:5, description:"TMT Fe500 reinforcement steel", unit:"MT", qty:145 },
      { srNo:6, description:"Brickwork in superstructure with cement mortar 1:6", unit:"Cum", qty:310 }
    ];
    t1Items.forEach(it=> DB.boqItems.create(Object.assign({ tenderId:t1.id }, it)));

    const b1 = DB.bids.create({ tenderId:t1.id, contractorId:contractor.id, mode:"item-wise", status:"submitted", technicalRemarks:"18 years combined team experience, own shuttering material available.", submittedAt:new Date().toISOString() });
    const rates1 = [980,6200,7800,7600,68000,520];
    DB.boqItems.list(i=>i.tenderId===t1.id).forEach((it,idx)=> DB.bidItems.create({ bidId:b1.id, boqItemId:it.id, rate:rates1[idx], amount:rates1[idx]*it.qty }));

    const b2 = DB.bids.create({ tenderId:t1.id, contractorId:contractor2.id, mode:"item-wise", status:"submitted", technicalRemarks:"Can mobilise within 7 days.", submittedAt:new Date().toISOString() });
    const rates2 = [1020,6500,8100,7900,71000,540];
    DB.boqItems.list(i=>i.tenderId===t1.id).forEach((it,idx)=> DB.bidItems.create({ bidId:b2.id, boqItemId:it.id, rate:rates2[idx], amount:rates2[idx]*it.qty }));

    const b3 = DB.bids.create({ tenderId:t1.id, contractorId:contractor3.id, mode:"item-wise", status:"submitted", technicalRemarks:"ISO 45001 certified safety systems, night shift capability.", submittedAt:new Date().toISOString() });
    const rates3 = [940,6050,7650,7450,66500,505];
    DB.boqItems.list(i=>i.tenderId===t1.id).forEach((it,idx)=> DB.bidItems.create({ bidId:b3.id, boqItemId:it.id, rate:rates3[idx], amount:rates3[idx]*it.qty }));

    DB.comments.create({ tenderId:t1.id, bidId:b2.id, boqItemId: DB.boqItems.list(i=>i.tenderId===t1.id)[2].id, authorId:pm.id, authorRole:"pm", text:"Rate for RCC columns looks high vs L1 — please revise or justify with material escalation." });

    // ---- Tender 2: Draft (BOQ builder in progress) ----
    DB.tenders.create({ pmId:pm.id, title:"MEP Fit-out – IT Park Tower C (Draft)", workType:"MEP", district:"Noida", state:"Uttar Pradesh", status:"draft", description:"Electrical, HVAC and Fire fighting fit-out for 3 floors.", estimatedValue:3200000, boqMode:"partial", published:false });

    // ---- Tender 3: Already awarded -> becomes a live project ----
    const t3 = DB.tenders.create({ pmId:pm.id, title:"Interior & Civil Work – Sector 45 Villas Phase 1", workType:"Civil", district:"Gurugram", state:"Haryana", status:"awarded", estimatedValue:5400000, paymentTerms:"20% advance, RA bills monthly, 10% retention.", retentionPct:10, published:true, publishedAt:new Date(Date.now()-30*86400000).toISOString(), awardedTo:contractor.id });
    const t3ItemDefs = [
      { d:"Earthwork excavation", unit:"Cum", qty:900 },
      { d:"PCC bed concrete", unit:"Cum", qty:150 },
      { d:"Brick masonry work", unit:"Sqm", qty:2200 },
      { d:"Internal plastering", unit:"Sqm", qty:4800 },
      { d:"Flooring – vitrified tiles", unit:"Sqm", qty:3600 },
      { d:"Steel reinforcement", unit:"MT", qty:8 }
    ];
    t3ItemDefs.forEach((it,idx)=> DB.boqItems.create({ tenderId:t3.id, srNo:idx+1, description:it.d, unit:it.unit, qty:it.qty }));
    const b3a = DB.bids.create({ tenderId:t3.id, contractorId:contractor.id, mode:"item-wise", status:"accepted", submittedAt:new Date(Date.now()-25*86400000).toISOString() });
    const rates3a=[210,5400,540,185,720,68000];
    DB.boqItems.list(i=>i.tenderId===t3.id).forEach((it,idx)=> DB.bidItems.create({ bidId:b3a.id, boqItemId:it.id, rate:rates3a[idx], amount:rates3a[idx]*it.qty }));

    DB.contactUnlocks.create({ tenderId:t3.id, pmPaid:true, contractorPaid:true, unlockedAt:new Date(Date.now()-24*86400000).toISOString(), amountEach:99 });

    const loi = DB.lois.create({ tenderId:t3.id, bidId:b3a.id, pmId:pm.id, contractorId:contractor.id, loiNo:"SW/LOI/2026/0001", contractValue: rates3a.reduce((s,r,idx)=>s+r*DB.boqItems.list(i=>i.tenderId===t3.id)[idx].qty,0), issuedAt:new Date(Date.now()-23*86400000).toISOString(), status:"issued" });
    DB.workOrders.create({ tenderId:t3.id, loiId:loi.id, pmId:pm.id, contractorId:contractor.id, woNo:"SW/WO/2026/0001", issuedAt:new Date(Date.now()-22*86400000).toISOString(), status:"issued",
      scope:"Civil & interior finishing works as per accepted BOQ and drawings.", penaltyClause:"0.5% of contract value per week of delay, max 10%.", warranty:"12 months defect liability period.", safety:"Contractor to comply with all site safety norms & provide PPE.", insurance:"Contractor to maintain CAR policy for full contract duration.", retentionPct:10, bgPct:5 });

    const proj = DB.projects.create({ tenderId:t3.id, workOrderId: null, name:"Sector 45 Villas Phase 1", pmId:pm.id, contractorId:contractor.id, district:"Gurugram", state:"Haryana", startDate:"2026-06-15", endDate:"2026-12-15", status:"running", progressPct:34 });

    const g = [
      { name:"Mobilisation & Site Setup", start:"2026-06-15", end:"2026-06-25", progress:100, type:"task" },
      { name:"Earthwork & Excavation", start:"2026-06-20", end:"2026-07-10", progress:100, type:"task" },
      { name:"Foundation & PCC", start:"2026-07-05", end:"2026-07-25", progress:90, type:"task", critical:true },
      { name:"Masonry Work", start:"2026-07-20", end:"2026-08-30", progress:55, type:"task", critical:true },
      { name:"Milestone: Structure Complete", start:"2026-08-30", end:"2026-08-30", progress:0, type:"milestone" },
      { name:"Plastering", start:"2026-08-25", end:"2026-09-20", progress:20, type:"task" },
      { name:"Flooring", start:"2026-09-15", end:"2026-10-15", progress:0, type:"task" },
      { name:"Finishing & Handover", start:"2026-10-10", end:"2026-12-10", progress:0, type:"task" }
    ];
    let prevId=null;
    g.forEach(t=>{ const rec = DB.ganttTasks.create(Object.assign({ projectId:proj.id, dependsOn: prevId?[prevId]:[] }, t)); prevId = rec.id; });

    ["Backlog","To Do","In Progress","Review","Done"].forEach((name,idx)=> DB.kanbanColumns.create({ projectId:proj.id, name, order:idx }));
    const cols = DB.kanbanColumns.list(c=>c.projectId===proj.id);
    const cards = [
      { title:"Shuttering for column grid C1-C6", col:2, priority:"high" },
      { title:"Steel binding – slab panel 3", col:2, priority:"med" },
      { title:"Cure & de-shutter beam B2", col:1, priority:"low" },
      { title:"Material indent – cement 200 bags", col:3, priority:"med" },
      { title:"Safety audit – scaffolding", col:4, priority:"high" }
    ];
    cards.forEach(c=> DB.kanbanCards.create({ projectId:proj.id, columnId:cols[c.col].id, title:c.title, priority:c.priority, assignee:contractor.name, dueDate:"2026-08-10" }));

    const mb = DB.mbSheets.create({ projectId:proj.id, name:"MB-01 Foundation & Masonry", createdBy:contractor.id });
    const t3Boq = DB.boqItems.list(i=>i.tenderId===t3.id);
    const findItem = desc => t3Boq.find(i=>i.description===desc);
    const mbRowsData = [
      { boqItemId:findItem("PCC bed concrete").id, unit:"Cum", nos:1, length:30, breadth:5, height:1, factor:1 },
      { boqItemId:findItem("PCC bed concrete").id, unit:"Cum", nos:1, length:25, breadth:4, height:1, factor:1 },
      { boqItemId:findItem("Brick masonry work").id, unit:"Sqm", nos:1, length:60, breadth:1, height:18, factor:1 },
      // Steel measured & billed in kg here (200 bars of 16mm dia @ 12m, 1.578 kg/m) — the abstract auto-converts to MT (the BOQ item's own billing unit).
      { boqItemId:findItem("Steel reinforcement").id, unit:"kg", nos:200, length:12, breadth:1, height:1, factor:1.578 }
    ];
    mbRowsData.forEach(r=> DB.mbRows.create(Object.assign({ mbSheetId:mb.id }, r, { qty:r.nos*r.length*r.breadth*r.height*r.factor })));

    DB.raBills.create({ projectId:proj.id, billNo:"RA-01", billDate:new Date(Date.now()-10*86400000).toISOString(), previousBillAmount:0, currentGrossAmount:850000, retentionPct:10, advanceRecovery:100000, gstPct:18, tdsPct:2, status:"approved" });
    DB.raBills.create({ projectId:proj.id, billNo:"RA-02", billDate:new Date().toISOString(), previousBillAmount:850000, currentGrossAmount:620000, retentionPct:10, advanceRecovery:50000, gstPct:18, tdsPct:2, status:"pending" });

    DB.dprs.create({ projectId:proj.id, date:new Date().toISOString().slice(0,10), labourCount:32, equipment:"1 JCB, 1 Concrete Mixer", weather:"Clear", workDone:"Masonry work grid D1-D8 completed, plaster started on ground floor.", delay:"None", createdBy:contractor.id });
    DB.dprs.create({ projectId:proj.id, date:new Date(Date.now()-86400000).toISOString().slice(0,10), labourCount:28, equipment:"1 JCB", weather:"Light Rain", workDone:"Partial masonry work, stopped by 2pm due to rain.", delay:"2 hours lost due to rain", createdBy:contractor.id });

    DB.hindrances.create({ projectId:proj.id, type:"Material Delay", description:"Cement delivery delayed by supplier by 3 days, impacting plaster schedule.", raisedBy:contractor.id, status:"pending", raisedAt:new Date().toISOString() });

    DB.paymentRequests.create({ projectId:proj.id, raBillId:null, amount:620000, note:"Requesting release against RA-02 measured work.", raisedBy:contractor.id, status:"pending", raisedAt:new Date().toISOString() });

    // Marketplace listings
    DB.marketplaceListings.create({ sellerId:pm.id, sellerRole:"pm", category:"Material", title:"TMT Fe500 Steel Bars – Surplus Stock", quantity:"12 MT", condition:"New", price:68000, priceUnit:"per MT", district:"Gurugram", state:"Haryana", description:"Surplus TMT bars from completed project, mill test certificate available.", status:"active" });
    DB.marketplaceListings.create({ sellerId:contractor3.id, sellerRole:"contractor", category:"Equipment", title:"JCB 3DX – Available on Rent", quantity:"1 unit", condition:"Good", price:1800, priceUnit:"per day", district:"Delhi", state:"Delhi", description:"Well maintained backhoe loader, operator available.", status:"active" });
    DB.marketplaceListings.create({ sellerId:contractor2.id, sellerRole:"contractor", category:"Scrap", title:"MS Scrap – Site Clearance", quantity:"3.5 MT", condition:"Scrap", price:32000, priceUnit:"lump sum", district:"Gurugram", state:"Haryana", description:"Mixed MS scrap from dismantled shuttering, urgent sale.", status:"active" });

    // Notifications
    DB.notifications.create({ userId:pm.id, title:"New bid received", body:"Deepak Infra Works submitted a bid on 'Structural & Civil Work – Sector 82'.", read:false, link:"/pages/tender-detail/index.html?id="+t1.id });
    DB.notifications.create({ userId:pm.id, title:"RA Bill pending approval", body:"RA-02 submitted for Sector 45 Villas Phase 1.", read:false, link:"/pages/project-workspace/index.html?id="+proj.id });
    DB.notifications.create({ userId:contractor.id, title:"Comment on your bid", body:"Project Manager requested revision on RCC column rate.", read:false, link:"/pages/tender-detail/index.html?id="+t1.id });
    DB.notifications.create({ userId:contractor.id, title:"Payment request update", body:"Your payment request of ₹6,20,000 is under review.", read:true, link:"/pages/project-workspace/index.html?id="+proj.id });

    DB.markSeeded();
  }

  global.SW = global.SW || {};
  global.SW.seed = seed;
})(window);
