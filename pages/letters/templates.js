/* ==========================================================================
   SUBLETWORKS.COM — Professional Letter Templates Library
   Each template defines its own field inputs and a body(ctx, f) generator
   that produces ready, professional letter copy. ctx carries the resolved
   project/party/contract data; f carries the user's field inputs.
   ========================================================================== */
(function(global){
  "use strict";
  const U = () => global.SW.Utils;
  const esc = v => U().escapeHtml(v==null?"":String(v));
  const fmtD = v => v ? U().fmtDate(v) : "—";
  const fmtM = v => v!=null && v!=="" ? U().fmtINR(+v) : "—";

  const TEMPLATES = [
    /* ---------------------------- Issued by Project Manager ---------------------------- */
    { id:"ntp", title:"Notice to Proceed (NTP)", category:"pm", icon:"🚀",
      desc:"Formally instruct the contractor to commence work per the Work Order.",
      fields:[ {k:"commenceDate",l:"Date of Commencement",type:"date",required:true}, {k:"specialInstructions",l:"Special Instructions (optional)",type:"textarea"} ],
      subject:ctx=>`Notice to Proceed — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>With reference to Work Order ${ctx.wo?esc(ctx.wo.woNo):"—"}${ctx.wo&&ctx.wo.issuedAt?" dated "+fmtD(ctx.wo.issuedAt):""} issued for the work <b>"${esc(ctx.project.name)}"</b> at ${esc(ctx.project.district)}, ${esc(ctx.project.state)}, you are hereby instructed to commence execution of the works with effect from <b>${fmtD(f.commenceDate)}</b>.</p>
        <p>Please ensure mobilisation of labour, material and equipment is completed in good time to achieve this date, and that all statutory approvals, insurances and safety documentation required under the contract are in place prior to commencement.</p>
        ${f.specialInstructions?`<p><b>Special Instructions:</b> ${esc(f.specialInstructions)}</p>`:""}
        <p>Kindly acknowledge receipt of this Notice to Proceed and confirm the commencement date in writing.</p>` },

    { id:"handover", title:"Site Handover Letter", category:"pm", icon:"🏗️", counterSign:true,
      desc:"Hand over the site to the contractor with access/utility particulars, jointly acknowledged.",
      fields:[ {k:"handoverDate",l:"Date of Handover",type:"date",required:true}, {k:"accessNotes",l:"Site Access / Boundary / Utilities Notes",type:"textarea"} ],
      subject:ctx=>`Site Handover — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>This is to confirm handover of the site for <b>"${esc(ctx.project.name)}"</b> at ${esc(ctx.project.district)}, ${esc(ctx.project.state)} to you, effective <b>${fmtD(f.handoverDate)}</b>, for commencement and execution of the works in accordance with the contract.</p>
        ${f.accessNotes?`<p><b>Site Access / Boundary / Utility Particulars:</b> ${esc(f.accessNotes)}</p>`:""}
        <p>You are requested to take charge of the site, verify its condition and boundaries, and raise any discrepancy in writing within 3 working days, failing which the site shall be deemed accepted in its present condition.</p>` },

    { id:"showcause", title:"Show Cause Notice (Delay / Non-Performance)", category:"pm", icon:"⚠️",
      desc:"Ask the contractor to explain slow progress or non-performance before further action.",
      fields:[ {k:"issue",l:"Nature of Delay / Non-Performance",type:"textarea",required:true}, {k:"replyDays",l:"Days Allowed to Reply",type:"number",default:7} ],
      subject:ctx=>`Show Cause Notice — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>It has been observed that progress of the works under <b>"${esc(ctx.project.name)}"</b> is not commensurate with the agreed programme, specifically: ${esc(f.issue)}</p>
        <p>You are hereby called upon to show cause, in writing, within <b>${esc(f.replyDays||7)} day(s)</b> of receipt of this notice, as to why appropriate action — including but not limited to levy of liquidated damages, curtailment of scope, or termination in part or whole — should not be initiated against you for the above default.</p>
        <p>Please treat this matter with utmost urgency. Failure to respond within the stipulated period will be construed as having no explanation to offer, and the matter shall be proceeded with on that basis.</p>` },

    { id:"warning", title:"Warning Letter (Quality / Safety Non-Compliance)", category:"pm", icon:"🦺",
      desc:"Record a formal warning for a quality or safety lapse observed on site.",
      fields:[ {k:"observation",l:"Observation / Non-Compliance",type:"textarea",required:true}, {k:"correctiveDays",l:"Days to Rectify",type:"number",default:3} ],
      subject:ctx=>`Warning Letter — Quality/Safety Non-Compliance — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>During a site inspection at <b>"${esc(ctx.project.name)}"</b>, the following non-compliance was observed: ${esc(f.observation)}</p>
        <p>This is a serious matter and is hereby recorded as a formal warning. You are directed to rectify the above within <b>${esc(f.correctiveDays||3)} day(s)</b> and confirm compliance in writing. Repeated or continued non-compliance may attract further action under the contract, including suspension of the relevant work or financial recovery.</p>
        <p>Please ensure all workmen and supervisory staff are sensitised to avoid recurrence.</p>` },

    { id:"default", title:"Notice of Default (Breach of Contract)", category:"pm", icon:"📋",
      desc:"Formally notify the contractor of a specific breach of contract terms.",
      fields:[ {k:"clause",l:"Contract Clause / Term Breached"}, {k:"details",l:"Details of Breach",type:"textarea",required:true}, {k:"cureDays",l:"Cure Period (days)",type:"number",default:15} ],
      subject:ctx=>`Notice of Default — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>This is to formally notify you of a default under the contract for <b>"${esc(ctx.project.name)}"</b>${f.clause?`, specifically in relation to ${esc(f.clause)}`:""}.</p>
        <p><b>Nature of Default:</b> ${esc(f.details)}</p>
        <p>You are hereby granted a cure period of <b>${esc(f.cureDays||15)} day(s)</b> from the date of this notice to remedy the above default. Should the default remain unremedied upon expiry of this period, the Employer/Project Manager reserves the right to exercise all remedies available under the contract, including but not limited to termination, without further notice.</p>` },

    { id:"suspension", title:"Suspension of Work Notice", category:"pm", icon:"⏸️",
      desc:"Instruct the contractor to suspend all or part of the works.",
      fields:[ {k:"scope",l:"Scope Suspended (All / Specific Portion)",required:true}, {k:"reason",l:"Reason for Suspension",type:"textarea",required:true} ],
      subject:ctx=>`Suspension of Work — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>You are hereby instructed to suspend <b>${esc(f.scope)}</b> of the works under <b>"${esc(ctx.project.name)}"</b> with immediate effect, for the following reason(s): ${esc(f.reason)}</p>
        <p>During the period of suspension, you are required to take all reasonable steps to protect and secure the works, materials and equipment on site. Resumption of work shall only be permitted upon a further written instruction. This suspension is issued without prejudice to either party's rights under the contract.</p>` },

    { id:"termination", title:"Termination of Contract Notice", category:"pm", icon:"🛑",
      desc:"Formally terminate the contract for cause, per prior default/show-cause notices.",
      fields:[ {k:"ref",l:"Reference to Prior Notice(s)"}, {k:"grounds",l:"Grounds for Termination",type:"textarea",required:true}, {k:"effectiveDate",l:"Effective Date of Termination",type:"date",required:true} ],
      subject:ctx=>`Termination of Contract — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>${f.ref?`With reference to ${esc(f.ref)} and`:"With"} no satisfactory remedy having been received from you, the contract for <b>"${esc(ctx.project.name)}"</b> is hereby terminated for cause, effective <b>${fmtD(f.effectiveDate)}</b>.</p>
        <p><b>Grounds for Termination:</b> ${esc(f.grounds)}</p>
        <p>You are directed to hand over the site, all works executed to date, materials, drawings and records to the Employer/Project Manager immediately upon the effective date. Final measurement and settlement of accounts shall be carried out per the terms of the contract, without prejudice to the Employer's right to recover damages and additional cost of completion.</p>` },

    { id:"eotrebut", title:"Response to EOT Claim (Approval / Rejection)", category:"pm", icon:"↩️",
      desc:"Respond formally to a contractor's Extension of Time claim, in whole or part.",
      fields:[ {k:"claimRef",l:"EOT Claim Reference"}, {k:"decision",l:"Decision",type:"select",options:["Approved in full","Approved in part","Rejected"],default:"Approved in part"}, {k:"daysGranted",l:"Days Granted (if any)",type:"number"}, {k:"reasoning",l:"Reasoning",type:"textarea",required:true} ],
      subject:ctx=>`Response to EOT Claim — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>With reference to your Extension of Time claim${f.claimRef?` ${esc(f.claimRef)}`:""} for <b>"${esc(ctx.project.name)}"</b>, the same has been examined and the decision is: <b>${esc(f.decision)}</b>${f.daysGranted?`, granting ${esc(f.daysGranted)} day(s) of extension`:""}.</p>
        <p><b>Reasoning:</b> ${esc(f.reasoning)}</p>
        <p>The revised completion date, if applicable, shall be updated in the project records accordingly. This decision is without prejudice to either party's other rights and remedies under the contract.</p>` },

    { id:"ldrecovery", title:"Recovery of Liquidated Damages Notice", category:"pm", icon:"💸",
      desc:"Notify the contractor of liquidated damages being levied/recovered for delay.",
      fields:[ {k:"delayDays",l:"Days of Delay",type:"number",required:true}, {k:"rate",l:"LD Rate (e.g. 0.5% per week)"}, {k:"amount",l:"Amount Recovered (₹)",type:"number",required:true} ],
      subject:ctx=>`Recovery of Liquidated Damages — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>As the works under <b>"${esc(ctx.project.name)}"</b> have not been completed within the stipulated contract period, resulting in a delay of <b>${esc(f.delayDays)} day(s)</b>, Liquidated Damages${f.rate?` at the rate of ${esc(f.rate)}`:""} amounting to <b>${fmtM(f.amount)}</b> are being levied and shall be recovered from your running/final bill(s) in accordance with the contract terms.</p>
        <p>This levy is without prejudice to the Employer's other rights under the contract and does not preclude further recovery should the delay continue.</p>` },

    { id:"virtualcompletion", title:"Virtual / Provisional Completion Certificate", category:"pm", icon:"✅", counterSign:true,
      desc:"Certify substantial completion of the works, subject to minor outstanding items.",
      fields:[ {k:"completionDate",l:"Date of Virtual Completion",type:"date",required:true}, {k:"pendingItems",l:"Minor Items Still Pending (if any)",type:"textarea"} ],
      subject:ctx=>`Virtual Completion Certificate — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>This is to certify that the works under <b>"${esc(ctx.project.name)}"</b> executed by ${esc(ctx.contractorName)} have reached a state of virtual/substantial completion as on <b>${fmtD(f.completionDate)}</b>, and the same is fit for its intended use/occupation, subject to the minor outstanding items noted below.</p>
        ${f.pendingItems?`<p><b>Pending Items / Snags:</b> ${esc(f.pendingItems)}</p>`:"<p>No material items remain pending.</p>"}
        <p>The Defect Liability Period shall commence from the date of this certificate as per the contract. This certificate does not absolve the Contractor of responsibility for rectifying the pending items listed above within a reasonable time.</p>` },

    { id:"finalcompletion", title:"Final Completion Certificate", category:"pm", icon:"🏁", counterSign:true,
      desc:"Certify final completion of the works after the defect liability period.",
      fields:[ {k:"completionDate",l:"Date of Final Completion",type:"date",required:true} ],
      subject:ctx=>`Final Completion Certificate — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>This is to certify that the works under <b>"${esc(ctx.project.name)}"</b> executed by ${esc(ctx.contractorName)} have been finally completed in all respects as on <b>${fmtD(f.completionDate)}</b>, all defects notified during the Defect Liability Period having been made good to the satisfaction of the Project Manager/Engineer-in-Charge.</p>
        <p>This certificate is issued for the purpose of release of retention money / security deposit / performance guarantee as applicable under the contract, subject to final settlement of accounts.</p>` },

    { id:"noc_sublet", title:"No Objection Certificate (NOC) for Sub-letting", category:"pm", icon:"📜",
      desc:"Grant the contractor permission to sub-let a defined portion of the work.",
      fields:[ {k:"scope",l:"Scope of Work Permitted to Sub-let",type:"textarea",required:true}, {k:"subContractor",l:"Name of Proposed Sub-Contractor"} ],
      subject:ctx=>`No Objection Certificate for Sub-letting — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>With reference to your request, this is to confirm that the Employer/Project Manager has no objection to you sub-letting the following scope of work under <b>"${esc(ctx.project.name)}"</b>${f.subContractor?` to ${esc(f.subContractor)}`:""}: ${esc(f.scope)}</p>
        <p>This No Objection is granted strictly on the condition that you shall remain fully responsible for the quality, safety, timely completion and all contractual obligations relating to the sub-let portion, as if executed by you directly. This NOC does not create any privity of contract between the Employer and the sub-contractor.</p>` },

    { id:"insurance_reminder", title:"Insurance Compliance Reminder", category:"pm", icon:"🛡️",
      desc:"Remind the contractor to maintain/renew required insurance policies.",
      fields:[ {k:"policyType",l:"Policy Type (e.g. CAR, WC, Third-Party)",required:true}, {k:"expiryDate",l:"Expiry / Due Date",type:"date"} ],
      subject:ctx=>`Insurance Compliance Reminder — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.contractorName)},</p>
        <p>As per the contract for <b>"${esc(ctx.project.name)}"</b>, you are required to maintain valid <b>${esc(f.policyType)}</b> insurance coverage for the full duration of the works.${f.expiryDate?` Our records indicate this policy is due to expire/lapse on <b>${fmtD(f.expiryDate)}</b>.`:""}</p>
        <p>You are requested to renew/furnish evidence of the current policy at the earliest, and in any case before its expiry, and submit a copy to this office. Continuation of work without valid insurance coverage may result in suspension of work and/or financial recovery for any uninsured loss.</p>` },

    /* ---------------------------- Issued by Contractor ---------------------------- */
    { id:"eotcover", title:"Request for Extension of Time (Covering Letter)", category:"contractor", icon:"⏱️",
      desc:"Short covering letter to formally submit an EOT claim to the PM for consideration.",
      fields:[ {k:"claimRef",l:"EOT Claim Reference"}, {k:"days",l:"Days Claimed",type:"number",required:true}, {k:"summary",l:"Brief Summary of Grounds",type:"textarea",required:true} ],
      subject:ctx=>`Request for Extension of Time — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>We write to formally submit our claim for Extension of Time${f.claimRef?` (Ref: ${esc(f.claimRef)})`:""} in respect of <b>"${esc(ctx.project.name)}"</b>, seeking an extension of <b>${esc(f.days)} day(s)</b> to the contract completion date.</p>
        <p><b>Brief Grounds:</b> ${esc(f.summary)}</p>
        <p>The detailed justification, chronology of delay events and supporting annexures are enclosed/available in the EOT Claims module for your review. We request that this be examined at the earliest and a decision communicated to us in accordance with the contract.</p>` },

    { id:"rateanalysis", title:"Submission of Rate Analysis for Extra Items", category:"contractor", icon:"🧮",
      desc:"Submit a detailed rate analysis for work outside the original BOQ scope.",
      fields:[ {k:"itemDesc",l:"Item / Scope Description",type:"textarea",required:true}, {k:"proposedRate",l:"Proposed Rate (₹)",type:"number",required:true}, {k:"unit",l:"Unit"} ],
      subject:ctx=>`Rate Analysis Submission for Extra Item — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>With reference to the additional/extra work instructed on <b>"${esc(ctx.project.name)}"</b>, please find below our rate analysis for the following item, which falls outside the original BOQ scope: ${esc(f.itemDesc)}</p>
        <p><b>Proposed Rate:</b> ${fmtM(f.proposedRate)}${f.unit?` per ${esc(f.unit)}`:""}</p>
        <p>This rate has been derived based on prevailing market rates for material, labour, equipment and applicable overheads/profit as per the contract's rate-analysis basis. We request your review and approval so that this item may be included in measurement and billing.</p>` },

    { id:"materialapproval", title:"Material / Sample Approval Request", category:"contractor", icon:"🧱",
      desc:"Request approval of a material sample before procurement/use on site.",
      fields:[ {k:"material",l:"Material / Item",required:true}, {k:"spec",l:"Specification / Brand Proposed",type:"textarea",required:true} ],
      subject:ctx=>`Material/Sample Approval Request — ${esc("")}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>We wish to seek your approval for the following material proposed for use on <b>"${esc(ctx.project.name)}"</b>: <b>${esc(f.material)}</b></p>
        <p><b>Specification / Brand:</b> ${esc(f.spec)}</p>
        <p>Sample(s)/data sheet(s) are enclosed/available for inspection at site. Kindly review and communicate your approval, or any comments/alternative requirements, so that procurement may proceed without delay to the works.</p>` },

    { id:"drawingrequest", title:"Request for Issue of Drawings / Instructions", category:"contractor", icon:"📐",
      desc:"Request pending drawings or instructions needed to proceed with an activity.",
      fields:[ {k:"item",l:"Drawing / Instruction Required",type:"textarea",required:true}, {k:"neededBy",l:"Required By (Date)",type:"date"} ],
      subject:ctx=>`Request for Drawings/Instructions — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>In order to proceed with the works under <b>"${esc(ctx.project.name)}"</b> without interruption, we request the issue of the following, which remains pending: ${esc(f.item)}</p>
        ${f.neededBy?`<p>As this activity is programmed shortly, we would appreciate receiving the above by <b>${fmtD(f.neededBy)}</b> to avoid any impact on progress.</p>`:""}
        <p>Please note that any delay in issue of the above may affect our programme, and we reserve the right to claim an Extension of Time/cost consequent to such delay, if any.</p>` },

    { id:"paymentfollowup", title:"Payment Follow-up / Reminder Letter", category:"contractor", icon:"💰",
      desc:"Follow up on an overdue RA Bill / payment.",
      fields:[ {k:"billNo",l:"RA Bill / Invoice No."}, {k:"amount",l:"Amount Due (₹)",type:"number",required:true}, {k:"dueDate",l:"Original Due Date",type:"date"} ],
      subject:ctx=>`Payment Reminder — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>We wish to draw your kind attention to our${f.billNo?` RA Bill/Invoice ${esc(f.billNo)}`:" running bill"} for <b>"${esc(ctx.project.name)}"</b>, amounting to <b>${fmtM(f.amount)}</b>, which remains outstanding${f.dueDate?` as against the due date of ${fmtD(f.dueDate)}`:""}.</p>
        <p>Timely payment is critical to maintaining uninterrupted progress of the works, including procurement of material and payment of labour wages. We request you to kindly expedite release of the above payment at the earliest, and confirm the anticipated payment date.</p>` },

    { id:"finalbillcovering", title:"Final Bill Submission Covering Letter", category:"contractor", icon:"🧾",
      desc:"Cover letter for submitting the final bill after completion of works.",
      fields:[ {k:"billNo",l:"Final Bill No.",required:true}, {k:"amount",l:"Final Bill Amount (₹)",type:"number",required:true} ],
      subject:ctx=>`Submission of Final Bill — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>Please find enclosed our Final Bill ${esc(f.billNo)} for the work <b>"${esc(ctx.project.name)}"</b>, amounting to <b>${fmtM(f.amount)}</b>, prepared in accordance with the final measurements jointly recorded and the terms of the contract.</p>
        <p>We request you to kindly verify and certify the same at the earliest, so that final settlement of accounts, and release of retention money/security deposit as applicable, may be processed without delay.</p>` },

    { id:"defectrectification", title:"Defect / Snag Rectification Completion Letter", category:"contractor", icon:"🔧",
      desc:"Confirm that snags/defects noted during the DLP have been rectified.",
      fields:[ {k:"snagList",l:"Snags Rectified (reference list/date)",type:"textarea",required:true}, {k:"date",l:"Date of Rectification",type:"date",required:true} ],
      subject:ctx=>`Confirmation of Defect Rectification — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>This is to confirm that the following defects/snags noted during the Defect Liability Period for <b>"${esc(ctx.project.name)}"</b> have been rectified as on <b>${fmtD(f.date)}</b>: ${esc(f.snagList)}</p>
        <p>We request a joint inspection to be scheduled at your convenience to verify the rectification and enable closure of the Defect Liability Period / release of the corresponding retention/security deposit.</p>` },

    { id:"jointmeasurement", title:"Request for Joint Measurement / Handing Over", category:"contractor", icon:"📏",
      desc:"Request the PM to jointly record measurements and take over completed works.",
      fields:[ {k:"scope",l:"Scope Ready for Measurement/Handover",type:"textarea",required:true}, {k:"proposedDate",l:"Proposed Date for Joint Inspection",type:"date"} ],
      subject:ctx=>`Request for Joint Measurement / Handing Over — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear ${esc(ctx.pmName)},</p>
        <p>The following portion of the works under <b>"${esc(ctx.project.name)}"</b> is now complete and ready for joint measurement/handover: ${esc(f.scope)}</p>
        ${f.proposedDate?`<p>We propose <b>${fmtD(f.proposedDate)}</b> for a joint site inspection and measurement, and request your representative's availability accordingly.</p>`:"<p>We request you to kindly arrange a joint site inspection and measurement at your earliest convenience.</p>"}` },

    /* ---------------------------- Either party ---------------------------- */
    { id:"forcemajeure", title:"Force Majeure Notice", category:"either", icon:"🌪️",
      desc:"Notify the other party of a force majeure event affecting the works.",
      fields:[ {k:"event",l:"Nature of Force Majeure Event",type:"textarea",required:true}, {k:"startDate",l:"Event Start Date",type:"date",required:true}, {k:"impact",l:"Anticipated Impact on Programme",type:"textarea"} ],
      subject:ctx=>`Force Majeure Notice — ${ctx.project.name}`,
      body:(ctx,f)=>`
        <p>Dear Sir/Madam,</p>
        <p>We hereby notify you, in accordance with the contract, of a Force Majeure event affecting the works under <b>"${esc(ctx.project.name)}"</b>, commencing <b>${fmtD(f.startDate)}</b>: ${esc(f.event)}</p>
        ${f.impact?`<p><b>Anticipated Impact:</b> ${esc(f.impact)}</p>`:""}
        <p>We reserve all rights available under the contract in relation to this event, including relief from performance obligations and/or claim for Extension of Time, for the duration the Force Majeure event and its consequences subsist. We shall keep you updated on the situation and its resolution.</p>` },

    { id:"generalcover", title:"General Covering / Transmittal Letter", category:"either", icon:"✉️",
      desc:"A flexible, general-purpose covering letter for any document/submission not covered above.",
      fields:[ {k:"subjectLine",l:"Subject",required:true}, {k:"body",l:"Letter Body",type:"textarea",required:true} ],
      subject:ctx=>``,
      body:(ctx,f)=>`<p>${esc(f.body).replace(/\n\n+/g,"</p><p>").replace(/\n/g,"<br>")}</p>`,
      overrideSubject:true }
  ];

  const CATEGORY_LABEL = { pm:"Issued by Project Manager", contractor:"Issued by Contractor", either:"Either Party" };

  function list(){ return TEMPLATES; }
  function get(id){ return TEMPLATES.find(t=>t.id===id) || null; }

  global.SW = global.SW || {};
  global.SW.LetterTemplates = { TEMPLATES, CATEGORY_LABEL, list, get };
})(window);
