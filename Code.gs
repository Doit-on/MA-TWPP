/**
 * ============================================================================
 * FACILITY MAINTENANCE MANAGEMENT SYSTEM (FMMS) - ENTERPRISE EDITION
 * Backend API & Database Controller (Google Apps Script)
 * ============================================================================
 * Connected Resources:
 * - Google Sheets (Data MA TWPP): 1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ
 * - Google Drive (Root Storage):  1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx
 *
 * Security & Reliability Standards:
 * 1. Mutex Concurrency Lock (LockService) to prevent duplicate Document/Task IDs
 * 2. Automated & On-Demand Snapshot Backups to Google Drive & Sheet validation
 * 3. Real-time Connection Health Check & Ping Diagnostics
 * 4. Comprehensive Error Boundary, Validation, and Before/After Audit Trail
 * 5. Strict Operator Identity & Timestamp Recording on all User/System Settings
 * 6. Zero-Touch Device Provisioning via QR Code Payload Verification
 * 7. Cost_References (Standard Rate Card) & Document_Revisions (Version Control)
 *    with strict Role-Level 2 (Supervisor-Only) Document Editing Enforcement
 * 8. Export Report Data directly to a new Google Sheet in Drive & .xls format
 * ============================================================================
 */

const CONFIG = {
  SPREADSHEET_ID: '1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ',
  DRIVE_FOLDER_ID: '1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx',
  SYSTEM_NAME: 'FMMS - Data MA TWPP',
  VERSION: '2.9.4-ENT',
  TIMEZONE: 'Asia/Bangkok',
  SHEETS: {
    USERS: 'Users',
    TASKS: 'Tasks',
    SCHEDULES: 'Preventive_Schedules',
    MEMOS: 'Approval_Memos',
    COST_REFS: 'Cost_References',
    DOC_REVISIONS: 'Document_Revisions',
    LOGS: 'System_Logs',
    SETTINGS: 'System_Settings',
    PROJECTS: 'Pilot_Projects',
    MILESTONES: 'Project_Milestones'
  }
};

/**
 * Schemas for each tab in Google Sheets (8 Tabs)
 */
const SCHEMAS = {
  Users: [
    'UserID', 'Username', 'PasswordHash', 'FullName', 'RoleLevel',
    'Department', 'Phone', 'Status', 'CreatedAt', 'CreatedBy',
    'UpdatedAt', 'UpdatedBy', 'LastLoginAt'
  ],
  Tasks: [
    'TaskID', 'DocVersion', 'Type', 'Category', 'Title', 'Location',
    'Description', 'InitialAnalysis', 'MaterialsRequired', 'CostRefIDs', 'Priority', 'Status',
    'AssignedContractorID', 'AssignedContractorName', 'SupervisorID', 'SupervisorName',
    'EstCost', 'ActualCost', 'BeforeImgURL', 'AfterImgURL',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy', 'IdempotencyKey'
  ],
  Preventive_Schedules: [
    'ScheduleID', 'DocVersion', 'EquipmentCode', 'EquipmentName', 'Category', 'Location',
    'Frequency', 'NextDueDate', 'AssignedTeam', 'ChecklistItems', 'Status',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
  ],
  Approval_Memos: [
    'MemoID', 'DocVersion', 'TaskID', 'DocReference', 'Subject', 'EstimatedBudget',
    'ReasonRationale', 'CostBreakdownJSON', 'VendorName', 'VendorQuotationURL', 'SupervisorRemark',
    'RequestedBy', 'RequestedAt', 'ApprovedBy', 'ApproverName', 'ApprovalDate',
    'ApprovalStatus', 'ExecutiveComment', 'UpdatedAt', 'UpdatedBy'
  ],
  Cost_References: [
    'CostRefID', 'RefVersion', 'Category', 'ItemCode', 'ItemName',
    'Specification', 'Unit', 'StandardUnitPrice', 'LaborRate', 'TotalStandardCost',
    'PreferredVendor', 'EffectiveDate', 'Status', 'UpdatedAt', 'UpdatedBy'
  ],
  Document_Revisions: [
    'RevisionID', 'DocumentID', 'DocumentType', 'VersionNumber', 'ChangeReason',
    'ChangedByUserID', 'ChangedByName', 'ChangedByRole', 'Timestamp',
    'BeforeSnapshotJSON', 'AfterSnapshotJSON'
  ],
  System_Logs: [
    'LogID', 'Timestamp', 'UserID', 'OperatorName', 'RoleLevel',
    'Action', 'TargetID', 'DocVersion', 'Details', 'BeforeState', 'AfterState',
    'ClientInfo', 'Status'
  ],
  System_Settings: [
    'SettingKey', 'SettingValue', 'Description', 'UpdatedAt', 'UpdatedBy', 'OperatorName'
  ],
  Pilot_Projects: [
    'ProjectID', 'DocVersion', 'ContractNo', 'ContractTitle', 'Category', 'Location',
    'ContractorName', 'ContractorPhone', 'TotalBudget', 'RetentionPercent', 'RetentionAmount',
    'PaymentMode', 'StartDate', 'EndDate', 'WarrantyMonths', 'ContractFileURL', 'Status',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
  ],
  Project_Milestones: [
    'MilestoneID', 'ProjectID', 'MilestoneNo', 'MilestoneTitle', 'Description',
    'Percentage', 'Amount', 'RetentionDeducted', 'NetPayable', 'DueDate',
    'WorkStatus', 'PaymentStatus', 'InspectionDate', 'InspectorName', 'InspectorNotes',
    'InspectionPhotosJSON', 'PaymentDate', 'PaidBy', 'PaymentSlipURL', 'PaymentVoucherNo',
    'UpdatedAt', 'UpdatedBy'
  ]
};

/**
 * HTTP GET Handler - Supports health check, initial sync, and provisioning verification
 */
function doGet(e) {
  const startTime = new Date().getTime();
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'ping';

    if (action === 'ping') {
      return jsonResponse(handlePing(startTime));
    }

    if (action === 'bootstrap') {
      ensureDatabaseReady();
      return jsonResponse(handleBootstrap(params, startTime));
    }

    return jsonResponse({
      ok: true,
      service: CONFIG.SYSTEM_NAME,
      version: CONFIG.VERSION,
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      driveFolderId: CONFIG.DRIVE_FOLDER_ID,
      timestamp: formatISO(new Date()),
      message: 'FMMS Enterprise API Endpoint is active.'
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      errorCode: 'ERR-GAS-GET-500',
      message: err.message || String(err),
      stack: err.stack || '',
      timestamp: formatISO(new Date())
    });
  }
}

/**
 * HTTP POST Handler - Main API Router for all mutations and queries
 */
function doPost(e) {
  const startTime = new Date().getTime();
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || 'ping';
    const actor = payload.actor || {
      userId: 'SYSTEM',
      fullName: 'System Anonymous',
      roleLevel: 0,
      clientInfo: payload.clientInfo || 'Web-SPA'
    };

    ensureDatabaseReady();

    let result;
    switch (action) {
      case 'ping':
        result = handlePing(startTime);
        break;
      case 'bootstrap':
        result = handleBootstrap(payload, startTime);
        break;
      case 'login':
        result = handleLogin(payload, actor);
        break;
      case 'createTask':
        result = handleCreateTask(payload, actor);
        break;
      case 'updateTask':
      case 'updateTaskBySupervisor':
        result = handleSupervisorEditDocument(payload, actor);
        break;
      case 'uploadImage':
        result = handleUploadImage(payload, actor);
        break;
      case 'generateMemo':
      case 'updateMemoBySupervisor':
        result = handleGenerateOrUpdateMemo(payload, actor);
        break;
      case 'saveCostReference':
        result = handleSaveCostReference(payload, actor);
        break;
      case 'executiveApprove':
        result = handleExecutiveApprove(payload, actor);
        break;
      case 'deleteTask':
        result = handleDeleteTask(payload, actor);
        break;
      case 'createSchedule':
        result = handleCreateSchedule(payload, actor);
        break;
      case 'exportToGoogleSheet':
        result = handleExportToGoogleSheet(payload, actor);
        break;
      case 'adminManageUser':
        result = handleAdminManageUser(payload, actor);
        break;
      case 'adminUpdateSettings':
        result = handleAdminUpdateSettings(payload, actor);
        break;
      case 'triggerBackup':
        result = handleBackupToDrive(payload, actor);
        break;
      case 'verifyIdIntegrity':
        result = handleVerifyIntegrity(payload, actor);
        break;
      case 'savePilotProject':
        result = handleSavePilotProject(payload, actor);
        break;
      case 'deletePilotProject':
        result = handleDeletePilotProject(payload, actor);
        break;
      case 'saveProjectMilestones':
        result = handleSaveProjectMilestones(payload, actor);
        break;
      case 'inspectMilestone':
        result = handleInspectMilestone(payload, actor);
        break;
      case 'payoutMilestone':
        result = handlePayoutMilestone(payload, actor);
        break;
      case 'testLineNotification':
        result = handleTestLineNotification(payload, actor);
        break;
      default:
        throw new Error('Unknown API action: ' + action);
    }

    result.latencyMs = new Date().getTime() - startTime;
    result.serverTimestamp = formatISO(new Date());
    return jsonResponse(result);

  } catch (err) {
    try {
      writeAuditLog({
        userId: 'SYSTEM_ERR',
        operatorName: 'Error Boundary',
        roleLevel: 0,
        action: 'SYSTEM_ERROR',
        targetId: 'API',
        docVersion: '-',
        details: err.message || String(err),
        beforeState: '',
        afterState: err.stack || '',
        clientInfo: 'GAS-doPost',
        status: 'ERROR'
      });
    } catch (_) {}

    return jsonResponse({
      ok: false,
      errorCode: 'ERR-GAS-POST-500',
      message: err.message || String(err),
      timestamp: formatISO(new Date()),
      latencyMs: new Date().getTime() - startTime
    });
  }
}

/**
 * ============================================================================
 * 1. DATABASE INITIALIZATION & SEEDING (8 SHEETS)
 * ============================================================================
 */

function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getRootDriveFolder() {
  return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
}

function ensureDatabaseReady() {
  const ss = getSpreadsheet();
  Object.keys(SCHEMAS).forEach(function(sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SCHEMAS[sheetName];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#0F172A')
        .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    } else if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });

  const now = formatISO(new Date());

  // Seed default users if empty
  const userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  if (userSheet && userSheet.getLastRow() <= 1) {
    const seedUsers = [
      ['USR-2026-0001', 'admin', hashPassword('admin123'), 'คุณนิพนธ์ (System Admin & Executive)', 3, 'บริหารจัดการอาคาร / วิศวกรรม', '081-000-0001', 'Active', now, 'SYSTEM_INIT', now, 'SYSTEM_INIT', now],
      ['USR-2026-0002', 'supervisor', hashPassword('sup123'), 'วิศวกร พรเทพ ใจดี (Supervisor)', 2, 'วิศวกรรมซ่อมบำรุง (MEP)', '081-000-0002', 'Active', now, 'USR-2026-0001', now, 'USR-2026-0001', now],
      ['USR-2026-0003', 'tech01', hashPassword('tech123'), 'นายช่าง สมชาย สายลุย (Contractor)', 1, 'ทีมซ่อมบำรุงภาคสนาม A', '081-000-0003', 'Active', now, 'USR-2026-0001', now, 'USR-2026-0001', now]
    ];
    userSheet.getRange(2, 1, seedUsers.length, seedUsers[0].length).setValues(seedUsers);
  }

  // Seed default Cost_References if empty
  const costSheet = ss.getSheetByName(CONFIG.SHEETS.COST_REFS);
  if (costSheet && costSheet.getLastRow() <= 1) {
    const seedCosts = [
      ['COST-2026-0001', 'v1.0', 'แอร์/เครื่องกล', 'MAT-HVAC-001', 'คอยล์โซลินอยด์วาล์วน้ำเย็น 24VAC + ล้างสเตรนเนอร์', 'Danfoss / Honeywell Standard', 'ชุด', 9500, 5000, 14500, 'หจก. ไทยคูลลิ่ง เอ็นจิเนียริ่ง', '2026-01-01', 'Active', now, 'USR-2026-0002 (วิศวกร พรเทพ)'],
      ['COST-2026-0002', 'v1.0', 'ประปา/สุขาภิบาล', 'MAT-PLB-002', 'ชุด Mechanical Seal SIC/SIC + ลูกปืน SKF 6306 (โอเวอร์ฮอลปั๊ม)', 'Grundfos CR Series Compatible', 'ชุด', 28500, 10000, 38500, 'บจก. สยามเมคคานิคอล ซัพพลาย', '2026-01-01', 'Active', now, 'USR-2026-0002 (วิศวกร พรเทพ)'],
      ['COST-2026-0003', 'v1.0', 'ไฟฟ้า', 'MAT-ELE-003', 'งานส่องกล้องความร้อน Thermoscan ตู้ MDB และทำความสะอาดจุดต่อ', 'มาตรฐานวิศวกรรมสถาน (วสท.)', 'งาน', 4000, 8000, 12000, 'บจก. พาวเวอร์เทค เซอร์วิส', '2026-01-01', 'Active', now, 'USR-2026-0002 (วิศวกร พรเทพ)']
    ];
    costSheet.getRange(2, 1, seedCosts.length, seedCosts[0].length).setValues(seedCosts);
  }
}

function handlePing(startTime) {
  let sheetOk = false;
  let driveOk = false;
  let sheetName = '';
  let driveName = '';

  try {
    const ss = getSpreadsheet();
    sheetName = ss.getName();
    sheetOk = true;
  } catch (e) {
    sheetName = 'Error: ' + e.message;
  }

  try {
    const folder = getRootDriveFolder();
    driveName = folder.getName();
    driveOk = true;
  } catch (e) {
    driveName = 'Error: ' + e.message;
  }

  return {
    ok: sheetOk && driveOk,
    status: (sheetOk && driveOk) ? 'ONLINE' : 'DEGRADED',
    system: CONFIG.SYSTEM_NAME,
    version: CONFIG.VERSION,
    resources: {
      spreadsheet: { id: CONFIG.SPREADSHEET_ID, name: sheetName, connected: sheetOk },
      driveFolder: { id: CONFIG.DRIVE_FOLDER_ID, name: driveName, connected: driveOk }
    },
    latencyMs: new Date().getTime() - startTime,
    timestamp: formatISO(new Date())
  };
}

function handleBootstrap(params, startTime) {
  const ss = getSpreadsheet();
  const users = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.USERS)).map(function(u) {
    delete u.PasswordHash;
    return u;
  });
  const tasks = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.TASKS));
  const schedules = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.SCHEDULES));
  const memos = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.MEMOS));
  const costRefs = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.COST_REFS));
  const docRevisions = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.DOC_REVISIONS)).slice(-150).reverse();
  const logs = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.LOGS)).slice(-150).reverse();
  const settings = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.SETTINGS));

  const projects = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.PROJECTS));
  const milestones = sheetToObjects(ss.getSheetByName(CONFIG.SHEETS.MILESTONES));

  return {
    ok: true,
    version: CONFIG.VERSION,
    data: {
      users: users,
      tasks: tasks,
      schedules: schedules,
      memos: memos,
      costRefs: costRefs,
      docRevisions: docRevisions,
      logs: logs,
      settings: settings,
      projects: projects,
      milestones: milestones
    },
    resources: {
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      driveFolderId: CONFIG.DRIVE_FOLDER_ID
    },
    latencyMs: new Date().getTime() - startTime
  };
}

/**
 * ============================================================================
 * 2. CONCURRENCY-SAFE UNIQUE DOCUMENT ID & VERSION CONTROL ENGINE
 * ============================================================================
 */

function generateUniqueDocId(sheetName, idColumnIndex, prefix) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  let maxSeq = 0;

  if (lastRow > 1) {
    const existingIds = sheet.getRange(2, idColumnIndex, lastRow - 1, 1).getValues();
    for (let i = 0; i < existingIds.length; i++) {
      const val = String(existingIds[i][0] || '').trim();
      if (val.indexOf(prefix + '-') === 0) {
        const parts = val.split('-');
        const seqStr = parts[parts.length - 1];
        const seqNum = parseInt(seqStr, 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }
  }

  const nextSeq = maxSeq + 1;
  const padded = ('0000' + nextSeq).slice(-4);
  return prefix + '-' + padded;
}

function incrementDocVersion(currentVersionStr) {
  if (!currentVersionStr) return 'v1.0';
  const clean = String(currentVersionStr).replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  const major = parseInt(parts[0] || '1', 10);
  const minor = parseInt(parts[1] || '0', 10) + 1;
  return 'v' + major + '.' + minor;
}

function recordDocumentRevision(docId, docType, newVersion, reason, actor, beforeObj, afterObj) {
  const ss = getSpreadsheet();
  const revSheet = ss.getSheetByName(CONFIG.SHEETS.DOC_REVISIONS);
  if (!revSheet) return;

  const prefix = 'REV-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMM');
  const revId = generateUniqueDocId(CONFIG.SHEETS.DOC_REVISIONS, 1, prefix);
  const now = formatISO(new Date());

  revSheet.appendRow([
    revId,
    docId,
    docType,
    newVersion,
    reason || 'แก้ไขข้อมูลเอกสารโดยผู้ควบคุมงาน (Supervisor)',
    actor.userId || 'USR-2026-0002',
    actor.fullName || 'Supervisor',
    Number(actor.roleLevel || 2),
    now,
    JSON.stringify(beforeObj || {}),
    JSON.stringify(afterObj || {})
  ]);

  return revId;
}

/**
 * ============================================================================
 * 3. TASK CREATION & SUPERVISOR-ONLY DOCUMENT EDITING (STRICT ROLE = 2)
 * ============================================================================
 */

function handleCreateTask(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const taskData = payload.taskData || {};
    const idempotencyKey = String(payload.idempotencyKey || '').trim();

    if (idempotencyKey) {
      const existingTasks = sheetToObjects(sheet);
      for (let i = 0; i < existingTasks.length; i++) {
        if (existingTasks[i].IdempotencyKey === idempotencyKey) {
          return {
            ok: true,
            duplicatePrevented: true,
            taskId: existingTasks[i].TaskID,
            docVersion: existingTasks[i].DocVersion || 'v1.0',
            message: 'ตรวจพบการส่งซ้ำ ระบบใช้รหัสงานเดิม: ' + existingTasks[i].TaskID
          };
        }
      }
    }

    const typePrefix = (taskData.Type === 'PM') ? 'PM' : 'CM';
    const ymPrefix = typePrefix + '-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMM');
    const newTaskId = (taskData.TaskID && String(taskData.TaskID).trim()) ? String(taskData.TaskID).trim() : generateUniqueDocId(CONFIG.SHEETS.TASKS, 1, ymPrefix);
    const initialVersion = 'v1.0';
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let beforeUrl = taskData.BeforeImgURL || '';
    let afterUrl = taskData.AfterImgURL || '';

    if (taskData.BeforeImgBase64) {
      try {
        beforeUrl = saveBase64ToDriveFolder(newTaskId, 'BEFORE', taskData.BeforeImgBase64).url;
      } catch (eDrive1) {
        beforeUrl = taskData.BeforeImgURL || '';
      }
    }
    if (taskData.AfterImgBase64) {
      try {
        afterUrl = saveBase64ToDriveFolder(newTaskId, 'AFTER', taskData.AfterImgBase64).url;
      } catch (eDrive2) {
        afterUrl = taskData.AfterImgURL || '';
      }
    }

    const newRow = [
      newTaskId,
      initialVersion,
      typePrefix,
      taskData.Category || 'ทั่วไป',
      taskData.Title || '-',
      taskData.Location || '-',
      taskData.Description || '-',
      taskData.InitialAnalysis || '-',
      taskData.MaterialsRequired || '-',
      taskData.CostRefIDs || '-',
      taskData.Priority || 'Normal',
      taskData.Status || 'Pending Level 2 Approval',
      taskData.AssignedContractorID || actor.userId,
      taskData.AssignedContractorName || actor.fullName,
      taskData.SupervisorID || 'USR-2026-0002',
      taskData.SupervisorName || 'วิศวกร พรเทพ ใจดี',
      Number(taskData.EstCost || 0),
      Number(taskData.ActualCost || 0),
      beforeUrl,
      afterUrl,
      now,
      operatorStamp,
      now,
      operatorStamp,
      idempotencyKey || Utilities.getUuid()
    ];

    sheet.appendRow(newRow);

    // Also auto-append linked Memo to MEMOS sheet so Supervisor and Executive see it immediately
    const memo = payload.memoData || taskData.memoData;
    if (memo) {
      const memoSheet = ss.getSheetByName(CONFIG.SHEETS.MEMOS);
      if (memoSheet) {
        memoSheet.appendRow([
          memo.MemoID || ('MEMO-2026-' + newTaskId.split('-').pop()),
          newTaskId,
          memo.DocReference || ('ทวพ./ซบร./2569/' + newTaskId.split('-').pop()),
          memo.Subject || ('ขออนุมัติงบประมาณ: ' + (taskData.Title || '-')),
          Number(memo.EstimatedBudget || taskData.EstCost || 0),
          memo.ReasonRationale || taskData.Description || '-',
          memo.VendorName || 'ผู้รับเหมาตามทะเบียนมาตรฐาน',
          memo.VendorQuotationURL || ('QT-' + newTaskId),
          memo.SupervisorRemark || 'รอการตรวจสอบและอนุมัติซ่อม',
          memo.RequestedBy || operatorStamp,
          now,
          '-',
          '-',
          '-',
          'Pending Approval',
          '-'
        ]);
      }
    }

    recordDocumentRevision(
      newTaskId,
      'TASK',
      initialVersion,
      'สร้างเอกสารใบงานครั้งแรก (Initial Creation)',
      actor,
      { status: 'NONE' },
      { TaskID: newTaskId, DocVersion: initialVersion, Title: newRow[4], EstCost: newRow[16] }
    );

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'CREATE_TASK',
      targetId: newTaskId,
      docVersion: initialVersion,
      details: 'Created ' + typePrefix + ' task: ' + taskData.Title + ' (' + initialVersion + ')',
      beforeState: 'NONE',
      afterState: JSON.stringify({ TaskID: newTaskId, DocVersion: initialVersion, EstCost: newRow[16] }),
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    // Hook: LINE Notification on New Task
    try {
      const lineMsg = '📌 [มีงานใหม่เข้ามาในระบบ FMMS]\n' +
        'รหัสใบงาน: ' + newTaskId + ' (' + initialVersion + ')\n' +
        'หัวข้อ: ' + (taskData.Title || '-') + '\n' +
        'ประเภท: ' + typePrefix + ' | หมวด: ' + (taskData.Category || 'ทั่วไป') + '\n' +
        'สถานที่: ' + (taskData.Location || '-') + '\n' +
        'ความเร่งด่วน: ' + (taskData.Priority || 'Normal') + '\n' +
        'ประมาณการงบ: ' + Number(taskData.EstCost || 0).toLocaleString() + ' บาท\n' +
        'ผู้แจ้งงาน: ' + actor.fullName + '\n' +
        'สถานะ: ' + (taskData.Status || 'Pending Level 2 Approval');
      sendLineNotification(lineMsg);
    } catch (eLine1) {
      Logger.log('Line notify on task create failed: ' + eLine1);
    }

    return {
      ok: true,
      taskId: newTaskId,
      docVersion: initialVersion,
      beforeImgUrl: beforeUrl,
      afterImgUrl: afterUrl,
      createdAt: now,
      createdBy: operatorStamp,
      message: 'สร้างใบงาน ' + newTaskId + ' (' + initialVersion + ') สำเร็จ'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Strict Role-Level 2 (Supervisor-Only) Document Editing Enforcement
 */
function handleSupervisorEditDocument(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // STRICT RULE: Only Role Level 2 (Supervisor) is allowed to edit existing generated documents
    if (Number(actor.roleLevel) < 2) {
      writeAuditLog({
        userId: actor.userId,
        operatorName: actor.fullName,
        roleLevel: actor.roleLevel,
        action: 'UNAUTHORIZED_DOC_EDIT_BLOCKED',
        targetId: (payload.taskData && payload.taskData.TaskID) || 'UNKNOWN',
        docVersion: '-',
        details: 'ปฏิเสธการแก้ไขเอกสาร: สิทธิ์ระดับ ' + actor.roleLevel + ' ไม่ได้รับอนุญาต (อนุญาตเฉพาะระดับ 2 Supervisor และระดับ 3 Executive เท่านั้น)',
        beforeState: '',
        afterState: 'BLOCKED',
        clientInfo: actor.clientInfo || '',
        status: 'DENIED'
      });
      throw new Error('ปฏิเสธคำขอ: กฎความปลอดภัยอนุญาตให้เฉพาะ "ระดับ 2 ผู้ควบคุมงาน (Supervisor)" เท่านั้นที่สามารถแก้ไขเอกสารที่สร้างแล้วได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const rows = sheetToObjects(sheet);
    const taskData = payload.taskData || {};
    const targetId = taskData.TaskID;

    let rowIndex = -1;
    let current = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].TaskID === targetId) {
        rowIndex = i + 2;
        current = rows[i];
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('ไม่พบใบงานรหัส ' + targetId);
    }

    const nextVersion = incrementDocVersion(current.DocVersion || 'v1.0');
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let beforeUrl = taskData.BeforeImgURL !== undefined ? taskData.BeforeImgURL : current.BeforeImgURL;
    let afterUrl = taskData.AfterImgURL !== undefined ? taskData.AfterImgURL : current.AfterImgURL;

    if (taskData.BeforeImgBase64) {
      beforeUrl = saveBase64ToDriveFolder(targetId, 'BEFORE', taskData.BeforeImgBase64).url;
    }
    if (taskData.AfterImgBase64) {
      afterUrl = saveBase64ToDriveFolder(targetId, 'AFTER', taskData.AfterImgBase64).url;
    }

    const updatedRow = [
      current.TaskID,
      nextVersion,
      taskData.Type || current.Type,
      taskData.Category || current.Category,
      taskData.Title || current.Title,
      taskData.Location || current.Location,
      taskData.Description !== undefined ? taskData.Description : current.Description,
      taskData.InitialAnalysis !== undefined ? taskData.InitialAnalysis : current.InitialAnalysis,
      taskData.MaterialsRequired !== undefined ? taskData.MaterialsRequired : current.MaterialsRequired,
      taskData.CostRefIDs !== undefined ? taskData.CostRefIDs : (current.CostRefIDs || '-'),
      taskData.Priority || current.Priority,
      taskData.Status || current.Status,
      taskData.AssignedContractorID || current.AssignedContractorID,
      taskData.AssignedContractorName || current.AssignedContractorName,
      actor.userId,
      actor.fullName,
      taskData.EstCost !== undefined ? Number(taskData.EstCost) : Number(current.EstCost || 0),
      taskData.ActualCost !== undefined ? Number(taskData.ActualCost) : Number(current.ActualCost || 0),
      beforeUrl,
      afterUrl,
      current.CreatedAt,
      current.CreatedBy,
      now,
      operatorStamp,
      current.IdempotencyKey || ''
    ];

    sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

    const revId = recordDocumentRevision(
      targetId,
      'TASK',
      nextVersion,
      payload.changeReason || 'Supervisor แก้ไขข้อมูลใบงาน/อ้างอิงค่าใช้จ่าย',
      actor,
      { DocVersion: current.DocVersion, Title: current.Title, Status: current.Status, EstCost: current.EstCost, ActualCost: current.ActualCost, CostRefIDs: current.CostRefIDs },
      { DocVersion: nextVersion, Title: updatedRow[4], Status: updatedRow[11], EstCost: updatedRow[16], ActualCost: updatedRow[17], CostRefIDs: updatedRow[9] }
    );

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'SUPERVISOR_EDIT_DOCUMENT',
      targetId: targetId,
      docVersion: nextVersion,
      details: 'Supervisor แก้ไขใบงาน ' + targetId + ' อัปเดตเป็น ' + nextVersion + ' (Rev: ' + revId + ')',
      beforeState: JSON.stringify({ v: current.DocVersion, Status: current.Status, EstCost: current.EstCost }),
      afterState: JSON.stringify({ v: nextVersion, Status: updatedRow[11], EstCost: updatedRow[16] }),
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    return {
      ok: true,
      taskId: targetId,
      docVersion: nextVersion,
      revisionId: revId,
      updatedAt: now,
      updatedBy: operatorStamp,
      message: 'บันทึกการแก้ไขเอกสาร ' + targetId + ' (' + nextVersion + ') สำเร็จ'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 4. COST REFERENCES & APPROVAL MEMO VERSIONING (SUPERVISOR LEVEL 2)
 * ============================================================================
 */

function handleSaveCostReference(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (Number(actor.roleLevel) < 2) {
      throw new Error('เฉพาะระดับ 2 ผู้ควบคุมงาน (Supervisor) เท่านั้นที่สามารถเพิ่มหรือแก้ไขตารางอ้างอิงค่าใช้จ่ายได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.COST_REFS);
    const rows = sheetToObjects(sheet);
    const item = payload.costData || {};
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let targetId = item.CostRefID;
    let existingIndex = -1;
    let current = null;

    if (targetId) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].CostRefID === targetId) {
          existingIndex = i + 2;
          current = rows[i];
          break;
        }
      }
    }

    const unitPrice = Number(item.StandardUnitPrice || 0);
    const laborRate = Number(item.LaborRate || 0);
    const totalStd = unitPrice + laborRate;

    if (existingIndex !== -1 && current) {
      const nextVer = incrementDocVersion(current.RefVersion || 'v1.0');
      const updatedRow = [
        current.CostRefID,
        nextVer,
        item.Category || current.Category,
        item.ItemCode || current.ItemCode,
        item.ItemName || current.ItemName,
        item.Specification || current.Specification,
        item.Unit || current.Unit,
        unitPrice,
        laborRate,
        totalStd,
        item.PreferredVendor || current.PreferredVendor,
        item.EffectiveDate || current.EffectiveDate,
        item.Status || 'Active',
        now,
        operatorStamp
      ];
      sheet.getRange(existingIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

      recordDocumentRevision(
        current.CostRefID,
        'COST_REF',
        nextVer,
        payload.changeReason || 'ปรับปรุงราคามาตรฐานอ้างอิง',
        actor,
        current,
        { CostRefID: current.CostRefID, RefVersion: nextVer, TotalStandardCost: totalStd }
      );

      return { ok: true, costRefId: current.CostRefID, refVersion: nextVer, updatedAt: now };
    } else {
      const prefix = 'COST-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
      const newCostId = generateUniqueDocId(CONFIG.SHEETS.COST_REFS, 1, prefix);
      const initVer = 'v1.0';

      const newRow = [
        newCostId,
        initVer,
        item.Category || 'ทั่วไป',
        item.ItemCode || 'MAT-GEN-001',
        item.ItemName || '-',
        item.Specification || '-',
        item.Unit || 'ชุด',
        unitPrice,
        laborRate,
        totalStd,
        item.PreferredVendor || '-',
        Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'),
        'Active',
        now,
        operatorStamp
      ];
      sheet.appendRow(newRow);

      recordDocumentRevision(newCostId, 'COST_REF', initVer, 'สร้างรายการอ้างอิงค่าใช้จ่ายใหม่', actor, {}, { CostRefID: newCostId, TotalStandardCost: totalStd });
      return { ok: true, costRefId: newCostId, refVersion: initVer, createdAt: now };
    }
  } finally {
    lock.releaseLock();
  }
}

function handleGenerateOrUpdateMemo(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (Number(actor.roleLevel) !== 2) {
      throw new Error('เฉพาะระดับ 2 ผู้ควบคุมงาน (Supervisor) เท่านั้นที่สามารถสร้างหรือแก้ไขบันทึกข้อความขออนุมัติได้');
    }

    const ss = getSpreadsheet();
    const memoSheet = ss.getSheetByName(CONFIG.SHEETS.MEMOS);
    const taskSheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const memos = sheetToObjects(memoSheet);
    const memoData = payload.memoData || {};
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let existingIdx = -1;
    let currentMemo = null;
    for (let i = 0; i < memos.length; i++) {
      if (memos[i].MemoID === memoData.MemoID || (memoData.TaskID && memos[i].TaskID === memoData.TaskID)) {
        existingIdx = i + 2;
        currentMemo = memos[i];
        break;
      }
    }

    let memoId = '';
    let docVersion = 'v1.0';

    if (existingIdx !== -1 && currentMemo) {
      memoId = currentMemo.MemoID;
      docVersion = incrementDocVersion(currentMemo.DocVersion || 'v1.0');
      const updatedRow = [
        memoId,
        docVersion,
        currentMemo.TaskID,
        memoData.DocReference || currentMemo.DocReference,
        memoData.Subject || currentMemo.Subject,
        Number(memoData.EstimatedBudget || currentMemo.EstimatedBudget || 0),
        memoData.ReasonRationale || currentMemo.ReasonRationale,
        memoData.CostBreakdownJSON || currentMemo.CostBreakdownJSON || '[]',
        memoData.VendorName || currentMemo.VendorName,
        memoData.VendorQuotationURL || currentMemo.VendorQuotationURL,
        memoData.SupervisorRemark || currentMemo.SupervisorRemark,
        currentMemo.RequestedBy,
        currentMemo.RequestedAt,
        currentMemo.ApprovedBy || '-',
        currentMemo.ApproverName || '-',
        currentMemo.ApprovalDate || '-',
        'Pending Approval',
        currentMemo.ExecutiveComment || '-',
        now,
        operatorStamp
      ];
      memoSheet.getRange(existingIdx, 1, 1, updatedRow.length).setValues([updatedRow]);

      recordDocumentRevision(
        memoId,
        'MEMO',
        docVersion,
        payload.changeReason || 'Supervisor แก้ไขรายละเอียดบันทึกข้อความขออนุมัติ',
        actor,
        { DocVersion: currentMemo.DocVersion, EstimatedBudget: currentMemo.EstimatedBudget, ReasonRationale: currentMemo.ReasonRationale },
        { DocVersion: docVersion, EstimatedBudget: updatedRow[5], ReasonRationale: updatedRow[6] }
      );
    } else {
      const yearPrefix = 'MEMO-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
      memoId = generateUniqueDocId(CONFIG.SHEETS.MEMOS, 1, yearPrefix);
      docVersion = 'v1.0';

      const newRow = [
        memoId,
        docVersion,
        memoData.TaskID,
        memoData.DocReference || ('ทวพ./ซบร./' + memoId),
        memoData.Subject || ('ขออนุมัติงบประมาณซ่อมบำรุงใบงาน ' + memoData.TaskID),
        Number(memoData.EstimatedBudget || 0),
        memoData.ReasonRationale || '-',
        memoData.CostBreakdownJSON || '[]',
        memoData.VendorName || '-',
        memoData.VendorQuotationURL || '-',
        memoData.SupervisorRemark || '-',
        operatorStamp,
        now,
        '-',
        '-',
        '-',
        'Pending Approval',
        '-',
        now,
        operatorStamp
      ];
      memoSheet.appendRow(newRow);

      recordDocumentRevision(
        memoId,
        'MEMO',
        docVersion,
        'สร้างบันทึกข้อความขออนุมัติครั้งแรก',
        actor,
        { status: 'NONE' },
        { MemoID: memoId, DocVersion: docVersion, EstimatedBudget: newRow[5] }
      );
    }

    // Update linked Task status
    const tasks = sheetToObjects(taskSheet);
    for (let j = 0; j < tasks.length; j++) {
      if (tasks[j].TaskID === memoData.TaskID) {
        taskSheet.getRange(j + 2, 12).setValue('Pending Approval');
        taskSheet.getRange(j + 2, 17).setValue(Number(memoData.EstimatedBudget || tasks[j].EstCost || 0));
        taskSheet.getRange(j + 2, 23).setValue(now);
        taskSheet.getRange(j + 2, 24).setValue(operatorStamp);
        break;
      }
    }

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'SAVE_APPROVAL_MEMO',
      targetId: memoId,
      docVersion: docVersion,
      details: 'Supervisor บันทึกข้อความ ' + memoId + ' (' + docVersion + ') สำหรับใบงาน ' + memoData.TaskID,
      beforeState: currentMemo ? currentMemo.DocVersion : 'NONE',
      afterState: docVersion + ' | Budget: ' + memoData.EstimatedBudget,
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    return {
      ok: true,
      memoId: memoId,
      docVersion: docVersion,
      updatedAt: now,
      updatedBy: operatorStamp
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 5. EXPORT DIRECTLY TO NEW GOOGLE SHEET IN DRIVE + XLS SUPPORT
 * ============================================================================
 */

function handleExportToGoogleSheet(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = getSpreadsheet();
    const rootFolder = getRootDriveFolder();
    const exportFolder = getOrCreateSubfolder(rootFolder, 'FMMS_Exported_Reports');
    const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
    const reportTitle = (payload.reportTitle || 'FMMS_Official_Report') + '_' + stamp;

    const newSs = SpreadsheetApp.create(reportTitle);
    const newSsFile = DriveApp.getFileById(newSs.getId());
    newSsFile.moveTo(exportFolder);

    const targetSheets = [
      CONFIG.SHEETS.TASKS,
      CONFIG.SHEETS.MEMOS,
      CONFIG.SHEETS.COST_REFS,
      CONFIG.SHEETS.DOC_REVISIONS
    ];

    targetSheets.forEach(function(sheetName) {
      const src = ss.getSheetByName(sheetName);
      if (src) {
        src.copyTo(newSs).setName(sheetName);
      }
    });

    // Remove default Sheet1 if present
    const defaultSheet = newSs.getSheetByName('Sheet1');
    if (defaultSheet && newSs.getSheets().length > 1) {
      newSs.deleteSheet(defaultSheet);
    }

    const now = formatISO(new Date());
    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'EXPORT_TO_GOOGLE_SHEET',
      targetId: newSs.getId(),
      docVersion: CONFIG.VERSION,
      details: 'ส่งออกรายงานไปยังไฟล์ Google Sheet ใหม่: ' + reportTitle,
      beforeState: '-',
      afterState: newSs.getUrl(),
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    return {
      ok: true,
      fileId: newSs.getId(),
      fileName: reportTitle,
      sheetUrl: newSs.getUrl(),
      exportedAt: now
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * 6. AUTHENTICATION, EXECUTIVE APPROVAL, SCHEDULES & BACKUP
 * ============================================================================
 */

function handleLogin(payload, actor) {
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const rows = sheetToObjects(sheet);
  const passHash = hashPassword(password);

  let matchedUser = null;
  let rowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].Username || '').trim().toLowerCase() === username) {
      if (rows[i].PasswordHash === passHash || rows[i].PasswordHash === password) {
        matchedUser = rows[i];
        rowIndex = i + 2;
        break;
      }
    }
  }

  if (!matchedUser) {
    return { ok: false, errorCode: 'AUTH-401', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  if (matchedUser.Status !== 'Active') {
    return { ok: false, errorCode: 'AUTH-403', message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อ Admin' };
  }

  const now = formatISO(new Date());
  sheet.getRange(rowIndex, 13).setValue(now);

  const sessionToken = Utilities.base64EncodeWebSafe(matchedUser.UserID + '|' + now + '|' + Utilities.getUuid());
  delete matchedUser.PasswordHash;
  return { ok: true, user: matchedUser, token: sessionToken };
}

function handleAdminManageUser(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (Number(actor.roleLevel) !== 3) {
      throw new Error('สิทธิ์ไม่เพียงพอ: เฉพาะผู้ดูแลระบบระดับ 3 (Admin) เท่านั้นที่จัดการผู้ใช้ได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    const rows = sheetToObjects(sheet);
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';
    const userData = payload.userData || {};
    const mode = payload.mode || 'create';

    if (mode === 'create') {
      const yearPrefix = 'USR-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
      const newUserId = generateUniqueDocId(CONFIG.SHEETS.USERS, 1, yearPrefix);
      const passHash = hashPassword(userData.Password || '123456');

      const newRow = [
        newUserId, userData.Username, passHash, userData.FullName,
        Number(userData.RoleLevel || 1), userData.Department || 'ทั่วไป',
        userData.Phone || '-', userData.Status || 'Active',
        now, operatorStamp, now, operatorStamp, '-'
      ];
      sheet.appendRow(newRow);
      return { ok: true, userId: newUserId, recordedBy: operatorStamp, recordedAt: now };
    } else if (mode === 'delete') {
      const targetUserId = String(payload.userId || userData.UserID || '').trim();
      const targetUsername = String(payload.username || userData.Username || '').trim().toLowerCase();
      if (!targetUserId && !targetUsername) throw new Error('ไม่ระบุรหัสผู้ใช้หรือชื่อผู้ใช้ที่ต้องการลบ');
      if (targetUserId === 'USR-2026-0001' || targetUsername === 'admin') {
        throw new Error('ไม่อนุญาตให้ลบบัญชีผู้ดูแลระบบหลัก (Super Admin USR-2026-0001)');
      }
      if (targetUserId === actor.userId) {
        throw new Error('ไม่อนุญาตให้ลบบัญชีของตนเองที่กำลังเข้าสู่ระบบอยู่');
      }

      let deletedCount = 0;
      let lastRemovedName = '';
      // Loop backwards from bottom to top so deleting rows does not corrupt subsequent row indices
      for (let i = rows.length - 1; i >= 0; i--) {
        const rowUid = String(rows[i].UserID || '').trim();
        const rowUname = String(rows[i].Username || '').trim().toLowerCase();
        const match = (targetUserId && rowUid === targetUserId) || (targetUsername && rowUname === targetUsername);
        if (match) {
          lastRemovedName = rows[i].FullName || rowUname;
          sheet.deleteRow(i + 2);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        writeAuditLog({
          userId: actor.userId,
          operatorName: actor.fullName,
          roleLevel: actor.roleLevel,
          action: 'DELETE_USER',
          targetId: targetUserId || targetUsername,
          docVersion: '-',
          details: 'ลบบัญชีผู้ใช้งาน ' + (targetUserId || targetUsername) + ' (' + lastRemovedName + ') ออกจาก Google Sheets สำเร็จ รวม ' + deletedCount + ' แถว',
          beforeState: 'ACTIVE',
          afterState: 'DELETED'
        });
        return { ok: true, userId: targetUserId, deletedCount: deletedCount, message: 'ลบบัญชีผู้ใช้ ' + (targetUserId || targetUsername) + ' สำเร็จ (' + deletedCount + ' รายการ)' };
      }
      throw new Error('ไม่พบข้อมูลผู้ใช้ ' + (targetUserId || targetUsername) + ' ในระบบ Google Sheets');
    } else {
      const targetUserId = userData.UserID;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].UserID === targetUserId) {
          const beforeUser = rows[i];
          const updatedPassHash = userData.Password ? hashPassword(userData.Password) : beforeUser.PasswordHash;
          const updatedRow = [
            beforeUser.UserID, userData.Username || beforeUser.Username, updatedPassHash,
            userData.FullName || beforeUser.FullName, Number(userData.RoleLevel || beforeUser.RoleLevel),
            userData.Department || beforeUser.Department, userData.Phone || beforeUser.Phone,
            userData.Status || beforeUser.Status, beforeUser.CreatedAt, beforeUser.CreatedBy,
            now, operatorStamp, beforeUser.LastLoginAt || '-'
          ];
          sheet.getRange(i + 2, 1, 1, updatedRow.length).setValues([updatedRow]);
          return { ok: true, userId: targetUserId, recordedBy: operatorStamp, recordedAt: now };
        }
      }
      throw new Error('ไม่พบรหัสผู้ใช้ ' + targetUserId);
    }
  } finally {
    lock.releaseLock();
  }
}

function handleExecutiveApprove(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (Number(actor.roleLevel) < 3) {
      throw new Error('เฉพาะผู้บริหาร (ระดับ 3) เท่านั้นที่สามารถอนุมัติได้');
    }

    const ss = getSpreadsheet();
    const memoSheet = ss.getSheetByName(CONFIG.SHEETS.MEMOS);
    const taskSheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);

    const taskId = payload.taskId || '';
    const memoId = payload.memoId || '';
    const rawDecision = payload.decision || 'Approved';

    // Support Approved, Closed, Rejected
    let newTaskStatus = 'Approved';
    let memoStatus = 'Approved';
    if (rawDecision === 'Closed') {
      newTaskStatus = 'Closed';
      memoStatus = 'Approved';
    } else if (rawDecision === 'Approved') {
      newTaskStatus = 'Approved';
      memoStatus = 'Approved';
    } else if (String(rawDecision).startsWith('Rejected')) {
      newTaskStatus = rawDecision;
      memoStatus = 'Rejected';
    } else {
      newTaskStatus = rawDecision;
    }

    const comment = payload.comment || (newTaskStatus === 'Closed' ? 'ผู้บริหารตรวจรับและอนุมัติปิดงานสมบูรณ์' : (newTaskStatus === 'Approved' ? 'ผู้บริหารอนุมัติดำเนินการตามเสนอ' : 'ตีกลับเพื่อแก้ไข'));
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let targetTaskId = taskId;

    // Update Memo row if found
    if (memoSheet) {
      const memos = sheetToObjects(memoSheet);
      for (let i = 0; i < memos.length; i++) {
        if ((memoId && memos[i].MemoID === memoId) || (taskId && memos[i].TaskID === taskId)) {
          const r = i + 2;
          if (!targetTaskId) targetTaskId = memos[i].TaskID;
          memoSheet.getRange(r, 14).setValue(actor.userId);
          memoSheet.getRange(r, 15).setValue(actor.fullName);
          memoSheet.getRange(r, 16).setValue(now);
          memoSheet.getRange(r, 17).setValue(memoStatus);
          memoSheet.getRange(r, 18).setValue(comment);
          break;
        }
      }
    }

    // Update Task row
    if (taskSheet) {
      const tasks = sheetToObjects(taskSheet);
      for (let j = 0; j < tasks.length; j++) {
        if (tasks[j].TaskID === targetTaskId || tasks[j].TaskID === taskId) {
          taskSheet.getRange(j + 2, 12).setValue(newTaskStatus);
          taskSheet.getRange(j + 2, 23).setValue(now);
          taskSheet.getRange(j + 2, 24).setValue(operatorStamp);
          break;
        }
      }
    }

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'EXECUTIVE_DECISION',
      targetId: targetTaskId || memoId || 'TASK',
      docVersion: 'v2.0',
      details: 'ผู้บริหาร (' + actor.fullName + ') ดำเนินการ ' + newTaskStatus + ' ใบงาน ' + (targetTaskId || memoId),
      beforeState: 'PENDING_OR_COMPLETED',
      afterState: newTaskStatus,
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    // Hook: LINE Notification on Executive Decision
    try {
      const execDecisionIcon = (newTaskStatus === 'Approved') ? '✅ [อนุมัติงบประมาณเรียบร้อย]' :
        (newTaskStatus === 'Closed' ? '🏁 [ผู้บริหารตรวจรับและปิดงานสมบูรณ์]' : '⚠️ [ใบงานถูกส่งกลับ/แก้ไข]');
      const lineMsg = execDecisionIcon + '\n' +
        'รหัสเอกสาร: ' + (targetTaskId || memoId) + '\n' +
        'สถานะผลการพิจารณา: ' + newTaskStatus + '\n' +
        'ผู้พิจารณา: ' + actor.fullName + ' (ระดับ 3 ผู้บริหาร)\n' +
        'ความเห็น/คำสั่งการ: ' + comment + '\n' +
        'เวลา: ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
      sendLineNotification(lineMsg);
    } catch (eLine2) {
      Logger.log('Line notify on exec approve failed: ' + eLine2);
    }

    return { ok: true, taskId: targetTaskId, memoId: memoId, decision: newTaskStatus, approvedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteTask(payload, actor) {
  const taskId = payload.taskId;
  if (!taskId) throw new Error('TaskID is required for deletion');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet();
    const taskSheet = ss.getSheetByName(CONFIG.SHEETS.TASKS);
    const data = taskSheet.getDataRange().getValues();
    let deletedTask = false;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === taskId) {
        taskSheet.deleteRow(i + 1);
        deletedTask = true;
        break;
      }
    }

    // Delete linked memos if any
    const memoSheet = ss.getSheetByName(CONFIG.SHEETS.MEMOS);
    if (memoSheet) {
      const memoData = memoSheet.getDataRange().getValues();
      for (let j = memoData.length - 1; j >= 1; j--) {
        if (String(memoData[j][1]).trim() === taskId || String(memoData[j][0]).trim() === taskId) {
          memoSheet.deleteRow(j + 1);
        }
      }
    }

    // Delete linked revisions if any
    const revSheet = ss.getSheetByName(CONFIG.SHEETS.REVISIONS);
    if (revSheet) {
      const revData = revSheet.getDataRange().getValues();
      for (let k = revData.length - 1; k >= 1; k--) {
        if (String(revData[k][0]).trim() === taskId) {
          revSheet.deleteRow(k + 1);
        }
      }
    }

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'DELETE_TASK',
      targetId: taskId,
      docVersion: '-',
      details: 'ลบใบงาน ' + taskId + ' ออกจากระบบและ Google Sheets สำเร็จ',
      beforeState: 'ACTIVE_RECORD',
      afterState: 'DELETED',
      clientInfo: actor.clientInfo || '',
      status: 'SUCCESS'
    });

    return { ok: true, taskId: taskId, deleted: deletedTask, message: 'ลบใบงานออกจากระบบและ Google Sheets เรียบร้อย' };
  } finally {
    lock.releaseLock();
  }
}
function handleCreateSchedule(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SCHEDULES);
    const sched = payload.scheduleData || {};
    const prefix = 'SCH-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
    const newSchedId = generateUniqueDocId(CONFIG.SHEETS.SCHEDULES, 1, prefix);
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    sheet.appendRow([
      newSchedId, 'v1.0', sched.EquipmentCode || 'EQ-000', sched.EquipmentName || '-',
      sched.Category || 'แอร์/เครื่องกล', sched.Location || '-', sched.Frequency || 'Monthly',
      sched.NextDueDate || '-', sched.AssignedTeam || 'ทีมซ่อมบำรุงหลัก',
      sched.ChecklistItems || '-', 'Active', now, operatorStamp, now, operatorStamp
    ]);
    return { ok: true, scheduleId: newSchedId, docVersion: 'v1.0', createdAt: now };
  } finally {
    lock.releaseLock();
  }
}

function saveBase64ToDriveFolder(taskId, tag, base64DataUrl) {
  const rootFolder = getRootDriveFolder();
  const yearStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
  const uploadsFolder = getOrCreateSubfolder(rootFolder, 'FMMS_Uploads');
  const yearFolder = getOrCreateSubfolder(uploadsFolder, yearStr);
  const taskFolder = getOrCreateSubfolder(yearFolder, taskId);

  let mimeType = 'image/jpeg';
  let base64Clean = base64DataUrl;
  if (base64DataUrl.indexOf(',') !== -1) {
    const parts = base64DataUrl.split(',');
    base64Clean = parts[1];
  }

  const decoded = Utilities.base64Decode(base64Clean);
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  const fileName = taskId + '_' + tag + '_' + stamp + '.jpg';
  const blob = Utilities.newBlob(decoded, mimeType, fileName);
  const file = taskFolder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (_) {}

  return {
    fileId: file.getId(),
    fileName: fileName,
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}

function handleUploadImage(payload, actor) {
  const res = saveBase64ToDriveFolder(payload.taskId || 'UNASSIGNED', payload.tag || 'IMG', payload.base64Data);
  return { ok: true, fileId: res.fileId, url: res.url };
}

function handleBackupToDrive(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet();
    const rootFolder = getRootDriveFolder();
    const backupRoot = getOrCreateSubfolder(rootFolder, 'FMMS_Backups');
    const ymFolder = getOrCreateSubfolder(backupRoot, Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM'));
    const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
    const backupName = 'BACKUP_Data_MA_TWPP_' + stamp;
    const copiedFile = DriveApp.getFileById(CONFIG.SPREADSHEET_ID).makeCopy(backupName, ymFolder);
    const now = formatISO(new Date());

    ss.getSheetByName(CONFIG.SHEETS.SETTINGS).appendRow([
      'LAST_SYSTEM_BACKUP', copiedFile.getUrl(), 'Backup File ID: ' + copiedFile.getId(), now, actor.userId, actor.fullName
    ]);

    return { ok: true, backupFileId: copiedFile.getId(), backupFileName: backupName, backupUrl: copiedFile.getUrl(), timestamp: now };
  } finally {
    lock.releaseLock();
  }
}

function handleAdminUpdateSettings(payload, actor) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  const now = formatISO(new Date());
  const settingsObj = payload.settings || {};
  Object.keys(settingsObj).forEach(function(key) {
    sheet.appendRow([key, String(settingsObj[key]), 'Updated via Admin Console', now, actor.userId, actor.fullName]);
  });
  return { ok: true, updatedAt: now };
}

function handleVerifyIntegrity() {
  const ss = getSpreadsheet();
  const tables = [
    { name: CONFIG.SHEETS.TASKS, key: 'TaskID' },
    { name: CONFIG.SHEETS.MEMOS, key: 'MemoID' },
    { name: CONFIG.SHEETS.COST_REFS, key: 'CostRefID' },
    { name: CONFIG.SHEETS.USERS, key: 'UserID' }
  ];
  let totalDuplicates = 0;
  const report = {};
  tables.forEach(function(t) {
    const rows = sheetToObjects(ss.getSheetByName(t.name));
    const seen = {};
    const dupes = [];
    rows.forEach(function(r) {
      const id = r[t.key];
      if (seen[id]) { dupes.push(id); totalDuplicates++; }
      seen[id] = true;
    });
    report[t.name] = { totalRows: rows.length, duplicateIds: dupes, healthy: dupes.length === 0 };
  });
  return { ok: true, healthy: totalDuplicates === 0, totalDuplicates: totalDuplicates, report: report };
}

function writeAuditLog(entry) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.LOGS);
  if (!sheet) return;
  const datePrefix = 'LOG-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd');
  const logId = datePrefix + '-' + ('0000' + sheet.getLastRow()).slice(-4);
  sheet.appendRow([
    logId, formatISO(new Date()), entry.userId || 'SYSTEM', entry.operatorName || 'System',
    entry.roleLevel !== undefined ? entry.roleLevel : 0, entry.action || 'EVENT',
    entry.targetId || '-', entry.docVersion || 'v1.0', entry.details || '-',
    entry.beforeState || '-', entry.afterState || '-', entry.clientInfo || '-', entry.status || 'SUCCESS'
  ]);
}

function getOrCreateSubfolder(parentFolder, folderName) {
  const iter = parentFolder.getFoldersByName(folderName);
  return iter.hasNext() ? iter.next() : parentFolder.createFolder(folderName);
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0];
  const results = [];
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    let hasContent = false;
    for (let c = 0; c < headers.length; c++) {
      const key = String(headers[c] || '').trim();
      if (!key) continue;
      let val = values[r][c];
      if (val instanceof Date) val = formatISO(val);
      if (val !== '' && val !== null && val !== undefined) hasContent = true;
      obj[key] = val;
    }
    if (hasContent) results.push(obj);
  }
  return results;
}

function hashPassword(rawPassword) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawPassword, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    const v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function formatISO(dateObj) {
  return Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================================
 * PILOT PROJECTS & MILESTONE CONTRACT WORKFLOW ENGINE
 * ============================================================================
 */

function handleSavePilotProject(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const role = Number(actor.roleLevel || 1);
    // Role 2.5 (Accounting), Role 3 (Admin / Executive) can create or update
    if (role < 2.5) {
      throw new Error('เฉพาะฝ่ายบัญชี (ระดับ 2.5) หรือผู้บริหาร/Admin (ระดับ 3) เท่านั้นที่จัดการข้อมูลสัญญาและโครงการได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.PROJECTS);
    const rows = sheetToObjects(sheet);
    const p = payload.project || {};
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let projectId = p.ProjectID;
    let existingIndex = -1;
    let beforeObj = null;

    if (projectId) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].ProjectID === projectId) {
          existingIndex = i + 2;
          beforeObj = rows[i];
          break;
        }
      }
    }

    if (existingIndex !== -1 && beforeObj) {
      // Update existing project
      const newVersion = incrementDocVersion(beforeObj.DocVersion);
      const updatedRow = [
        beforeObj.ProjectID,
        newVersion,
        p.ContractNo || beforeObj.ContractNo,
        p.ContractTitle || beforeObj.ContractTitle,
        p.Category || beforeObj.Category || 'ปรับปรุงอาคาร',
        p.Location || beforeObj.Location || 'ทั่วไป',
        p.ContractorName || beforeObj.ContractorName,
        p.ContractorPhone || beforeObj.ContractorPhone || '-',
        Number(p.TotalBudget || beforeObj.TotalBudget || 0),
        Number(p.RetentionPercent !== undefined ? p.RetentionPercent : (beforeObj.RetentionPercent || 5)),
        Number(p.RetentionAmount !== undefined ? p.RetentionAmount : (beforeObj.RetentionAmount || 0)),
        p.PaymentMode || beforeObj.PaymentMode || 'MILESTONE_INSTALLMENTS',
        p.StartDate || beforeObj.StartDate || '',
        p.EndDate || beforeObj.EndDate || '',
        Number(p.WarrantyMonths || beforeObj.WarrantyMonths || 12),
        p.ContractFileURL || beforeObj.ContractFileURL || '',
        p.Status || beforeObj.Status || 'In Progress',
        beforeObj.CreatedAt,
        beforeObj.CreatedBy,
        now,
        operatorStamp
      ];
      sheet.getRange(existingIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

      writeAuditLog({
        userId: actor.userId,
        operatorName: actor.fullName,
        roleLevel: actor.roleLevel,
        action: 'UPDATE_PILOT_PROJECT',
        targetId: projectId,
        docVersion: newVersion,
        details: 'แก้ไขข้อมูลโครงการ/สัญญา ' + projectId + ' โดย ' + operatorStamp,
        beforeState: JSON.stringify(beforeObj),
        afterState: JSON.stringify(p)
      });

      return { ok: true, projectId: projectId, version: newVersion, message: 'บันทึกการแก้ไขโครงการเรียบร้อย' };
    } else {
      // Create new project
      const prefix = 'PRJ-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
      projectId = generateUniqueDocId(CONFIG.SHEETS.PROJECTS, 1, prefix);
      const newRow = [
        projectId,
        'v1.0',
        p.ContractNo || ('CNT-' + Date.now().toString(36).toUpperCase()),
        p.ContractTitle || 'โครงการปรับปรุงงานระบบและอาคาร',
        p.Category || 'ปรับปรุงอาคาร',
        p.Location || 'พื้นที่โครงการ',
        p.ContractorName || 'ผู้รับเหมาโครงการ',
        p.ContractorPhone || '-',
        Number(p.TotalBudget || 0),
        Number(p.RetentionPercent !== undefined ? p.RetentionPercent : 5),
        Number(p.RetentionAmount || 0),
        p.PaymentMode || 'MILESTONE_INSTALLMENTS',
        p.StartDate || Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'),
        p.EndDate || '',
        Number(p.WarrantyMonths || 12),
        p.ContractFileURL || '',
        p.Status || 'Contract Signed',
        now,
        operatorStamp,
        now,
        operatorStamp
      ];
      sheet.appendRow(newRow);

      writeAuditLog({
        userId: actor.userId,
        operatorName: actor.fullName,
        roleLevel: actor.roleLevel,
        action: 'CREATE_PILOT_PROJECT',
        targetId: projectId,
        docVersion: 'v1.0',
        details: 'สร้างโครงการนำร่องใหม่ ' + projectId + ' สัญญา: ' + (p.ContractNo || '-') + ' วงเงิน ฿' + Number(p.TotalBudget || 0),
        beforeState: 'NONE',
        afterState: JSON.stringify(p)
      });

      return { ok: true, projectId: projectId, version: 'v1.0', message: 'สร้างโครงการใหม่สำเร็จ' };
    }
  } finally {
    lock.releaseLock();
  }
}

function handleDeletePilotProject(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (Number(actor.roleLevel || 1) < 3) {
      throw new Error('เฉพาะ Admin หรือผู้บริหาร (ระดับ 3) เท่านั้นที่สามารถลบโครงการได้');
    }
    const ss = getSpreadsheet();
    const prjSheet = ss.getSheetByName(CONFIG.SHEETS.PROJECTS);
    const msSheet = ss.getSheetByName(CONFIG.SHEETS.MILESTONES);
    const projectId = payload.projectId;
    if (!projectId) throw new Error('ไม่ระบุรหัสโครงการที่ต้องการลบ');

    const prjRows = sheetToObjects(prjSheet);
    for (let i = prjRows.length - 1; i >= 0; i--) {
      if (prjRows[i].ProjectID === projectId) {
        prjSheet.deleteRow(i + 2);
      }
    }

    if (msSheet) {
      const msRows = sheetToObjects(msSheet);
      for (let j = msRows.length - 1; j >= 0; j--) {
        if (msRows[j].ProjectID === projectId) {
          msSheet.deleteRow(j + 2);
        }
      }
    }

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'DELETE_PILOT_PROJECT',
      targetId: projectId,
      docVersion: '-',
      details: 'ลบโครงการ ' + projectId + ' และงวดงานที่เกี่ยวข้องทั้งหมดออกจากระบบ',
      beforeState: 'ACTIVE',
      afterState: 'DELETED'
    });

    return { ok: true, projectId: projectId, message: 'ลบโครงการเรียบร้อยแล้ว' };
  } finally {
    lock.releaseLock();
  }
}

function handleSaveProjectMilestones(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const role = Number(actor.roleLevel || 1);
    if (role < 2.5) {
      throw new Error('เฉพาะฝ่ายบัญชี (ระดับ 2.5) หรือผู้บริหาร/Admin (ระดับ 3) เท่านั้นที่กำหนดงวดงานได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MILESTONES);
    const projectId = payload.projectId;
    const milestones = payload.milestones || [];
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    if (!projectId) throw new Error('ไม่ระบุ ProjectID สำหรับงวดงาน');

    // Remove existing milestones for this project to rewrite cleanly
    const existing = sheetToObjects(sheet);
    for (let i = existing.length - 1; i >= 0; i--) {
      if (existing[i].ProjectID === projectId) {
        sheet.deleteRow(i + 2);
      }
    }

    // Append new milestone rows
    milestones.forEach(function(m, idx) {
      const msId = m.MilestoneID || (projectId + '-MS' + String(idx + 1).padStart(2, '0'));
      const row = [
        msId,
        projectId,
        Number(m.MilestoneNo || (idx + 1)),
        m.MilestoneTitle || ('งวดที่ ' + (idx + 1)),
        m.Description || '',
        Number(m.Percentage || 0),
        Number(m.Amount || 0),
        Number(m.RetentionDeducted || 0),
        Number(m.NetPayable || 0),
        m.DueDate || '',
        m.WorkStatus || 'Pending',
        m.PaymentStatus || 'Unpaid',
        m.InspectionDate || '',
        m.InspectorName || '',
        m.InspectorNotes || '',
        typeof m.InspectionPhotosJSON === 'string' ? m.InspectionPhotosJSON : JSON.stringify(m.InspectionPhotos || []),
        m.PaymentDate || '',
        m.PaidBy || '',
        m.PaymentSlipURL || '',
        m.PaymentVoucherNo || '',
        now,
        operatorStamp
      ];
      sheet.appendRow(row);
    });

    writeAuditLog({
      userId: actor.userId,
      operatorName: actor.fullName,
      roleLevel: actor.roleLevel,
      action: 'UPDATE_PROJECT_MILESTONES',
      targetId: projectId,
      docVersion: '-',
      details: 'บันทึกงวดงานโครงการ ' + projectId + ' รวม ' + milestones.length + ' งวดงาน',
      beforeState: 'PREVIOUS_MILESTONES',
      afterState: JSON.stringify(milestones)
    });

    return { ok: true, projectId: projectId, count: milestones.length, message: 'บันทึกงวดงาน ' + milestones.length + ' งวดสำเร็จ' };
  } finally {
    lock.releaseLock();
  }
}

function handleInspectMilestone(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const role = Number(actor.roleLevel || 1);
    if (role < 2) {
      throw new Error('เฉพาะวิศวกรผู้ควบคุมงาน (ระดับ 2) หรือผู้บริหาร (ระดับ 3) เท่านั้นที่ตรวจรับงานได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MILESTONES);
    const rows = sheetToObjects(sheet);
    const msId = payload.milestoneId;
    const insp = payload.inspection || {};
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].MilestoneID === msId) {
        const r = rows[i];
        const updatedRow = [
          r.MilestoneID,
          r.ProjectID,
          r.MilestoneNo,
          r.MilestoneTitle,
          r.Description,
          r.Percentage,
          r.Amount,
          r.RetentionDeducted,
          r.NetPayable,
          r.DueDate,
          insp.WorkStatus || 'Inspected & Approved',
          insp.WorkStatus === 'Inspected & Approved' ? 'Pending Executive Approval' : 'Unpaid',
          insp.InspectionDate || now,
          insp.InspectorName || actor.fullName,
          insp.InspectorNotes || '',
          typeof insp.InspectionPhotosJSON === 'string' ? insp.InspectionPhotosJSON : JSON.stringify(insp.InspectionPhotos || []),
          r.PaymentDate || '',
          r.PaidBy || '',
          r.PaymentSlipURL || '',
          r.PaymentVoucherNo || '',
          now,
          operatorStamp
        ];
        sheet.getRange(i + 2, 1, 1, updatedRow.length).setValues([updatedRow]);

        writeAuditLog({
          userId: actor.userId,
          operatorName: actor.fullName,
          roleLevel: actor.roleLevel,
          action: 'INSPECT_MILESTONE',
          targetId: msId,
          docVersion: '-',
          details: 'ตรวจรับงวดงาน ' + msId + ' ผล: ' + (insp.WorkStatus || 'ผ่านการตรวจรับ'),
          beforeState: r.WorkStatus,
          afterState: insp.WorkStatus || 'Inspected & Approved'
        });

        // Hook: LINE Notification on Milestone Inspection (Notify Accounting)
        try {
          const lineMsg = '🏗️ [ตรวจรับงวดงานโครงการเรียบร้อย]\n' +
            'รหัสงวดงาน: ' + msId + ' (โครงการ: ' + r.ProjectID + ')\n' +
            'ชื่องวดงาน: ' + r.MilestoneTitle + '\n' +
            'ผลการตรวจรับ: ' + (insp.WorkStatus || 'ผ่านการตรวจรับ') + '\n' +
            'ยอดเบิกจ่ายสุทธิ: ' + Number(r.NetPayable || 0).toLocaleString() + ' บาท\n' +
            'ผู้ตรวจรับ: ' + actor.fullName + '\n' +
            '📢 แจ้งฝ่ายบัญชีและการเงิน: สามารถเข้าสู่ระบบเพื่อดำเนินการสั่งจ่ายได้';
          sendLineNotification(lineMsg);
        } catch (eLine3) {
          Logger.log('Line notify on milestone inspect failed: ' + eLine3);
        }

        return { ok: true, milestoneId: msId, message: 'บันทึกการตรวจรับงวดงานสำเร็จ' };
      }
    }
    throw new Error('ไม่พบรหัสงวดงาน ' + msId);
  } finally {
    lock.releaseLock();
  }
}

function handlePayoutMilestone(payload, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const role = Number(actor.roleLevel || 1);
    if (role < 2.5) {
      throw new Error('เฉพาะฝ่ายบัญชี (ระดับ 2.5) หรือผู้บริหาร/Admin (ระดับ 3) เท่านั้นที่สั่งจ่ายเงินงวดได้');
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.MILESTONES);
    const rows = sheetToObjects(sheet);
    const msId = payload.milestoneId;
    const payout = payload.payout || {};
    const now = formatISO(new Date());
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].MilestoneID === msId) {
        const r = rows[i];
        if (r.WorkStatus !== 'Inspected & Approved') {
          throw new Error('ไม่สามารถสั่งจ่ายได้: งวดงานยังไม่ผ่านการตรวจรับจากวิศวกรผู้ควบคุมงาน (3-Way Match Failed)');
        }

        const updatedRow = [
          r.MilestoneID,
          r.ProjectID,
          r.MilestoneNo,
          r.MilestoneTitle,
          r.Description,
          r.Percentage,
          r.Amount,
          r.RetentionDeducted,
          r.NetPayable,
          r.DueDate,
          r.WorkStatus,
          'Paid',
          r.InspectionDate,
          r.InspectorName,
          r.InspectorNotes,
          r.InspectionPhotosJSON,
          payout.PaymentDate || now,
          payout.PaidBy || operatorStamp,
          payout.PaymentSlipURL || '',
          payout.PaymentVoucherNo || ('PV-' + Date.now().toString(36).toUpperCase()),
          now,
          operatorStamp
        ];
        sheet.getRange(i + 2, 1, 1, updatedRow.length).setValues([updatedRow]);

        writeAuditLog({
          userId: actor.userId,
          operatorName: actor.fullName,
          roleLevel: actor.roleLevel,
          action: 'PAYOUT_MILESTONE',
          targetId: msId,
          docVersion: '-',
          details: 'จ่ายเงินงวดงาน ' + msId + ' ยอดสุทธิ ฿' + Number(r.NetPayable || 0) + ' เลขที่ใบสำคัญ: ' + (payout.PaymentVoucherNo || '-'),
          beforeState: r.PaymentStatus,
          afterState: 'Paid'
        });

        return { ok: true, milestoneId: msId, message: 'บันทึกการสั่งจ่ายและแนบสลิปสำเร็จ' };
      }
    }
    throw new Error('ไม่พบรหัสงวดงาน ' + msId);
  } finally {
    lock.releaseLock();
  }
}


/**
 * ============================================================================
 * LINE MESSAGING API NOTIFICATION ENGINE (v2.9.4-ENT)
 * Endpoint: https://api.line.me/v2/bot/message/push
 * ============================================================================
 */

function getSystemSetting(key, defaultValue) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    if (sheet) {
      const rows = sheetToObjects(sheet);
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].SettingKey === key && rows[i].SettingValue) {
          return String(rows[i].SettingValue).trim();
        }
      }
    }
  } catch (e) {
    Logger.log('getSystemSetting sheet error: ' + e);
  }
  try {
    const prop = PropertiesService.getScriptProperties().getProperty(key);
    if (prop) return String(prop).trim();
  } catch (_) {}
  return defaultValue || '';
}

function sendLineNotification(messageText, customToken, customTargetId) {
  try {
    const token = (customToken && String(customToken).trim()) ? String(customToken).trim() : getSystemSetting('lineToken', '');
    const targetId = (customTargetId && String(customTargetId).trim()) ? String(customTargetId).trim() : getSystemSetting('lineTargetId', '');

    if (!token || !targetId) {
      Logger.log('LINE Push Notification skipped: lineToken or lineTargetId is not configured.');
      return { ok: false, skipped: true, reason: 'LINE token or targetId is empty' };
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const payload = {
      to: targetId,
      messages: [
        {
          type: 'text',
          text: messageText
        }
      ]
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const respCode = response.getResponseCode();
    const respText = response.getContentText();

    if (respCode >= 200 && respCode < 300) {
      Logger.log('LINE Push Success: ' + respCode);
      return { ok: true, status: respCode, response: respText };
    } else {
      Logger.log('LINE Push API Error (' + respCode + '): ' + respText);
      return { ok: false, status: respCode, error: respText };
    }
  } catch (err) {
    Logger.log('LINE Push Exception: ' + err.toString());
    return { ok: false, error: err.toString() };
  }
}

function handleTestLineNotification(payload, actor) {
  const customToken = (payload && payload.token) || '';
  const customTargetId = (payload && payload.targetId) || '';
  const testMsg = '🔔 [FMMS Test Alert v2.9.4-ENT]\n' +
    '✅ ระบบแจ้งเตือนผ่าน LINE ทำงานสมบูรณ์!\n' +
    '📅 เวลา: ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss') + '\n' +
    '👤 ผู้ทดสอบ: ' + actor.fullName + ' (' + actor.userId + ')\n' +
    '🏢 ฐานข้อมูล: ' + CONFIG.SYSTEM_NAME + ' (' + CONFIG.VERSION + ')';

  const result = sendLineNotification(testMsg, customToken, customTargetId);
  if (!result.ok && !result.skipped) {
    throw new Error('LINE API Error (' + result.status + '): ' + (result.error || 'ส่งข้อความไม่สำเร็จ'));
  }
  if (result.skipped) {
    throw new Error('กรุณาระบุ Channel Access Token และ Target ID ให้ครบถ้วนก่อนทดสอบ');
  }
  return { ok: true, message: 'ส่งข้อความแจ้งเตือนทดสอบไปยัง LINE เรียบร้อยแล้ว' };
}
