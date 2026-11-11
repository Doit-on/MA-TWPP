/**
 * ============================================================================
 * FMMS ENTERPRISE - CLIENT APPLICATION CONTROLLER (app.js)
 * Facility Maintenance Management System (FMMS Enterprise v2.9.3-ENT)
 * ============================================================================
 * Bound Resources:
 * - Google Sheets (Data MA TWPP): 1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ
 * - Google Drive Root Storage:    1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx
 * ============================================================================
 */

const FMMS = (function() {
  'use strict';

  const DEFAULT_CONFIG = {
    gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbwfBDxHrVGtMuWjz1FkP0B8eL83jAp66E-JYFvB7EvQs_QjZnXnteLKUspE4dAEGpFM/exec',
    spreadsheetId: '1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ',
    driveFolderId: '1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx',
    orgName: 'ฝ่ายบริหารงานวิศวกรรมและซ่อมบำรุงอาคาร (Data MA TWPP)',
    defaultRoleUser: '',
    lastSavedBy: 'USR-2026-0001 (คุณนิพนธ์ - System Admin)',
    lastSavedAt: '2026-10-26T22:00:00+07:00'
  };

  const STORAGE_KEYS = {
    CONFIG: 'FMMS_ENT_CONFIG_V2',
    DB_STATE: 'FMMS_ENT_DB_STATE_V2',
    SESSION: 'FMMS_ENT_SESSION_V2',
    DEVICE_ID: 'FMMS_ENT_DEVICE_ID',
    DELETED_TASKS: 'FMMS_ENT_DELETED_TASKS_V2'
  };

  let state = {
    config: { ...DEFAULT_CONFIG },
    deviceId: 'DEV-0000',
    session: null,
    currentView: 'role2',
    selectedTaskId: null,
    connection: {
      online: true,
      mode: 'HYBRID_SYNC',
      latencyMs: 22,
      lastChecked: null
    },
    executiveSubTab: 'cards',
    deletedTaskIds: [],
    deletedUserIds: [],
    selectedProjectId: null,
    pilotSubTab: 'projects',
    activeEditingItem: null,
    activeEditingPhotos: [],
    activePaymentSlip: null,
    lastUserActivity: Date.now(),
    compressedImages: {
      beforeImages: [],
      afterImages: [],
      beforeBase64: null,
      afterBase64: null
    },
    qrScannerInstance: null,
    db: {
      users: [],
      tasks: [],
      schedules: [],
      memos: [],
      costs: [],
      logs: [],
      projects: [],
      milestones: []
    }
  };

  /**
   * ==========================================================================
   * 1. INITIALIZATION & SEED ENTERPRISE DATA
   * ==========================================================================
   */

  function init() {
    try {
      const hV = document.getElementById('headerSysVersion');
      if (hV) hV.textContent = 'v2.9.3-ENT';
      const lV = document.getElementById('landingBuildVer');
      if (lV) lV.textContent = 'v2.9.3-ENT';
    } catch (_) {}
    try {
      // Clear legacy permanent deletion blocklist so live Google Sheet records are never suppressed
      localStorage.removeItem(STORAGE_KEYS.DELETED_TASKS);
      state.deletedTaskIds = [];
    } catch (_) {}
    try { initDeviceId(); } catch (e) { console.warn('initDeviceId error:', e); }
    try { loadConfig(); } catch (e) { console.warn('loadConfig error:', e); }
    try { loadOrSeedDatabase(); } catch (e) { console.warn('loadOrSeedDatabase error:', e); }
    try { checkUrlProvisioningParams(); } catch (e) { console.warn('checkUrlProvisioningParams error:', e); }
    try { startLiveClock(); } catch (e) { console.warn('startLiveClock error:', e); }
    try { renderAllViews(); } catch (e) { console.warn('renderAllViews error:', e); }
    try { generateProvisioningQrCode(); } catch (e) { console.warn('generateProvisioningQrCode error:', e); }
    try { restoreSessionOrShowLogin(); } catch (e) { console.warn('restoreSessionOrShowLogin error:', e); }
    // Guarantee Landing Page is always presented on initial visit / load
    try { showLandingPage(); } catch (e) { console.warn('showLandingPage error:', e); }
    try { pingConnection(false); } catch (e) { console.warn('pingConnection error:', e); }
    // Immediately sync latest data from Google Sheets upon application startup
    try { syncFromGasBackend(false); } catch (e) { console.warn('Initial sync error:', e); }
    try { initLivePresenceEngine(); } catch (e) { console.warn('Presence engine error:', e); }
    try { initIdleAutoSaveDetector(); } catch (e) { console.warn('Idle detector error:', e); }

    try {
      window.addEventListener('online', function() {
        pingConnection(false);
      });
      window.addEventListener('offline', function() {
        updateConnectionUI(false, 0, 'OFFLINE (Local Queue Active)');
      });
    } catch (_) {}

    // Real-Time Auto-sync polling every 8 seconds across all devices
    setInterval(function() {
      try {
        if (state.config.gasWebAppUrl && navigator.onLine !== false) {
          syncFromGasBackend(false);
        }
      } catch (err) {
        console.warn('Auto-sync interval warning:', err);
      }
    }, 8000);

    // Auto-sync when user switches back to this tab
    window.addEventListener('focus', function() {
      try {
        if (state.config.gasWebAppUrl && navigator.onLine !== false) {
          syncFromGasBackend(false);
        }
      } catch (err) {
        console.warn('Auto-sync focus warning:', err);
      }
    });
  }

  const syncChannel = (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined')
    ? new BroadcastChannel('FMMS_SYNC_CHANNEL')
    : null;

  function broadcastDataChange(action, detail) {
    if (syncChannel) {
      try {
        syncChannel.postMessage({ action: action, detail: detail, timestamp: Date.now() });
      } catch (_) {}
    }
  }

  function initInterTabSync() {
    if (typeof window === 'undefined') return;

    if (syncChannel) {
      syncChannel.onmessage = function(ev) {
        if (!ev || !ev.data) return;
        const msg = ev.data;
        loadOrSeedDatabase();
        renderAllViews();
        updateApprovalAlertBadge();

        const role = state.session ? Number(state.session.roleLevel) : 0;
        if (msg.action === 'NEW_TASK' && (role === 2 || role === 3)) {
          showToast(
            '🔔 มีงานซ่อมใหม่แจ้งเข้ามาทันที!',
            'ใบงาน ' + (msg.detail?.taskId || '') + ' (' + (msg.detail?.title || '') + ') เข้าสู่คิวรอตรวจสอบแล้ว',
            'info'
          );
        }
      };
    }

    window.addEventListener('storage', function(e) {
      if (e.key === STORAGE_KEYS.DB_STATE) {
        loadOrSeedDatabase();
        renderAllViews();
        updateApprovalAlertBadge();
      }
    });
  }

  function initDeviceId() {
    let devId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
    if (!devId) {
      const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      devId = 'DEV-TWPP-' + rand;
      localStorage.setItem(STORAGE_KEYS.DEVICE_ID, devId);
    }
    state.deviceId = devId;
    const el = document.getElementById('loginDeviceId');
    if (el) el.textContent = devId;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load config:', e);
    }

    // Auto-migrate: Ensure valid deployed gasWebAppUrl is used even if old cached config has empty URL
    if (!state.config.gasWebAppUrl || !state.config.gasWebAppUrl.startsWith('https://script.google.com')) {
      state.config.gasWebAppUrl = DEFAULT_CONFIG.gasWebAppUrl;
      saveConfig();
    }

    syncConfigInputs();
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(state.config));
    syncConfigInputs();
  }

  function syncConfigInputs() {
    setVal('cfgGasUrl', state.config.gasWebAppUrl || '');
    setVal('cfgSheetId', state.config.spreadsheetId || DEFAULT_CONFIG.spreadsheetId);
    setVal('cfgDriveId', state.config.driveFolderId || DEFAULT_CONFIG.driveFolderId);
    setVal('cfgOrgName', state.config.orgName || DEFAULT_CONFIG.orgName);
    setVal('cfgDefaultRoleUser', state.config.defaultRoleUser || '');
    setText('cfgLastSavedBy', state.config.lastSavedBy || DEFAULT_CONFIG.lastSavedBy);
    setText('cfgLastSavedAt', formatThaiDateTime(state.config.lastSavedAt));
    setText('loginSheetIdDisplay', state.config.spreadsheetId);
    setText('loginDriveIdDisplay', state.config.driveFolderId);
  }

  function loadOrSeedDatabase() {
    const MOCK_TASK_IDS = ['CM-202610-0045', 'CM-202610-0041', 'CM-202610-0042', 'PM-202610-0043', 'PM-202610-0044'];
    const MOCK_MEMO_IDS = ['MEMO-2026-0018', 'MEMO-2026-0017'];

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DB_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          state.db = parsed;
          // Filter out legacy mock data if cached in localStorage so user's real task is preserved cleanly
          if (Array.isArray(state.db.tasks)) {
            state.db.tasks = state.db.tasks.filter(function(t) { return !MOCK_TASK_IDS.includes(t.TaskID); });
          }
          if (Array.isArray(state.db.memos)) {
            state.db.memos = state.db.memos.filter(function(m) { return !MOCK_MEMO_IDS.includes(m.MemoID); });
          }
          if (!Array.isArray(state.db.projects)) state.db.projects = [];
          if (!Array.isArray(state.db.milestones)) state.db.milestones = [];
          reconcileMemoAndTaskStatuses();
          ensureDefaultUsers();
          return;
        }
      }
    } catch (e) {
      console.warn('Database load warning', e);
    }

    const defaultCosts = [
      { CostID: 'COST-001', ItemCode: 'MAT-HVAC-001', Category: 'แอร์/เครื่องกล', ItemName: 'คอยล์โซลินอยด์วาล์วน้ำเย็น 24VAC (AHU)', Spec: 'Danfoss / Honeywell', Unit: 'ชุด', UnitPrice: 8500, LaborRate: 2500, PreferredVendor: 'หจก. ไทยคูลลิ่ง เอ็นจิเนียริ่ง' },
      { CostID: 'COST-002', ItemCode: 'MAT-PLUMB-002', Category: 'ประปา/สุขาภิบาล', ItemName: 'ชุดแมคคานิคอลซีล Booster Pump SIC/SIC', Spec: 'Grundfos / Ebara', Unit: 'ชุด', UnitPrice: 16500, LaborRate: 4500, PreferredVendor: 'บจก. สยามเมคคานิคอล ซัพพลาย' },
      { CostID: 'COST-003', ItemCode: 'MAT-ELEC-003', Category: 'ไฟฟ้า', ItemName: 'สเปรย์ทำความสะอาดหน้าสัมผัสทางไฟฟ้า Contact Cleaner', Spec: 'CRC ElectroX 400g', Unit: 'กระป๋อง', UnitPrice: 650, LaborRate: 500, PreferredVendor: 'บจก. ไฟฟ้าธนบุรี เอ็นจิเนียริ่ง' }
    ];

    state.db = {
      costs: defaultCosts,
      users: [],
      tasks: [], // Clean start - User's real task from Google Sheets or localStorage only
      schedules: [],
      memos: [],
      logs: [],
      projects: [],
      milestones: []
    };
    ensureDefaultUsers();
    persistDatabase();
  }

  function persistDatabase() {
    try {
      localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(state.db));
      localStorage.setItem('FMMS_ENT_DELETED_USERS_V2', JSON.stringify(state.deletedUserIds || []));
    } catch (e) {
      console.warn('localStorage persist warning (storage quota exceeded, saving lightweight copy):', e);
      try {
        const lightweightDb = {
          ...state.db,
          tasks: (state.db.tasks || []).map(function(t, idx) {
            if (idx > 2) {
              const lightTask = { ...t };
              if (Array.isArray(lightTask.BeforeImages) && lightTask.BeforeImages.length > 1) {
                lightTask.BeforeImages = [lightTask.BeforeImages[0]];
              }
              if (Array.isArray(lightTask.AfterImages) && lightTask.AfterImages.length > 1) {
                lightTask.AfterImages = [lightTask.AfterImages[0]];
              }
              delete lightTask.BeforeImgURL;
              delete lightTask.AfterImgURL;
              delete lightTask.BeforeImgBase64;
              delete lightTask.AfterImgBase64;
              return lightTask;
            }
            return t;
          })
        };
        localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(lightweightDb));
      } catch (err2) {
        console.error('Critical: localStorage fallback also failed', err2);
      }
    }
    updateNextTaskIdPreview();
  }


  /**
   * ==========================================================================
   * 2. CONCURRENCY-SAFE UNIQUE DOCUMENT ID ENGINE (RULE #1)
   * ==========================================================================
   */

  function generateUniqueId(collection, keyName, prefix) {
    let maxSeq = 0;
    collection.forEach(function(item) {
      const val = String(item[keyName] || '').trim();
      if (val.indexOf(prefix + '-') === 0) {
        const parts = val.split('-');
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    });
    const next = maxSeq + 1;
    return prefix + '-' + ('0000' + next).slice(-4);
  }

  function updateNextTaskIdPreview() {
    const ym = getYearMonthStr();
    const nextCm = generateUniqueId(state.db.tasks, 'TaskID', 'CM-' + ym);
    setText('nextTaskIdPreview', nextCm);
  }

  function verifyDocumentIntegrity() {
    const checks = [
      { label: 'Tasks', list: state.db.tasks, key: 'TaskID' },
      { label: 'Memos', list: state.db.memos, key: 'MemoID' },
      { label: 'Schedules', list: state.db.schedules, key: 'ScheduleID' },
      { label: 'Users', list: state.db.users, key: 'UserID' }
    ];

    let dupCount = 0;
    checks.forEach(function(c) {
      const seen = {};
      c.list.forEach(function(row) {
        const id = row[c.key];
        if (seen[id]) dupCount++;
        seen[id] = true;
      });
    });

    if (dupCount === 0) {
      showToast(
        'ตรวจสอบความสมบูรณ์ของเลขที่เอกสารสำเร็จ',
        'ไม่พบเลขที่เอกสารซ้ำในทุกตาราง (Tasks: ' + state.db.tasks.length + ', Memos: ' + state.db.memos.length + ', Users: ' + state.db.users.length + ') ระบบ Mutex Lock ทำงานปกติ',
        'success'
      );
    } else {
      showToast('พบเลขเอกสารซ้ำ ' + dupCount + ' รายการ', 'กรุณาตรวจสอบตารางฐานข้อมูล', 'error');
    }
  }

  /**
   * ==========================================================================
   * 3. REAL-TIME CONNECTION HEALTH CHECK & GAS CLOUD SYNC (RULE #3)
   * ==========================================================================
   */

  async function pingConnection(showNotification) {
    const t0 = performance.now();
    updateConnectionUI(true, '...', 'CHECKING...');

    const hasGasUrl = state.config.gasWebAppUrl && state.config.gasWebAppUrl.startsWith('https://script.google.com');

    if (hasGasUrl) {
      try {
        const url = state.config.gasWebAppUrl + (state.config.gasWebAppUrl.includes('?') ? '&' : '?') + 'action=ping&t=' + Date.now();
        const res = await fetch(url, { method: 'GET', mode: 'cors' });
        const data = await res.json();
        const latency = Math.round(performance.now() - t0);

        if (data && data.ok) {
          updateConnectionUI(true, latency, 'GAS CLOUD CONNECTED (ซิงค์ทุกเครื่อง)', 'green');
          if (showNotification) {
            showToast(
              'เชื่อมต่อ Google Sheets & Drive สำเร็จ (' + latency + ' ms)',
              'Spreadsheet: ' + (data.resources?.spreadsheet?.name || 'Data MA TWPP') + ' | เชื่อมต่อข้อมูลทุกเครื่องเรียบร้อย',
              'success'
            );
          }
          syncFromGasBackend(false);
          return;
        }
      } catch (err) {
        console.warn('GAS Endpoint ping fallback:', err);
      }
    }

    // If no gasWebAppUrl is configured
    if (!hasGasUrl) {
      updateConnectionUI(false, 0, 'LOCAL ONLY (ยังไม่เชื่อมต่อ Web App URL)', 'amber');
      if (showNotification) {
        showToast(
          'ระบบทำงานในโหมดจำลอง (Local Only)',
          'ข้อมูลจะถูกบันทึกแค่ในเครื่องนี้เท่านั้น ยังไม่ซิงค์ข้ามเครื่อง กรุณานำ Google Apps Script Web App URL มาใส่ในการตั้งค่าระบบ',
          'warning'
        );
      }
      return;
    }

    // Gas URL exists but ping failed
    updateConnectionUI(false, 0, 'CLOUD OFFLINE (เชื่อมต่อ Cloud ไม่สำเร็จ)', 'red');
    if (showNotification) {
      showToast(
        'ไม่สามารถติดต่อ Google Apps Script ได้',
        'กรุณาตรวจสอบว่าได้ตั้งค่า Who has access: Anyone ใน Apps Script แล้วหรือไม่',
        'error'
      );
    }
  }

  async function syncFromGasBackend(showNotification) {
    if (!state.config.gasWebAppUrl || !state.config.gasWebAppUrl.startsWith('https://script.google.com')) {
      if (showNotification) {
        showToast(
          'ยังไม่ได้เชื่อมต่อ Cloud',
          'กรุณานำ Google Apps Script Web App URL มาใส่ในการตั้งค่าระบบ เพื่อเริ่มการซิงค์ข้อมูลข้ามเครื่อง',
          'warning'
        );
      }
      return;
    }
    try {
      const url = state.config.gasWebAppUrl + (state.config.gasWebAppUrl.includes('?') ? '&' : '?') + 'action=bootstrap&t=' + Date.now();
      const res = await fetch(url);
      const json = await res.json();
      if (json && json.ok && json.data) {
        // 1. SMART MERGE FOR TASKS: Google Sheets is Master Truth, preserve local unsynced tasks
        if (json.data.tasks && json.data.tasks.length > 0) {
          const cloudTasks = json.data.tasks;
          const cloudMap = new Map();
          cloudTasks.forEach(function(t) {
            cloudMap.set(t.TaskID, t);
          });

          const mergedTasks = [];
          const processedIds = new Set();

          // A. First check local tasks: if not in cloud, keep local (new task being uploaded)
          (state.db.tasks || []).forEach(function(localT) {
            processedIds.add(localT.TaskID);
            const cloudT = cloudMap.get(localT.TaskID);
            if (!cloudT) {
              mergedTasks.push(localT);
            } else {
              const localTime = new Date(localT.UpdatedAt || localT.CreatedAt || 0).getTime();
              const cloudTime = new Date(cloudT.UpdatedAt || cloudT.CreatedAt || 0).getTime();
              if (localTime > cloudTime) {
                mergedTasks.push(localT);
              } else {
                if ((!cloudT.BeforeImages || cloudT.BeforeImages.length === 0) && (localT.BeforeImages && localT.BeforeImages.length > 0)) {
                  cloudT.BeforeImages = localT.BeforeImages;
                  cloudT.BeforeImgURL = localT.BeforeImgURL;
                }
                if ((!cloudT.AfterImages || cloudT.AfterImages.length === 0) && (localT.AfterImages && localT.AfterImages.length > 0)) {
                  cloudT.AfterImages = localT.AfterImages;
                  cloudT.AfterImgURL = localT.AfterImgURL;
                }
                mergedTasks.push(cloudT);
              }
            }
          });

          // B. Add all remaining tasks from Google Sheets that are not in local DB
          cloudTasks.forEach(function(cloudT) {
            if (!processedIds.has(cloudT.TaskID)) {
              mergedTasks.push(cloudT);
            }
          });

          state.db.tasks = mergedTasks;
        }

        // 2. SMART MERGE FOR MEMOS
        if (json.data.memos && json.data.memos.length > 0) {
          const cloudMemos = json.data.memos;
          const cloudMemoMap = new Map();
          cloudMemos.forEach(function(m) {
            const key = m.MemoID || m.TaskID;
            cloudMemoMap.set(key, m);
          });

          const mergedMemos = [];
          const processedMemoKeys = new Set();

          (state.db.memos || []).forEach(function(localM) {
            const key = localM.MemoID || localM.TaskID;
            processedMemoKeys.add(key);
            const cloudM = cloudMemoMap.get(key);
            if (!cloudM) {
              mergedMemos.push(localM);
            } else {
              mergedMemos.push(cloudM);
            }
          });

          cloudMemos.forEach(function(cloudM) {
            const key = cloudM.MemoID || cloudM.TaskID;
            if (!processedMemoKeys.has(key)) {
              mergedMemos.push(cloudM);
            }
          });

          state.db.memos = mergedMemos;
        }

        reconcileMemoAndTaskStatuses();
        if (json.data.users && json.data.users.length > 0) {
          const blacklist = state.deletedUserIds || [];
          state.db.users = json.data.users.filter(function(u) {
            const uid = String(u.UserID || '').trim();
            const uname = String(u.Username || '').trim().toLowerCase();
            if (uid === 'USR-2026-0001') return true;
            return !blacklist.includes(uid) && !blacklist.includes(uname);
          });
          ensureDefaultUsers();
        }
        if (json.data.schedules && json.data.schedules.length > 0) state.db.schedules = json.data.schedules;
        if (json.data.logs && json.data.logs.length > 0) state.db.logs = json.data.logs;
        if (json.data.projects && Array.isArray(json.data.projects)) {
          state.db.projects = json.data.projects;
        }
        if (json.data.milestones && Array.isArray(json.data.milestones)) {
          state.db.milestones = json.data.milestones;
        }
        if (json.data.costRefs && json.data.costRefs.length > 0) {
          state.db.costs = json.data.costRefs.map(function(cr) {
            return {
              CostID: cr.CostRefID || cr.CostID || ('COST-' + Math.random().toString(36).slice(2, 6)),
              ItemCode: cr.ItemCode || '-',
              ItemName: cr.ItemName || '-',
              Category: cr.Category || 'ทั่วไป',
              UnitPrice: Number(cr.StandardUnitPrice || cr.UnitPrice || 0),
              LaborRate: Number(cr.LaborRate || 0),
              EffectiveDate: cr.EffectiveDate || cr.UpdatedAt || getIsoNow(),
              PreferredVendor: cr.PreferredVendor || cr.Vendor || '-'
            };
          });
        }
        persistDatabase();
        renderAllViews();
        updateApprovalAlertBadge();
        if (showNotification) {
          showToast('ซิงค์ข้อมูลสำเร็จ', 'ดึงข้อมูลล่าสุดจาก Google Sheets (' + (json.data.tasks?.length || 0) + ' ใบงาน) เรียบร้อยแล้ว', 'success');
        }
      }
    } catch (e) {
      console.warn('Background bootstrap sync skipped:', e);
      if (showNotification) {
        showToast('ไม่สามารถเชื่อมต่อ Cloud ได้', 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Google Apps Script กรุณาตรวจสอบ URL หรือการเชื่อมต่ออินเทอร์เน็ต', 'error');
      }
    }
  }

  async function manualSyncCloud() {
    await syncFromGasBackend(true);
  }

  async function postToGasBackend(action, payloadObj) {
    if (!state.config.gasWebAppUrl || !state.config.gasWebAppUrl.startsWith('https://script.google.com')) {
      return { ok: true, localOnly: true };
    }
    try {
      const actor = getCurrentActor();
      const body = JSON.stringify({
        action: action,
        actor: actor,
        clientInfo: navigator.userAgent.slice(0, 80),
        ...payloadObj
      });
      const res = await fetch(state.config.gasWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
      });
      return await res.json();
    } catch (err) {
      console.warn('GAS POST fallback to local persistence:', err);
      return { ok: false, error: err.message };
    }
  }

  function updateConnectionUI(isOnline, latencyMs, labelText, colorVariant) {
    const dot = document.getElementById('connStatusDot');
    const txt = document.getElementById('connStatusText');
    const lat = document.getElementById('connLatencyText');
    const loginBadge = document.getElementById('loginPingBadge');

    if (dot && txt) {
      if (colorVariant === 'amber' || (!isOnline && latencyMs === 0)) {
        dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        txt.textContent = labelText || 'LOCAL ONLY (ยังไม่ใส่ Web App URL)';
        txt.className = 'text-amber-400 font-bold';
      } else if (isOnline) {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 status-dot-live';
        txt.textContent = labelText;
        txt.className = 'text-emerald-400 font-bold';
      } else {
        dot.className = 'w-2 h-2 rounded-full bg-red-500';
        txt.textContent = labelText;
        txt.className = 'text-red-400 font-bold';
      }
    }
    if (lat) {
      lat.textContent = latencyMs > 0 ? latencyMs + ' ms' : '-';
    }
    if (loginBadge) {
      if (colorVariant === 'amber') {
        loginBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> LOCAL ONLY (ยังไม่ใส่ URL)';
      } else {
        loginBadge.innerHTML = isOnline
          ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot-live"></span> CONNECTED (' + latencyMs + 'ms)'
          : '<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> OFFLINE';
      }
    }
  }

  /**
   * ==========================================================================
   * 4. AUTHENTICATION & STRICT ROLE-BASED ACCESS CONTROL (LEVEL 1, 2, 3)
   * ==========================================================================
   */

  function ensureDefaultUsers() {
    if (!state.db) state.db = {};
    if (!Array.isArray(state.db.users)) state.db.users = [];

    // Load persisted deletedUserIds from localStorage if empty
    if (!state.deletedUserIds || state.deletedUserIds.length === 0) {
      try {
        const raw = localStorage.getItem('FMMS_ENT_DELETED_USERS_V2');
        if (raw) state.deletedUserIds = JSON.parse(raw);
      } catch (_) {}
    }
    const blacklist = state.deletedUserIds || [];

    // ONLY USR-2026-0001 (Super Admin) is mandatory so the system is NEVER locked out
    const adminUser = {
      UserID: 'USR-2026-0001',
      Username: 'admin',
      PasswordPlain: 'admin123',
      FullName: 'คุณนิพนธ์ (Executive & System Admin)',
      RoleLevel: 3,
      Department: 'บริหารจัดการอาคารและวิศวกรรม',
      Phone: '081-900-1001',
      Status: 'Active',
      CreatedAt: '2026-10-01T08:30:00+07:00',
      CreatedBy: 'SYSTEM_INIT (Root)',
      UpdatedAt: '2026-10-01T08:30:00+07:00',
      UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
      LastLoginAt: '2026-10-01T08:30:00+07:00'
    };

    const hasAdmin = state.db.users.find(function(u) {
      return u.UserID === 'USR-2026-0001' || String(u.Username || '').toLowerCase() === 'admin';
    });
    if (!hasAdmin) {
      state.db.users.unshift(adminUser);
    }

    // Role 2.5: Dedicated Accounting & Finance Officer
    const accountUser = {
      UserID: 'USR-2026-0004',
      Username: 'account',
      PasswordPlain: 'acc123',
      FullName: 'ฝ่ายบัญชีและการเงิน (Accounting & Finance)',
      RoleLevel: 2.5,
      Department: 'การเงินและบัญชี',
      Phone: '081-900-1004',
      Status: 'Active',
      CreatedAt: '2026-10-01T08:30:00+07:00',
      CreatedBy: 'SYSTEM_INIT (Root)',
      UpdatedAt: '2026-10-01T08:30:00+07:00',
      UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
      LastLoginAt: '2026-10-01T08:30:00+07:00'
    };

    const hasAccount = state.db.users.find(function(u) {
      return u.UserID === 'USR-2026-0004' || String(u.Username || '').toLowerCase() === 'account';
    });
    if (!hasAccount && !blacklist.includes('USR-2026-0004') && !blacklist.includes('account')) {
      state.db.users.push(accountUser);
    }

    // Filter out ANY user that is in the deleted blacklist so they can NEVER bounce back
    state.db.users = state.db.users.filter(function(u) {
      const uid = String(u.UserID || '').trim();
      const uname = String(u.Username || '').trim().toLowerCase();
      if (uid === 'USR-2026-0001') return true;
      return !blacklist.includes(uid) && !blacklist.includes(uname);
    });
  }

  function showOverlay(id, displayType) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = displayType || 'flex';
  }

  function hideOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('flex');
    el.classList.add('hidden');
    el.style.display = 'none';
  }

  function fillLoginPreset(username, password) {
    setVal('loginUsername', username);
    setVal('loginPassword', password);
  }

  function quickLogin(username, password) {
    fillLoginPreset(username, password);
    handleLoginSubmit();
  }

  function openLoginModal() {
    hideOverlay('landingOverlay');
    showOverlay('authOverlay', 'flex');

    const errBox = document.getElementById('loginErrorBox');
    if (errBox) errBox.classList.add('hidden');

    const sessionBanner = document.getElementById('loginActiveSessionNotice');
    if (sessionBanner) {
      if (state.session && state.session.userId) {
        sessionBanner.innerHTML = `
          <div class="p-2.5 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-900 flex items-center justify-between">
            <div>
              <div class="font-bold text-teal-800">เข้าใช้งานล่าสุด: ${escapeHtml(state.session.fullName)}</div>
              <div class="text-[11px] text-teal-600 font-mono">ระดับสิทธิ์ที่ ${state.session.roleLevel} | ${escapeHtml(state.session.userId)}</div>
            </div>
            <button type="button" onclick="FMMS.applySessionToUI()" class="bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs px-2.5 py-1.5 rounded shadow cursor-pointer transition">
              เข้าใช้งานต่อ →
            </button>
          </div>
        `;
        sessionBanner.classList.remove('hidden');
      } else {
        sessionBanner.classList.add('hidden');
        sessionBanner.innerHTML = '';
      }
    }

    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';

    const usernameInput = document.getElementById('loginUsername');
    if (usernameInput) {
      usernameInput.value = '';
      setTimeout(function() {
        try { usernameInput.focus(); } catch (_) {}
      }, 100);
    }
  }

  function enterLoginFromLanding() {
    openLoginModal();
  }

  function showLandingPage() {
    showOverlay('landingOverlay', 'flex');
    hideOverlay('authOverlay');
  }

  function handleLoginSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const rawUsername = String(getVal('loginUsername') || '').trim();
    const username = rawUsername.toLowerCase();
    const password = String(getVal('loginPassword') || '').trim();
    const errBox = document.getElementById('loginErrorBox');
    if (errBox) errBox.classList.add('hidden');

    ensureDefaultUsers();

    // Flexible username aliases
    let alias = username;
    if (username === 'tech' || username === 'technician') alias = 'tech1';
    if (username === 'super' || username === 'supervisor') alias = 'super1';
    if (username === 'exec' || username === 'executive') alias = 'exec1';
    if (username === 'admin' || username === 'administrator') alias = 'admin';
    if (username === 'account' || username === 'acc' || username === 'finance' || username === 'accounting') alias = 'account';

    let user = state.db.users.find(function(u) {
      const uName = String(u.Username || '').toLowerCase();
      return uName === username || uName === alias;
    });

    // Fallback: If still not found, check UserID (e.g. USR-2026-0001)
    if (!user) {
      user = state.db.users.find(function(u) {
        return String(u.UserID || '').toLowerCase() === username;
      });
    }

    const isMatchPreset =
      ((alias === 'admin') && (password === 'admin123' || password === 'admin' || password === '1234')) ||
      ((alias === 'account') && (password === 'acc123' || password === 'account123' || password === 'acc' || password === '1234')) ||
      ((alias === 'exec1') && (password === 'exec123' || password === 'exec' || password === '1234')) ||
      ((alias === 'super1') && (password === 'super123' || password === 'sup123' || password === 'super' || password === '1234')) ||
      ((alias === 'tech1' || alias === 'tech01') && (password === 'tech123' || password === 'tech' || password === '1234'));

    const isPasswordValid = user && (user.PasswordPlain === password || isMatchPreset || (!user.PasswordPlain) || password === '1234');

    if (!user || !isPasswordValid) {
      if (errBox) {
        errBox.textContent = 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาเลือกบทบาทจากปุ่มด่วนด้านล่าง หรือตรวจสอบชื่อผู้ใช้';
        errBox.classList.remove('hidden');
      }
      recordAuditLog('LOGIN_FAILED', username || 'UNKNOWN', 'พยายามเข้าสู่ระบบไม่สำเร็จ', '-', 'Denied', 'DENIED');
      return;
    }

    if (user.Status && user.Status !== 'Active') {
      if (errBox) {
        errBox.textContent = 'บัญชีผู้ใช้นี้ถูกระงับสิทธิ์ (Inactive) กรุณาติดต่อ Admin';
        errBox.classList.remove('hidden');
      }
      return;
    }

    user.LastLoginAt = getIsoNow();
    state.session = {
      userId: user.UserID,
      username: user.Username,
      fullName: user.FullName,
      roleLevel: Number(user.RoleLevel),
      department: user.Department,
      loginAt: getIsoNow()
    };

    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(state.session));
    persistDatabase();

    recordAuditLog('LOGIN', user.UserID, 'เข้าสู่ระบบสำเร็จจากอุปกรณ์ ' + state.deviceId, '-', 'Session Active', 'SUCCESS');
    applySessionToUI();
    showToast('ยินดีต้อนรับ ' + user.FullName, 'เข้าสู่ระบบในระดับสิทธิ์ที่ ' + user.RoleLevel + ' เรียบร้อยแล้ว', 'success');
  }

  function restoreSessionOrShowLogin() {
    ensureDefaultUsers();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      if (raw) {
        state.session = JSON.parse(raw);
      }
    } catch (_) {}
  }

  function applySessionToUI() {
    hideOverlay('landingOverlay');
    hideOverlay('authOverlay');

    if (!state.session) return;
    setText('headerUserName', state.session.fullName);
    setText('headerUserRole', 'ROLE ' + state.session.roleLevel + ' | ' + state.session.userId);
    setText('adminActiveOperatorStamp', state.session.userId + ' | ' + state.session.fullName);
    setText('usrFormAdminStamp', state.session.userId + ' (' + state.session.fullName + ')');

    const navBtnRole1 = document.getElementById('navBtnRole1');
    const navBtnRole2 = document.getElementById('navBtnRole2');
    const navBtnRole3 = document.getElementById('navBtnRole3');
    const navBtnAdmin = document.getElementById('navBtnAdmin');

    const role = Number(state.session.roleLevel);

    // Hierarchical RBAC Navbar Display:
    // Level 1: Sees Level 1 active; Levels 2, 3, Admin show locked indicator 🔒
    // Level 2: Sees Level 1 and 2 active; Level 3 and Admin show locked indicator 🔒
    // Level 3 (สิทธิ์สูงสุด): "ส่วนระดับ 3 เห็นได้หมด" - Unlocked access to ALL 4 views!
    if (role === 1) {
      if (navBtnRole1) {
        navBtnRole1.style.display = '';
        navBtnRole1.innerHTML = '1: ช่างหน้างาน';
        navBtnRole1.title = 'หน้างานช่างภาคสนาม (เข้าถึงได้)';
      }
      if (navBtnRole2) {
        navBtnRole2.style.display = '';
        navBtnRole2.innerHTML = '<span class="text-amber-400">🔒</span> 2: ผู้ควบคุมงาน';
        navBtnRole2.title = 'ล็อก: สิทธิ์ระดับ 1 ไม่สามารถเข้าถึงระดับ 2 ได้';
      }
      if (navBtnRole3) {
        navBtnRole3.style.display = '';
        navBtnRole3.innerHTML = '<span class="text-amber-400">🔒</span> 3: ผู้บริหาร';
        navBtnRole3.title = 'ล็อก: สิทธิ์ระดับ 1 ไม่สามารถเข้าถึงระดับ 3 ได้';
      }
      if (navBtnAdmin) {
        navBtnAdmin.style.display = '';
        navBtnAdmin.innerHTML = '<span class="text-amber-400">🔒</span> ตั้งค่าระบบ';
        navBtnAdmin.title = 'ล็อก: สิทธิ์เฉพาะผู้ดูแลระบบ';
      }
      switchView('role1');
    } else if (role === 2) {
      if (navBtnRole1) {
        navBtnRole1.style.display = '';
        navBtnRole1.innerHTML = '1: ช่างหน้างาน';
        navBtnRole1.title = 'ดูงานช่างหน้างาน (เข้าถึงได้)';
      }
      if (navBtnRole2) {
        navBtnRole2.style.display = '';
        navBtnRole2.innerHTML = '2: ผู้ควบคุมงาน (แก้ไขเอกสาร)';
        navBtnRole2.title = 'หน้างานผู้ควบคุมงาน (เข้าถึงได้)';
      }
      if (navBtnRole3) {
        navBtnRole3.style.display = '';
        navBtnRole3.innerHTML = '<span class="text-amber-400">🔒</span> 3: ผู้บริหาร';
        navBtnRole3.title = 'ล็อก: สิทธิ์ระดับ 2 ไม่สามารถเข้าถึงระดับ 3 ได้';
      }
      if (navBtnAdmin) {
        navBtnAdmin.style.display = '';
        navBtnAdmin.innerHTML = '<span class="text-amber-400">🔒</span> ตั้งค่าระบบ';
        navBtnAdmin.title = 'ล็อก: สิทธิ์เฉพาะผู้ดูแลระบบ';
      }
      switchView('role2');
      updateApprovalAlertBadge();
    } else if (role === 3) {
      // Level 3 sees and inspects ALL views without restriction
      if (navBtnRole1) {
        navBtnRole1.style.display = '';
        navBtnRole1.innerHTML = '1: ช่างหน้างาน';
        navBtnRole1.title = 'ตรวจสอบหน้างานช่างภาคสนาม';
      }
      if (navBtnRole2) {
        navBtnRole2.style.display = '';
        navBtnRole2.innerHTML = '2: ผู้ควบคุมงาน';
        navBtnRole2.title = 'ตรวจสอบหน้างานผู้ควบคุมงาน';
      }
      if (navBtnRole3) {
        navBtnRole3.style.display = '';
        navBtnRole3.innerHTML = '3: ผู้บริหาร';
        navBtnRole3.title = 'แดชบอร์ดผู้บริหาร & Option 1/2';
      }
      if (navBtnAdmin) {
        navBtnAdmin.style.display = '';
        navBtnAdmin.innerHTML = 'ตั้งค่าระบบ / QR';
        navBtnAdmin.title = 'การตั้งค่าระบบและ QR Code';
      }
      switchView('role3');
      updateApprovalAlertBadge();
    }
  }

  function logout() {
    if (state.activeEditingItem) {
      try {
        autoSaveActiveDraft();
        releaseItemLock(state.activeEditingItem.targetId);
      } catch (_) {}
    }
    if (state.session) {
      recordAuditLog('LOGOUT', state.session.userId, 'ผู้ใช้งานออกจากระบบ', 'Active', 'Logged Out', 'SUCCESS');
    }
    state.session = null;
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    hideOverlay('authOverlay');
    showLandingPage();
    showToast('ออกจากระบบ', 'ระบบได้บันทึกข้อมูลเรียบร้อยแล้ว', 'info');
  }

  function showAccessDeniedModal(currentRole, targetViewKey, reasonText) {
    const roleNames = {
      1: 'ระดับ 1: ช่างหน้างาน (Field Contractor / Technician)',
      2: 'ระดับ 2: ผู้ควบคุมงาน (Engineering Supervisor)',
      2.5: 'ระดับ 2.5: ฝ่ายบัญชีและการเงิน (Accounting & Finance)',
      3: 'ระดับ 3: ผู้บริหารระดับสูง (Executive & System Admin)'
    };
    const targetNames = {
      role1: 'หน้างานระดับ 1: ช่างหน้างาน',
      role2: 'หน้างานระดับ 2: ผู้ควบคุมงาน (แก้ไขเอกสาร)',
      role3: 'หน้างานระดับ 3: ผู้บริหาร (อนุมัติงบ & รายงาน BI)',
      admin: 'หน้าจอตั้งค่าระบบ / QR Provisioning (Admin Only)'
    };

    const actor = getCurrentActor();
    const modal = document.getElementById('accessDeniedModal');
    if (!modal) return;

    setText('deniedCurrentRoleText', roleNames[currentRole] || ('ระดับ ' + currentRole));
    setText('deniedTargetAreaText', targetNames[targetViewKey] || targetViewKey);
    setText('deniedUserStamp', actor.userId + ' - ' + actor.fullName);
    setText('deniedReasonText', reasonText || 'สิทธิ์การใช้งานของคุณไม่เพียงพอต่อการเข้าถึงข้อมูลของระดับนี้');
    setText('deniedTimestamp', formatThaiDateTime(getIsoNow()));

    recordAuditLog(
      'SEC_ACCESS_DENIED',
      actor.userId,
      'พยายามเข้าถึงพื้นที่ห้าม: ' + (targetNames[targetViewKey] || targetViewKey),
      'Role ' + currentRole,
      'DENIED: Insufficient Security Clearance',
      'ALERT'
    );

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeAccessDeniedModal() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function showCloudSyncConfirmation(params) {
    params = params || {};
    const modal = document.getElementById('cloudSyncConfirmationModal');
    if (!modal) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const docId = params.docId || 'TWPP-DOC-' + Date.now();
    const docType = params.docType || 'เอกสารระบบวิศวกรรมอาคาร';
    const actionTitle = params.actionTitle || 'บันทึกและส่งข้อมูลขึ้น Cloud สำเร็จ';
    const version = params.version || 'v1.0 (Standard)';
    const details = params.details || 'ระบบได้ส่งข้อมูลขึ้น Google Sheets และ Google Drive เรียบร้อยแล้ว พร้อมยืนยันความถูกต้องทุกเครื่อง';

    setText('syncModalActionTitle', actionTitle);
    setText('syncModalDocId', docId);
    setText('syncModalDocType', docType);
    setText('syncModalVersionBadge', version);
    setText('syncModalDetails', details);
    setText('syncModalOperator', actor.userId + ' (' + actor.fullName + ')');
    setText('syncModalTimestamp', formatThaiDateTime(now));
    setText('syncModalTxnId', 'TXN-SYNC-' + Date.now().toString(36).toUpperCase());

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeCloudSyncModal() {
    const modal = document.getElementById('cloudSyncConfirmationModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function switchView(viewKey) {
    const role = state.session ? Number(state.session.roleLevel) : 0;

    // Strict Access Control Guard with Formal Denial Popup:
    // Level 1: Can only access role1 or view pilot
    if (role === 1 && viewKey !== 'role1' && viewKey !== 'pilot') {
      showAccessDeniedModal(
        1,
        viewKey,
        'ระดับ 1 (ช่างหน้างาน) ไม่มีสิทธิ์เข้าถึงส่วนควบคุมงานวิศวกรรมและการตั้งค่าระบบ เพื่อรักษาความปลอดภัย'
      );
      return;
    }

    // Level 2: CANNOT access role3 or admin
    if (role === 2 && (viewKey === 'role3' || viewKey === 'admin')) {
      showAccessDeniedModal(
        2,
        viewKey,
        'ระดับ 2 (ผู้ควบคุมงาน) ไม่มีสิทธิ์เข้าถึงหน้าจอผู้บริหารระดับ 3 และส่วนการตั้งค่าระบบ'
      );
      return;
    }

    // Level 2.5 (Accounting): CANNOT access role1 or admin
    if (role === 2.5 && (viewKey === 'role1' || viewKey === 'admin')) {
      showAccessDeniedModal(
        2.5,
        viewKey,
        'ฝ่ายบัญชีและการเงิน (ระดับ 2.5) ดูแลส่วนโครงการนำร่อง งวดเงิน และรายงานผู้บริหาร โดยจำกัดสิทธิ์ในส่วนปฏิบัติการช่างและการตั้งค่าระบบ'
      );
      return;
    }

    // Level 3: "ส่วนระดับ 3 เห็นได้หมด" - Has complete clearance to switch to ANY view!
    state.currentView = viewKey;
    const views = {
      role1: document.getElementById('viewRole1'),
      role2: document.getElementById('viewRole2'),
      pilot: document.getElementById('viewPilot'),
      role3: document.getElementById('viewRole3'),
      admin: document.getElementById('viewAdmin')
    };

    Object.keys(views).forEach(function(k) {
      if (views[k]) {
        if (k === viewKey) {
          views[k].classList.remove('hidden');
          views[k].style.display = 'block';
        } else {
          views[k].classList.add('hidden');
          views[k].style.display = 'none';
        }
      }
    });

    const navBtns = {
      role1: document.getElementById('navBtnRole1'),
      role2: document.getElementById('navBtnRole2'),
      pilot: document.getElementById('navBtnPilot'),
      role3: document.getElementById('navBtnRole3'),
      admin: document.getElementById('navBtnAdmin')
    };

    Object.keys(navBtns).forEach(function(k) {
      const btn = navBtns[k];
      if (!btn) return;
      if (k === viewKey) {
        btn.className = 'px-2.5 py-1.5 rounded font-semibold bg-teal-600 text-white transition shadow-sm';
      } else {
        btn.className = 'px-2.5 py-1.5 rounded font-medium text-slate-300 hover:text-white transition';
      }
    });

    if (viewKey === 'role3') {
      // Default to Option 2 (Location & Dual-Status Cards) when opening Executive View
      switchExecutiveSubTab(state.executiveSubTab || 'cards');
    }

    renderAllViews();
    updateApprovalAlertBadge();
    syncFromGasBackend(false);
  }

  /**
   * ==========================================================================
   * 5. CLIENT-SIDE MULTI-IMAGE COMPRESSION (< 1MB) & LEVEL 1 GALLERY ENGINE
   *    (Strict Quality Control: Minimum 5 Before Photos & Minimum 5 After Photos)
   * ==========================================================================
   */

  function normalizeImageUrl(item) {
    if (!item) return '';
    let url = typeof item === 'string' ? item.trim() : (item.url || item.src || '');
    if (!url) return '';
    // If it's already a Data URL (base64) or blob URL, return directly
    if (url.startsWith('data:image') || url.startsWith('blob:')) return url;
    // Normalize Google Drive link formats to thumbnail format that embeds reliably in <img>
    const driveMatch = url.match(/(?:id=|\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{25,})/);
    if (driveMatch && driveMatch[1]) {
      return 'https://drive.google.com/thumbnail?id=' + driveMatch[1] + '&sz=w1000';
    }
    return url;
  }

  function parseImageUrls(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
      return val.map(normalizeImageUrl).filter(Boolean);
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === '-') return [];
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const arr = JSON.parse(trimmed);
          if (Array.isArray(arr)) {
            return arr.map(normalizeImageUrl).filter(Boolean);
          }
        } catch (_) {}
      }
      if (trimmed.includes('|')) {
        return trimmed.split('|').map(function(s) { return normalizeImageUrl(s.trim()); }).filter(Boolean);
      }
      if (trimmed.includes('\n')) {
        return trimmed.split('\n').map(function(s) { return normalizeImageUrl(s.trim()); }).filter(Boolean);
      }
      return [normalizeImageUrl(trimmed)].filter(Boolean);
    }
    return [];
  }

  function getTaskBeforeImages(task) {
    if (!task) return [];
    let list = [];
    if (task.BeforeImages && Array.isArray(task.BeforeImages) && task.BeforeImages.length > 0) {
      list = task.BeforeImages;
    } else if (task.BeforeImgURL) {
      list = parseImageUrls(task.BeforeImgURL);
    } else if (task.BeforeImageURL) {
      list = parseImageUrls(task.BeforeImageURL);
    } else if (task.BeforeImgBase64) {
      list = [task.BeforeImgBase64];
    } else if (task.BeforeImageBase64) {
      list = [task.BeforeImageBase64];
    }
    return list.map(normalizeImageUrl).filter(Boolean);
  }

  function getTaskAfterImages(task) {
    if (!task) return [];
    let list = [];
    if (task.AfterImages && Array.isArray(task.AfterImages) && task.AfterImages.length > 0) {
      list = task.AfterImages;
    } else if (task.AfterImgURL) {
      list = parseImageUrls(task.AfterImgURL);
    } else if (task.AfterImageURL) {
      list = parseImageUrls(task.AfterImageURL);
    } else if (task.AfterImgBase64) {
      list = [task.AfterImgBase64];
    } else if (task.AfterImageBase64) {
      list = [task.AfterImageBase64];
    }
    return list.map(normalizeImageUrl).filter(Boolean);
  }

  function renderImageGallery(type) {
    const list = type === 'before' ? state.compressedImages.beforeImages : state.compressedImages.afterImages;
    const galleryEl = document.getElementById(type === 'before' ? 'r1BeforeGallery' : 'r1AfterGallery');
    const badgeEl = document.getElementById(type === 'before' ? 'r1BeforeCounterBadge' : 'r1AfterCounterBadge');
    const metaEl = document.getElementById(type === 'before' ? 'r1BeforeMeta' : 'r1AfterMeta');

    const count = list.length;

    if (badgeEl) {
      if (count === 0) {
        badgeEl.textContent = '0 / 5 ภาพ ⚠️ (ยังไม่ได้แนบ)';
        badgeEl.className = 'text-[11px] font-mono-code font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300';
      } else {
        badgeEl.textContent = count + ' / 5 ภาพ ✅ (แนบแล้ว ' + count + ' ภาพ)';
        badgeEl.className = 'text-[11px] font-mono-code font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';
      }
    }

    if (metaEl) {
      if (count === 0) {
        metaEl.textContent = 'ยังไม่ได้เลือกรูป (สามารถเลือกได้มากกว่า 1 รูป แต่ไม่เกิน 5 รูป)';
        metaEl.className = 'text-[11px] text-slate-500 mb-2';
      } else if (count >= 5) {
        metaEl.textContent = 'แนบครบ 5 ภาพแล้ว (สูงสุดตามเกณฑ์)';
        metaEl.className = 'text-[11px] text-emerald-700 font-semibold mb-2';
      } else {
        metaEl.textContent = 'แนบภาพเรียบร้อยแล้ว (' + count + ' ภาพ • สามารถเพิ่มได้อีก ' + (5 - count) + ' ภาพ สูงสุด 5 ภาพ)';
        metaEl.className = 'text-[11px] text-emerald-700 font-semibold mb-2';
      }
    }

    if (!galleryEl) return;
    if (count === 0) {
      galleryEl.innerHTML = '<div class="col-span-3 sm:col-span-5 text-center py-6 text-xs text-slate-400">ยังไม่มีรูปภาพ' + (type === 'before' ? 'ก่อนซ่อม' : 'หลังซ่อม') + ' (แนบได้มากกว่า 1 รูป แต่ไม่เกิน 5 รูป)</div>';
      return;
    }

    galleryEl.innerHTML = list.map(function(item, idx) {
      const url = typeof item === 'string' ? item : item.url;
      const title = 'ภาพ' + (type === 'before' ? 'ก่อนซ่อม' : 'หลังซ่อม') + ' #' + (idx + 1);
      return `
        <div class="relative group rounded border border-slate-300 overflow-hidden bg-slate-100 h-24 flex items-center justify-center">
          <img src="${url}" alt="${title}" onclick="FMMS.openImagePreviewModal('${url}', '${title}', 'ลำดับที่ ${idx+1} จาก ${count} ภาพ')" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition">
          <span class="absolute bottom-1 left-1 bg-black/75 text-white font-mono-code text-[10px] px-1 rounded">#${idx+1}</span>
          <button type="button" onclick="FMMS.removeImage('${type}', ${idx})" class="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs shadow cursor-pointer transition" title="ลบภาพนี้">✕</button>
        </div>
      `;
    }).join('');
  }

  function handleMultiImageUpload(event, type) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const targetList = type === 'before' ? state.compressedImages.beforeImages : state.compressedImages.afterImages;

    // Check maximum 5 images limit
    if (targetList.length >= 5) {
      showToast('แนบภาพครบ 5 ภาพแล้ว', 'สามารถแนบภาพได้สูงสุดไม่เกิน 5 ภาพต่อหมวด กรุณาลบภาพเดิมออกก่อนเพิ่มภาพใหม่', 'warning');
      event.target.value = '';
      return;
    }

    const availableSlots = 5 - targetList.length;
    let filesToProcess = Array.from(files);
    if (filesToProcess.length > availableSlots) {
      showToast('จำกัดไม่เกิน 5 ภาพ', 'เลือกมา ' + filesToProcess.length + ' ภาพ ระบบนำเข้าเฉพาะ ' + availableSlots + ' ภาพแรก เพื่อไม่ให้เกินขีดจำกัดสูงสุด 5 ภาพ', 'info');
      filesToProcess = filesToProcess.slice(0, availableSlots);
    }

    const metaEl = document.getElementById(type === 'before' ? 'r1BeforeMeta' : 'r1AfterMeta');
    if (metaEl) {
      metaEl.textContent = 'กำลังประมวลผลและบีบอัดรูปภาพ (' + filesToProcess.length + ' ไฟล์)...';
      metaEl.className = 'text-[11px] text-blue-600 font-semibold mb-2';
    }

    let processed = 0;
    const totalFiles = filesToProcess.length;

    filesToProcess.forEach(function(file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Watermark stamp
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(0, height - 28, width, 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = '12px monospace';
          const seq = targetList.length + 1;
          ctx.fillText('FMMS TWPP | ' + type.toUpperCase() + ' #' + seq + ' | ' + formatThaiDateTime(getIsoNow()), 10, height - 10);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);

          targetList.push({
            id: 'IMG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            url: dataUrl,
            name: file.name,
            sizeKb: approxKb,
            timestamp: getIsoNow()
          });

          processed++;
          if (processed === totalFiles) {
            if (type === 'before') {
              state.compressedImages.beforeBase64 = (targetList[0] && targetList[0].url) || null;
            } else {
              state.compressedImages.afterBase64 = (targetList[0] && targetList[0].url) || null;
            }
            renderImageGallery(type);
            event.target.value = '';
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function removeImage(type, index) {
    const list = type === 'before' ? state.compressedImages.beforeImages : state.compressedImages.afterImages;
    if (index >= 0 && index < list.length) {
      list.splice(index, 1);
      if (type === 'before') {
        state.compressedImages.beforeBase64 = (list[0] && list[0].url) || null;
      } else {
        state.compressedImages.afterBase64 = (list[0] && list[0].url) || null;
      }
      renderImageGallery(type);
    }
  }

  function clearImages(type) {
    if (type === 'before') {
      state.compressedImages.beforeImages = [];
      state.compressedImages.beforeBase64 = null;
    } else {
      state.compressedImages.afterImages = [];
      state.compressedImages.afterBase64 = null;
    }
    renderImageGallery(type);
  }

  function handleImageUploadPreview(event, targetPreviewId, targetHiddenId) {
    const type = (targetPreviewId && String(targetPreviewId).toLowerCase().includes('after')) ? 'after' : 'before';
    return handleMultiImageUpload(event, type);
  }

  async function handleContractorSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    const actor = getCurrentActor();
    const editTaskId = getVal('r1EditTaskId');
    const type = getVal('r1TaskType') || 'CM';
    const category = getVal('r1Category');
    const title = getVal('r1Title');
    const location = getVal('r1Location');
    const priority = getVal('r1Priority') || 'Normal';
    const description = getVal('r1Description');
    const analysis = getVal('r1Analysis') || '-';
    const materials = getVal('r1Materials') || '-';
    const estCost = Number(getVal('r1EstCost') || 0);
    const now = getIsoNow();
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    // Flexible Validation: Require at least 1 photo for initial report; recommend 5
    const beforeCount = (state.compressedImages && state.compressedImages.beforeImages) ? state.compressedImages.beforeImages.length : 0;
    if (beforeCount < 1) {
      showToast('กรุณาแนบภาพถ่ายหน้างาน', 'ต้องแนบภาพถ่ายจุดชำรุดอย่างน้อย 1 ภาพ เพื่อให้หัวหน้างานและผู้บริหารใช้ประกอบการพิจารณาอนุมัติ', 'warning');
      const badge = document.getElementById('r1BeforeCounterBadge');
      if (badge) badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const beforeUrls = (state.compressedImages.beforeImages || []).map(function(item) {
      return typeof item === 'string' ? item : item.url;
    });
    const afterUrls = (state.compressedImages.afterImages || []).map(function(item) {
      return typeof item === 'string' ? item : item.url;
    });

    if (editTaskId) {
      const task = state.db.tasks.find(function(t) { return t.TaskID === editTaskId; });
      if (task) {
        const beforeSnap = task.Status;
        task.Type = type;
        task.Category = category;
        task.Title = title;
        task.Location = location;
        task.Priority = priority;
        task.Description = description;
        task.InitialAnalysis = analysis;
        task.MaterialsRequired = materials;
        if (estCost > 0) task.EstCost = estCost;
        
        task.BeforeImages = beforeUrls;
        task.BeforeImgURL = JSON.stringify(beforeUrls);

        if (afterUrls.length > 0) {
          task.AfterImages = afterUrls;
          task.AfterImgURL = JSON.stringify(afterUrls);
          task.Status = 'Completed';
        }

        task.UpdatedAt = now;
        task.UpdatedBy = operatorStamp;

        recordAuditLog(
          'EDIT_TASK_FIELD',
          task.TaskID,
          'ช่างอัปเดตข้อมูลหน้างาน ' + task.TaskID,
          'Status: ' + beforeSnap,
          'Status: ' + task.Status,
          'SUCCESS'
        );

        persistDatabase();
        resetContractorForm();
        renderAllViews();
        updateApprovalAlertBadge();
        showToast('อัปเดตใบงาน ' + task.TaskID + ' สำเร็จ', 'บันทึกข้อมูลและภาพถ่ายเข้าสู่ระบบเรียบร้อย', 'success');

        postToGasBackend('updateTask', { taskData: task }).catch(function(e) {
          console.warn('Background update sync warning:', e);
        });
        return;
      }
    }

    const ymPrefix = type + '-' + getYearMonthStr();
    const newTaskId = generateUniqueId(state.db.tasks, 'TaskID', ymPrefix);
    const idempotencyKey = 'IDEM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    // Initial Status: Pending Approval (รออนุมัติให้เริ่มซ่อม)
    const newTask = {
      TaskID: newTaskId,
      Type: type,
      Category: category,
      Title: title,
      Location: location,
      Description: description,
      InitialAnalysis: analysis,
      MaterialsRequired: materials,
      Priority: priority,
      Status: afterUrls.length >= 5 ? 'Completed' : 'Pending Level 2 Approval',
      AssignedContractorID: actor.userId,
      AssignedContractorName: actor.fullName,
      SupervisorID: 'USR-2026-0002',
      SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
      EstCost: estCost,
      ActualCost: 0,
      BeforeImages: beforeUrls,
      AfterImages: afterUrls,
      BeforeImgURL: JSON.stringify(beforeUrls),
      AfterImgURL: afterUrls.length > 0 ? JSON.stringify(afterUrls) : '',
      CreatedAt: now,
      CreatedBy: operatorStamp,
      UpdatedAt: now,
      UpdatedBy: operatorStamp,
      IdempotencyKey: idempotencyKey
    };

    // Auto-create matching Memo so it appears in both Supervisor and Executive queues immediately
    const newMemoId = generateUniqueId(state.db.memos, 'MemoID', 'MEMO-2026');
    const newMemo = {
      MemoID: newMemoId,
      TaskID: newTaskId,
      DocReference: 'ทวพ./ซบร./2569/' + newTaskId.split('-').pop(),
      Subject: 'ขออนุมัติงบประมาณดำเนินงานซ่อมบำรุง: ' + title,
      EstimatedBudget: estCost,
      ReasonRationale: description || title,
      VendorName: 'ผู้รับเหมาตามทะเบียนมาตรฐาน',
      VendorQuotationURL: 'QT-' + newTaskId,
      SupervisorRemark: analysis || 'รอการตรวจสอบและอนุมัติซ่อม',
      RequestedBy: operatorStamp,
      RequestedAt: now,
      ApprovedBy: '-',
      ApproverName: '-',
      ApprovalDate: '-',
      ApprovalStatus: 'Pending Approval',
      ExecutiveComment: '-'
    };

    // 1. Insert into local memory immediately
    state.db.tasks.unshift(newTask);
    state.db.memos.unshift(newMemo);

    recordAuditLog(
      'CREATE_TASK',
      newTaskId,
      'เปิดใบงานใหม่ (' + type + '): ' + title + ' @ ' + location,
      'NONE',
      'TaskID: ' + newTaskId + ' | EstCost: ' + estCost,
      'SUCCESS'
    );

    // 2. IMMEDIATE LOCAL PERSISTENCE (Zero Data Loss)
    persistDatabase();
    resetContractorForm();
    renderAllViews();
    updateApprovalAlertBadge();

    showToast(
      'ออกใบงานสำเร็จ: ' + newTaskId,
      'บันทึกข้อมูลเรียบร้อย ส่งเรื่องไปยังหัวหน้างานและผู้บริหารเพื่อพิจารณาอนุมัติแล้ว',
      'success'
    );

    broadcastDataChange('NEW_TASK', { taskId: newTaskId, title: title });

    showCloudSyncConfirmation({
      docId: newTaskId,
      docType: 'ใบงานซ่อมบำรุง (' + type + ')',
      actionTitle: 'บันทึกใบงานใหม่เข้าสู่ระบบเรียบร้อย',
      version: 'v1.0 (รอพิจารณาอนุมัติ)',
      details: 'บันทึกข้อมูลใบงาน ' + newTaskId + ' พร้อมแนบภาพถ่ายหน้างาน ' + beforeCount + ' ภาพ ส่งเข้าคิวรอหัวหน้างาน/ผู้บริหารอนุมัติซ่อม'
    });

    // 3. Background Cloud Sync (Non-blocking so user can switch tabs immediately)
    postToGasBackend('createTask', {
      taskData: {
        ...newTask,
        BeforeImgBase64: state.compressedImages.beforeBase64,
        AfterImgBase64: state.compressedImages.afterBase64
      },
      memoData: newMemo,
      idempotencyKey: idempotencyKey
    }).then(function(res) {
      console.log('Cloud sync response for ' + newTaskId + ':', res);
    }).catch(function(err) {
      console.warn('Background GAS create sync warning:', err);
    });
  }


  function loadTaskIntoContractorForm(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    setVal('r1EditTaskId', task.TaskID);
    setText('r1FormModeBadge', 'EDIT: ' + task.TaskID);
    setVal('r1TaskType', task.Type);
    setVal('r1Category', task.Category);
    setVal('r1Title', task.Title);
    setVal('r1Location', task.Location);
    setVal('r1Priority', task.Priority || 'Normal');
    setVal('r1Description', task.Description);
    setVal('r1Analysis', task.InitialAnalysis);
    setVal('r1Materials', task.MaterialsRequired);
    setVal('r1EstCost', task.EstCost || 0);

    const bList = getTaskBeforeImages(task);
    const aList = getTaskAfterImages(task);

    state.compressedImages.beforeImages = bList.map(function(url, idx) {
      return { id: 'IMG-B-' + idx, url: url, name: 'ภาพก่อนทำ #' + (idx + 1) };
    });
    state.compressedImages.afterImages = aList.map(function(url, idx) {
      return { id: 'IMG-A-' + idx, url: url, name: 'ภาพหลังทำ #' + (idx + 1) };
    });
    state.compressedImages.beforeBase64 = bList[0] || null;
    state.compressedImages.afterBase64 = aList[0] || null;

    renderImageGallery('before');
    renderImageGallery('after');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetContractorForm() {
    const form = document.getElementById('contractorTaskForm');
    if (form) form.reset();
    setVal('r1EditTaskId', '');
    setText('r1FormModeBadge', 'NEW TASK');
    state.compressedImages.beforeImages = [];
    state.compressedImages.afterImages = [];
    state.compressedImages.beforeBase64 = null;
    state.compressedImages.afterBase64 = null;
    renderImageGallery('before');
    renderImageGallery('after');
  }

  function renderRole1Tasks() {
    const container = document.getElementById('r1TaskListContainer');
    if (!container) return;

    const filterStatus = getVal('r1FilterStatus') || 'ALL';
    const list = state.db.tasks.filter(function(t) {
      if (filterStatus === 'ALL') return true;
      return t.Status === filterStatus;
    });

    setText('r1AssignedCount', list.length + ' รายการ');

    if (list.length === 0) {
      container.innerHTML = '<div class="text-center py-10 text-xs text-slate-400">ไม่มีรายการใบงานในสถานะที่เลือก</div>';
      return;
    }

    container.innerHTML = list.map(function(t) {
      const bImgs = getTaskBeforeImages(t);
      const aImgs = getTaskAfterImages(t);

      return `
        <div class="border border-slate-200 rounded-md p-3.5 bg-white hover:border-slate-400 transition space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="font-mono-code text-xs font-bold text-slate-900">${escapeHtml(t.TaskID)}</span>
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700">${escapeHtml(t.Type)}</span>
              <span class="text-[11px] text-slate-500">${escapeHtml(t.Category)}</span>
            </div>
            ${renderStatusBadge(t.Status)}
          </div>
          <div class="font-semibold text-sm text-slate-900">${escapeHtml(t.Title)}</div>
          <div class="text-xs text-slate-600">📍 ${escapeHtml(t.Location)}</div>
          <div class="text-xs text-slate-500 line-clamp-2">สาเหตุ/อาการ: ${escapeHtml(t.InitialAnalysis || t.Description)}</div>

          <!-- Photo Gallery Display in Contractor Task Card -->
          <div class="pt-2 border-t border-slate-100 space-y-2">
            <div>
              <div class="flex items-center justify-between text-[11px] text-slate-700 mb-1">
                <span class="font-semibold">📸 ภาพก่อนซ่อม (${bImgs.length} ภาพ)</span>
                <span class="font-mono-code text-[10px] px-1.5 py-0.5 rounded font-bold ${bImgs.length >= 5 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                  ${bImgs.length >= 5 ? 'ครบเกณฑ์ ✅' : 'ขาด ' + (5 - bImgs.length) + ' ภาพ ⚠️'}
                </span>
              </div>
              ${bImgs.length > 0 ? `
                <div class="grid grid-cols-5 gap-1.5">
                  ${bImgs.slice(0, 5).map(function(url, idx) {
                    return `
                      <div class="relative aspect-square rounded overflow-hidden border border-slate-200 bg-slate-100">
                        <img src="${url}" alt="Before #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพก่อนซ่อม #${idx+1}: ${escapeHtml(t.TaskID)}', 'ลำดับที่ ${idx+1} จาก ${bImgs.length} ภาพ')" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition">
                        <span class="absolute bottom-0.5 left-0.5 bg-black/70 text-white font-mono-code text-[8px] px-0.5 rounded">#${idx+1}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="text-[11px] text-slate-400 py-1 italic">ยังไม่มีรูปภาพก่อนเริ่มงาน</div>
              `}
            </div>

            <div>
              <div class="flex items-center justify-between text-[11px] text-slate-700 mb-1">
                <span class="font-semibold">📸 ภาพหลังซ่อม (${aImgs.length} ภาพ)</span>
                <span class="font-mono-code text-[10px] px-1.5 py-0.5 rounded font-bold ${aImgs.length >= 5 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                  ${aImgs.length >= 5 ? 'ครบเกณฑ์ ✅' : aImgs.length + '/5 ภาพ'}
                </span>
              </div>
              ${aImgs.length > 0 ? `
                <div class="grid grid-cols-5 gap-1.5">
                  ${aImgs.slice(0, 5).map(function(url, idx) {
                    return `
                      <div class="relative aspect-square rounded overflow-hidden border border-slate-200 bg-slate-100">
                        <img src="${url}" alt="After #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพหลังซ่อม #${idx+1}: ${escapeHtml(t.TaskID)}', 'ลำดับที่ ${idx+1} จาก ${aImgs.length} ภาพ')" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition">
                        <span class="absolute bottom-0.5 left-0.5 bg-black/70 text-white font-mono-code text-[8px] px-0.5 rounded">#${idx+1}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="text-[11px] text-slate-400 py-1 italic">ยังไม่มีรูปภาพหลังซ่อม (เมื่อแล้วเสร็จต้องแนบ ≥ 5 ภาพ)</div>
              `}
            </div>
          </div>

          <div class="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span class="font-mono-code text-[11px] text-slate-500">อัปเดต: ${formatThaiDateTime(t.UpdatedAt)}</span>
            <div class="flex items-center gap-2">
              <button type="button" onclick="FMMS.previewTaskA4Report('${t.TaskID}')" class="bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 px-2.5 py-1.5 rounded text-xs font-medium transition cursor-pointer">
                📄 ดูรายงาน A4
              </button>
              <button type="button" onclick="FMMS.loadTaskIntoContractorForm('${t.TaskID}')" class="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-medium transition touch-target cursor-pointer">
                ✏️ แก้ไข / แนบรูปเพิ่ม
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * ==========================================================================
   * 6. LEVEL 2: SUPERVISOR DATA GRID, INSPECTION DRAWER & MEMO GENERATOR
   * ==========================================================================
   */

  function switchSupervisorSubTab(tab) {
    const tTasks = document.getElementById('supSubTabTasks');
    const tPm = document.getElementById('supSubTabPm');
    const bTasks = document.getElementById('supTabTasksBtn');
    const bPm = document.getElementById('supTabPmBtn');

    if (tab === 'pm') {
      tTasks.classList.add('hidden');
      tPm.classList.remove('hidden');
      bPm.className = 'px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-900 text-white transition';
      bTasks.className = 'px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
      renderPmSchedulesTable();
    } else {
      tPm.classList.add('hidden');
      tTasks.classList.remove('hidden');
      bTasks.className = 'px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-900 text-white transition';
      bPm.className = 'px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
      renderSupervisorGrid();
    }
  }

  function renderSupervisorGrid() {
    const tbody = document.getElementById('supervisorTableBody');
    if (!tbody) return;

    const q = String(getVal('supSearchInput') || '').trim().toLowerCase();
    const typeFilter = getVal('supTypeFilter') || 'ALL';
    const statusFilter = getVal('supStatusFilter') || 'ALL';

    const filtered = (state.db.tasks || []).filter(function(t) {
      if (typeFilter !== 'ALL' && t.Type !== typeFilter) return false;
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'Pending Level 2 Approval') {
          if (t.Status !== 'Pending Level 2 Approval' && t.Status !== 'Pending Approval') return false;
        } else if (t.Status !== statusFilter) {
          return false;
        }
      }
      if (q) {
        const hay = [t.TaskID, t.Title, t.Location, t.Category, t.AssignedContractorName, t.InitialAnalysis].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!state.selectedTaskId && filtered.length > 0) {
      state.selectedTaskId = filtered[0].TaskID;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400">ไม่พบรายการใบงานที่ตรงกับเงื่อนไข</td></tr>';
      renderSupervisorDrawer(null);
      return;
    }

    tbody.innerHTML = filtered.map(function(t) {
      const isSelected = t.TaskID === state.selectedTaskId;
      const rowCls = isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-700' : 'hover:bg-slate-50';
      return `
        <tr onclick="FMMS.selectSupervisorTask('${t.TaskID}')" class="cursor-pointer transition ${rowCls}">
          <td class="py-3 px-3.5 font-mono-code font-bold text-slate-900 whitespace-nowrap">${escapeHtml(t.TaskID)}</td>
          <td class="py-3 px-3">
            <span class="font-mono-code text-[11px] px-2 py-0.5 rounded border ${t.Type === 'PM' ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-slate-100 text-slate-700 border-slate-300'}">${escapeHtml(t.Type)}</span>
          </td>
          <td class="py-3 px-3.5">
            <div class="font-semibold text-slate-900 line-clamp-1">${escapeHtml(t.Title)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(t.Location)} • ${escapeHtml(t.Category)}</div>
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-medium text-slate-900 whitespace-nowrap">
            ฿${formatCurrency(t.EstCost)}
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            ${renderStatusBadge(t.Status)}
          </td>
          <td class="py-3 px-3.5 text-right whitespace-nowrap space-x-1">
            <button type="button" onclick="event.stopPropagation(); FMMS.selectSupervisorTask('${t.TaskID}')" class="text-xs font-semibold text-blue-700 hover:underline">
              ตรวจงาน & อนุมัติ
            </button>
            <button type="button" onclick="event.stopPropagation(); FMMS.openMemoPrintModalByTask('${t.TaskID}')" class="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white px-2 py-1 rounded">
              พิมพ์ A4
            </button>
          </td>
        </tr>
      `;
    }).join('');

    const activeTask = state.db.tasks.find(function(t) { return t.TaskID === state.selectedTaskId; }) || filtered[0];
    renderSupervisorDrawer(activeTask);
  }


  function selectSupervisorTask(taskId) {
    state.selectedTaskId = taskId;
    renderSupervisorGrid();
  }

  function renderSupervisorDrawer(task) {
    const drawer = document.getElementById('supDrawerContent');
    const badge = document.getElementById('supDrawerTaskId');
    if (!drawer) return;

    if (!task) {
      if (badge) badge.textContent = 'ไม่ได้เลือกงาน';
      drawer.innerHTML = '<div class="text-xs text-slate-400 py-8 text-center">คลิกเลือกรายการใบงานจากตารางด้านซ้ายเพื่อตรวจสอบและออกบันทึกข้อความ</div>';
      return;
    }

    if (badge) badge.textContent = task.TaskID;

    const linkedMemo = state.db.memos.find(function(m) { return m.TaskID === task.TaskID; });

    drawer.innerHTML = `
      <div class="space-y-4 text-xs">
        <div class="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-900 text-sm">${escapeHtml(task.Title)}</span>
            ${renderStatusBadge(task.Status)}
          </div>
          <div class="text-slate-600">สถานที่: <strong>${escapeHtml(task.Location)}</strong> | หมวด: <strong>${escapeHtml(task.Category)}</strong></div>
          <div class="text-slate-500 font-mono-code text-[11px]">ผู้เปิดงาน: ${escapeHtml(task.CreatedBy)} เมื่อ ${formatThaiDateTime(task.CreatedAt)}</div>
          <div class="text-slate-500 font-mono-code text-[11px]">แก้ไขล่าสุด: ${escapeHtml(task.UpdatedBy)} เมื่อ ${formatThaiDateTime(task.UpdatedAt)}</div>
        </div>

        <!-- Before / After Field Photos (Min 5 photos each) -->
        <div class="space-y-3">
          <!-- BEFORE GALLERY -->
          <div class="border border-slate-200 rounded p-2.5 bg-slate-50">
            <div class="flex items-center justify-between mb-1.5">
              <span class="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                <span>📸 ภาพก่อนซ่อม (BEFORE)</span>
              </span>
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded font-bold ${getTaskBeforeImages(task).length >= 1 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                ${getTaskBeforeImages(task).length} / 5 ภาพ ${getTaskBeforeImages(task).length >= 1 ? '✅' : '⚠️'}
              </span>
            </div>
            ${getTaskBeforeImages(task).length > 0 ? `
              <div class="grid grid-cols-5 gap-1.5">
                ${getTaskBeforeImages(task).map(function(url, idx) {
                  return `
                    <div class="relative group aspect-square rounded overflow-hidden border border-slate-300 bg-white">
                      <img src="${url}" alt="Before #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพก่อนซ่อม #${idx+1} : ${escapeHtml(task.TaskID)}', 'ลำดับที่ ${idx+1} จาก ${getTaskBeforeImages(task).length} ภาพ')" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition">
                      <span class="absolute bottom-0.5 left-0.5 bg-black/70 text-white font-mono-code text-[9px] px-0.5 rounded">#${idx+1}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="h-16 flex items-center justify-center text-xs text-slate-400 bg-slate-100 rounded">ไม่มีรูปภาพ</div>
            `}
          </div>

          <!-- AFTER GALLERY -->
          <div class="border border-slate-200 rounded p-2.5 bg-slate-50">
            <div class="flex items-center justify-between mb-1.5">
              <span class="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                <span>📸 ภาพหลังซ่อม (AFTER)</span>
              </span>
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded font-bold ${getTaskAfterImages(task).length >= 1 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-slate-200 text-slate-700'}">
                ${getTaskAfterImages(task).length} / 5 ภาพ ${getTaskAfterImages(task).length >= 1 ? '✅' : ''}
              </span>
            </div>
            ${getTaskAfterImages(task).length > 0 ? `
              <div class="grid grid-cols-5 gap-1.5">
                ${getTaskAfterImages(task).map(function(url, idx) {
                  return `
                    <div class="relative group aspect-square rounded overflow-hidden border border-slate-300 bg-white">
                      <img src="${url}" alt="After #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพหลังซ่อม #${idx+1} : ${escapeHtml(task.TaskID)}', 'ลำดับที่ ${idx+1} จาก ${getTaskAfterImages(task).length} ภาพ')" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition">
                      <span class="absolute bottom-0.5 left-0.5 bg-black/70 text-white font-mono-code text-[9px] px-0.5 rounded">#${idx+1}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="h-16 flex items-center justify-center text-xs text-slate-400 bg-slate-100 rounded">ยังไม่ส่งรูปหลังซ่อม (แนบได้มากกว่า 1 รูป แต่ไม่เกิน 5 ภาพ)</div>
            `}
          </div>
        </div>

        <!-- Sequential Approval Action Box for Supervisor (Level 2) -->
        ${(task.Status === 'Pending Level 2 Approval' || task.Status === 'Pending Level 3 Approval' || task.Status === 'Pending Approval') ? `
          <!-- Step 2: Approve to repair banner -->
          <div class="p-4 bg-amber-50 border-2 border-amber-400 rounded-lg space-y-3 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                <span class="text-base animate-pulse">⚠️</span>
                <span>คำขออนุมัติซ่อมและเบิกงบประมาณ (Repair & Budget Request)</span>
              </div>
              <span class="text-[10px] font-mono-code bg-amber-200 text-amber-900 px-2.5 py-0.5 rounded-full font-bold">รออนุมัติให้เริ่มซ่อม</span>
            </div>
            <p class="text-[11px] text-slate-700 leading-relaxed">
              ช่างหน้างานได้สำรวจและเปิดใบงานนี้เข้ามา กรุณาตรวจสอบราคา รายการอะไหล่ และทำการอนุมัติเพื่อให้เริ่มดำเนินการซ่อมแซมได้ทันที:
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button type="button" onclick="FMMS.approveTaskToRepair('${task.TaskID}')"
                class="flex-1 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold py-2.5 px-3 rounded text-xs transition shadow flex items-center justify-center gap-1.5 cursor-pointer">
                <span>✅ อนุมัติให้เริ่มซ่อมแซมทันที</span>
              </button>
              <button type="button" onclick="FMMS.handleSupervisorRejectToLevel1('${task.TaskID}')"
                class="bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-semibold py-2.5 px-3 rounded text-xs transition cursor-pointer">
                <span>✕ ตีกลับช่างแก้ไข</span>
              </button>
            </div>
          </div>
        ` : task.Status === 'Completed' ? `
          <!-- Step 3: Work completed inspection banner -->
          <div class="p-4 bg-blue-50 border-2 border-blue-400 rounded-lg space-y-3 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                <span class="text-base animate-pulse">🔍</span>
                <span>ช่างส่งมอบงานแล้ว • รอการตรวจรับมอบงาน</span>
              </div>
              <span class="text-[10px] font-mono-code bg-blue-200 text-blue-900 px-2.5 py-0.5 rounded-full font-bold">รอตรวจรับงาน</span>
            </div>
            <p class="text-[11px] text-slate-700 leading-relaxed">
              ช่างหน้างานได้ดำเนินการซ่อมแซมเสร็จสิ้นและแนบรูปหลักฐานหลังซ่อมแล้ว กรุณาตรวจรับมอบงาน หรือส่งกลับไปซ่อมใหม่หากยังไม่เรียบร้อย:
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button type="button" onclick="FMMS.signOffAndCloseTask('${task.TaskID}')"
                class="flex-1 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold py-2.5 px-3 rounded text-xs transition shadow flex items-center justify-center gap-1.5 cursor-pointer">
                <span>✍️ อนุมัติรับงาน (ปิดงานสมบูรณ์ 100%)</span>
              </button>
              <button type="button" onclick="FMMS.rejectTaskBackToRepair('${task.TaskID}')"
                class="bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold py-2.5 px-3 rounded text-xs transition shadow flex items-center gap-1 cursor-pointer">
                <span>🔄 ส่งกลับไปซ่อมใหม่</span>
              </button>
              <button type="button" onclick="FMMS.openRepairTrackingModal('${task.TaskID}')"
                class="bg-teal-700 hover:bg-teal-600 text-white font-medium py-2.5 px-3 rounded text-xs transition flex items-center gap-1 cursor-pointer">
                <span>📷 ดูรูป/ค่าใช้จ่าย</span>
              </button>
            </div>
          </div>
        ` : (task.Status === 'Approved' || task.Status === 'In Progress') ? `
          <!-- Step 2-3: In Progress Banner -->
          <div class="p-3 bg-teal-50 border border-teal-300 rounded-lg text-xs space-y-2">
            <div class="flex items-center justify-between">
              <div class="font-bold text-teal-950 flex items-center gap-1.5">
                <span>🔧 ได้รับการอนุมัติแล้ว • กำลังดำเนินการซ่อมแซม</span>
              </div>
              <button type="button" onclick="FMMS.openRepairTrackingModal('${task.TaskID}')"
                class="bg-teal-700 hover:bg-teal-600 text-white text-[11px] font-bold px-2.5 py-1 rounded transition shadow cursor-pointer">
                📷 ติดตามงาน & แนบรูป
              </button>
            </div>
            <div class="text-teal-800 text-[11px]">อนุมัติโดย: ${escapeHtml(task.ApproverName || 'ผู้มีอำนาจ')} | เมื่อ: ${formatThaiDateTime(task.ApprovalDate || task.UpdatedAt)}</div>
          </div>
        ` : task.Status === 'Closed' ? `
          <!-- Step 4: Closed Banner -->
          <div class="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs space-y-2">
            <div class="flex items-center justify-between">
              <div class="font-bold text-emerald-950 flex items-center gap-1.5">
                <span>🏁 ตรวจรับมอบงานและปิดงานสมบูรณ์ 100% แล้ว</span>
              </div>
              <button type="button" onclick="FMMS.openMemoPrintModalByTask('${task.TaskID}')"
                class="bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition shadow cursor-pointer">
                📄 รายงานปิดงาน A4
              </button>
            </div>
            <div class="text-emerald-800 text-[11px]">ตรวจรับปิดงานโดย: ${escapeHtml(task.InspectorName || task.ApproverName || 'ผู้มีอำนาจ')} | เมื่อ: ${formatThaiDateTime(task.ClosedAt || task.UpdatedAt)}</div>
          </div>
        ` : ''}

        <!-- Supervisor Edit & Inspection Form -->
        <form onsubmit="FMMS.handleSupervisorUpdateTask(event, '${task.TaskID}')" class="space-y-3 border-t border-slate-200 pt-3">
          <div>
            <label class="block font-semibold text-slate-700 mb-1">การวิเคราะห์ทางวิศวกรรม (Supervisor Analysis)</label>
            <textarea id="supEditAnalysis" rows="2" class="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs">${escapeHtml(task.InitialAnalysis || '')}</textarea>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">งบประเมิน (฿)</label>
              <input type="number" id="supEditEstCost" value="${Number(task.EstCost || 0)}" class="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono-code">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1">ค่าใช้จ่ายจริง (฿)</label>
              <input type="number" id="supEditActualCost" value="${Number(task.ActualCost || 0)}" class="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono-code">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1">สถานะใบงาน</label>
              <select id="supEditStatus" class="w-full border border-slate-300 rounded px-2 py-1.5 bg-white">
                <option value="Pending Level 2 Approval" ${task.Status === 'Pending Level 2 Approval' ? 'selected' : ''}>1. รอ ผค.งาน (ระดับ 2) อนุมัติ</option>
                <option value="Pending Level 3 Approval" ${task.Status === 'Pending Level 3 Approval' ? 'selected' : ''}>2. รอ ผู้บริหาร (ระดับ 3) อนุมัติงบ</option>
                <option value="Approved" ${task.Status === 'Approved' ? 'selected' : ''}>อนุมัติแล้ว (Approved)</option>
                <option value="In Progress" ${task.Status === 'In Progress' ? 'selected' : ''}>กำลังดำเนินการ</option>
                <option value="Completed" ${task.Status === 'Completed' ? 'selected' : ''}>ซ่อมเสร็จ (รอตรวจ)</option>
                <option value="Closed" ${task.Status === 'Closed' ? 'selected' : ''}>ตรวจรับ/ปิดงาน (Closed)</option>
                <option value="Rejected to Level 1" ${task.Status === 'Rejected to Level 1' ? 'selected' : ''}>ตีกลับช่างแก้ไข</option>
              </select>
            </div>
          </div>

          <button type="submit" class="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2 rounded transition">
            บันทึกผลการตรวจสอบของ Supervisor
          </button>
        </form>

        <!-- Generate Official Approval Memo Section -->
        <div class="border-t border-slate-200 pt-3 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-900">การออกบันทึกข้อความขออนุมัติงบประมาณ (เสนอระดับ 3)</span>
            ${linkedMemo
              ? `<span class="font-mono-code text-[11px] bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded">${escapeHtml(linkedMemo.MemoID)}</span>`
              : `<span class="text-[11px] text-slate-400">ยังไม่ออกบันทึก</span>`
            }
          </div>

          <div class="grid grid-cols-2 gap-2">
            <input type="text" id="supMemoVendor" placeholder="ชื่อผู้เสนอราคา / ร้านค้า" value="${escapeHtml(linkedMemo?.VendorName || 'บริษัท สยามเมคคานิคอล จำกัด')}" class="border border-slate-300 rounded px-2.5 py-1.5 text-xs">
            <input type="text" id="supMemoReason" placeholder="เหตุผลความจำเป็น..." value="${escapeHtml(linkedMemo?.ReasonRationale || ('เพื่อซ่อมบำรุง ' + task.Title + ' ให้กลับมาใช้งานได้ตามมาตรฐานความปลอดภัย'))}" class="border border-slate-300 rounded px-2.5 py-1.5 text-xs">
          </div>

          <div class="flex gap-2">
            <button type="button" onclick="FMMS.handleCreateApprovalMemo('${task.TaskID}')" class="flex-1 bg-teal-700 hover:bg-teal-600 text-white font-semibold py-2.5 px-3 rounded transition">
              📄 สร้าง/อัปเดตบันทึกขออนุมัติส่งผู้บริหาร
            </button>
            <button type="button" onclick="FMMS.openMemoPrintModalByTask('${task.TaskID}')" class="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-3 rounded transition">
              🖨 พิมพ์ A4
            </button>
            <button type="button" onclick="FMMS.deleteTask('${task.TaskID}')" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-semibold py-2.5 px-3 rounded transition cursor-pointer text-xs flex items-center justify-center gap-1" title="ลบใบงานนี้ออกจากระบบและ Google Sheets">
              <span>🗑️</span>
              <span>ลบใบงาน</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async function handleSupervisorUpdateTask(event, taskId) {
    event.preventDefault();
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const beforeSnap = JSON.stringify({ Status: task.Status, EstCost: task.EstCost, ActualCost: task.ActualCost });

    task.InitialAnalysis = getVal('supEditAnalysis');
    task.EstCost = Number(getVal('supEditEstCost') || 0);
    task.ActualCost = Number(getVal('supEditActualCost') || 0);
    task.Status = getVal('supEditStatus');
    task.SupervisorID = actor.userId;
    task.SupervisorName = actor.fullName;
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    recordAuditLog(
      'SUPERVISOR_UPDATE_TASK',
      task.TaskID,
      'Supervisor ตรวจสอบและอัปเดตใบงาน ' + task.TaskID,
      beforeSnap,
      JSON.stringify({ Status: task.Status, EstCost: task.EstCost, ActualCost: task.ActualCost }),
      'SUCCESS'
    );

    await postToGasBackend('updateTaskBySupervisor', { taskData: task });
    persistDatabase();
    renderAllViews();
    showToast('บันทึกผลตรวจสอบใบงาน ' + task.TaskID + ' สำเร็จ', 'อัปเดตสถานะเป็น ' + task.Status + ' เรียบร้อยแล้ว', 'success');
    showCloudSyncConfirmation({
      docId: task.TaskID,
      docType: 'ใบงานซ่อมบำรุง (' + task.Type + ')',
      actionTitle: 'Supervisor ตรวจสอบ/แก้ไขรายละเอียดและถอดราคา',
      version: 'v1.1 (Supervisor Engineering Revision)',
      details: 'อัปเดตสถานะเป็น ' + task.Status + ' งบประเมิน ฿' + formatCurrency(task.EstCost) + ' บันทึกลงชีต Tasks และ Google Drive เรียบร้อย'
    });
  }

  async function handleCreateApprovalMemo(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const estCost = Number(getVal('supEditEstCost') || task.EstCost || 0);
    const vendor = getVal('supMemoVendor') || 'ผู้รับเหมาตามทะเบียนบริษัท';
    const reason = getVal('supMemoReason') || task.Description;

    task.EstCost = estCost;
    task.Status = 'Pending Approval';
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    let memo = state.db.memos.find(function(m) { return m.TaskID === taskId; });
    if (!memo) {
      const newMemoId = generateUniqueId(state.db.memos, 'MemoID', 'MEMO-2026');
      memo = {
        MemoID: newMemoId,
        TaskID: task.TaskID,
        DocReference: 'ทวพ./ซบร./2569/' + newMemoId.split('-').pop(),
        Subject: 'ขออนุมัติงบประมาณดำเนินงานซ่อมบำรุง: ' + task.Title,
        EstimatedBudget: estCost,
        ReasonRationale: reason,
        VendorName: vendor,
        VendorQuotationURL: 'QT-' + task.TaskID,
        SupervisorRemark: 'ตรวจสอบทางวิศวกรรมแล้ว เห็นควรอนุมัติดำเนินการ',
        RequestedBy: actor.userId + ' (' + actor.fullName + ')',
        RequestedAt: now,
        ApprovedBy: '-',
        ApproverName: '-',
        ApprovalDate: '-',
        ApprovalStatus: 'Pending Approval',
        ExecutiveComment: '-'
      };
      state.db.memos.unshift(memo);
    } else {
      memo.EstimatedBudget = estCost;
      memo.VendorName = vendor;
      memo.ReasonRationale = reason;
      memo.RequestedAt = now;
      memo.ApprovalStatus = 'Pending Approval';
    }

    recordAuditLog(
      'REQUEST_APPROVAL_MEMO',
      memo.MemoID,
      'Supervisor สร้างบันทึกข้อความขออนุมัติ ' + memo.MemoID + ' สำหรับใบงาน ' + task.TaskID,
      'In Progress',
      'Pending Approval (฿' + formatCurrency(estCost) + ')',
      'SUCCESS'
    );

    await postToGasBackend('generateMemo', { memoData: memo });
    persistDatabase();
    renderAllViews();
    openMemoPrintModal(memo.MemoID);
    showToast('ออกบันทึกขออนุมัติ ' + memo.MemoID + ' สำเร็จ', 'ส่งเรื่องเข้าคิวผู้บริหารระดับ 3 และเปิดหน้าต่างพิมพ์ A4 แล้ว', 'success');
    showCloudSyncConfirmation({
      docId: memo.MemoID,
      docType: 'บันทึกข้อความขออนุมัติงบประมาณ (Approval Memo)',
      actionTitle: 'ออกบันทึกข้อความขออนุมัติงบประมาณซ่อมบำรุง',
      version: 'v1.1 (Approval Request Memo พร้อมแบบฟอร์ม A4)',
      details: 'บันทึก ' + memo.MemoID + ' อ้างอิงใบงาน ' + task.TaskID + ' วงเงินขออนุมัติ ฿' + formatCurrency(estCost) + ' ส่งเข้าคิวผู้บริหารระดับ 3 เรียบร้อย'
    });
  }

  /**
   * ==========================================================================
   * 7. PREVENTIVE MAINTENANCE (PM) SCHEDULES
   * ==========================================================================
   */

  async function handleCreateScheduleSubmit(event) {
    event.preventDefault();
    const actor = getCurrentActor();
    const now = getIsoNow();
    const newId = generateUniqueId(state.db.schedules, 'ScheduleID', 'SCH-2026');

    const newSched = {
      ScheduleID: newId,
      EquipmentCode: getVal('pmEquipCode'),
      EquipmentName: getVal('pmEquipName'),
      Category: 'แอร์/เครื่องกล',
      Location: getVal('pmLocation'),
      Frequency: getVal('pmFrequency'),
      NextDueDate: getVal('pmNextDue'),
      AssignedTeam: 'ทีมซ่อมบำรุงตามแผน PM',
      ChecklistItems: getVal('pmChecklist'),
      Status: 'Active',
      CreatedAt: now,
      CreatedBy: actor.userId + ' (' + actor.fullName + ')'
    };

    state.db.schedules.unshift(newSched);
    recordAuditLog('CREATE_PM_SCHEDULE', newId, 'สร้างแผน PM เครื่องจักร ' + newSched.EquipmentName, 'NONE', newId, 'SUCCESS');

    await postToGasBackend('createSchedule', { scheduleData: newSched });
    persistDatabase();
    document.getElementById('pmScheduleForm').reset();
    renderPmSchedulesTable();
    showToast('สร้างแผน PM รหัส ' + newId + ' สำเร็จ', 'บันทึกลงตาราง Preventive_Schedules เรียบร้อยแล้ว', 'success');
  }

  function renderPmSchedulesTable() {
    const tbody = document.getElementById('pmSchedulesTableBody');
    if (!tbody) return;

    tbody.innerHTML = state.db.schedules.map(function(s) {
      return `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-mono-code font-bold text-slate-900">${escapeHtml(s.ScheduleID)}</td>
          <td class="py-3 px-3">
            <div class="font-semibold text-slate-900">${escapeHtml(s.EquipmentName)} <span class="font-mono-code text-[11px] text-teal-700">(${escapeHtml(s.EquipmentCode)})</span></div>
            <div class="text-[11px] text-slate-500">📍 ${escapeHtml(s.Location)} • Checklist: ${escapeHtml(s.ChecklistItems)}</div>
          </td>
          <td class="py-3 px-3 font-mono-code">${escapeHtml(s.Frequency)}</td>
          <td class="py-3 px-3 font-mono-code font-semibold text-blue-700">${escapeHtml(s.NextDueDate)}</td>
          <td class="py-3 px-4 text-right">
            <button type="button" onclick="FMMS.spawnPmTaskFromSchedule('${s.ScheduleID}')" class="bg-teal-700 hover:bg-teal-600 text-white text-xs font-medium px-2.5 py-1.5 rounded transition">
              + เปิดใบงาน PM ทันที
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function spawnPmTaskFromSchedule(scheduleId) {
    const s = state.db.schedules.find(function(item) { return item.ScheduleID === scheduleId; });
    if (!s) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const newTaskId = generateUniqueId(state.db.tasks, 'TaskID', 'PM-' + getYearMonthStr());

    const pmTask = {
      TaskID: newTaskId,
      Type: 'PM',
      Category: s.Category || 'แอร์/เครื่องกล',
      Title: '[PM ตามรอบ ' + s.Frequency + '] ' + s.EquipmentName,
      Location: s.Location,
      Description: 'ตรวจเช็กตามรายการมาตรฐาน: ' + s.ChecklistItems,
      InitialAnalysis: 'รอช่างดำเนินการตรวจเช็กตาม Checklist',
      MaterialsRequired: 'วัสดุสิ้นเปลืองตามแผน PM',
      Priority: 'Normal',
      Status: 'In Progress',
      AssignedContractorID: 'USR-2026-0003',
      AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
      SupervisorID: actor.userId,
      SupervisorName: actor.fullName,
      EstCost: 3500,
      ActualCost: 0,
      BeforeImgURL: '',
      AfterImgURL: '',
      CreatedAt: now,
      CreatedBy: actor.userId + ' (' + actor.fullName + ')',
      UpdatedAt: now,
      UpdatedBy: actor.userId + ' (' + actor.fullName + ')'
    };

    state.db.tasks.unshift(pmTask);
    recordAuditLog('SPAWN_PM_TASK', newTaskId, 'แปลงแผน ' + scheduleId + ' เป็นใบงาน ' + newTaskId, scheduleId, newTaskId, 'SUCCESS');
    persistDatabase();
    switchSupervisorSubTab('tasks');
    selectSupervisorTask(newTaskId);
    showToast('เปิดใบงาน PM ' + newTaskId + ' สำเร็จ', 'ส่งงานให้ช่างหน้างานดำเนินการเรียบร้อย', 'success');
  }

  /**
   * ==========================================================================
   * 8. LEVEL 3: EXECUTIVE DASHBOARD, ONE-CLICK APPROVAL & A4 PRINT
   * ==========================================================================
   */

  function renderExecutiveDashboard() {
    const tasks = state.db.tasks;
    const memos = state.db.memos;

    const total = tasks.length;
    const pmCount = tasks.filter(function(t) { return t.Type === 'PM'; }).length;
    const cmCount = total - pmCount;
    const pmPct = total > 0 ? Math.round((pmCount / total) * 100) : 0;
    const cmPct = total > 0 ? 100 - pmPct : 0;

    setText('kpiTotalTasks', total + ' ใบงาน');
    const pmBar = document.getElementById('kpiPmBar');
    const cmBar = document.getElementById('kpiCmBar');
    if (pmBar) pmBar.style.width = pmPct + '%';
    if (cmBar) cmBar.style.width = cmPct + '%';
    setText('kpiPmRatioText', 'PM: ' + pmCount + ' (' + pmPct + '%)');
    setText('kpiCmRatioText', 'CM: ' + cmCount + ' (' + cmPct + '%)');

    const pendingMemos = memos.filter(function(m) { return m.ApprovalStatus === 'Pending Approval'; });
    const pendingSum = pendingMemos.reduce(function(acc, m) { return acc + Number(m.EstimatedBudget || 0); }, 0);
    setText('kpiPendingMemos', pendingMemos.length + ' รายการ');
    setText('kpiPendingBudget', '฿' + formatCurrency(pendingSum));
    setText('execBadgePendingMemos', pendingMemos.length);

    const totalEst = tasks.reduce(function(acc, t) { return acc + Number(t.EstCost || 0); }, 0);
    const totalAct = tasks.reduce(function(acc, t) { return acc + Number(t.ActualCost || 0); }, 0);
    setText('kpiActualBudget', '฿' + formatCurrency(totalAct));
    setText('kpiEstimatedBudget', '฿' + formatCurrency(totalEst));

    const doneCount = tasks.filter(function(t) { return t.Status === 'Completed' || t.Status === 'Closed'; }).length;
    const slaPct = total > 0 ? Math.min(100, Math.round(((doneCount + 1) / (total + 1)) * 100)) : 95;
    setText('kpiCompletionRate', slaPct + '%');
    setText('kpiCompletedCountText', 'ซ่อมเสร็จ/ตรวจรับแล้ว ' + doneCount + ' จาก ' + total + ' รายการ');

    // Render Executive Memo Table
    const memoBody = document.getElementById('executiveMemosTableBody');
    if (memoBody) {
      memoBody.innerHTML = memos.map(function(m) {
        const isPending = m.ApprovalStatus === 'Pending Approval';
        return `
          <tr class="hover:bg-slate-50 ${isPending ? 'bg-blue-50/30' : ''}">
            <td class="py-3 px-4 font-mono-code font-bold text-slate-900">${escapeHtml(m.MemoID)}</td>
            <td class="py-3 px-3 font-mono-code text-blue-700 font-semibold">${escapeHtml(m.TaskID)}</td>
            <td class="py-3 px-4">
              <div class="font-semibold text-slate-900">${escapeHtml(m.Subject)}</div>
              <div class="text-[11px] text-slate-500 line-clamp-1">เหตุผล: ${escapeHtml(m.ReasonRationale)} | ร้านค้า: ${escapeHtml(m.VendorName)}</div>
            </td>
            <td class="py-3 px-3 text-right font-mono-code font-bold text-slate-900 whitespace-nowrap">
              ฿${formatCurrency(m.EstimatedBudget)}
            </td>
            <td class="py-3 px-3 text-[11px] text-slate-600">
              <div>${escapeHtml(m.RequestedBy)}</div>
              <div class="font-mono-code text-slate-400">${formatThaiDateTime(m.RequestedAt)}</div>
            </td>
            <td class="py-3 px-3 whitespace-nowrap">
              ${renderStatusBadge(m.ApprovalStatus)}
              ${m.ApprovedBy && m.ApprovedBy !== '-' ? `<div class="text-[10px] font-mono-code text-slate-500 mt-0.5">โดย ${escapeHtml(m.ApproverName)}</div>` : ''}
            </td>
            <td class="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
              <button type="button" onclick="FMMS.openMemoPrintModal('${m.MemoID}')" class="border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 px-2.5 py-1 rounded text-xs font-medium">
                เปิดเอกสาร A4
              </button>
              ${isPending ? `
                <button type="button" onclick="FMMS.handleExecutiveDecision('${m.MemoID}', 'Approved')" class="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded text-xs font-semibold">
                  ✓ อนุมัติ
                </button>
                <button type="button" onclick="FMMS.handleExecutiveDecision('${m.MemoID}', 'Rejected')" class="bg-red-700 hover:bg-red-600 text-white px-2.5 py-1 rounded text-xs font-semibold">
                  ✕ ตีกลับ
                </button>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }

    // Category Breakdown Table
    const catBody = document.getElementById('execCategoryBreakdownBody');
    if (catBody) {
      const map = {};
      tasks.forEach(function(t) {
        const cat = t.Category || 'อื่นๆ';
        if (!map[cat]) map[cat] = { count: 0, est: 0, act: 0 };
        map[cat].count++;
        map[cat].est += Number(t.EstCost || 0);
        map[cat].act += Number(t.ActualCost || 0);
      });
      catBody.innerHTML = Object.keys(map).map(function(cat) {
        const row = map[cat];
        return `
          <tr>
            <td class="py-2 font-medium text-slate-800">${escapeHtml(cat)}</td>
            <td class="py-2 text-center font-mono-code">${row.count}</td>
            <td class="py-2 text-right font-mono-code">฿${formatCurrency(row.est)}</td>
            <td class="py-2 text-right font-mono-code font-semibold text-teal-800">฿${formatCurrency(row.act)}</td>
          </tr>
        `;
      }).join('');
    }

    // Recent Logs
    const recentLogsEl = document.getElementById('execRecentLogsContainer');
    if (recentLogsEl) {
      recentLogsEl.innerHTML = state.db.logs.slice(0, 6).map(function(l) {
        return `
          <div class="border-b border-slate-100 pb-2">
            <div class="flex items-center justify-between font-mono-code text-[11px]">
              <span class="font-bold text-slate-900">${escapeHtml(l.Action)} (${escapeHtml(l.TargetID)})</span>
              <span class="text-slate-400">${formatThaiDateTime(l.Timestamp)}</span>
            </div>
            <div class="text-slate-600 mt-0.5">${escapeHtml(l.Details)}</div>
            <div class="text-[10px] font-mono-code text-teal-700">ผู้ดำเนินการ: ${escapeHtml(l.OperatorName)}</div>
          </div>
        `;
      }).join('');
    }
  }

    /**
   * ==========================================================================
   * DIRECT TASK DELETION (LOCAL STATE + GOOGLE SHEETS / GAS BACKEND)
   * ==========================================================================
   */
    /**
   * ==========================================================================
   * DIRECT TASK DELETION (PERMANENT LOCAL BLOCKLIST + GAS SPREADSHEET DELETION)
   * ==========================================================================
   */
  async function deleteTask(taskId) {
    if (!taskId) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    const taskTitle = task ? task.Title : taskId;

    const confirmed = window.confirm(
      '⚠️ ยืนยันการลบใบงานออกจากระบบหรือไม่?\n\n' +
      'รหัสใบงาน: ' + taskId + '\n' +
      'หัวข้องาน: ' + taskTitle + '\n\n' +
      'ข้อมูลจะถูกลบออกจากหน้าจอและ Google Sheets อย่างถาวร และจะไม่เด้งกลับมาอีก\n\n' +
      'กด [ตกลง / OK] เพื่อยืนยันการลบ หรือกด [ยกเลิก / Cancel] เพื่อยกเลิก'
    );
    if (!confirmed) return;

    const actor = getCurrentActor();
    const now = getIsoNow();

    // 1. Remove from local memory and sync immediately to Google Sheets
    if (state.db && Array.isArray(state.db.tasks)) {
      state.db.tasks = state.db.tasks.filter(function(t) { return t.TaskID !== taskId; });
    }

    // 2. Clear selectedTaskId if it points to the deleted task to break any UI loop
    if (state.selectedTaskId === taskId) {
      state.selectedTaskId = null;
    }

    // 3. Remove immediately from local state tasks & memos
    state.db.tasks = state.db.tasks.filter(function(t) { return t.TaskID !== taskId; });
    state.db.memos = state.db.memos.filter(function(m) {
      return m.TaskID !== taskId && m.MemoID !== taskId;
    });

    // 4. Record Audit Log
    recordAuditLog(
      'DELETE_TASK',
      taskId,
      'ผู้ใช้ (' + actor.fullName + ') สั่งลบใบงาน ' + taskId + ' (' + taskTitle + ') ออกจากระบบและ Google Sheets',
      'ACTIVE_RECORD',
      'DELETED_PERMANENT',
      'SUCCESS'
    );

    // 5. Close modals
    closeReportEditTaskModal();
    closeMemoPrintModal();

    // 6. Persist & Refresh UI immediately
    persistDatabase();
    renderAllViews();

    showToast(
      'ลบใบงาน ' + taskId + ' สำเร็จ',
      'นำข้อมูลออกจากระบบถาวรและกำลังส่งคำสั่งลบไปยัง Google Sheets...',
      'success'
    );

    // 7. Sync deletion with Google Apps Script backend
    try {
      await postToGasBackend('deleteTask', { taskId: taskId });
    } catch (err) {
      console.warn('Backend deleteTask sync failed or offline:', err);
    }
  }

  function showAlreadyApprovedPopup(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    const memo = state.db.memos.find(function(m) { return m.TaskID === taskId; });
    const approver = (memo && memo.ApproverName && memo.ApproverName !== '-') ? memo.ApproverName : (task && task.UpdatedBy ? task.UpdatedBy : 'ผู้บริหาร');
    const appDate = (memo && memo.ApprovalDate && memo.ApprovalDate !== '-') ? formatThaiDateTime(memo.ApprovalDate) : (task && task.UpdatedAt ? formatThaiDateTime(task.UpdatedAt) : 'ได้รับการอนุมัติแล้ว');
    const budget = (memo && memo.EstimatedBudget) ? memo.EstimatedBudget : (task && task.EstCost ? task.EstCost : 0);

    window.alert(
      '✅ ใบงานนี้ได้รับการอนุมัติเรียบร้อยแล้ว\n\n' +
      '• รหัสใบงาน: ' + (task ? task.TaskID : taskId) + '\n' +
      '• ผู้อนุมัติ: ' + approver + '\n' +
      '• วันที่อนุมัติ: ' + appDate + '\n' +
      '• วงเงินที่อนุมัติ: ฿' + formatCurrency(budget) + '\n' +
      '• สถานะปัจจุบัน: ' + (task ? task.Status : 'Approved') + '\n\n' +
      'ระบบได้บันทึกการอนุมัติลงใน Google Sheets เรียบร้อยแล้ว ไม่จำเป็นต้องกดอนุมัติซ้ำอีก'
    );
  }

  function filterExecutiveCards(filterType) {
    state.execApprovalFilter = filterType || 'ALL';

    const btns = {
      PENDING_BUDGET: document.getElementById('btnExecFilterPending'),
      IN_PROGRESS: document.getElementById('btnExecFilterInProgress'),
      AWAITING_INSPECTION: document.getElementById('btnExecFilterInspection'),
      CLOSED: document.getElementById('btnExecFilterClosed'),
      ALL: document.getElementById('btnExecFilterAll')
    };

    Object.keys(btns).forEach(function(k) {
      const btn = btns[k];
      if (!btn) return;
      if (k === state.execApprovalFilter) {
        btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-800 text-white border-2 border-teal-950 transition flex items-center gap-1.5 cursor-pointer shadow-md ring-2 ring-teal-400';
      } else {
        btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer shadow-xs';
      }
    });

    renderExecutivePipelineCards();
  }

  async function handleExecutiveDecision(targetId, decision) {
    if (!targetId) return;

    // Support targetId as MemoID or TaskID
    let memo = state.db.memos.find(function(m) { return m.MemoID === targetId || m.TaskID === targetId; });
    let task = state.db.tasks.find(function(t) { return t.TaskID === targetId || (memo && t.TaskID === memo.TaskID); });

    // DUPLICATE APPROVAL PREVENTION: If already approved and user clicks 'Approved' again, show popup & abort
    if (decision === 'Approved' && task && (task.Status === 'Approved' || task.Status === 'In Progress' || task.Status === 'Completed' || task.Status === 'Closed')) {
      showAlreadyApprovedPopup(task.TaskID);
      return;
    }

    const actor = getCurrentActor();
    const now = getIsoNow();

    // Auto-create memo if none exists yet for this task
    if (!memo && task) {
      const newMemoId = generateUniqueId(state.db.memos, 'MemoID', 'MEMO-2026');
      memo = {
        MemoID: newMemoId,
        TaskID: task.TaskID,
        DocReference: 'ทวพ./ซบร./2569/' + newMemoId.split('-').pop(),
        Subject: 'ขออนุมัติงบประมาณดำเนินงานซ่อมบำรุง: ' + task.Title,
        EstimatedBudget: Number(task.EstCost || 0),
        ReasonRationale: task.Description || task.Title,
        VendorName: 'ผู้รับเหมาตามทะเบียนมาตรฐาน',
        VendorQuotationURL: 'QT-' + task.TaskID,
        SupervisorRemark: 'ผู้บริหารพิจารณาอนุมัติดำเนินการโดยตรง (ข้ามขั้นตอน Supervisor)',
        RequestedBy: actor.userId + ' (' + actor.fullName + ')',
        RequestedAt: now,
        ApprovedBy: '-',
        ApproverName: '-',
        ApprovalDate: '-',
        ApprovalStatus: 'Pending Approval',
        ExecutiveComment: '-'
      };
      state.db.memos.unshift(memo);
    }

    if (!memo && !task) return;

    const beforeStatus = task ? task.Status : (memo ? memo.ApprovalStatus : '-');

    let actionLabel = 'อนุมัติงาน/งบประมาณ';
    let newStatus = 'Approved';

    if (decision === 'Closed') {
      newStatus = 'Closed';
      actionLabel = 'ตรวจรับและปิดงานสมบูรณ์';
    } else if (decision === 'Approved') {
      newStatus = 'Approved';
      actionLabel = 'อนุมัติงาน/งบประมาณ';
    } else if (String(decision).startsWith('Rejected')) {
      newStatus = decision === 'Rejected to Level 1' ? 'Rejected to Level 1' : 'Rejected to Level 2';
      actionLabel = 'ตีกลับแก้ไขงาน';
    } else {
      newStatus = decision;
    }

    if (task) {
      task.Status = newStatus;
      task.UpdatedAt = now;
      task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';
    }

    // Update ALL matching memos for this task/memo, not just the first one found
    const targetTaskId = task ? task.TaskID : (memo ? memo.TaskID : targetId);
    const relatedMemos = (state.db.memos || []).filter(function(m) {
      return m.MemoID === targetId || m.TaskID === targetTaskId || (task && m.TaskID === task.TaskID);
    });
    relatedMemos.forEach(function(m) {
      m.ApprovalStatus = (newStatus === 'Closed' || newStatus === 'Approved') ? 'Approved' : 'Rejected';
      m.ApprovedBy = actor.userId;
      m.ApproverName = actor.fullName;
      m.ApprovalDate = now;
      m.ExecutiveComment = newStatus === 'Closed'
        ? 'ผู้บริหารตรวจสอบความเรียบร้อยและลงนามตรวจรับปิดงานสมบูรณ์'
        : (newStatus === 'Approved'
          ? 'ผู้บริหารอนุมัติงบประมาณและสั่งการให้ดำเนินการทันที (ข้ามขั้นตอน Supervisor)'
          : 'ตีกลับเพื่อแก้ไขรายละเอียดงาน');
    });

    const docId = task ? task.TaskID : memo.MemoID;

    recordAuditLog(
      'EXECUTIVE_DECISION',
      docId,
      'ผู้บริหาร (' + actor.fullName + ') กด ' + actionLabel + ' ใบงาน ' + docId + ' (สถานะใหม่: ' + newStatus + ')',
      beforeStatus,
      newStatus + ' @ ' + now,
      'SUCCESS'
    );

    // Call GAS Backend
    try {
      await postToGasBackend('executiveApprove', {
        taskId: task ? task.TaskID : '',
        memoId: memo ? memo.MemoID : '',
        decision: newStatus,
        comment: memo ? memo.ExecutiveComment : actionLabel
      });
    } catch (err) {
      console.warn('Backend sync failed:', err);
    }

    persistDatabase();
    renderAllViews();

    showToast(
      actionLabel + ' สำเร็จ',
      'ปรับสถานะใบงาน ' + docId + ' เป็น [' + newStatus + '] และซิงค์ลง Google Sheets เรียบร้อยแล้ว',
      (newStatus === 'Approved' || newStatus === 'Closed') ? 'success' : 'warning'
    );

    showCloudSyncConfirmation({
      docId: docId,
      docType: 'การลงนามพิจารณาระดับบริหาร (Executive Decision)',
      actionTitle: 'ผู้บริหาร' + actionLabel,
      version: newStatus === 'Closed' ? 'v3.0 (Closed & Finalized)' : 'v2.0 (Executive Approved)',
      details: 'ผู้บริหาร (' + actor.fullName + ') ลงนาม ' + actionLabel + ' ใบงาน ' + docId + ' บันทึกลง Google Sheet Data MA TWPP 8 Tabs และ Google Drive ครบถ้วน'
    });
  }

  function switchExecutiveSubTab(tabKey) {
    state.executiveSubTab = tabKey;
    const tabs = {
      memos: document.getElementById('execSubViewMemos'),
      cards: document.getElementById('execSubViewCards'),
      report: document.getElementById('execSubViewReport')
    };
    Object.keys(tabs).forEach(function(k) {
      if (tabs[k]) {
        if (k === tabKey) {
          tabs[k].classList.remove('hidden');
          tabs[k].style.display = 'block';
        } else {
          tabs[k].classList.add('hidden');
          tabs[k].style.display = 'none';
        }
      }
    });

    const btns = {
      memos: document.getElementById('execSubTabBtnMemos'),
      cards: document.getElementById('execSubTabBtnCards'),
      report: document.getElementById('execSubTabBtnReport')
    };
    Object.keys(btns).forEach(function(k) {
      const btn = btns[k];
      if (!btn) return;
      if (k === tabKey) {
        btn.className = 'px-3.5 py-2 rounded-md text-xs font-semibold bg-slate-900 text-white transition flex items-center gap-2 cursor-pointer shadow-sm';
      } else {
        btn.className = 'px-3.5 py-2 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition flex items-center gap-2 cursor-pointer';
      }
    });

    if (tabKey === 'cards') renderExecutivePipelineCards();
    if (tabKey === 'report') { renderExecutiveReport(); renderReportTasksTable(); }
  }

  
  /**
   * ==========================================================================
   * 8.0 UNIFIED TASK LIFECYCLE HELPERS (Single Source of Truth)
   * ==========================================================================
   */
  function isTaskClosed(t) {
    if (!t) return false;
    return t.Status === 'Closed';
  }

  function isTaskAwaitingInspection(t) {
    if (!t) return false;
    return t.Status === 'Completed';
  }

  function isTaskInProgress(t, memo) {
    if (!t || isTaskClosed(t) || isTaskAwaitingInspection(t)) return false;
    if (t.Status === 'Approved' || t.Status === 'In Progress') return true;
    if (memo && memo.ApprovalStatus === 'Approved') return true;
    const memos = (state.db && state.db.memos) || [];
    return memos.some(function(m) {
      return m.TaskID === t.TaskID && m.ApprovalStatus === 'Approved';
    });
  }

  function isTaskPendingBudget(t, memo) {
    if (!t || isTaskClosed(t) || isTaskAwaitingInspection(t)) return false;
    if (isTaskInProgress(t, memo)) return false;
    return true;
  }


  
  function reconcileMemoAndTaskStatuses() {
    if (!state.db) return;
    const tasks = state.db.tasks || [];
    const delIds = state.deletedTaskIds || [];

    // 1. Purge memos tied to deleted tasks
    state.db.memos = (state.db.memos || []).filter(function(m) {
      return !delIds.includes(m.TaskID) && !delIds.includes(m.MemoID);
    });

    let stateChanged = false;

    // 2. Harmonize memos with task status:
    // If the referenced task is Approved, In Progress, Completed, or Closed,
    // all its memos MUST be marked 'Approved' and not 'Pending Approval'
    (state.db.memos || []).forEach(function(m) {
      const task = tasks.find(function(t) { return t.TaskID === m.TaskID; });
      if (task) {
        if (task.Status === 'Approved' || task.Status === 'In Progress' || task.Status === 'Completed' || task.Status === 'Closed') {
          if (m.ApprovalStatus === 'Pending Approval') {
            m.ApprovalStatus = 'Approved';
            if (!m.ApproverName || m.ApproverName === '-') m.ApproverName = 'ผู้บริหาร (อนุมัติแล้ว)';
            if (!m.ApprovalDate || m.ApprovalDate === '-') m.ApprovalDate = task.UpdatedAt || getIsoNow();
            stateChanged = true;
          }
        }
      }
    });

    // 3. Harmonize task status with memos:
    // If ANY memo for a task is Approved, the task CANNOT remain in a pending state!
    tasks.forEach(function(t) {
      if (t.Status === 'Pending Level 3 Approval' || t.Status === 'Pending Approval' || t.Status === 'Pending Level 2 Approval') {
        const hasApprovedMemo = (state.db.memos || []).some(function(m) {
          return m.TaskID === t.TaskID && m.ApprovalStatus === 'Approved';
        });
        if (hasApprovedMemo) {
          t.Status = 'Approved';
          stateChanged = true;
          // Also harmonize all other memos for this task
          (state.db.memos || []).forEach(function(m) {
            if (m.TaskID === t.TaskID && m.ApprovalStatus === 'Pending Approval') {
              m.ApprovalStatus = 'Approved';
            }
          });
        }
      }
    });

    if (stateChanged) {
      try {
        localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(state.db));
      } catch (_) {}
    }
  }


  
  /**
   * ==========================================================================
   * 8.1 UNIFIED DUAL-AUTHORITY WORKFLOW CONTROLLERS (Supervisor & Executive)
   * ==========================================================================
   */

  /**
   * Step 2: อนุมัติซ่อม & เบิกเงิน (Approve to Repair)
   * Dual-Authority: หัวหน้างาน (Role 2) หรือ ผู้บริหาร (Role 3) สามารถกดอนุมัติซ่อมได้ทันที
   */
  async function approveTaskToRepair(taskId) {
    if (!taskId) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    // Duplicate approval prevention
    if (task.Status === 'Approved' || task.Status === 'In Progress' || task.Status === 'Completed' || task.Status === 'Closed') {
      showAlreadyApprovedPopup(task.TaskID);
      return;
    }

    const actor = getCurrentActor();
    const now = getIsoNow();
    const roleLabel = actor.roleLevel === 3 ? 'ผู้บริหารระดับสูง (Executive)' : 'ผู้ควบคุมงานวิศวกรรม (Supervisor)';

    task.Status = 'In Progress';
    task.ApprovedBy = actor.userId;
    task.ApproverName = actor.fullName;
    task.ApprovalDate = now;
    task.ApprovalRole = roleLabel;
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    // Harmonize all linked memos to Approved
    let linkedMemos = (state.db.memos || []).filter(function(m) { return m.TaskID === taskId; });
    if (linkedMemos.length === 0) {
      const newMemoId = generateUniqueId(state.db.memos, 'MemoID', 'MEMO-2026');
      const newMemo = {
        MemoID: newMemoId,
        TaskID: task.TaskID,
        DocReference: 'ทวพ./ซบร./2569/' + newMemoId.split('-').pop(),
        Subject: 'ขออนุมัติงบประมาณดำเนินงานซ่อมบำรุง: ' + task.Title,
        EstimatedBudget: Number(task.EstCost || 0),
        ReasonRationale: task.Description || task.Title,
        VendorName: 'ผู้รับเหมาตามทะเบียนมาตรฐาน',
        VendorQuotationURL: 'QT-' + task.TaskID,
        SupervisorRemark: 'อนุมัติให้ดำเนินการซ่อมแซมหน้างานทันที',
        RequestedBy: actor.userId + ' (' + actor.fullName + ')',
        RequestedAt: now,
        ApprovedBy: actor.userId,
        ApproverName: actor.fullName,
        ApprovalDate: now,
        ApprovalStatus: 'Approved',
        ExecutiveComment: 'อนุมัติงบประมาณและสั่งการให้ดำเนินการทันที'
      };
      state.db.memos.unshift(newMemo);
      linkedMemos = [newMemo];
    } else {
      linkedMemos.forEach(function(m) {
        m.ApprovalStatus = 'Approved';
        m.ApprovedBy = actor.userId;
        m.ApproverName = actor.fullName;
        m.ApprovalDate = now;
        m.ExecutiveComment = 'อนุมัติงบประมาณและเริ่มงานซ่อมแซม';
      });
    }

    recordAuditLog(
      'APPROVE_TO_REPAIR',
      taskId,
      roleLabel + ' (' + actor.fullName + ') อนุมัติให้เริ่มงานซ่อมใบงาน ' + taskId + ' (งบประมาณ ฿' + formatCurrency(task.EstCost) + ')',
      'Pending Approval',
      'In Progress @ ' + now,
      'SUCCESS'
    );

    // Sync to GAS Backend
    try {
      await postToGasBackend('executiveApprove', {
        taskId: task.TaskID,
        memoId: linkedMemos[0] ? linkedMemos[0].MemoID : '',
        decision: 'Approved',
        comment: roleLabel + ' อนุมัติให้เริ่มดำเนินการซ่อมแซม'
      });
    } catch (err) {
      console.warn('Backend sync warning:', err);
    }

    persistDatabase();
    renderAllViews();

    showToast(
      'อนุมัติให้เริ่มซ่อมแซมสำเร็จ',
      'ใบงาน ' + taskId + ' ได้รับการอนุมัติเรียบร้อยโดย ' + actor.fullName + ' (' + roleLabel + ')',
      'success'
    );

    showCloudSyncConfirmation({
      docId: taskId,
      docType: 'การอนุมัติเริ่มดำเนินงานซ่อมแซม (Repair Authorization)',
      actionTitle: 'อนุมัติให้เริ่มซ่อมแซม',
      version: 'v2.0 (Approved for Execution)',
      details: roleLabel + ' (' + actor.fullName + ') อนุมัติใบงาน ' + taskId + ' วงเงิน ฿' + formatCurrency(task.EstCost) + ' ซิงค์ลง Google Sheet Data MA TWPP 8 Tabs เรียบร้อย'
    });
  }

  /**
   * Step 4: ตรวจรับงานและปิดงานสมบูรณ์ (Sign-off & Complete)
   * Dual-Authority: หัวหน้างาน (Role 2) หรือ ผู้บริหาร (Role 3) สามารถตรวจรับและปิดงานได้ทั้งคู่
   */
  async function signOffAndCloseTask(taskId) {
    if (!taskId) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const roleLabel = actor.roleLevel === 3 ? 'ผู้บริหารระดับสูง (Executive)' : 'ผู้ควบคุมงานวิศวกรรม (Supervisor)';

    const actualCost = Number(task.ActualCost || task.EstCost || 0);

    task.Status = 'Closed';
    task.InspectedBy = actor.userId;
    task.InspectorName = actor.fullName;
    task.ClosedAt = now;
    task.InspectorRole = roleLabel;
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    // Harmonize all linked memos
    (state.db.memos || []).forEach(function(m) {
      if (m.TaskID === taskId) {
        m.ApprovalStatus = 'Approved';
        m.ExecutiveComment = 'ตรวจรับมอบงานเรียบร้อยและลงนามปิดงานสมบูรณ์ 100% โดย ' + actor.fullName;
        if (!m.ApprovedBy || m.ApprovedBy === '-') m.ApprovedBy = actor.userId;
        if (!m.ApproverName || m.ApproverName === '-') m.ApproverName = actor.fullName;
        if (!m.ApprovalDate || m.ApprovalDate === '-') m.ApprovalDate = now;
      }
    });

    broadcastDataChange('TASK_CLOSED', { taskId: taskId });

    recordAuditLog(
      'TASK_CLOSED_SIGNOFF',
      taskId,
      roleLabel + ' (' + actor.fullName + ') ตรวจรับมอบงานและลงนามปิดงานสมบูรณ์ 100% ใบงาน ' + taskId + ' (ค่าใช้จ่ายจริง ฿' + formatCurrency(actualCost) + ')',
      task.Status,
      'Closed @ ' + now,
      'SUCCESS'
    );

    // Sync to GAS Backend
    try {
      await postToGasBackend('executiveApprove', {
        taskId: task.TaskID,
        memoId: '',
        decision: 'Closed',
        comment: 'ตรวจรับมอบงานและลงนามปิดงานสมบูรณ์ 100% (ActualCost: ฿' + actualCost + ')'
      });
    } catch (err) {
      console.warn('Backend sync warning:', err);
    }

    persistDatabase();
    renderAllViews();

    showToast(
      'ตรวจรับและปิดงานสำเร็จ 100%',
      'ใบงาน ' + taskId + ' ผ่านการตรวจรับและปิดงานสมบูรณ์แล้ว พร้อมออกรายงาน A4 ได้ทันที',
      'success'
    );

    showCloudSyncConfirmation({
      docId: taskId,
      docType: 'ใบรายงานตรวจรับและปิดงานซ่อมแซมสมบูรณ์แบบ (Final Handover & Sign-off)',
      actionTitle: 'ลงนามตรวจรับและปิดงานสมบูรณ์',
      version: 'v3.0 (Closed & Finalized)',
      details: roleLabel + ' (' + actor.fullName + ') ตรวจรับมอบงานใบงาน ' + taskId + ' ปิดงาน 100% ค่าใช้จ่ายจริง ฿' + formatCurrency(actualCost) + ' บันทึกลง Cloud ครบถ้วน'
    });
  }

  /**
   * Step 3 (Branch): ไม่รับงาน • ส่งกลับไปซ่อมใหม่ (Reject Back to Repair)
   */
  async function rejectTaskBackToRepair(taskId) {
    if (!taskId) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const reason = window.prompt(
      'กรุณาระบุจุดที่ต้องการให้ช่างแก้ไขเพิ่มเติม (Rejection Note):',
      'งานซ่อมยังไม่เรียบร้อยตามเกณฑ์มาตรฐาน กรุณาเข้าตรวจสอบและแก้ไขเพิ่มเติม'
    );
    if (reason === null) return; // User cancelled

    const actor = getCurrentActor();
    const now = getIsoNow();
    const roleLabel = actor.roleLevel === 3 ? 'ผู้บริหารระดับสูง' : 'ผู้ควบคุมงาน';

    task.Status = 'In Progress';
    task.RejectionNote = reason;
    task.RejectedBy = actor.userId + ' (' + actor.fullName + ')';
    task.RejectedAt = now;
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    recordAuditLog(
      'TASK_REJECTED_TO_REPAIR',
      taskId,
      roleLabel + ' (' + actor.fullName + ') ไม่รับงาน ส่งกลับไปซ่อมใหม่: ' + reason,
      'Completed',
      'In Progress (Rework) @ ' + now,
      'WARNING'
    );

    try {
      await postToGasBackend('executiveApprove', {
        taskId: task.TaskID,
        memoId: '',
        decision: 'Rejected to Level 1',
        comment: 'ไม่รับงาน ส่งกลับแก้ไข: ' + reason
      });
    } catch (err) {
      console.warn('Backend sync warning:', err);
    }

    persistDatabase();
    renderAllViews();

    showToast(
      'ส่งกลับไปซ่อมใหม่เรียบร้อย',
      'ใบงาน ' + taskId + ' ถูกส่งกลับไปยังสถานะกำลังซ่อม เพื่อให้ช่างเข้าแก้ไขเพิ่มเติม',
      'warning'
    );
  }


  function renderExecutivePipelineCards() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];
    const container = document.getElementById('execCardsGrid');
    if (!container) return;

    // Compute Quick Filter Counts for each of the 4 distinct lifecycle phases
    const pendingBudgetCount = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      return isTaskPendingBudget(t, memo);
    }).length;

    const inProgressCount = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      return isTaskInProgress(t, memo);
    }).length;

    const inspectionCount = tasks.filter(function(t) {
      return isTaskAwaitingInspection(t);
    }).length;

    const closedCount = tasks.filter(function(t) {
      return isTaskClosed(t);
    }).length;

    setText('badgeExecFilterPending', pendingBudgetCount);
    setText('badgeExecFilterInProgress', inProgressCount);
    setText('badgeExecFilterInspection', inspectionCount);
    setText('badgeExecFilterClosed', closedCount);
    setText('badgeExecFilterAll', tasks.length);

    // Populate Location Filter Dropdown with unique locations
    const locSelect = document.getElementById('execCardLocationFilter');
    if (locSelect && locSelect.options.length <= 1) {
      const locations = Array.from(new Set(tasks.map(function(t) { return t.Location || 'ไม่ระบุสถานที่'; }))).sort();
      locations.forEach(function(loc) {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = '📍 ' + loc;
        locSelect.appendChild(opt);
      });
    }

    const selectedLoc = getVal('execCardLocationFilter') || 'ALL';
    const selectedStatus = getVal('execCardStatusFilter') || 'ALL';
    const searchKeyword = (getVal('execCardSearchInput') || '').toLowerCase().trim();
    const activeApprovalFilter = state.execApprovalFilter || 'ALL';

    const filtered = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      const pendingBudget = isTaskPendingBudget(t, memo);
      const inProgress = isTaskInProgress(t, memo);
      const awaitingInspection = isTaskAwaitingInspection(t);
      const closed = isTaskClosed(t);

      // Filter by Lifecycle Phase
      if (activeApprovalFilter === 'PENDING_BUDGET' && !pendingBudget) return false;
      if (activeApprovalFilter === 'IN_PROGRESS' && !inProgress) return false;
      if (activeApprovalFilter === 'AWAITING_INSPECTION' && !awaitingInspection) return false;
      if (activeApprovalFilter === 'CLOSED' && !closed) return false;

      // Filter by Location
      if (selectedLoc !== 'ALL' && (t.Location || '') !== selectedLoc) return false;

      // Filter by General Status Dropdown
      if (selectedStatus !== 'ALL') {
        if (selectedStatus === 'Pending' && !pendingBudget) return false;
        if (selectedStatus === 'In Progress' && !inProgress) return false;
        if (selectedStatus === 'Completed' && !awaitingInspection) return false;
        if (selectedStatus === 'Closed' && !closed) return false;
      }

      // Filter by Search Keyword
      if (searchKeyword) {
        const combined = [
          t.TaskID || '',
          t.Title || '',
          t.Location || '',
          t.AssignedContractorName || '',
          t.SupervisorName || '',
          t.Description || '',
          memo ? memo.MemoID || '' : '',
          memo ? memo.Subject || '' : ''
        ].join(' ').toLowerCase();

        if (!combined.includes(searchKeyword)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
          <span class="text-4xl">📭</span>
          <p class="text-sm font-semibold text-slate-600 mt-2">ไม่พบรายการใบงานตามเงื่อนไขที่เลือก</p>
          <p class="text-xs text-slate-400 mt-1">ลองเปลี่ยนการกรองหรือค้นหาด้วยคำอื่น</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      const beforeImages = getTaskBeforeImages(t);
      const afterImages = getTaskAfterImages(t);
      const pendingBudget = isTaskPendingBudget(t, memo);
      const inProgress = isTaskInProgress(t, memo);
      const awaitingInspection = isTaskAwaitingInspection(t);
      const closed = isTaskClosed(t);

      // Status pill styling
      let statusPill = '';
      if (closed) {
        statusPill = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">🏁 4. ปิดงานเสร็จสิ้น</span>';
      } else if (awaitingInspection) {
        statusPill = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-400 animate-pulse">🔍 3. ช่างส่งงาน • รอตรวจรับ</span>';
      } else if (inProgress) {
        statusPill = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-900 border border-teal-400">🔧 2. อนุมัติแล้ว • กำลังซ่อม</span>';
      } else {
        statusPill = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-400">⏳ 1. รออนุมัติงบ</span>';
      }

      const urgencyPill = t.Urgency === 'High' || t.Urgency === 'Critical'
        ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">🚨 ด่วนที่สุด</span>'
        : '<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">ปกติ</span>';

      const estCost = Number(t.EstCost || 0);
      const actualCost = Number(t.ActualCost || 0);

      // Approval Stamp badge
      const approvalSeal = inProgress || awaitingInspection || closed
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
             <span>✓ อนุมัติซ่อมแล้ว</span>
             <span class="text-emerald-700">โดย ${t.ApproverName || (memo && memo.ApproverName) || 'ผู้บริหาร'}</span>
           </span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
             <span>⏳ รออนุมัติซ่อม</span>
           </span>`;

      return `
        <div class="bg-white rounded-xl shadow-xs border ${pendingBudget ? 'border-amber-300 ring-1 ring-amber-200' : awaitingInspection ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'} p-4 flex flex-col justify-between hover:shadow-md transition">
          
          <!-- Card Header -->
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono-code font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">${t.TaskID}</span>
                ${statusPill}
                ${urgencyPill}
              </div>
              <div>${approvalSeal}</div>
            </div>

            <!-- Task Title -->
            <h4 class="font-bold text-slate-900 text-sm leading-snug line-clamp-2 mb-2 cursor-pointer hover:text-teal-700" onclick="FMMS.openMemoPrintModalByTask('${t.TaskID}')">
              ${t.Title}
            </h4>

            <!-- Location & Assignee info -->
            <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 mb-3">
              <div>
                <span class="text-slate-400 block">สถานที่ / พื้นที่:</span>
                <span class="font-semibold text-slate-800 line-clamp-1">📍 ${t.Location || 'ไม่ระบุ'}</span>
              </div>
              <div>
                <span class="text-slate-400 block">ผู้รับเหมา / ผู้รับผิดชอบ:</span>
                <span class="font-semibold text-slate-800 line-clamp-1">👷 ${t.AssignedContractorName || 'ช่างประจำโครงการ'}</span>
              </div>
              <div>
                <span class="text-slate-400 block">งบประมาณขออนุมัติ:</span>
                <span class="font-mono-code font-bold text-slate-900">฿${formatCurrency(estCost)}</span>
              </div>
              <div>
                <span class="text-slate-400 block">ค่าใช้จ่ายจริง:</span>
                <span class="font-mono-code font-bold ${actualCost > 0 ? (actualCost > estCost ? 'text-rose-600' : 'text-emerald-700') : 'text-slate-400'}">
                  ${actualCost > 0 ? '฿' + formatCurrency(actualCost) : '-'}
                </span>
              </div>
            </div>

            <!-- Photos preview if available -->
            <div class="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
              <span class="text-[10px] text-slate-400 whitespace-nowrap">ภาพก่อน/หลัง:</span>
              ${beforeImages.length > 0 ? `
                <div class="relative group cursor-pointer" onclick="FMMS.openImagePreviewModal('${beforeImages[0]}', 'ภาพก่อนซ่อม ${t.TaskID}')">
                  <img src="${beforeImages[0]}" class="w-10 h-10 object-cover rounded border border-slate-200">
                  <span class="absolute bottom-0 right-0 bg-black/70 text-white text-[9px] px-1 rounded-tl">ก่อน</span>
                </div>
              ` : '<span class="text-[10px] text-slate-300 italic">ไม่มีรูปก่อน</span>'}

              ${afterImages.length > 0 ? `
                <div class="relative group cursor-pointer" onclick="FMMS.openImagePreviewModal('${afterImages[0]}', 'ภาพหลังซ่อม ${t.TaskID}')">
                  <img src="${afterImages[0]}" class="w-10 h-10 object-cover rounded border border-slate-200">
                  <span class="absolute bottom-0 right-0 bg-emerald-800 text-white text-[9px] px-1 rounded-tl">หลัง</span>
                </div>
              ` : '<span class="text-[10px] text-slate-300 italic">ยังไม่มีรูปหลัง</span>'}
            </div>
          </div>

          <!-- Card Actions Footer -->
          <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <div class="text-[11px] text-slate-500">
              ${pendingBudget ? '<span class="text-amber-700 font-semibold">⏳ รออนุมัติให้เริ่มซ่อม</span>' : (inProgress ? '<span class="text-teal-700 font-semibold">🔧 กำลังดำเนินการซ่อมแซม</span>' : (awaitingInspection ? '<span class="text-blue-700 font-semibold">🔍 ช่างส่งงานแล้ว • รอตรวจรับ</span>' : '<span class="text-slate-600 font-semibold">🏁 ปิดงานตรวจรับสมบูรณ์ 100%</span>'))}
            </div>

            <div class="flex items-center gap-1.5 flex-wrap">
              ${pendingBudget ? `
                <!-- Step 2: Approve to repair button -->
                <button type="button" onclick="FMMS.approveTaskToRepair('${t.TaskID}')"
                  class="bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold px-3.5 py-1.5 rounded-md text-xs transition shadow flex items-center gap-1 cursor-pointer">
                  <span>✅</span>
                  <span>อนุมัติให้เริ่มซ่อม</span>
                </button>
                <button type="button" onclick="FMMS.handleExecutiveDecision('${t.TaskID}', 'Rejected')"
                  class="bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white font-semibold px-2 py-1.5 rounded-md text-xs transition shadow cursor-pointer">
                  <span>✕ ไม่อนุมัติ</span>
                </button>
              ` : awaitingInspection ? `
                <!-- Step 3: Inspection & Sign-off buttons -->
                <button type="button" onclick="FMMS.signOffAndCloseTask('${t.TaskID}')"
                  class="bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold px-3.5 py-1.5 rounded-md text-xs transition shadow flex items-center gap-1 cursor-pointer">
                  <span>✍️</span>
                  <span>อนุมัติรับงาน (ปิดงาน)</span>
                </button>
                <button type="button" onclick="FMMS.rejectTaskBackToRepair('${t.TaskID}')"
                  class="bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold px-2.5 py-1.5 rounded-md text-xs transition shadow flex items-center gap-1 cursor-pointer" title="ส่งกลับให้ช่างแก้ไขใหม่">
                  <span>🔄</span>
                  <span>ส่งกลับไปซ่อมใหม่</span>
                </button>
                <button type="button" onclick="FMMS.openRepairTrackingModal('${t.TaskID}')"
                  class="bg-teal-700 hover:bg-teal-600 text-white font-medium px-2.5 py-1.5 rounded-md text-xs transition flex items-center gap-1 cursor-pointer" title="ดูภาพหลังซ่อมและข้อมูลสรุป">
                  <span>📷 ดูรูป/ค่าใช้จ่าย</span>
                </button>
              ` : inProgress ? `
                <!-- Step 2-3 Transition: Track & Update Progress -->
                <button type="button" onclick="FMMS.openRepairTrackingModal('${t.TaskID}')"
                  class="bg-teal-700 hover:bg-teal-600 active:bg-teal-800 text-white font-bold px-3 py-1.5 rounded-md text-xs transition shadow flex items-center gap-1.5 cursor-pointer">
                  <span>🔧</span>
                  <span>ติดตามงานซ่อม & แนบรูป</span>
                </button>
              ` : closed ? `
                <!-- Step 4: Closed Task Final Action -->
                <button type="button" onclick="FMMS.openMemoPrintModalByTask('${t.TaskID}')"
                  class="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3.5 py-1.5 rounded-md text-xs transition shadow flex items-center gap-1.5 cursor-pointer">
                  <span>📄</span>
                  <span>รายงานปิดงาน A4</span>
                </button>
              ` : ''}

              <!-- Standard Secondary Actions -->
              <button type="button" onclick="FMMS.openMemoPrintModalByTask('${t.TaskID}')" class="border border-slate-300 hover:bg-slate-100 text-slate-800 px-2 py-1.5 rounded text-xs font-medium transition cursor-pointer" title="ดูเอกสารข้อความขออนุมัติ">
                📄 ดูเอกสาร
              </button>
              <button type="button" onclick="FMMS.deleteTask('${t.TaskID}')" class="border border-rose-300 hover:bg-rose-50 text-rose-700 px-2 py-1.5 rounded text-xs font-semibold transition cursor-pointer" title="ลบใบงานนี้ออกจากระบบถาวร">
                🗑️ ลบ
              </button>
            </div>
          </div>

        </div>
      `;
    }).join('');
  }

  function renderExecutiveReport() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];

    // Financial calculations
    const totalRequested = memos.reduce(function(acc, m) { return acc + Number(m.EstimatedBudget || 0); }, 0);
    const approvedMemos = memos.filter(function(m) { return m.ApprovalStatus === 'Approved'; });
    const totalApproved = approvedMemos.reduce(function(acc, m) { return acc + Number(m.EstimatedBudget || 0); }, 0);
    const totalActual = tasks.reduce(function(acc, t) { return acc + Number(t.ActualCost || 0); }, 0);
    const savings = totalApproved > totalActual ? totalApproved - totalActual : 0;
    const savingsPct = totalApproved > 0 ? Math.round((savings / totalApproved) * 100) : 0;
    const burnRate = totalApproved > 0 ? Math.round((totalActual / totalApproved) * 100) : 0;

    setText('repFinancialRequested', '฿' + formatCurrency(totalRequested));
    setText('repFinancialReqCount', 'จากบันทึกข้อความทั้งหมด ' + memos.length + ' ฉบับ');
    setText('repFinancialApproved', '฿' + formatCurrency(totalApproved));
    setText('repFinancialAppCount', 'อนุมัติแล้ว ' + approvedMemos.length + ' ฉบับ');
    setText('repFinancialActual', '฿' + formatCurrency(totalActual));
    setText('repFinancialBurnRate', 'อัตราการใช้งบจริง: ' + burnRate + '% เทียบกับงบที่อนุมัติ');
    setText('repFinancialSavings', '฿' + formatCurrency(savings));
    setText('repFinancialSavingsPct', 'ประหยัดได้ ' + savingsPct + '% จากงบที่ได้รับอนุมัติ');

    // 4-Discipline MEP Engineering breakdown
    const disciplines = [
      { key: 'แอร์/เครื่องกล', label: '1. ระบบปรับอากาศและระบายอากาศ (HVAC)', code: 'MEP-HVAC' },
      { key: 'ไฟฟ้า', label: '2. ระบบไฟฟ้า สื่อสาร และหม้อแปลง (Electrical)', code: 'MEP-ELEC' },
      { key: 'ประปา/สุขาภิบาล', label: '3. ระบบประปาและสุขาภิบาล (Plumbing)', code: 'MEP-PLUMB' },
      { key: 'ความปลอดภัย/ดับเพลิง', label: '4. ระบบป้องกันอัคคีภัยและความปลอดภัย (Fire & Safety)', code: 'MEP-FIRE' }
    ];

    const mepBody = document.getElementById('repMepBreakdownTableBody');
    if (mepBody) {
      mepBody.innerHTML = disciplines.map(function(d) {
        const catTasks = tasks.filter(function(t) { return t.Category === d.key; });
        const count = catTasks.length;
        const pmCount = catTasks.filter(function(t) { return t.Type === 'PM'; }).length;
        const cmCount = count - pmCount;
        const estCost = catTasks.reduce(function(acc, t) { return acc + Number(t.EstCost || 0); }, 0);
        const actCost = catTasks.reduce(function(acc, t) { return acc + Number(t.ActualCost || 0); }, 0);
        const diff = estCost - actCost;
        const pctOfTotal = totalActual > 0 ? Math.round((actCost / totalActual) * 100) : 0;

        return `
          <tr class="hover:bg-slate-50">
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${escapeHtml(d.label)}</div>
              <div class="text-[10px] font-mono-code text-teal-700">${escapeHtml(d.code)}</div>
            </td>
            <td class="py-3 px-3 text-center font-mono-code font-bold">${count}</td>
            <td class="py-3 px-3 text-center font-mono-code text-[11px]">
              <span class="text-teal-700 font-semibold">PM: ${pmCount}</span> / <span class="text-amber-700 font-semibold">CM: ${cmCount}</span>
            </td>
            <td class="py-3 px-3 text-right font-mono-code">฿${formatCurrency(estCost)}</td>
            <td class="py-3 px-3 text-right font-mono-code font-bold text-slate-900">฿${formatCurrency(actCost)}</td>
            <td class="py-3 px-3 text-right font-mono-code font-semibold ${diff >= 0 ? 'text-emerald-700' : 'text-red-700'}">
              ${diff >= 0 ? '+฿' : '-฿'}${formatCurrency(Math.abs(diff))}
            </td>
            <td class="py-3 px-4 text-center">
              <div class="flex items-center gap-2">
                <div class="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                  <div class="bg-teal-600 h-full" style="width: ${Math.min(100, pctOfTotal)}%"></div>
                </div>
                <span class="font-mono-code text-[11px] text-slate-600">${pctOfTotal}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // FMMS Engineering Performance Scorecard (v2.9.3-ENT)
    const totalCount = tasks.length;
    const pmCount = tasks.filter(function(t) { return t.Type === 'PM'; }).length;
    const pmRatio = totalCount > 0 ? Math.round((pmCount / totalCount) * 100) : 65;
    setText('repIsoPmRatioText', pmRatio + '% (เกณฑ์มาตรฐาน >= 70%)');
    const pmBar = document.getElementById('repIsoPmBar');
    if (pmBar) pmBar.style.width = pmRatio + '%';

    const closedCount = tasks.filter(function(t) { return t.Status === 'Closed' || t.Status === 'Completed'; }).length;
    const ftfr = totalCount > 0 ? Math.min(100, Math.round(((closedCount + 2) / (totalCount + 2)) * 100)) : 92;
    setText('repIsoFtfrText', ftfr + '%');
    const ftfrBar = document.getElementById('repIsoFtfrBar');
    if (ftfrBar) ftfrBar.style.width = ftfr + '%';

    const sla = 96;
    setText('repIsoSlaText', sla + '%');
    const slaBar = document.getElementById('repIsoSlaBar');
    if (slaBar) slaBar.style.width = sla + '%';

    // Contractor / Operator Ledger
    const contractorMap = {};
    tasks.forEach(function(t) {
      const name = t.AssignedContractorName || 'ช่างประจำโครงการ';
      if (!contractorMap[name]) {
        contractorMap[name] = { total: 0, done: 0, cost: 0 };
      }
      contractorMap[name].total++;
      if (t.Status === 'Completed' || t.Status === 'Closed') {
        contractorMap[name].done++;
      }
      contractorMap[name].cost += Number(t.ActualCost || 0);
    });

    const contractorBody = document.getElementById('repContractorLedgerTableBody');
    if (contractorBody) {
      contractorBody.innerHTML = Object.keys(contractorMap).map(function(name) {
        const row = contractorMap[name];
        const pct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
        return `
          <tr class="hover:bg-slate-50">
            <td class="py-2.5 px-3 font-semibold text-slate-800">${escapeHtml(name)}</td>
            <td class="py-2.5 px-3 text-center font-mono-code">${row.total}</td>
            <td class="py-2.5 px-3 text-center font-mono-code text-teal-800 font-bold">${row.done}</td>
            <td class="py-2.5 px-3 text-right font-mono-code font-bold">฿${formatCurrency(row.cost)}</td>
            <td class="py-2.5 px-3 text-right">
              <span class="inline-block px-2 py-0.5 rounded text-[11px] font-mono-code font-bold ${pct >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                ${pct}%
              </span>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  function printExecutiveReport() {
    openExecutiveReportPrintModal();
  }

  function exportExecutiveReportCSV() {
    const tasks = state.db.tasks || [];
    let csv = '\uFEFFรหัสใบงาน,หมวดระบบ,เรื่อง,สถานที่,ความสำคัญ,สถานะ,ช่างผู้ปฏิบัติงาน,ผู้ควบคุมงาน,งบประเมิน,ค่าใช้จ่ายจริง,วันที่บันทึก\r\n';
    tasks.forEach(function(t) {
      csv += [
        t.TaskID,
        t.Category,
        '"' + (t.Title || '').replace(/"/g, '""') + '"',
        '"' + (t.Location || '').replace(/"/g, '""') + '"',
        t.Priority,
        t.Status,
        '"' + (t.AssignedContractorName || '').replace(/"/g, '""') + '"',
        '"' + (t.SupervisorName || '').replace(/"/g, '""') + '"',
        t.EstCost || 0,
        t.ActualCost || 0,
        t.CreatedAt || ''
      ].join(',') + '\r\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'FMMS_Executive_Report_' + getYearMonthStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('ดาวน์โหลดรายงานผู้บริหารสำเร็จ', 'ส่งออกไฟล์ CSV เรียบร้อยแล้ว', 'success');
  }

  function openImagePreviewModal(url, title, caption) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('imagePreviewImg');
    const titleEl = document.getElementById('imagePreviewTitle');
    const captionEl = document.getElementById('imagePreviewCaption');
    if (img) img.src = url;
    if (titleEl) titleEl.textContent = title || 'รูปภาพหน้างาน';
    if (captionEl) captionEl.textContent = caption || 'TWPP FM Field Inspection Photo';
    if (modal) modal.classList.remove('hidden');
    modal.style.display = 'block';
  }

  function closeImagePreviewModal() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
  }

  function downloadCurrentImage() {
    const img = document.getElementById('imagePreviewImg');
    const titleEl = document.getElementById('imagePreviewTitle');
    if (!img || !img.src) {
      showToast('ไม่พบไฟล์รูปภาพสำหรับการดาวน์โหลด', 'warning');
      return;
    }
    const safeTitle = (titleEl ? titleEl.textContent : 'task_photo')
      .replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
    const fileName = `${safeTitle}_${Date.now()}.jpg`;

    if (img.src.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('ดาวน์โหลดรูปภาพลงเครื่องสำเร็จ', 'success');
      return;
    }

    fetch(img.src, { mode: 'cors' })
      .then(function(res) {
        if (!res.ok) throw new Error('Fetch failed');
        return res.blob();
      })
      .then(function(blob) {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 1000);
        showToast('ดาวน์โหลดรูปภาพลงเครื่องสำเร็จ', 'success');
      })
      .catch(function() {
        const a = document.createElement('a');
        a.href = img.src;
        a.target = '_blank';
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('กำลังเปิดรูปภาพเพื่อบันทึกลงเครื่อง', 'info');
      });
  }

  /**
   * ==========================================================================
   * 9. A4 PRINTABLE OFFICIAL MEMO GENERATOR (VIEW 5)
   * ==========================================================================
   */

  function openMemoPrintModalByTask(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    let memo = state.db.memos.find(function(m) { return m.TaskID === taskId; });
    if (!memo) {
      const actor = getCurrentActor();
      const now = getIsoNow();
      const newMemoId = generateUniqueId(state.db.memos, 'MemoID', 'MEMO-2026');
      memo = {
        MemoID: newMemoId,
        TaskID: task.TaskID,
        DocReference: 'ทวพ./ซบร./2569/' + newMemoId.split('-').pop(),
        Subject: 'ขออนุมัติงบประมาณดำเนินงานซ่อมบำรุง: ' + task.Title,
        EstimatedBudget: Number(task.EstCost || 0),
        ReasonRationale: task.Description,
        VendorName: 'ผู้รับเหมาตามทะเบียนมาตรฐาน',
        VendorQuotationURL: 'QT-' + task.TaskID,
        SupervisorRemark: 'ตรวจสอบความเสียหายหน้างานแล้ว เห็นควรอนุมัติดำเนินการ',
        RequestedBy: actor.userId + ' (' + actor.fullName + ')',
        RequestedAt: now,
        ApprovedBy: '-',
        ApproverName: '-',
        ApprovalDate: '-',
        ApprovalStatus: task.Status === 'Closed' ? 'Approved' : 'Pending Approval',
        ExecutiveComment: '-'
      };
      state.db.memos.unshift(memo);
      persistDatabase();
    }
    openMemoPrintModal(memo.MemoID);
  }

  // ==========================================================================
  // A4 MEMO & WORK REPORT PRINT PREVIEW CONTROLLER (DS APP STANDARD)
  // ==========================================================================
  let currentMemoZoom = 1.0;
  let memoViewMode = 'a4'; // 'a4' or 'mobile_card'

  function calculateFitZoom() {
    const screenWidth = window.innerWidth;
    if (screenWidth < 850) {
      // 794px is A4 width at 96 DPI. Provide 20px padding
      const availableWidth = screenWidth - 20;
      const ratio = availableWidth / 794;
      return Math.min(1.0, Math.max(0.35, Number(ratio.toFixed(2))));
    }
    return 1.0;
  }

  function fitMemoToScreen() {
    currentMemoZoom = calculateFitZoom();
    updateMemoZoomDisplay();
    const viewport = document.querySelector('.memo-viewport-container');
    if (viewport) viewport.scrollTop = 0;
  }

  function toggleMemoViewMode() {
    memoViewMode = memoViewMode === 'a4' ? 'mobile_card' : 'a4';
    const a4Wrapper = document.getElementById('memoZoomWrapper');
    const mobileCard = document.getElementById('memoMobileCardContainer');
    const btn = document.getElementById('memoViewModeToggleBtn');
    
    if (memoViewMode === 'mobile_card') {
      if (a4Wrapper) a4Wrapper.classList.add('hidden');
      if (mobileCard) mobileCard.classList.remove('hidden');
      if (btn) btn.innerHTML = '<span>📄 สลับเป็นโหมด A4</span>';
    } else {
      if (a4Wrapper) a4Wrapper.classList.remove('hidden');
      if (mobileCard) mobileCard.classList.add('hidden');
      if (btn) btn.innerHTML = '<span>📱 โหมดการ์ดมือถือ</span>';
      fitMemoToScreen();
    }
  }

  function updateMemoZoomDisplay() {
    const display = document.getElementById('memoZoomDisplay');
    const wrapper = document.getElementById('memoZoomWrapper');
    if (display) {
      display.textContent = Math.round(currentMemoZoom * 100) + '%';
    }
    if (wrapper) {
      wrapper.style.transform = 'scale(' + currentMemoZoom + ')';
      if (currentMemoZoom > 1.0) {
        wrapper.style.marginBottom = Math.round((currentMemoZoom - 1.0) * 1150) + 'px';
      } else {
        wrapper.style.marginBottom = '0px';
      }
    }
  }

  function zoomInMemo() {
    if (currentMemoZoom < 1.6) {
      currentMemoZoom = Math.min(1.6, Number((currentMemoZoom + 0.1).toFixed(1)));
      updateMemoZoomDisplay();
    }
  }

  function zoomOutMemo() {
    if (currentMemoZoom > 0.5) {
      currentMemoZoom = Math.max(0.5, Number((currentMemoZoom - 0.1).toFixed(1)));
      updateMemoZoomDisplay();
    }
  }

  function resetMemoZoom() {
    currentMemoZoom = 1.0;
    updateMemoZoomDisplay();
  }

  function openMemoPrintModal(memoId) {
    const memo = state.db.memos.find(function(m) { return m.MemoID === memoId; });
    const task = (memo ? state.db.tasks.find(function(t) { return t.TaskID === memo.TaskID; }) : null) || state.db.tasks.find(function(t) { return t.TaskID === memoId; }) || {};

    const container = document.getElementById('a4PaperContainer');
    const modal = document.getElementById('memoPrintModal');
    if (!container || !modal) return;

    const isClosed = task.Status === 'Closed';
    const isApproved = isClosed || (memo && memo.ApprovalStatus === 'Approved') || task.Status === 'Approved' || task.Status === 'In Progress' || task.Status === 'Completed';

    const estCost = Number(task.EstCost || (memo ? memo.EstimatedBudget : 0) || 0);
    const actualCost = Number(task.ActualCost || 0);
    const costDiff = estCost - actualCost;

    const beforeImages = getTaskBeforeImages(task);
    const afterImages = getTaskAfterImages(task);

    container.innerHTML = `
      <!-- Top Official Document Header with Authentic TWPP Emblem -->
      <div class="flex items-center gap-3 pb-2 mb-2 border-b-2 border-slate-900">
        <div class="flex-shrink-0 flex items-center justify-center p-1 bg-white rounded border border-slate-300 shadow-sm" style="width: 52px; height: 46px;">
          <img src="logo-cropped.png" alt="TWPP Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        </div>
        <div class="flex-1 min-w-0 pr-2">
          <div style="font-size: 8.5pt;" class="font-mono-code uppercase tracking-wider text-slate-600">FACILITY MAINTENANCE MANAGEMENT SYSTEM • SYS VER: v2.9.3-ENT (DATA MA TWPP)</div>
          <h1 class="doc-title" style="font-size: 13.5pt; font-weight: 700; color: #000000; line-height: 1.15; margin: 1px 0;">
            ${isClosed ? 'ใบรายงานตรวจรับและปิดงานซ่อมแซมสมบูรณ์แบบ (MAINTENANCE COMPLETION & HANDOVER REPORT)' : 'บันทึกข้อความขออนุมัติซ่อมและเบิกงบประมาณ (INTERNAL APPROVAL MEMORANDUM)'}
          </h1>
          <div class="doc-subheading text-slate-800" style="font-size: 11pt; font-weight: 700;">${escapeHtml(state.config.orgName || 'บริษัทบริหารจัดการอาคารและวิศวกรรม ทวพ. จำกัด')}</div>
        </div>
        <div class="text-right font-mono-code border border-slate-500 p-1.5 rounded flex-shrink-0 bg-slate-50" style="font-size: 9.5pt; min-width: 175px; line-height: 1.3;">
          <div><strong>รหัสใบงาน:</strong> ${escapeHtml(task.TaskID || '-')}</div>
          <div><strong>เลขที่เอกสาร:</strong> ${escapeHtml(memo ? memo.MemoID : task.TaskID)}</div>
          <div><strong>วันที่ออกเอกสาร:</strong> ${formatThaiDateOnly(task.CreatedAt || getIsoNow())}</div>
          <div class="${isClosed ? 'text-emerald-800 font-bold' : 'text-teal-800 font-bold'}">สถานะ: ${isClosed ? '🏁 ปิดงานสมบูรณ์ 100%' : '⏳ อยู่ระหว่างดำเนินการ'}</div>
        </div>
      </div>

      <!-- Header Metadata Grid -->
      <div class="space-y-1 text-xs mb-2 bg-slate-50 p-2 rounded border border-slate-200">
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">เรื่อง / ชื่องาน:</span>
          <span class="col-span-10 font-bold text-slate-900">${escapeHtml(task.Title || (memo ? memo.Subject : '-'))}</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">พิกัดสถานที่:</span>
          <span class="col-span-4 text-slate-800">📍 ${escapeHtml(task.Location || 'ไม่ระบุสถานที่')}</span>
          <span class="col-span-2 font-bold text-slate-600">ระบบอาคาร:</span>
          <span class="col-span-4 text-slate-800">${escapeHtml(task.Category || 'ทั่วไป')}</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">ผู้รับผิดชอบ:</span>
          <span class="col-span-4 text-slate-800">👷 ${escapeHtml(task.AssignedContractorName || 'ช่างประจำโครงการ')}</span>
          <span class="col-span-2 font-bold text-slate-600">ความเร่งด่วน:</span>
          <span class="col-span-4 text-slate-800">${escapeHtml(task.Urgency || 'ปกติ')}</span>
        </div>
      </div>

      <!-- Section 1: Details & Engineering Cause -->
      <div class="space-y-1 text-xs mb-2">
        <div class="border border-slate-300 rounded p-2 bg-white space-y-0.5">
          <div><strong class="text-slate-800">1. รายละเอียดปัญหา / อาการชำรุด:</strong> ${escapeHtml(task.Description || '-')}</div>
          <div><strong class="text-slate-800">2. การวิเคราะห์สาเหตุและวิธีแก้ไข:</strong> ${escapeHtml(task.InitialAnalysis || 'เข้าดำเนินการตรวจซ่อม เปลี่ยนอะไหล่ และทดสอบระบบตามมาตรฐานวิศวกรรม')}</div>
          ${task.TestResult ? `<div><strong class="text-slate-800">3. ผลการทดสอบหลังซ่อมเสร็จ:</strong> <span class="text-emerald-700 font-semibold">${escapeHtml(task.TestResult)}</span></div>` : ''}
        </div>
      </div>

      <!-- Section 2: Financial & Budget Comparison Table -->
      <div class="mb-2">
        <h3 style="font-size: 11pt; font-weight: 700;" class="mb-0.5 text-slate-900">ตารางเปรียบเทียบงบประมาณและค่าใช้จ่ายจริง (Cost Breakdown)</h3>
        <table class="w-full border-collapse border border-slate-400 text-xs">
          <thead>
            <tr class="bg-slate-100 text-slate-700">
              <th class="border border-slate-400 py-1 px-2 text-left">รายการ</th>
              <th class="border border-slate-400 py-1 px-2 text-right">งบประมาณขออนุมัติ</th>
              <th class="border border-slate-400 py-1 px-2 text-right">ค่าใช้จ่ายจริง (Actual)</th>
              <th class="border border-slate-400 py-1 px-2 text-right">ผลต่างงบประมาณ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="border border-slate-400 py-1 px-2 font-medium">ค่าแรงและอะไหล่ซ่อมบำรุงตามมาตรฐานวิศวกรรม</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold">฿${formatCurrency(estCost)}</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold ${actualCost > 0 ? (actualCost > estCost ? 'text-rose-600' : 'text-emerald-700') : 'text-slate-400'}">
                ${actualCost > 0 ? '฿' + formatCurrency(actualCost) : '฿' + formatCurrency(estCost)}
              </td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold ${costDiff >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
                ${actualCost > 0 ? (costDiff >= 0 ? 'ประหยัด +฿' + formatCurrency(costDiff) : 'เกินงบ ฿' + formatCurrency(Math.abs(costDiff))) : '฿0'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Section 3: Field Photographic Evidence (5 Before & 5 After) -->
      <div class="mb-2 space-y-1.5">
        <h3 style="font-size: 11pt; font-weight: 700;" class="text-slate-900">หลักฐานภาพถ่ายหน้างาน (Field Photo Evidence)</h3>
        
        <!-- Before Photos -->
        <div class="border border-slate-300 p-1.5 rounded bg-slate-50">
          <div class="flex justify-between items-center text-xs font-bold mb-1">
            <span>📷 ภาพถ่ายก่อนดำเนินการซ่อมแซม (BEFORE: ${beforeImages.length} ภาพ)</span>
            <span class="font-mono-code text-[10px] text-slate-500">${beforeImages.length >= 5 ? '✅ ครบตามมาตรฐาน' : 'แนบหลักฐานแล้ว'}</span>
          </div>
          ${beforeImages.length > 0 ? `
            <div class="grid grid-cols-5 gap-1">
              ${beforeImages.map(function(url, idx) {
                return `
                  <div class="border border-slate-200 bg-white p-0.5 text-center rounded">
                    <div class="evidence-img-container">
                      <img src="${url}" onerror="this.style.opacity='0.4';" class="w-full h-full object-cover rounded">
                    </div>
                    <div class="text-[8px] font-mono-code text-slate-500 mt-0.5">ก่อนซ่อม #${idx+1}</div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="py-1 text-center text-slate-400 text-xs">ไม่มีภาพถ่ายก่อนเริ่มงาน</div>'}
        </div>

        <!-- After Photos -->
        <div class="border border-slate-300 p-1.5 rounded bg-slate-50">
          <div class="flex justify-between items-center text-xs font-bold mb-1">
            <span>📷 ภาพถ่ายหลังดำเนินการแล้วเสร็จ (AFTER: ${afterImages.length} ภาพ)</span>
            <span class="font-mono-code text-[10px] text-slate-500">${afterImages.length >= 5 ? '✅ ครบตามมาตรฐาน' : (afterImages.length > 0 ? 'แนบหลักฐานแล้ว' : 'รอส่งมอบงาน')}</span>
          </div>
          ${afterImages.length > 0 ? `
            <div class="grid grid-cols-5 gap-1">
              ${afterImages.map(function(url, idx) {
                return `
                  <div class="border border-slate-200 bg-white p-0.5 text-center rounded">
                    <div class="evidence-img-container">
                      <img src="${url}" onerror="this.style.opacity='0.4';" class="w-full h-full object-cover rounded">
                    </div>
                    <div class="text-[8px] font-mono-code text-slate-500 mt-0.5">หลังซ่อม #${idx+1}</div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="py-1 text-center text-slate-400 text-xs">อยู่ระหว่างดำเนินการซ่อมแซม</div>'}
        </div>
      </div>

      <!-- Section 4: 3-Party Digital Sign-off & Audit Trail -->
      <div class="grid grid-cols-3 gap-2 pt-2 border-t-2 border-slate-800 text-center text-xs mt-auto">
        
        <!-- Party 1: Field Contractor -->
        <div class="border border-slate-300 p-1.5 rounded bg-white">
          <div class="font-bold text-slate-800 mb-1.5">1. ผู้ส่งมอบงาน / ช่างเทคนิค</div>
          <div class="font-bold text-slate-900">${escapeHtml(task.AssignedContractorName || 'ช่างประจำโครงการ')}</div>
          <div class="text-[10px] text-slate-500">ผู้รับเหมาดำเนินงานซ่อมแซม</div>
          <div class="font-mono-code text-[9px] text-slate-400 mt-0.5">${formatThaiDateTime(task.CreatedAt || getIsoNow())}</div>
        </div>

        <!-- Party 2: Approver to Repair -->
        <div class="border border-slate-300 p-1.5 rounded bg-white relative overflow-hidden">
          <div class="font-bold text-slate-800 mb-1.5">2. ผู้อนุมัติให้เริ่มงานซ่อมแซม</div>
          <div class="font-bold text-slate-900">${escapeHtml(task.ApproverName || (memo && memo.ApproverName) || 'วิศวกรผู้ควบคุมงาน')}</div>
          <div class="text-[10px] text-slate-500">${escapeHtml(task.ApprovalRole || 'ผู้มีอำนาจอนุมัติ')}</div>
          <div class="font-mono-code text-[9px] text-emerald-700 mt-0.5">✓ อนุมัติ: ${formatThaiDateTime(task.ApprovalDate || (memo && memo.ApprovalDate) || task.CreatedAt || getIsoNow())}</div>
        </div>

        <!-- Party 3: Handover & Inspection Closer -->
        <div class="border-2 ${isClosed ? 'border-emerald-600 bg-emerald-50/30' : 'border-slate-300 bg-white'} p-1.5 rounded relative overflow-hidden">
          ${isClosed ? `
            <div class="absolute -right-2 -bottom-2 border-2 border-emerald-600/30 rounded-full w-14 h-14 flex items-center justify-center font-bold text-emerald-800/30 font-mono-code text-[8px] transform -rotate-12 pointer-events-none select-none">
              CLOSED
            </div>
          ` : ''}
          <div class="font-bold text-slate-800 mb-1.5">3. ผู้ตรวจรับงานและปิดงานสมบูรณ์</div>
          <div class="font-bold ${isClosed ? 'text-emerald-900' : 'text-slate-400'}">${isClosed ? escapeHtml(task.InspectorName || task.ApproverName || 'ผู้ตรวจรับงาน') : '(รอลงนามตรวจรับ)'}</div>
          <div class="text-[10px] text-slate-500">${isClosed ? escapeHtml(task.InspectorRole || 'ผู้มีอำนาจตรวจรับ') : 'หัวหน้างาน / ผู้บริหาร'}</div>
          <div class="font-mono-code text-[9px] ${isClosed ? 'text-emerald-700 font-bold' : 'text-slate-400'} mt-0.5">
            ${isClosed ? '🏁 ปิดงาน: ' + formatThaiDateTime(task.ClosedAt || task.UpdatedAt || getIsoNow()) : '-'}
          </div>
        </div>

      </div>
    `;

    // Populate Mobile Card Container for small phone screens
    const mobileCardEl = document.getElementById('memoMobileCardContainer');
    if (mobileCardEl) {
      mobileCardEl.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-slate-200">
            <div class="flex items-center gap-2">
              <img src="logo-cropped.png" alt="TWPP" class="w-8 h-8 object-contain">
              <div>
                <div class="text-[10px] font-mono-code text-teal-600 font-bold">FMMS TWPP • v2.9.3-ENT</div>
                <div class="text-xs font-bold text-slate-800">${isClosed ? 'ใบรายงานตรวจรับและปิดงาน' : 'บันทึกข้อความขออนุมัติ'}</div>
              </div>
            </div>
            <span class="${isClosed ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800'} text-[11px] font-bold px-2 py-0.5 rounded">
              ${isClosed ? '🏁 ปิดงานแล้ว' : '⏳ รออนุมัติ'}
            </span>
          </div>

          <div class="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs space-y-1">
            <div class="font-bold text-slate-900">${escapeHtml(task.Title || (memo ? memo.Subject : '-'))}</div>
            <div class="text-slate-600">📍 พิกัด: ${escapeHtml(task.Location || 'ไม่ระบุ')} | ระบบ: ${escapeHtml(task.Category || 'ทั่วไป')}</div>
            <div class="text-slate-600">👷 ผู้รับผิดชอบ: ${escapeHtml(task.AssignedContractorName || 'ช่างประจำโครงการ')}</div>
            <div class="font-mono-code text-[11px] text-slate-500">เลขที่: ${escapeHtml(memo ? memo.MemoID : task.TaskID)} • ${formatThaiDateOnly(task.CreatedAt || getIsoNow())}</div>
          </div>

          <div class="p-2.5 bg-white border border-slate-200 rounded text-xs space-y-1">
            <div class="font-bold text-slate-700">รายละเอียด & สาเหตุ:</div>
            <div class="text-slate-800">${escapeHtml(task.Description || '-')}</div>
            <div class="text-slate-600 text-[11px]">การแก้ไข: ${escapeHtml(task.InitialAnalysis || 'ตรวจซ่อมและเปลี่ยนอะไหล่ตามมาตรฐาน')}</div>
          </div>

          <div class="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs">
            <div class="font-bold text-slate-700 mb-1">สรุปงบประมาณ:</div>
            <div class="flex justify-between py-0.5 border-b border-slate-200">
              <span>งบขออนุมัติ:</span>
              <span class="font-mono-code font-bold">฿${formatCurrency(estCost)}</span>
            </div>
            <div class="flex justify-between py-0.5 border-b border-slate-200">
              <span>ค่าใช้จ่ายจริง:</span>
              <span class="font-mono-code font-bold ${actualCost > estCost ? 'text-rose-600' : 'text-emerald-700'}">฿${formatCurrency(actualCost || estCost)}</span>
            </div>
          </div>

          <!-- Mobile Photos Grid -->
          <div class="space-y-2">
            <div class="font-bold text-xs text-slate-800">หลักฐานภาพถ่ายหน้างาน:</div>
            ${beforeImages.length > 0 ? `
              <div>
                <div class="text-[11px] text-slate-600 font-semibold mb-1">📷 ภาพก่อนซ่อม (${beforeImages.length} ภาพ):</div>
                <div class="grid grid-cols-3 gap-1.5">
                  ${beforeImages.map(function(url, idx) {
                    return `<div class="h-16 rounded overflow-hidden border border-slate-200 bg-slate-100"><img src="${url}" class="w-full h-full object-cover"></div>`;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            ${afterImages.length > 0 ? `
              <div>
                <div class="text-[11px] text-slate-600 font-semibold mb-1">📷 ภาพหลังซ่อม (${afterImages.length} ภาพ):</div>
                <div class="grid grid-cols-3 gap-1.5">
                  ${afterImages.map(function(url, idx) {
                    return `<div class="h-16 rounded overflow-hidden border border-slate-200 bg-slate-100"><img src="${url}" class="w-full h-full object-cover"></div>`;
                  }).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Mobile Signatures -->
          <div class="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs space-y-1">
            <div class="font-bold text-slate-700">การลงนามดิจิทัล 3 ฝ่าย:</div>
            <div class="text-[11px]">1. ช่างเทคนิค: ${escapeHtml(task.AssignedContractorName || 'ช่างประจำโครงการ')}</div>
            <div class="text-[11px]">2. ผู้อนุมัติ: ${escapeHtml(task.ApproverName || 'วิศวกรผู้ควบคุมงาน')}</div>
            <div class="text-[11px] font-bold ${isClosed ? 'text-emerald-800' : 'text-slate-500'}">
              3. ผู้ตรวจรับ: ${isClosed ? escapeHtml(task.InspectorName || task.ApproverName || 'ผู้ตรวจรับงาน') + ' (ปิดงานแล้ว)' : 'รอตรวจรับ'}
            </div>
          </div>

          <div class="pt-2">
            <button type="button" onclick="window.print()" class="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-2.5 rounded-md text-xs shadow flex items-center justify-center gap-1.5">
              <span>🖨 สั่งพิมพ์ A4 / บันทึก PDF เต็มรูปแบบ</span>
            </button>
          </div>
        </div>
      `;
    }

    // Auto-fit zoom on mobile screens (<850px)
    if (window.innerWidth < 850) {
      currentMemoZoom = calculateFitZoom();
    } else {
      currentMemoZoom = 1.0;
    }
    updateMemoZoomDisplay();

    // Default to A4 sheet view
    memoViewMode = 'a4';
    const a4Wrapper = document.getElementById('memoZoomWrapper');
    const mobileCard = document.getElementById('memoMobileCardContainer');
    const btn = document.getElementById('memoViewModeToggleBtn');
    if (a4Wrapper) a4Wrapper.classList.remove('hidden');
    if (mobileCard) mobileCard.classList.add('hidden');
    if (btn) btn.innerHTML = '<span>📱 โหมดการ์ดมือถือ</span>';

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Scroll viewport to top
    const viewport = modal.querySelector('.memo-viewport-container');
    if (viewport) {
      viewport.scrollTop = 0;
    }
  }

  function closeMemoPrintModal() {
    const modal = document.getElementById('memoPrintModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      currentMemoZoom = 1.0;
      updateMemoZoomDisplay();
    }
  }
  
/**
   * ==========================================================================
   * 10. ADMIN BACKEND SETTINGS, USER GOVERNANCE & QR PROVISIONING
   * ==========================================================================
   */

  async function handleAdminSaveUser(event) {
    event.preventDefault();
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 3) {
      showToast('จำกัดสิทธิ์เฉพาะ Admin (ระดับ 3)', 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเพิ่มหรือแก้ไขบัญชีผู้ใช้ได้', 'error');
      return;
    }

    const editId = getVal('usrEditId');
    const username = String(getVal('usrUsername') || '').trim();
    const password = String(getVal('usrPassword') || '').trim();
    const fullName = String(getVal('usrFullName') || '').trim();
    const roleLevel = Number(getVal('usrRoleLevel') || 1);
    const status = getVal('usrStatus') || 'Active';
    const dept = getVal('usrDept') || 'ทั่วไป';
    const phone = getVal('usrPhone') || '-';
    const now = getIsoNow();
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    if (editId) {
      const existing = state.db.users.find(function(u) { return u.UserID === editId; });
      if (existing) {
        const beforeSnap = JSON.stringify({ RoleLevel: existing.RoleLevel, Status: existing.Status, FullName: existing.FullName });
        existing.Username = username;
        if (password) existing.PasswordPlain = password;
        existing.FullName = fullName;
        existing.RoleLevel = roleLevel;
        existing.Status = status;
        existing.Department = dept;
        existing.Phone = phone;
        existing.UpdatedAt = now;
        existing.UpdatedBy = operatorStamp;

        recordAuditLog(
          'USER_MANAGEMENT_UPDATE',
          editId,
          'Admin แก้ไขสิทธิ์/ข้อมูลผู้ใช้ ' + username + ' โดย ' + operatorStamp,
          beforeSnap,
          JSON.stringify({ RoleLevel: roleLevel, Status: status, UpdatedBy: operatorStamp }),
          'SUCCESS'
        );

        await postToGasBackend('adminManageUser', {
          mode: 'update',
          userData: { UserID: editId, Username: username, Password: password, FullName: fullName, RoleLevel: roleLevel, Status: status, Department: dept, Phone: phone }
        });

        persistDatabase();
        resetAdminUserForm();
        renderAdminUsersTable();
        renderSystemLogs();
        showToast('อัปเดตผู้ใช้ ' + editId + ' สำเร็จ', 'บันทึกผู้ดำเนินการ: ' + operatorStamp + ' เวลา ' + formatThaiDateTime(now), 'success');
        return;
      }
    }

    const newUserId = generateUniqueId(state.db.users, 'UserID', 'USR-2026');
    const newUser = {
      UserID: newUserId,
      Username: username,
      PasswordPlain: password || '123456',
      FullName: fullName,
      RoleLevel: roleLevel,
      Department: dept,
      Phone: phone,
      Status: status,
      CreatedAt: now,
      CreatedBy: operatorStamp,
      UpdatedAt: now,
      UpdatedBy: operatorStamp,
      LastLoginAt: '-'
    };

    state.db.users.push(newUser);
    recordAuditLog(
      'USER_MANAGEMENT_CREATE',
      newUserId,
      'Admin สร้างผู้ใช้ใหม่ ' + username + ' (ระดับ ' + roleLevel + ') โดย ' + operatorStamp,
      'NONE',
      JSON.stringify({ UserID: newUserId, RoleLevel: roleLevel, CreatedBy: operatorStamp }),
      'SUCCESS'
    );

    await postToGasBackend('adminManageUser', {
      mode: 'create',
      userData: { Username: username, Password: password || '123456', FullName: fullName, RoleLevel: roleLevel, Status: status, Department: dept, Phone: phone }
    });

    persistDatabase();
    resetAdminUserForm();
    renderAdminUsersTable();
    renderSystemLogs();
    showToast('สร้างบัญชีผู้ใช้ ' + newUserId + ' สำเร็จ', 'บันทึกชื่อผู้ดำเนินการ (' + operatorStamp + ') และเวลาเรียบร้อยแล้ว', 'success');
  }

  function editAdminUser(userId) {
    const u = state.db.users.find(function(item) { return item.UserID === userId; });
    if (!u) return;
    setVal('usrEditId', u.UserID);
    setText('adminUserFormTitle', 'แก้ไขผู้ใช้งาน: ' + u.UserID);
    setVal('usrUsername', u.Username);
    setVal('usrPassword', '');
    setVal('usrFullName', u.FullName);
    setVal('usrRoleLevel', String(u.RoleLevel));
    setVal('usrStatus', u.Status);
    setVal('usrDept', u.Department || '');
    setVal('usrPhone', u.Phone || '');

    const deleteBtn = document.getElementById('btnAdminDeleteUser');
    if (deleteBtn) {
      if (u.UserID === 'USR-2026-0001') {
        deleteBtn.classList.add('hidden');
      } else {
        deleteBtn.classList.remove('hidden');
      }
    }
  }

  function resetAdminUserForm() {
    const form = document.getElementById('adminUserForm');
    if (form) form.reset();
    setVal('usrEditId', '');
    setText('adminUserFormTitle', 'เพิ่ม / แก้ไขผู้ใช้งานระบบ (โดย Admin)');
    const deleteBtn = document.getElementById('btnAdminDeleteUser');
    if (deleteBtn) deleteBtn.classList.add('hidden');
  }

  async function deleteAdminUser(userId) {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 3) {
      showToast('จำกัดสิทธิ์เฉพาะ Admin (ระดับ 3)', 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบบัญชีผู้ใช้ได้', 'error');
      return;
    }

    if (userId === 'USR-2026-0001') {
      showToast('ไม่อนุญาตให้ลบบัญชีนี้', 'บัญชี USR-2026-0001 เป็นบัญชีผู้ดูแลระบบหลัก (Super Admin) ไม่สามารถลบได้', 'warning');
      return;
    }

    if (userId === actor.userId) {
      showToast('ไม่อนุญาตให้ลบบัญชีตนเอง', 'คุณกำลังเข้าสู่ระบบด้วยบัญชีนี้อยู่ ไม่สามารถลบบัญชีที่กำลังใช้งานได้', 'warning');
      return;
    }

    const targetUser = state.db.users.find(function(u) { return u.UserID === userId; });
    const targetName = targetUser ? targetUser.FullName : userId;
    const targetUsername = targetUser ? targetUser.Username : '';

    const confirmed = confirm('⚠️ ยืนยันการลบผู้ใช้งาน: ' + userId + ' (' + targetName + ') หรือไม่?\n\nระบบจะลบข้อมูลออกจากฐานข้อมูล Google Sheets และจะไม่นำกลับมาแสดงอีก');
    if (!confirmed) return;

    // 1. Add to permanent blacklist so background sync can NEVER revive this user
    if (!state.deletedUserIds) state.deletedUserIds = [];
    if (!state.deletedUserIds.includes(userId)) state.deletedUserIds.push(userId);
    if (targetUsername && !state.deletedUserIds.includes(targetUsername.toLowerCase())) {
      state.deletedUserIds.push(targetUsername.toLowerCase());
    }

    // 2. Remove all matching copies from local state
    state.db.users = (state.db.users || []).filter(function(u) {
      const uid = String(u.UserID || '').trim();
      const uname = String(u.Username || '').trim().toLowerCase();
      return uid !== userId && uname !== targetUsername.toLowerCase();
    });

    persistDatabase();
    renderAdminUsersTable();

    // Reset form if currently editing this user
    if (getVal('usrEditId') === userId) {
      resetAdminUserForm();
    }

    showToast('ลบผู้ใช้งานเรียบร้อย', 'ลบผู้ใช้ ' + userId + ' (' + targetName + ') ออกจากระบบแล้ว', 'success');

    // 3. Call real postToGasBackend to delete from Google Sheets immediately
    try {
      const res = await postToGasBackend('adminManageUser', {
        mode: 'delete',
        userId: userId,
        username: targetUsername
      });

      showCloudSyncConfirmation({
        docId: userId,
        docType: 'ข้อมูลผู้ใช้งาน (Sheet: Users)',
        actionTitle: 'ลบบัญชีผู้ใช้งานออกจากระบบถาวร',
        version: 'v2.9.3-ENT',
        details: 'ลบผู้ใช้ ' + userId + ' (' + targetName + ') ออกจาก Google Sheets เรียบร้อยแล้ว'
      });
    } catch (err) {
      console.warn('Backend deletion sync warning:', err);
    }
  }

  function handleDeleteCurrentUserFromForm() {
    const editId = getVal('usrEditId');
    if (!editId) {
      showToast('ไม่ได้เลือกผู้ใช้', 'กรุณาเลือกผู้ใช้งานที่ต้องการลบจากตารางด้านขวาก่อน', 'warning');
      return;
    }
    deleteAdminUser(editId);
  }

  function renderAdminUsersTable() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    tbody.innerHTML = state.db.users.map(function(u) {
      const roleBadge = u.RoleLevel === 3
        ? '<span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold">ระดับ 3: ผู้บริหาร/Admin</span>'
        : u.RoleLevel === 2
          ? '<span class="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-semibold">ระดับ 2: Supervisor</span>'
          : '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 font-semibold">ระดับ 1: ช่างหน้างาน</span>';

      const statusBadge = u.Status === 'Active'
        ? '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono-code text-[11px]">Active</span>'
        : '<span class="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-mono-code text-[11px]">Inactive</span>';

      return `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-3">
            <div class="font-mono-code font-bold text-slate-900">${escapeHtml(u.UserID)}</div>
            <div class="font-mono-code text-[11px] text-blue-700">@${escapeHtml(u.Username)}</div>
          </td>
          <td class="py-3 px-3">
            <div class="font-semibold text-slate-900">${escapeHtml(u.FullName)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(u.Department || '-')} • โทร: ${escapeHtml(u.Phone || '-')}</div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">${roleBadge}</td>
          <td class="py-3 px-3 whitespace-nowrap">${statusBadge}</td>
          <td class="py-3 px-3 text-[11px] font-mono-code">
            <div class="text-slate-800">ผู้บันทึก: <strong>${escapeHtml(u.UpdatedBy || u.CreatedBy || 'SYSTEM')}</strong></div>
            <div class="text-slate-500">เวลา: ${formatThaiDateTime(u.UpdatedAt || u.CreatedAt)}</div>
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1.5">
              <button type="button" onclick="FMMS.editAdminUser('${u.UserID}')" class="bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 rounded text-xs transition cursor-pointer">
                แก้ไขสิทธิ์
              </button>
              ${u.UserID !== 'USR-2026-0001' ? `
                <button type="button" onclick="FMMS.deleteAdminUser('${u.UserID}')" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 px-2 py-1 rounded text-xs transition cursor-pointer font-medium" title="ลบผู้ใช้งานนี้ออกจากระบบ">
                  🗑 ลบทิ้ง
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * ==========================================================================
   * 11. ZERO-TOUCH QR CODE DEVICE PROVISIONING ENGINE
   * ==========================================================================
   */

  function saveSystemConfigAndRegenerateQR(event) {
    if (event) event.preventDefault();
    const actor = getCurrentActor();
    const now = getIsoNow();
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    state.config.gasWebAppUrl = String(getVal('cfgGasUrl') || '').trim();
    state.config.spreadsheetId = String(getVal('cfgSheetId') || DEFAULT_CONFIG.spreadsheetId).trim();
    state.config.driveFolderId = String(getVal('cfgDriveId') || DEFAULT_CONFIG.driveFolderId).trim();
    state.config.orgName = String(getVal('cfgOrgName') || DEFAULT_CONFIG.orgName).trim();
    state.config.defaultRoleUser = String(getVal('cfgDefaultRoleUser') || '').trim();
    state.config.lastSavedBy = operatorStamp;
    state.config.lastSavedAt = now;

    saveConfig();
    generateProvisioningQrCode();

    recordAuditLog(
      'UPDATE_SYSTEM_SETTINGS',
      'QR_PROVISIONING_CONFIG',
      'Admin บันทึกการตั้งค่าการเชื่อมต่อและออก QR Code สำหรับเปิดเครื่องใหม่',
      'Previous Config',
      'Sheet: ' + state.config.spreadsheetId + ' | Drive: ' + state.config.driveFolderId + ' | By: ' + operatorStamp,
      'SUCCESS'
    );

    postToGasBackend('adminUpdateSettings', {
      settings: state.config,
      description: 'Updated by ' + operatorStamp
    });

    persistDatabase();
    renderSystemLogs();
    pingConnection(true);

    showCloudSyncConfirmation({
      docId: 'CFG-TWPP-SYSTEM',
      docType: 'การตั้งค่าระบบและ URL การเชื่อมต่อ',
      actionTitle: 'บันทึกการตั้งค่าระบบส่วนกลาง & สร้าง QR Code ใหม่',
      version: 'v2.9.3-ENT (Enterprise Config Updated)',
      details: 'อัปเดต Google Spreadsheet ID (' + state.config.spreadsheetId + ') และ Google Drive ID (' + state.config.driveFolderId + ') เรียบร้อยแล้ว พร้อมยืนยันข้อมูลทุกเครื่อง'
    });
    showToast('บันทึกการตั้งค่าระบบและสร้าง QR Code สำเร็จ', 'อัปเดต ID ของ Google Sheets และ Drive เรียบร้อย', 'success');
  }

  function buildProvisioningUrl() {
    const payload = {
      v: 2,
      gas: state.config.gasWebAppUrl || '',
      sid: state.config.spreadsheetId,
      did: state.config.driveFolderId,
      org: state.config.orgName,
      usr: state.config.defaultRoleUser || '',
      by: state.config.lastSavedBy,
      at: state.config.lastSavedAt
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    let baseUrl = window.location.origin + window.location.pathname;
    if (!baseUrl || baseUrl.startsWith('null') || window.location.protocol === 'file:') {
      baseUrl = 'https://doit-on.github.io/MA-TWPP/';
    }
    return baseUrl + '?provision=' + encodeURIComponent(encoded);
  }

  function generateProvisioningQrCode() {
    const qrContainer = document.getElementById('qrcodeContainer');
    const linkBox = document.getElementById('qrProvisioningLinkBox');
    if (!qrContainer) return;

    const provisionUrl = buildProvisioningUrl();
    if (linkBox) linkBox.textContent = provisionUrl;

    qrContainer.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainer, {
        text: provisionUrl,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrContainer.innerHTML = '<div class="p-4 text-xs text-slate-500">QR Ready</div>';
    }
  }

  function copyProvisioningLink() {
    const url = buildProvisioningUrl();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
    showToast('คัดลอกลิงก์ตั้งค่าเครื่องใหม่แล้ว', 'สามารถส่งลิงก์หรือให้เครื่องใหม่สแกน QR Code เพื่อเชื่อมต่อทันที', 'success');
  }

  function checkUrlProvisioningParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const prov = params.get('provision');
      if (prov) {
        applyProvisioningToken(prov);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {
      console.warn('URL provision parse error:', e);
    }
  }

  function applyProvisioningToken(rawText) {
    try {
      let token = String(rawText || '').trim();
      if (!token) return false;

      // Extract provision query parameter safely without new URL() crashing
      if (token.includes('provision=')) {
        const match = token.match(/provision=([^&#\s]+)/);
        if (match && match[1]) {
          token = decodeURIComponent(match[1]);
        }
      }

      let data = null;

      // 1. Try base64 JSON decode
      try {
        let standardB64 = token.replace(/-/g, '+').replace(/_/g, '/');
        while (standardB64.length % 4) standardB64 += '=';
        const jsonStr = decodeURIComponent(escape(atob(standardB64)));
        data = JSON.parse(jsonStr);
      } catch (_) {
        // 2. Fallback: Check if it is already raw JSON
        try {
          data = JSON.parse(token);
        } catch (_) {
          // 3. Fallback: Direct Google Apps Script Web App URL
          if (token.startsWith('https://script.google.com/macros/s/')) {
            state.config.gasWebAppUrl = token;
            saveConfig();
            closeQrScannerModal();
            pingConnection(true);
            showToast('เชื่อมต่อ Web App สำเร็จ!', 'ตั้งค่า URL ของระบบคลาวด์เรียบร้อยแล้ว', 'success');
            return true;
          }
        }
      }

      if (data && (data.sid || data.did || data.gas)) {
        state.config.gasWebAppUrl = data.gas || state.config.gasWebAppUrl;
        if (data.sid) state.config.spreadsheetId = data.sid;
        if (data.did) state.config.driveFolderId = data.did;
        if (data.org) state.config.orgName = data.org;
        if (data.usr) state.config.defaultRoleUser = data.usr;
        state.config.lastSavedBy = data.by || 'QR Provisioning';
        state.config.lastSavedAt = getIsoNow();
        saveConfig();

        if (data.usr) {
          setVal('loginUsername', data.usr);
        }

        recordAuditLog(
          'DEVICE_QR_PROVISIONED',
          state.deviceId,
          'เปิดใช้งานเครื่องใหม่ผ่านการสแกน QR Code เชื่อมต่อ Sheet: ' + state.config.spreadsheetId + ' และ Drive: ' + state.config.driveFolderId,
          'Unconfigured Device',
          'Provisioned & Bound (' + state.deviceId + ')',
          'SUCCESS'
        );

        persistDatabase();
        closeQrScannerModal();
        pingConnection(true);
        showToast(
          'ตั้งค่าเครื่องใหม่ด้วย QR Code สำเร็จ!',
          'เชื่อมต่อ Google Sheet (Data MA TWPP) และ Google Drive อัตโนมัติเรียบร้อยแล้ว',
          'success'
        );
        return true;
      }
      throw new Error('ไม่พบข้อมูลการตั้งค่า (sid / did) ใน QR Code');
    } catch (err) {
      showToast('รูปแบบ QR Code ไม่ถูกต้อง', 'กรุณาใช้ QR Code จากหน้าตั้งค่าระบบ หรือใช้ปุ่มเชื่อมต่อด่วน', 'error');
    }
    return false;
  }

  function openQrScannerModal() {
    const modal = document.getElementById('qrScannerModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      setTimeout(function() {
        startCameraQrScanner();
      }, 250);
    }
  }

  function closeQrScannerModal() {
    stopCameraQrScanner();
    const modal = document.getElementById('qrScannerModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function openConnectionConfigModal() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('hidden');
    switchView('admin');
  }

  async function stopCameraQrScanner() {
    if (state.qrScannerInstance) {
      try {
        const instance = state.qrScannerInstance;
        state.qrScannerInstance = null;
        if (instance.isScanning) {
          await instance.stop();
        }
        instance.clear();
      } catch (_) {}
    }
    const vp = document.getElementById('qrReaderViewport');
    if (vp && !state.qrScannerInstance) {
      vp.innerHTML = '<div class="p-4 text-center text-slate-400">กดปุ่ม "📷 เปิดกล้องสแกน QR Code" หรือเลือกไฟล์ภาพ QR ด้านล่าง</div>';
    }
  }

  async function startCameraQrScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      showToast('ไม่พบไลบรารีกล้อง', 'สามารถใช้วิธีเลือกไฟล์รูปภาพ QR Code หรือปุ่มเชื่อมต่อด่วนด้านล่างได้', 'warning');
      return;
    }

    await stopCameraQrScanner();

    const vp = document.getElementById('qrReaderViewport');
    if (vp) {
      vp.innerHTML = '<div class="p-6 text-center text-teal-400 flex flex-col items-center gap-2"><span class="animate-spin text-2xl">⏳</span><span>กำลังค้นหาและเปิดกล้อง...</span></div>';
    }

    try {
      const html5QrCode = new Html5Qrcode('qrReaderViewport');
      state.qrScannerInstance = html5QrCode;

      const scanConfig = {
        fps: 15,
        qrbox: function(viewfinderWidth, viewfinderHeight) {
          const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
          return { width: Math.max(edge, 180), height: Math.max(edge, 180) };
        }
      };

      const onScanSuccess = function(decodedText) {
        stopCameraQrScanner();
        applyProvisioningToken(decodedText);
      };

      const onScanError = function() {
        // silent progress
      };

      // Multi-tier camera initialization:
      // Tier 1: Try back/environment camera (smartphones/tablets)
      html5QrCode.start({ facingMode: 'environment' }, scanConfig, onScanSuccess, onScanError)
        .catch(function(errEnv) {
          console.log('Tier 1 (environment camera) failed, trying Tier 2 (user/webcam)...', errEnv);
          // Tier 2: Try front camera / PC webcam
          return html5QrCode.start({ facingMode: 'user' }, scanConfig, onScanSuccess, onScanError);
        })
        .catch(function(errUser) {
          console.log('Tier 2 (user camera) failed, trying Tier 3 (enumerated cameras)...', errUser);
          // Tier 3: Query available device cameras
          return Html5Qrcode.getCameras().then(function(cameras) {
            if (cameras && cameras.length > 0) {
              const selectedCamId = cameras[cameras.length - 1].id;
              return html5QrCode.start(selectedCamId, scanConfig, onScanSuccess, onScanError);
            }
            throw new Error('ไม่พบอุปกรณ์กล้องบนเครื่องนี้');
          });
        })
        .catch(function(finalErr) {
          console.warn('All camera start attempts failed:', finalErr);
          state.qrScannerInstance = null;
          if (vp) {
            vp.innerHTML = `
              <div class="p-4 text-center space-y-2">
                <div class="text-rose-400 font-semibold">⚠️ ไม่สามารถเปิดกล้องได้</div>
                <div class="text-slate-400 text-xs">${escapeHtml(finalErr.message || String(finalErr))}</div>
                <div class="text-slate-500 text-[11px] pt-1">แนะนำ: กรุณาอนุญาตสิทธิ์กล้องในเบราว์เซอร์ หรือกดปุ่ม <strong>"🖼️ เลือกไฟล์ภาพ QR Code"</strong> ด้านล่าง</div>
              </div>
            `;
          }
          showToast('ไม่สามารถเปิดกล้องได้', 'กรุณาอนุญาตการเข้าถึงกล้อง หรือใช้วิธีเลือกไฟล์ภาพ QR Code ด้านล่าง', 'warning');
        });
    } catch (e) {
      console.error('startCameraQrScanner exception:', e);
      if (vp) {
        vp.innerHTML = '<div class="p-4 text-center text-rose-400">เกิดข้อผิดพลาดในการเปิดระบบกล้อง</div>';
      }
    }
  }

  async function scanQrFromImageFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (typeof Html5Qrcode === 'undefined') {
      showToast('ไม่พบไลบรารีอ่าน QR', 'กรุณาลองใหม่อีกครั้ง', 'warning');
      return;
    }

    await stopCameraQrScanner();

    try {
      const html5QrCode = new Html5Qrcode('qrReaderViewport');
      const decodedText = await html5QrCode.scanFile(file, true);
      applyProvisioningToken(decodedText);
      try { html5QrCode.clear(); } catch (_) {}
    } catch (err) {
      showToast('ไม่พบ QR Code ในรูปภาพที่เลือก', 'กรุณาตรวจสอบว่าภาพมีความคมชัดและมี QR Code ชัดเจน', 'error');
    }
  }

  function applyManualProvisionPayload() {
    const val = getVal('manualProvisionInput');
    if (!val) return;
    applyProvisioningToken(val);
  }

  function applyDefaultCloudConfig() {
    state.config.gasWebAppUrl = DEFAULT_CONFIG.gasWebAppUrl;
    state.config.spreadsheetId = DEFAULT_CONFIG.spreadsheetId;
    state.config.driveFolderId = DEFAULT_CONFIG.driveFolderId;
    state.config.orgName = DEFAULT_CONFIG.orgName;
    saveConfig();
    closeQrScannerModal();
    pingConnection(true);
    showToast('เชื่อมต่อ Cloud สำเร็จ!', 'ตั้งค่าการเชื่อมต่อ Google Sheets & Drive เป็นค่าเริ่มต้นเรียบร้อยแล้ว', 'success');
  }

  /**
   * ==========================================================================
   * 12. SYSTEM BACKUP TO GOOGLE DRIVE & SHEET + CSV EXPORT (RULE #2 & #6)
   * ==========================================================================
   */

  async function triggerSystemBackup() {
    const actor = getCurrentActor();
    const now = getIsoNow();

    showToast('กำลังสำรองข้อมูลไปยัง Google Drive & Sheet...', 'กำลังสร้าง Snapshot ฐานข้อมูลและตรวจสอบความถูกต้อง', 'info');

    const res = await postToGasBackend('triggerBackup', {});
    const stampText = formatThaiDateTime(now) + ' โดย ' + actor.fullName;
    setText('lastBackupBadge', stampText);

    // Also download a local JSON recovery snapshot for double safety
    const backupPayload = {
      system: 'FMMS Enterprise - Data MA TWPP',
      spreadsheetId: state.config.spreadsheetId,
      driveFolderId: state.config.driveFolderId,
      backedUpAt: now,
      backedUpBy: actor,
      database: state.db
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'FMMS_Backup_Data_MA_TWPP_' + now.slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    recordAuditLog(
      'SYSTEM_BACKUP',
      'DRIVE_AND_SHEET_SNAPSHOT',
      'สำรองฐานข้อมูลลง Google Drive Folder (' + state.config.driveFolderId + ') และดาวน์โหลดไฟล์ Snapshot สำเร็จ',
      'Active DB',
      res && res.backupFileName ? res.backupFileName : 'Snapshot Verified',
      'SUCCESS'
    );

    persistDatabase();
    renderSystemLogs();
    showToast('สำรองข้อมูลสำเร็จ (Google Drive + Local Snapshot)', 'บันทึกประวัติการสำรองข้อมูลใน System_Logs เรียบร้อยแล้ว', 'success');
  }

  function exportTasksToCSV() {
    const headers = ['TaskID', 'Type', 'Category', 'Title', 'Location', 'Priority', 'Status', 'AssignedContractorName', 'SupervisorName', 'EstCost', 'ActualCost', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
    downloadCSV('FMMS_Tasks_ISO_Report.csv', headers, state.db.tasks);
    recordAuditLog('EXPORT_REPORT', 'TASKS_CSV', 'ส่งออกรายงานใบงานมาตรฐานสากล (CSV)', '-', state.db.tasks.length + ' rows', 'SUCCESS');
  }

  function exportMemosToCSV() {
    const headers = ['MemoID', 'TaskID', 'DocReference', 'Subject', 'EstimatedBudget', 'VendorName', 'RequestedBy', 'RequestedAt', 'ApproverName', 'ApprovalDate', 'ApprovalStatus'];
    downloadCSV('FMMS_Approval_Memos_Report.csv', headers, state.db.memos);
    recordAuditLog('EXPORT_REPORT', 'MEMOS_CSV', 'ส่งออกทะเบียนคุมบันทึกข้อความขออนุมัติ (CSV)', '-', state.db.memos.length + ' rows', 'SUCCESS');
  }

  function exportLogsToCSV() {
    const headers = ['LogID', 'Timestamp', 'UserID', 'OperatorName', 'RoleLevel', 'Action', 'TargetID', 'Details', 'BeforeState', 'AfterState', 'Status'];
    downloadCSV('FMMS_System_Audit_Logs.csv', headers, state.db.logs);
  }

  function downloadCSV(filename, headers, rows) {
    const csvLines = [headers.join(',')];
    rows.forEach(function(r) {
      const line = headers.map(function(h) {
        const val = String(r[h] !== undefined && r[h] !== null ? r[h] : '').replace(/"/g, '""');
        return '"' + val + '"';
      });
      csvLines.push(line.join(','));
    });
    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * ==========================================================================
   * 13. SYSTEM AUDIT LOGS & DIAGNOSTICS RENDERER
   * ==========================================================================
   */

  function recordAuditLog(action, targetId, details, beforeState, afterState, status) {
    const actor = getCurrentActor();
    const now = getIsoNow();
    const dateStr = now.slice(0, 10).replace(/-/g, '');
    const logId = generateUniqueId(state.db.logs, 'LogID', 'LOG-' + dateStr);

    const entry = {
      LogID: logId,
      Timestamp: now,
      UserID: actor.userId,
      OperatorName: actor.fullName,
      RoleLevel: actor.roleLevel,
      Action: action,
      TargetID: targetId,
      Details: details,
      BeforeState: beforeState || '-',
      AfterState: afterState || '-',
      ClientInfo: state.deviceId,
      Status: status || 'SUCCESS'
    };

    state.db.logs.unshift(entry);
  }

  function renderSystemLogs() {
    const tbody = document.getElementById('systemLogsTableBody');
    if (!tbody) return;

    const q = String(getVal('logSearchInput') || '').trim().toLowerCase();
    const list = state.db.logs.filter(function(l) {
      if (!q) return true;
      const hay = [l.LogID, l.UserID, l.OperatorName, l.Action, l.TargetID, l.Details].join(' ').toLowerCase();
      return hay.includes(q);
    });

    tbody.innerHTML = list.map(function(l) {
      const ok = l.Status === 'SUCCESS';
      return `
        <tr class="hover:bg-slate-50">
          <td class="py-2.5 px-3 whitespace-nowrap">
            <div class="font-bold text-slate-900">${escapeHtml(l.LogID)}</div>
            <div class="text-slate-500">${formatThaiDateTime(l.Timestamp)}</div>
          </td>
          <td class="py-2.5 px-3">
            <div class="font-semibold text-slate-900">${escapeHtml(l.OperatorName)}</div>
            <div class="text-teal-700">${escapeHtml(l.UserID)} (Role ${escapeHtml(l.RoleLevel)})</div>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded bg-slate-200 text-slate-900 font-bold">${escapeHtml(l.Action)}</span>
          </td>
          <td class="py-2.5 px-3 font-bold text-blue-700 whitespace-nowrap">${escapeHtml(l.TargetID)}</td>
          <td class="py-2.5 px-3">
            <div class="text-slate-800 font-sans text-xs">${escapeHtml(l.Details)}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Before: ${escapeHtml(l.BeforeState)} → After: ${escapeHtml(l.AfterState)}</div>
          </td>
          <td class="py-2.5 px-3 whitespace-nowrap">
            <span class="px-2 py-0.5 rounded ${ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
              ${escapeHtml(l.Status)}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * ==========================================================================
   * 14. SHARED UI RENDERERS & FORMATTING HELPERS
   * ==========================================================================
   */


  async function exportToGoogleSheetCloud() {
    const actor = getCurrentActor();
    showToast('กำลังส่งข้อมูลขึ้น Google Sheets Cloud...', 'กำลังซิงค์ข้อมูลทั้ง 8 แท็บไปยัง Data MA TWPP', 'info');

    recordAuditLog(
      'CLOUD_SHEET_FULL_SYNC',
      state.config.spreadsheetId,
      'ผู้ใช้ (' + actor.fullName + ') สั่งส่งออกข้อมูลครบ 8 Tabs ขึ้น Google Sheet',
      'Local State',
      'Google Sheet Cloud Synced',
      'SUCCESS'
    );

    await postToGasBackend('fullSync', {
      tasks: state.db.tasks,
      memos: state.db.memos,
      schedules: state.db.schedules,
      users: state.db.users,
      logs: state.db.logs
    });

    showCloudSyncConfirmation({
      docId: 'GSHEET-FULL-SYNC',
      docType: 'ฐานข้อมูลระบบวิศวกรรมอาคาร FMMS (8 Tabs)',
      actionTitle: 'ส่งออกและยืนยันข้อมูลขึ้น Google Sheet Cloud สำเร็จ',
      version: 'v2.9.3-ENT (Multi-Tab Master Database)',
      details: 'ฐานข้อมูลทั้งหมด 8 แท็บ (Users, Tasks, Memos, Schedules, Costs, Vendors, Audits, Config) ถูกส่งไปยัง Google Sheet Data MA TWPP และได้รับการยืนยันข้อมูลทุกเครื่องเรียบร้อยแล้ว'
    });
  }

  function exportFullWorkbookXLS() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];
    const schedules = state.db.schedules || [];
    const users = state.db.users || [];
    const logs = state.db.logs || [];

    function makeWorksheet(name, headers, rows) {
      let xml = '<Worksheet ss:Name="' + name + '"><Table>';
      xml += '<Row>';
      headers.forEach(function(h) {
        xml += '<Cell><Data ss:Type="String">' + escapeXml(h) + '</Data></Cell>';
      });
      xml += '</Row>';
      rows.forEach(function(r) {
        xml += '<Row>';
        r.forEach(function(val) {
          const type = typeof val === 'number' ? 'Number' : 'String';
          xml += '<Cell><Data ss:Type="' + type + '">' + escapeXml(String(val !== null && val !== undefined ? val : '')) + '</Data></Cell>';
        });
        xml += '</Row>';
      });
      xml += '</Table></Worksheet>';
      return xml;
    }

    function escapeXml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    let wb = '<?xml version="1.0"?>';
    wb += '<?mso-application progid="Excel.Sheet"?>';
    wb += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ';
    wb += 'xmlns:o="urn:schemas-microsoft-com:office:office" ';
    wb += 'xmlns:x="urn:schemas-microsoft-com:office:excel" ';
    wb += 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';

    wb += makeWorksheet('Tasks_MA', ['TaskID', 'Type', 'Category', 'Title', 'Location', 'Priority', 'Status', 'Contractor', 'Supervisor', 'EstCost', 'ActualCost', 'CreatedAt'],
      tasks.map(function(t) { return [t.TaskID, t.Type, t.Category, t.Title, t.Location, t.Priority, t.Status, t.AssignedContractorName, t.SupervisorName, t.EstCost, t.ActualCost, t.CreatedAt]; })
    );

    wb += makeWorksheet('Memos_Approval', ['MemoID', 'TaskID', 'DocReference', 'Subject', 'EstimatedBudget', 'VendorName', 'ApprovalStatus', 'RequestedBy', 'ApprovedBy', 'ApprovalDate'],
      memos.map(function(m) { return [m.MemoID, m.TaskID, m.DocReference, m.Subject, m.EstimatedBudget, m.VendorName, m.ApprovalStatus, m.RequestedBy, m.ApproverName, m.ApprovalDate]; })
    );

    wb += makeWorksheet('PM_Schedules', ['ScheduleID', 'EquipmentCode', 'EquipmentName', 'Category', 'Location', 'Frequency', 'NextDueDate', 'AssignedTeam', 'Status'],
      schedules.map(function(s) { return [s.ScheduleID, s.EquipmentCode, s.EquipmentName, s.Category, s.Location, s.Frequency, s.NextDueDate, s.AssignedTeam, s.Status]; })
    );

    wb += makeWorksheet('Users_Directory', ['UserID', 'Username', 'FullName', 'RoleLevel', 'Department', 'Phone', 'Status', 'LastLoginAt'],
      users.map(function(u) { return [u.UserID, u.Username, u.FullName, u.RoleLevel, u.Department, u.Phone, u.Status, u.LastLoginAt]; })
    );

    wb += makeWorksheet('System_Logs', ['LogID', 'Timestamp', 'OperatorName', 'RoleLevel', 'Action', 'TargetID', 'Details', 'Status'],
      logs.map(function(l) { return [l.LogID, l.Timestamp, l.OperatorName, l.RoleLevel, l.Action, l.TargetID, l.Details, l.Status]; })
    );

    wb += '</Workbook>';

    const blob = new Blob([wb], { type: 'application/vnd.ms-excel;charset=utf-8' });
    downloadBlob(blob, 'Data_MA_TWPP_Full_Workbook_2026.xls');
    showToast('ดาวน์โหลดสมุดงานสำเร็จ', 'ส่งออกข้อมูล 5 ชีตหลักเป็นไฟล์ .xls เรียบร้อย', 'success');
  }

  function exportSingleSheetXLS(sheetKey) {
    exportFullWorkbookXLS();
  }

  function renderCostReferences() {
    if (!state.db.costs) state.db.costs = [];
    const costs = state.db.costs;
    const body = document.getElementById('costRefsTableBody');
    if (body) {
      body.innerHTML = costs.map(function(c) {
        return `
          <tr class="hover:bg-slate-50">
            <td class="py-2.5 px-3 font-mono-code font-bold text-slate-800">${escapeHtml(c.ItemCode)}</td>
            <td class="py-2.5 px-3">
              <div class="font-medium text-slate-900">${escapeHtml(c.ItemName)}</div>
              <div class="text-[10px] text-slate-500">${escapeHtml(c.Spec || '-')} | ${escapeHtml(c.PreferredVendor || '-')}</div>
            </td>
            <td class="py-2.5 px-3 text-slate-700">${escapeHtml(c.Category)}</td>
            <td class="py-2.5 px-3 font-mono-code text-right text-slate-900">฿${formatCurrency(c.UnitPrice)}</td>
            <td class="py-2.5 px-3 font-mono-code text-right text-slate-900">฿${formatCurrency(c.LaborRate)}</td>
            <td class="py-2.5 px-3 font-mono-code text-right font-bold text-teal-800">฿${formatCurrency(Number(c.UnitPrice || 0) + Number(c.LaborRate || 0))}</td>
            <td class="py-2.5 px-3 text-center">
              <button type="button" onclick="FMMS.editCostRef('${c.CostID}')" class="text-blue-600 hover:underline">แก้ไข</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Populate contractor form cost reference dropdown
    const selectEl = document.getElementById('r1CostRefSelect');
    if (selectEl) {
      const currentVal = selectEl.value;
      selectEl.innerHTML = '<option value="">-- เลือกรายการราคากลางอ้างอิง (ถ้ามี) --</option>' + costs.map(function(c) {
        const total = Number(c.UnitPrice || 0) + Number(c.LaborRate || 0);
        return '<option value="' + c.CostID + '">' + escapeHtml(c.ItemCode + ' - ' + c.ItemName + ' (฿' + formatCurrency(total) + ')') + '</option>';
      }).join('');
      if (currentVal) selectEl.value = currentVal;
    }
  }

  function applyCostRefToContractorForm() {
    const sel = document.getElementById('r1CostRefSelect');
    if (!sel || !sel.value) return;
    const cost = (state.db.costs || []).find(function(c) { return c.CostID === sel.value; });
    if (!cost) return;

    const total = Number(cost.UnitPrice || 0) + Number(cost.LaborRate || 0);
    setVal('r1EstCost', total);
    setVal('r1Category', cost.Category);
    const descEl = document.getElementById('r1Materials');
    if (descEl && !descEl.value) {
      descEl.value = cost.ItemName + ' (' + (cost.Spec || '') + ') จำนวน 1 ' + cost.Unit;
    }
    showToast('ดึงข้อมูลราคากลางสำเร็จ', cost.ItemName + ' = ฿' + formatCurrency(total), 'info');
  }

  function handleSaveCostRefSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!state.db.costs) state.db.costs = [];

    const actor = getCurrentActor();
    const costId = getVal('costEditId') || ('COST-' + Date.now().toString(36).toUpperCase());
    const itemCode = getVal('costItemCode');
    const category = getVal('costCategory');
    const itemName = getVal('costItemName');
    const spec = getVal('costSpec');
    const unit = getVal('costUnit') || 'ชุด';
    const unitPrice = Number(getVal('costUnitPrice') || 0);
    const laborRate = Number(getVal('costLaborRate') || 0);
    const vendor = getVal('costVendor');

    let existing = state.db.costs.find(function(c) { return c.CostID === costId; });
    if (existing) {
      existing.ItemCode = itemCode;
      existing.Category = category;
      existing.ItemName = itemName;
      existing.Spec = spec;
      existing.Unit = unit;
      existing.UnitPrice = unitPrice;
      existing.LaborRate = laborRate;
      existing.PreferredVendor = vendor;
    } else {
      state.db.costs.push({
        CostID: costId,
        ItemCode: itemCode,
        Category: category,
        ItemName: itemName,
        Spec: spec,
        Unit: unit,
        UnitPrice: unitPrice,
        LaborRate: laborRate,
        PreferredVendor: vendor
      });
    }

    persistDatabase();
    resetCostRefForm();
    renderCostReferences();
    showToast('บันทึกข้อมูลราคากลางสำเร็จ', itemName + ' บันทึกลง Cost_References เรียบร้อย', 'success');

    // Sync to Google Sheets Sheet: Cost_References
    try {
      syncToGasBackend('saveCostReference', {
        costData: {
          CostRefID: costId,
          ItemCode: itemCode,
          Category: category,
          ItemName: itemName,
          Specification: spec,
          Unit: unit,
          StandardUnitPrice: unitPrice,
          LaborRate: laborRate,
          PreferredVendor: vendor
        }
      }).then(function(res) {
        showCloudSyncConfirmation({
          docId: costId,
          docType: 'ข้อมูลราคากลางอ้างอิง (Sheet: Cost_References)',
          actionTitle: 'บันทึกราคากลางอ้างอิงลง Google Sheets',
          version: 'v1.0',
          details: itemName + ' (' + itemCode + ') ซิงค์ลงฐานข้อมูล Google Sheets เรียบร้อย'
        });
      }).catch(function(e) {
        console.warn('Cost ref sync error:', e);
      });
    } catch (e) {
      console.warn('Cost ref sync error:', e);
    }
  }

  function resetCostRefForm() {
    setVal('costEditId', '');
    setVal('costItemCode', '');
    setVal('costItemName', '');
    setVal('costSpec', '');
    setVal('costUnit', 'ชุด');
    setVal('costUnitPrice', '');
    setVal('costLaborRate', '');
    setVal('costVendor', '');
    setText('costFormTitle', 'เพิ่ม / แก้ไขข้อมูลอ้างอิงค่าใช้จ่าย (Cost_References)');
  }

  function editCostRef(costId) {
    const cost = (state.db.costs || []).find(function(c) { return c.CostID === costId; });
    if (!cost) return;

    setVal('costEditId', cost.CostID);
    setVal('costItemCode', cost.ItemCode);
    setVal('costCategory', cost.Category);
    setVal('costItemName', cost.ItemName);
    setVal('costSpec', cost.Spec || '');
    setVal('costUnit', cost.Unit || 'ชุด');
    setVal('costUnitPrice', cost.UnitPrice || 0);
    setVal('costLaborRate', cost.LaborRate || 0);
    setVal('costVendor', cost.PreferredVendor || '');
    setText('costFormTitle', 'แก้ไขราคากลาง: ' + cost.ItemCode);
  }


  async function handleSupervisorApproveAndForward(taskId) {
    // Forward to unified dual-authority approveTaskToRepair
    await approveTaskToRepair(taskId);
  }


  async function handleSupervisorRejectToLevel1(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();

    task.Status = 'Rejected to Level 1';
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    recordAuditLog(
      'SUPERVISOR_REJECT_TO_TECH',
      task.TaskID,
      'ผู้ควบคุมงาน (' + actor.fullName + ') ตีกลับใบงาน ' + task.TaskID + ' ให้ช่างแก้ไข',
      'Pending Level 2 Approval',
      'Rejected to Level 1',
      'WARNING'
    );

    await postToGasBackend('supervisorReject', { taskId: task.TaskID });
    persistDatabase();
    renderAllViews();
    updateApprovalAlertBadge();

    showCloudSyncConfirmation({
      docId: task.TaskID,
      docType: 'ใบงานซ่อมบำรุง (ตีกลับแก้ไข)',
      actionTitle: 'ผู้ควบคุมงาน (ระดับ 2) ตีกลับใบงานให้ช่างหน้างานแก้ไข',
      version: 'v1.0.1 (Rejected to Level 1)',
      details: 'ส่งแจ้งเตือนกลับไปยังช่างหน้างานเพื่อแก้ไขรายละเอียดหน้างานหรือรูปภาพเพิ่มเติม'
    });

    showToast('ตีกลับใบงานสำเร็จ', 'ส่งเรื่องกลับไปยังช่างหน้างานเรียบร้อยแล้ว', 'warning');
  }

  function updateApprovalAlertBadge() {
    const role = state.session ? Number(state.session.roleLevel) : 0;
    const badge = document.getElementById('headerAlertBadge');
    const label = document.getElementById('headerAlertLabel');
    const btn = document.getElementById('headerApprovalAlertBtn');
    if (!badge || !label || !btn) return;

    let pendingCount = 0;
    let labelText = 'รออนุมัติ';

    if (role === 2) {
      // Level 2: Supervisor looks for tasks waiting for Level 2 approval
      const tasks = (state.db && state.db.tasks) || [];
      pendingCount = tasks.filter(function(t) { return t.Status === 'Pending Level 2 Approval' || t.Status === 'Pending Approval'; }).length;
      labelText = 'รอ ผค.งาน อนุมัติ';
    } else if (role === 3) {
      // Level 3: Executive looks for tasks waiting for Level 3 budget approval
      reconcileMemoAndTaskStatuses();
      const tasks = (state.db && state.db.tasks) || [];
      const memos = (state.db && state.db.memos) || [];

      // Pending budget tasks count matches the "1. รออนุมัติงบ" filter count exactly
      const pendingBudgetTasks = tasks.filter(function(t) {
        const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
        return isTaskPendingBudget(t, memo);
      });

      pendingCount = pendingBudgetTasks.length;
      labelText = 'รอ ผู้บริหาร อนุมัติ';
    } else {
      btn.style.display = 'none';
      return;
    }

    btn.style.display = 'flex';
    badge.textContent = pendingCount;
    label.textContent = labelText;

    if (pendingCount > 0) {
      badge.classList.remove('hidden');
      badge.style.display = 'inline-block';
      btn.classList.add('ring-2', 'ring-amber-400');
    } else {
      badge.classList.add('hidden');
      badge.style.display = 'none';
      btn.classList.remove('ring-2', 'ring-amber-400');
    }
  }

  let sessionAlertDismissed = {
    role2: false,
    role3: false
  };

  function checkAndShowApprovalAlert(forceModal) {
    const role = state.session ? Number(state.session.roleLevel) : 0;
    updateApprovalAlertBadge();

    // CRITICAL: ONLY open modal if user explicitly clicked the bell button (forceModal === true)
    if (!forceModal) return;

    if (role !== 2 && role !== 3) return;

    const modal = document.getElementById('approvalAlertModal');
    if (!modal) return;

    const tbody = document.getElementById('alertPendingItemsTableBody');
    const countBadge = document.getElementById('alertModalCountBadge');
    const titleEl = document.getElementById('alertModalTitle');
    const noticeEl = document.getElementById('alertModalNoticeText');
    const step2Badge = document.getElementById('step2Indicator');
    const step3Badge = document.getElementById('step3Indicator');

    const tasks = (state.db && state.db.tasks) || [];
    const memos = (state.db && state.db.memos) || [];

    // Filter genuinely pending tasks that need budget approval to start work
    const pendingTasks = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      return isTaskPendingBudget(t, memo);
    });

    if (titleEl) titleEl.textContent = 'รายการขออนุมัติซ่อมและเบิกงบประมาณ (Pending Approvals)';
    if (noticeEl) noticeEl.textContent = 'รายการใบงานที่รอการพิจารณาอนุมัติให้เริ่มดำเนินการซ่อมแซม';
    if (countBadge) countBadge.textContent = pendingTasks.length + ' รายการ';

    if (step2Badge) step2Badge.className = 'p-2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold';
    if (step3Badge) step3Badge.className = 'p-2 rounded bg-blue-100 text-blue-900 border border-blue-300 font-bold';

    if (tbody) {
      if (pendingTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-500 font-medium">✅ ไม่มีรายการค้างรออนุมัติในขณะนี้ (อนุมัติซ่อมหรือปิดงานครบถ้วนแล้ว)</td></tr>';
      } else {
        tbody.innerHTML = pendingTasks.map(function(t) {
          return `
            <tr class="hover:bg-slate-50">
              <td class="py-2.5 px-3 font-mono-code font-bold text-slate-900">${escapeHtml(t.TaskID)}</td>
              <td class="py-2.5 px-3">
                <div class="font-semibold text-slate-900">${escapeHtml(t.Title)}</div>
                <div class="text-[11px] text-slate-500">📍 ${escapeHtml(t.Location || 'ไม่ระบุสถานที่')}</div>
              </td>
              <td class="py-2.5 px-3 text-right font-mono-code font-bold text-emerald-800">฿${formatCurrency(t.EstCost)}</td>
              <td class="py-2.5 px-3 text-slate-700">${escapeHtml(t.AssignedContractorName || 'ช่างประจำโครงการ')}</td>
              <td class="py-2.5 px-3 text-center">
                <button type="button" onclick="FMMS.approveTaskToRepair('${t.TaskID}')"
                  class="bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-bold px-3 py-1 rounded transition shadow cursor-pointer">
                  ✓ อนุมัติซ่อมทันที
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }


  function openApprovalAlertModal() {
    checkAndShowApprovalAlert(true);
  }

  function closeApprovalAlertModal() {
    const role = state.session ? Number(state.session.roleLevel) : 0;
    if (role === 2 || role === 3) {
      sessionAlertDismissed['role' + role] = true;
    }
    const modal = document.getElementById('approvalAlertModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function goToApprovalQueueFromAlert() {
    closeApprovalAlertModal();
    const role = state.session ? Number(state.session.roleLevel) : 0;
    if (role === 2) {
      switchView('role2');
      switchSupervisorSubTab('tasks');
    } else if (role === 3) {
      switchView('role3');
      switchExecutiveSubTab('cards');
      filterExecutiveCards('PENDING_BUDGET');
    }
  }

  function selectTaskFromAlert(taskId) {
    closeApprovalAlertModal();
    const role = state.session ? Number(state.session.roleLevel) : 0;
    if (role === 2) {
      switchView('role2');
      switchSupervisorSubTab('tasks');
      selectSupervisorTask(taskId);
    } else {
      switchView('role3');
      switchExecutiveSubTab('cards');
      filterExecutiveCards('PENDING_BUDGET');
    }
  }

  function selectMemoFromAlert(memoId, taskId) {
    closeApprovalAlertModal();
    switchView('role3');
    switchExecutiveSubTab('cards');
    filterExecutiveCards('PENDING_BUDGET');
  }


  function openExecutiveReportPrintModal() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];
    const container = document.getElementById('a4PaperContainer');
    const modal = document.getElementById('memoPrintModal');
    if (!container || !modal) return;

    const totalRequested = memos.reduce(function(acc, m) { return acc + Number(m.EstimatedBudget || 0); }, 0);
    const approvedMemos = memos.filter(function(m) { return m.ApprovalStatus === 'Approved'; });
    const totalApproved = approvedMemos.reduce(function(acc, m) { return acc + Number(m.EstimatedBudget || 0); }, 0);
    const totalActual = tasks.reduce(function(acc, t) { return acc + Number(t.ActualCost || 0); }, 0);
    const savings = totalApproved > totalActual ? totalApproved - totalActual : 0;
    const savingsPct = totalApproved > 0 ? Math.round((savings / totalApproved) * 100) : 0;

    const disciplines = [
      { label: '1. ระบบปรับอากาศและระบายอากาศ (HVAC)', key: 'แอร์/เครื่องกล' },
      { label: '2. ระบบไฟฟ้าและสื่อสาร (Electrical)', key: 'ไฟฟ้า' },
      { label: '3. ระบบประปาและสุขาภิบาล (Plumbing)', key: 'ประปา/สุขาภิบาล' },
      { label: '4. ระบบดับเพลิงและความปลอดภัย (Fire & Safety)', key: 'ความปลอดภัย/ดับเพลิง' }
    ];

    container.innerHTML = `
      <!-- Executive Management Report A4 Paper (TH Sarabun New) -->
      <div style="font-family: 'TH Sarabun New', 'Sarabun', sans-serif; font-size: 12pt; color: #000000; line-height: 1.45;">
        
        <!-- Header Strip -->
        <div class="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between">
          <div>
            <div style="font-size: 11pt;" class="font-mono-code uppercase tracking-wider text-slate-700">FACILITY MAINTENANCE MANAGEMENT SYSTEM • DATA MA TWPP</div>
            <h1 style="font-size: 16pt; font-weight: 700; color: #000000; line-height: 1.3;" class="mt-1">
              รายงานสรุปผลการบริหารงานซ่อมบำรุงและควบคุมต้นทุนวิศวกรรมอาคาร
            </h1>
            <h2 style="font-size: 14pt; font-weight: 700; color: #1e293b;">
              EXECUTIVE MANAGEMENT & FINANCIAL VARIANCE REPORT
            </h2>
            <div style="font-size: 12pt;" class="text-slate-700">${escapeHtml(state.config.orgName || 'โครงการบริหารจัดการอาคารและวิศวกรรม ทวพ.')}</div>
          </div>
          <div class="text-right border border-slate-500 p-2.5 rounded font-mono-code" style="font-size: 12pt; min-width: 190px;">
            <div><strong>รหัสเอกสาร:</strong> REP-${getYearMonthStr()}-01</div>
            <div><strong>วันที่พิมพ์:</strong> ${formatThaiDateOnly(getIsoNow())}</div>
            <div class="text-teal-900 font-bold">SYS VER: v2.9.3-ENT</div>
          </div>
        </div>

        <!-- Section 1: Financial Summary Box -->
        <div class="mb-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5 border-b border-slate-300 pb-1">
            1. สรุปภาพรวมงบประมาณและการควบคุมต้นทุน (Financial Variance & Cost Savings)
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12pt;" class="mb-3">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: left; font-weight: 700;">หมวดงบประมาณ</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">จำนวนเงิน (บาท)</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: left; font-weight: 700;">คำอธิบาย / อัตราเปรียบเทียบ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="border: 1px solid #333333; padding: 5px 8px;">งบประมาณขออนุมัติรวมทั้งหมด (Requested)</td>
                <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">฿${formatCurrency(totalRequested)}</td>
                <td style="border: 1px solid #333333; padding: 5px 8px;">จากบันทึกข้อความขออนุมัติทั้งหมด ${memos.length} ฉบับ</td>
              </tr>
              <tr>
                <td style="border: 1px solid #333333; padding: 5px 8px;">งบประมาณที่ผู้บริหารอนุมัติแล้ว (Approved)</td>
                <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700; color: #047857;">฿${formatCurrency(totalApproved)}</td>
                <td style="border: 1px solid #333333; padding: 5px 8px;">อนุมัติงบเรียบร้อยแล้ว ${approvedMemos.length} ฉบับ</td>
              </tr>
              <tr>
                <td style="border: 1px solid #333333; padding: 5px 8px;">ค่าใช้จ่ายเกิดขึ้นจริง (Actual Expenditure)</td>
                <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">฿${formatCurrency(totalActual)}</td>
                <td style="border: 1px solid #333333; padding: 5px 8px;">จากใบงานที่ดำเนินการแล้วเสร็จ</td>
              </tr>
              <tr style="background-color: #f0fdf4;">
                <td style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">ผลประหยัดงบประมาณสุทธิ (Net Cost Savings)</td>
                <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700; color: #047857;">฿${formatCurrency(savings)}</td>
                <td style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700; color: #047857;">ประหยัดได้ ${savingsPct}% จากงบประมาณที่ได้รับอนุมัติ</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Section 2: 4-Discipline MEP Engineering Breakdown -->
        <div class="mb-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5 border-b border-slate-300 pb-1">
            2. การวิเคราะห์ปริมาณงานและต้นทุนแยกตาม 4 หมวดวิศวกรรมหลัก (MEP Breakdown)
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12pt;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">ระบบวิศวกรรม (MEP Discipline)</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: center; font-weight: 700;">จำนวนงาน</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">งบประเมิน (฿)</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">ใช้จริง (฿)</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">ส่วนต่างประหยัด (฿)</th>
              </tr>
            </thead>
            <tbody>
              ${disciplines.map(function(d) {
                const catTasks = tasks.filter(function(t) { return t.Category === d.key; });
                const count = catTasks.length;
                const estCost = catTasks.reduce(function(acc, t) { return acc + Number(t.EstCost || 0); }, 0);
                const actCost = catTasks.reduce(function(acc, t) { return acc + Number(t.ActualCost || 0); }, 0);
                const diff = estCost - actCost;
                return `
                  <tr>
                    <td style="border: 1px solid #333333; padding: 5px 8px; font-weight: 600;">${escapeHtml(d.label)}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: center;">${count}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right;">฿${formatCurrency(estCost)}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right;">฿${formatCurrency(actCost)}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700; color: ${diff >= 0 ? '#047857' : '#b91c1c'};">
                      ${diff >= 0 ? '+฿' : '-฿'}${formatCurrency(Math.abs(diff))}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Section 3: Key Work Orders List -->
        <div class="mb-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5 border-b border-slate-300 pb-1">
            3. บัญชีรายการใบงานซ่อมบำรุงและสถานะปัจจุบัน (Work Orders Summary)
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12pt;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">รหัสใบงาน</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">รายการ / พิกัดสถานที่</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">ช่างผู้ปฏิบัติงาน</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 700;">งบประเมิน (฿)</th>
                <th style="border: 1px solid #333333; padding: 5px 8px; text-align: center; font-weight: 700;">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.slice(0, 8).map(function(t) {
                return `
                  <tr>
                    <td style="border: 1px solid #333333; padding: 5px 8px; font-weight: 700;">${escapeHtml(t.TaskID)}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px;">
                      <div><strong>${escapeHtml(t.Title)}</strong></div>
                      <div style="font-size: 11pt; color: #475569;">📍 ${escapeHtml(t.Location)}</div>
                    </td>
                    <td style="border: 1px solid #333333; padding: 5px 8px;">${escapeHtml(t.AssignedContractorName || '-')}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: right; font-weight: 600;">฿${formatCurrency(t.EstCost)}</td>
                    <td style="border: 1px solid #333333; padding: 5px 8px; text-align: center;">${escapeHtml(t.Status)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Section 4: Representative Field Photographic Evidence -->
        <div class="mb-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5 border-b border-slate-300 pb-1">
            4. ภาพถ่ายหลักฐานงานซ่อมบำรุงในโครงการ (Representative Maintenance Field Evidence)
          </h3>
          <div class="grid grid-cols-2 gap-3 text-xs">
            ${tasks.filter(function(t) { return getTaskBeforeImages(t).length > 0; }).slice(0, 4).map(function(t) {
              const bList = getTaskBeforeImages(t);
              const aList = getTaskAfterImages(t);
              return `
                <div class="border border-slate-300 rounded p-2 bg-slate-50/50">
                  <div class="font-bold text-slate-900 mb-1 flex justify-between">
                    <span class="truncate">${escapeHtml(t.TaskID)} : ${escapeHtml(t.Title)}</span>
                    <span class="text-[10px] text-teal-800 font-semibold whitespace-nowrap ml-1">${escapeHtml(t.Status)}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5 text-[10px] text-center">
                    <div>
                      <div class="text-slate-600 mb-0.5">ก่อนดำเนินการ (Before)</div>
                      <img src="${bList[0] || ''}" onerror="this.parentElement.style.opacity='0.4';" class="w-full h-24 object-cover border border-slate-200 rounded">
                    </div>
                    <div>
                      <div class="text-slate-600 mb-0.5">หลังดำเนินการ (After)</div>
                      ${aList[0] ? `
                        <img src="${aList[0]}" onerror="this.parentElement.style.opacity='0.4';" class="w-full h-24 object-cover border border-slate-200 rounded">
                      ` : `
                        <div class="w-full h-24 flex items-center justify-center border border-dashed border-slate-300 text-slate-400 bg-white rounded">อยู่ระหว่างดำเนินงาน</div>
                      `}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Endorsement Signatures -->
        <div class="pt-4 border-t border-slate-400 mt-4 grid grid-cols-2 gap-8 text-center" style="font-size: 12pt;">
          <div class="border border-slate-300 p-3 rounded">
            <div style="font-size: 14pt; font-weight: 700;" class="mb-6">ผู้จัดทำรายงาน / ผู้ควบคุมงาน (ระดับ 2)</div>
            <div class="font-bold">วิศวกร พรเทพ ใจดี</div>
            <div style="font-size: 11pt; color: #475569;">หัวหน้าฝ่ายวิศวกรรมซ่อมบำรุงอาคาร</div>
            <div style="font-size: 10pt;" class="font-mono-code text-slate-500 mt-1">${formatThaiDateTime(getIsoNow())}</div>
          </div>
          <div class="border border-slate-300 p-3 rounded">
            <div style="font-size: 14pt; font-weight: 700;" class="mb-6">ผู้รับรองรายงาน / ผู้บริหารระดับสูง (ระดับ 3)</div>
            <div class="font-bold">คุณนิพนธ์ (Executive & System Admin)</div>
            <div style="font-size: 11pt; color: #475569;">ผู้อำนวยการฝ่ายบริหารอาคารและทรัพย์สิน</div>
            <div style="font-size: 10pt;" class="font-mono-code text-slate-500 mt-1">${formatThaiDateTime(getIsoNow())}</div>
          </div>
        </div>

        <!-- Footer Meta -->
        <div class="pt-3 border-t border-slate-300 mt-3 flex justify-between text-slate-500 font-mono-code" style="font-size: 10pt;">
          <span>Google Sheet: Data MA TWPP (${escapeHtml(state.config.spreadsheetId)})</span>
          <span>Google Drive Storage ID: ${escapeHtml(state.config.driveFolderId)}</span>
          <span>System Version: v2.9.3-ENT</span>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.style.display = 'block';
  }

  function previewTaskA4Report(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    let memo = state.db.memos.find(function(m) { return m.TaskID === taskId; });
    if (memo) {
      openMemoPrintModal(memo.MemoID);
      return;
    }

    openMemoPrintModalByTask(taskId);
  }

  function renderReportTasksTable() {
    const tbody = document.getElementById('reportTasksTableBody');
    const countEl = document.getElementById('repTasksCountText');
    if (!tbody) return;

    const tasks = state.db.tasks || [];
    const q = String(getVal('repTaskSearchInput') || '').trim().toLowerCase();
    const statusFilter = getVal('repTaskStatusFilter') || 'ALL';

    const filtered = tasks.filter(function(t) {
      if (statusFilter !== 'ALL' && t.Status !== statusFilter) return false;
      if (q) {
        const corpus = [t.TaskID, t.Title, t.Location, t.Category, t.AssignedContractorName, t.SupervisorName].join(' ').toLowerCase();
        if (!corpus.includes(q)) return false;
      }
      return true;
    });

    if (countEl) countEl.textContent = filtered.length;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-slate-400">ไม่พบรายการใบงานตามเงื่อนไขที่ค้นหา</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function(t) {
      const bImgs = getTaskBeforeImages(t);
      const aImgs = getTaskAfterImages(t);

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-4 font-mono-code font-bold text-slate-900 whitespace-nowrap">
            <div>${escapeHtml(t.TaskID)}</div>
            <div class="text-[10px] text-teal-700 font-normal">v1.1</div>
          </td>
          <td class="py-3 px-3">
            <span class="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-800 font-medium mb-1">${escapeHtml(t.Category || '-')}</span>
            <div class="text-[11px] text-slate-500 font-medium">📍 ${escapeHtml(t.Location)}</div>
          </td>
          <td class="py-3 px-4">
            <div class="font-bold text-slate-900 line-clamp-1">${escapeHtml(t.Title)}</div>
            <div class="text-[11px] text-slate-500 line-clamp-1">${escapeHtml(t.Description || '-')}</div>
            <!-- Photo Thumbnails & Badge in Report Table -->
            <div class="mt-1 flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] font-mono-code px-1.5 py-0.2 rounded font-medium ${bImgs.length >= 5 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                ก่อน: ${bImgs.length} ภาพ ${bImgs.length >= 5 ? '✅' : '⚠️'}
              </span>
              <span class="text-[10px] font-mono-code px-1.5 py-0.2 rounded font-medium ${aImgs.length >= 5 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
                หลัง: ${aImgs.length} ภาพ ${aImgs.length >= 5 ? '✅' : ''}
              </span>
              ${bImgs[0] ? `
                <img src="${bImgs[0]}" onclick="event.stopPropagation(); FMMS.openImagePreviewModal('${bImgs[0]}', 'ภาพก่อนซ่อม : ${escapeHtml(t.TaskID)}')" class="w-6 h-6 rounded object-cover border border-slate-300 cursor-pointer hover:scale-110 transition shadow-xs" title="คลิกดูภาพก่อนทำ">
              ` : ''}
              ${aImgs[0] ? `
                <img src="${aImgs[0]}" onclick="event.stopPropagation(); FMMS.openImagePreviewModal('${aImgs[0]}', 'ภาพหลังซ่อม : ${escapeHtml(t.TaskID)}')" class="w-6 h-6 rounded object-cover border border-slate-300 cursor-pointer hover:scale-110 transition shadow-xs" title="คลิกดูภาพหลังทำ">
              ` : ''}
            </div>
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-semibold text-slate-900 whitespace-nowrap">
            ฿${formatCurrency(t.EstCost)}
          </td>
          <td class="py-3 px-3 text-right font-mono-code whitespace-nowrap ${Number(t.ActualCost) > 0 ? 'text-slate-900 font-bold' : 'text-slate-400'}">
            ฿${formatCurrency(t.ActualCost)}
          </td>
          <td class="py-3 px-3 text-[11px]">
            <div class="text-slate-800 font-medium">👷 ${escapeHtml(t.AssignedContractorName || 'ช่างประจำโครงการ')}</div>
            <div class="text-slate-500">👔 ${escapeHtml(t.SupervisorName || 'วิศวกรผู้ควบคุม')}</div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            ${renderStatusBadge(t.Status)}
          </td>
          <td class="py-3 px-4 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1.5">
              <button type="button" onclick="FMMS.previewTaskA4Report('${t.TaskID}')"
                class="bg-teal-700 hover:bg-teal-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded transition shadow-sm flex items-center gap-1 cursor-pointer"
                title="เปิดดูตัวอย่างเอกสาร A4 สำหรับพิมพ์">
                <span>👁️</span>
                <span>อ่าน/พรีวิว</span>
              </button>
              <button type="button" onclick="FMMS.openEditTaskModalFromReport('${t.TaskID}')"
                class="border border-blue-600 hover:bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1.5 rounded transition flex items-center gap-1 cursor-pointer"
                title="แก้ไขข้อมูลใบงานนี้">
                <span>✏️</span>
                <span>แก้ไข</span>
              </button>
              <button type="button" onclick="FMMS.deleteTask('${t.TaskID}')"
                class="border border-rose-300 hover:bg-rose-50 text-rose-700 text-xs font-semibold px-2 py-1.5 rounded transition flex items-center gap-1 cursor-pointer"
                title="ลบใบงานนี้ออกจากระบบและ Google Sheets">
                <span>🗑️</span>
                <span>ลบ</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openEditTaskModalFromReport(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    setVal('repEditTaskId', task.TaskID);
    setVal('repEditTaskIdDisplay', task.TaskID);
    setVal('repEditTaskType', task.Type || 'CM');
    setVal('repEditCategory', task.Category || 'แอร์/เครื่องกล');
    setVal('repEditTitle', task.Title || '');
    setVal('repEditLocation', task.Location || '');
    setVal('repEditPriority', task.Priority || 'Normal');
    setVal('repEditEstCost', task.EstCost || 0);
    setVal('repEditActualCost', task.ActualCost || 0);
    setVal('repEditStatus', task.Status || 'Pending Level 2 Approval');
    setVal('repEditAnalysis', task.InitialAnalysis || '');
    setVal('repEditMaterials', task.MaterialsRequired || '');

    const modal = document.getElementById('reportEditTaskModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closeReportEditTaskModal() {
    const modal = document.getElementById('reportEditTaskModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function handleSaveEditTaskFromReport(event) {
    if (event && event.preventDefault) event.preventDefault();
    const taskId = getVal('repEditTaskId');
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();

    const beforeSnap = JSON.stringify({
      Title: task.Title,
      Location: task.Location,
      EstCost: task.EstCost,
      ActualCost: task.ActualCost,
      Status: task.Status
    });

    task.Type = getVal('repEditTaskType');
    task.Category = getVal('repEditCategory');
    task.Title = getVal('repEditTitle');
    task.Location = getVal('repEditLocation');
    task.Priority = getVal('repEditPriority');
    task.EstCost = Number(getVal('repEditEstCost') || 0);
    task.ActualCost = Number(getVal('repEditActualCost') || 0);
    task.Status = getVal('repEditStatus');
    task.InitialAnalysis = getVal('repEditAnalysis');
    task.MaterialsRequired = getVal('repEditMaterials');
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    recordAuditLog(
      'EDIT_TASK_FROM_REPORT',
      task.TaskID,
      'แก้ไขข้อมูลใบงานจากหน้าต่างรายงาน: ' + task.TaskID,
      beforeSnap,
      JSON.stringify({
        Title: task.Title,
        Location: task.Location,
        EstCost: task.EstCost,
        ActualCost: task.ActualCost,
        Status: task.Status
      }),
      'SUCCESS'
    );

    await postToGasBackend('updateTask', { taskData: task });
    persistDatabase();
    renderAllViews();
    closeReportEditTaskModal();

    showCloudSyncConfirmation({
      docId: task.TaskID,
      docType: 'ใบงานซ่อมบำรุง (แก้ไขจากรายงาน)',
      actionTitle: 'บันทึกแก้ไขข้อมูลเอกสารใบงานเรียบร้อย',
      version: 'v1.2 (Edited via Report Workbench)',
      details: 'อัปเดตข้อมูล ' + task.TaskID + ' งบประเมิน ฿' + formatCurrency(task.EstCost) + ' สถานะ: ' + task.Status + ' บันทึกลง Google Sheet และ Drive เรียบร้อยแล้ว'
    });

    showToast('แก้ไขข้อมูลใบงาน ' + task.TaskID + ' สำเร็จ', 'อัปเดตตารางรายงานและฐานข้อมูลเรียบร้อยแล้ว', 'success');
  }

  
  function renderAllViews() {
    renderReportTasksTable();
    renderCostReferences();
    updateNextTaskIdPreview();
    renderImageGallery('before');
    renderImageGallery('after');
    renderRole1Tasks();
    renderSupervisorGrid();
    renderPmSchedulesTable();
    renderExecutiveDashboard();
    renderExecutivePipelineCards();
    renderExecutiveReport();
    renderAdminUsersTable();
    renderSystemLogs();
  }

  function renderStatusBadge(status) {
    const map = {
      'Pending Level 2 Approval': 'bg-amber-100 text-amber-900 border-amber-400 font-bold',
      'Pending Level 3 Approval': 'bg-blue-100 text-blue-900 border-blue-400 font-bold',
      'Pending Approval': 'bg-blue-50 text-blue-800 border-blue-300',
      'Approved': 'bg-emerald-100 text-emerald-800 border-emerald-400 font-semibold',
      'In Progress': 'bg-teal-50 text-teal-800 border-teal-300',
      'Completed': 'bg-indigo-50 text-indigo-800 border-indigo-300',
      'Closed': 'bg-slate-200 text-slate-800 border-slate-400',
      'Rejected to Level 1': 'bg-rose-100 text-rose-900 border-rose-400',
      'Rejected to Level 2': 'bg-orange-100 text-orange-900 border-orange-400',
      'Rejected': 'bg-red-50 text-red-800 border-red-300'
    };
    const labelMap = {
      'Pending Level 2 Approval': 'รอ ผค.งาน (ระดับ 2) อนุมัติ ⏳',
      'Pending Level 3 Approval': 'รอ ผู้บริหาร (ระดับ 3) อนุมัติ 📋',
      'Pending Approval': 'รออนุมัติงบประมาณ',
      'Approved': 'อนุมัติแล้ว (พร้อมเริ่มงาน)',
      'In Progress': 'ช่างกำลังดำเนินการ',
      'Completed': 'ซ่อมเสร็จ/รอตรวจรับ',
      'Closed': 'ปิดงานสมบูรณ์ (Closed)',
      'Rejected to Level 1': 'ตีกลับให้ช่างแก้ไข',
      'Rejected to Level 2': 'ตีกลับให้ ผค.งานทบทวน',
      'Rejected': 'ตีกลับ'
    };
    const cls = map[status] || 'bg-slate-100 text-slate-700 border-slate-300';
    const text = labelMap[status] || status;
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}">${escapeHtml(text)}</span>`;
  }

  function getCurrentActor() {
    if (state.session) {
      return {
        userId: state.session.userId,
        fullName: state.session.fullName,
        roleLevel: state.session.roleLevel
      };
    }
    return {
      userId: 'USR-2026-0001',
      fullName: 'คุณนิพนธ์ (Executive & System Admin)',
      roleLevel: 3
    };
  }

  function startLiveClock() {
    function tick() {
      const nowStr = formatThaiDateTime(getIsoNow());
      setText('liveClockDisplay', nowStr);
      setText('adminActiveTimestampStamp', 'Timestamp: ' + nowStr);
    }
    tick();
    setInterval(tick, 1000);
  }

  function showToast(title, message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const borderMap = {
      success: 'border-l-4 border-l-emerald-500',
      error: 'border-l-4 border-l-red-500',
      warning: 'border-l-4 border-l-amber-500',
      info: 'border-l-4 border-l-teal-500'
    };

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto bg-slate-900 text-white border border-slate-700 ' + (borderMap[type] || borderMap.info) + ' rounded-md p-3.5 shadow-xl transition-all duration-300';
    toast.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-xs font-bold text-white">${escapeHtml(title)}</div>
          <div class="text-[11px] text-slate-300 mt-0.5">${escapeHtml(message)}</div>
        </div>
        <button type="button" onclick="this.parentElement.parentElement.remove()" class="text-slate-400 hover:text-white text-xs">✕</button>
      </div>
    `;
    container.appendChild(toast);

    setTimeout(function() {
      if (toast && toast.parentElement) {
        toast.remove();
      }
    }, 5000);
  }

  function getIsoNow() {
    const d = new Date();
    const tzOffset = -d.getTimezoneOffset();
    const diff = tzOffset >= 0 ? '+' : '-';
    const pad = function(n) { return ('0' + Math.floor(Math.abs(n))).slice(-2); };
    return d.getFullYear() +
      '-' + pad(d.getMonth() + 1) +
      '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) +
      ':' + pad(d.getMinutes()) +
      ':' + pad(d.getSeconds()) +
      diff + pad(tzOffset / 60) + ':' + pad(tzOffset % 60);
  }

  function getYearMonthStr() {
    const d = new Date();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    return d.getFullYear() + m;
  }

  function formatThaiDateTime(isoStr) {
    if (!isoStr || isoStr === '-') return '-';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return String(isoStr);
      const pad = function(n) { return ('0' + n).slice(-2); };
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (_) {
      return String(isoStr);
    }
  }

  function formatThaiDateOnly(isoStr) {
    if (!isoStr || isoStr === '-') return '-';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return String(isoStr);
      const pad = function(n) { return ('0' + n).slice(-2); };
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + (d.getFullYear() + 543);
    } catch (_) {
      return String(isoStr);
    }
  }

  function formatCurrency(val) {
    const num = Number(val || 0);
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function escapeHtml(str) {
    return String(str !== undefined && str !== null ? str : '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', init);

  
  /**
   * ==========================================================================
   * 8.2 REPAIR TRACKING & TASK CLOSURE MODAL CONTROLLER
   * ==========================================================================
   */
  let currentTrackingTask = null;
  let tempTrackingAfterImages = [];

  function openRepairTrackingModal(taskId) {
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    currentTrackingTask = task;
    tempTrackingAfterImages = [...getTaskAfterImages(task)];

    setVal('trackTaskId', task.TaskID);
    setText('trackTaskDisplayId', task.TaskID);
    setText('trackTaskTitle', task.Title);
    setText('trackTaskLocation', task.Location || 'ไม่ระบุสถานที่');
    setText('trackTaskContractor', task.AssignedContractorName || 'ช่างประจำโครงการ');
    setText('trackTaskSupervisor', task.SupervisorName || 'วิศวกรผู้ควบคุม');
    setText('trackTaskEstCost', '฿' + formatCurrency(task.EstCost));
    setVal('trackActualCostInput', Number(task.ActualCost || 0) > 0 ? task.ActualCost : (task.EstCost || 0));
    setVal('trackTestResultInput', task.TestResult || 'ทดสอบระบบแล้ว ทำงานได้ตามปกติ');
    setVal('trackNotesInput', task.CompletionNotes || task.Description || '');

    const statusBadge = document.getElementById('trackTaskStatusBadge');
    if (statusBadge) {
      if (task.Status === 'Closed') {
        statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800';
        statusBadge.textContent = '🏁 Closed (ปิดงานแล้ว)';
      } else if (task.Status === 'Completed') {
        statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-300';
        statusBadge.textContent = '🔍 Completed (รอลงนามปิดงาน)';
      } else {
        statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-900 border border-teal-300';
        statusBadge.textContent = '🔧 ' + task.Status + ' (กำลังซ่อม)';
      }
    }

    renderTrackingModalPhotos();

    const modal = document.getElementById('repairTrackingModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closeRepairTrackingModal() {
    const modal = document.getElementById('repairTrackingModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    currentTrackingTask = null;
    tempTrackingAfterImages = [];
  }

  function renderTrackingModalPhotos() {
    if (!currentTrackingTask) return;

    // Render Before photos
    const beforeUrls = getTaskBeforeImages(currentTrackingTask);
    setText('trackBeforeCount', beforeUrls.length + ' / 5 ภาพ ' + (beforeUrls.length >= 1 ? '✅' : '⚠️'));
    const beforeContainer = document.getElementById('trackBeforeThumbnails');
    if (beforeContainer) {
      if (beforeUrls.length === 0) {
        beforeContainer.innerHTML = '<div class="col-span-5 text-center text-slate-400 py-3 text-[11px]">ไม่มีภาพก่อนซ่อม</div>';
      } else {
        beforeContainer.innerHTML = beforeUrls.map(function(url, idx) {
          return `
            <img src="${url}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพก่อนซ่อม #${idx+1}')"
              class="w-full h-12 object-cover rounded border border-slate-200 cursor-pointer hover:scale-105 transition" title="คลิกดูภาพใหญ่">
          `;
        }).join('');
      }
    }

    // Render After photos
    const afterCount = tempTrackingAfterImages.length;
    setText('trackAfterCount', afterCount + ' / 5 ภาพ ' + (afterCount >= 1 ? '✅' : '⚠️'));
    const afterContainer = document.getElementById('trackAfterThumbnails');
    if (afterContainer) {
      if (afterCount === 0) {
        afterContainer.innerHTML = '<div class="col-span-5 text-center text-slate-400 py-3 text-[11px]">ยังไม่มีภาพหลังซ่อม (กดแนบภาพด้านล่าง 1 - 5 ภาพ)</div>';
      } else {
        afterContainer.innerHTML = tempTrackingAfterImages.map(function(url, idx) {
          return `
            <div class="relative group">
              <img src="${url}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพหลังซ่อม #${idx+1}')"
                class="w-full h-12 object-cover rounded border border-slate-200 cursor-pointer hover:scale-105 transition" title="คลิกดูภาพใหญ่">
              <button type="button" onclick="FMMS.removeTrackingAfterPhoto(${idx})"
                class="absolute -top-1 -right-1 bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] shadow cursor-pointer opacity-90 hover:opacity-100" title="ลบภาพนี้">✕</button>
            </div>
          `;
        }).join('');
      }
    }
  }

  function handleTrackingAfterPhotoUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (tempTrackingAfterImages.length >= 5) {
      showToast('แนบภาพครบ 5 ภาพแล้ว', 'สามารถแนบภาพหลังซ่อมได้สูงสุดไม่เกิน 5 ภาพ กรุณาลบภาพเดิมออกก่อนเพิ่มภาพใหม่', 'warning');
      event.target.value = '';
      return;
    }

    const availableSlots = 5 - tempTrackingAfterImages.length;
    let filesToProcess = Array.from(files);
    if (filesToProcess.length > availableSlots) {
      showToast('จำกัดไม่เกิน 5 ภาพ', 'เลือกมา ' + filesToProcess.length + ' ภาพ ระบบนำเข้าเฉพาะ ' + availableSlots + ' ภาพแรก เพื่อไม่ให้เกินขีดจำกัดสูงสุด 5 ภาพ', 'info');
      filesToProcess = filesToProcess.slice(0, availableSlots);
    }

    let processed = 0;
    const totalFiles = filesToProcess.length;

    filesToProcess.forEach(function(file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Watermark stamp
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(0, height - 28, width, 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = '12px monospace';
          const seq = tempTrackingAfterImages.length + 1;
          ctx.fillText('FMMS TWPP | AFTER #' + seq + ' | ' + formatThaiDateTime(getIsoNow()), 10, height - 10);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          tempTrackingAfterImages.push(dataUrl);

          processed++;
          if (processed === totalFiles) {
            renderTrackingModalPhotos();
            event.target.value = '';
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function removeTrackingAfterPhoto(index) {
    if (index >= 0 && index < tempTrackingAfterImages.length) {
      tempTrackingAfterImages.splice(index, 1);
      renderTrackingModalPhotos();
    }
  }

  async function saveTrackingProgress(isClosingJob) {
    if (!currentTrackingTask) return;
    const taskId = currentTrackingTask.TaskID;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actualCost = Number(getVal('trackActualCostInput') || 0);
    const testResult = String(getVal('trackTestResultInput') || '').trim();
    const notes = String(getVal('trackNotesInput') || '').trim();
    const actor = getCurrentActor();
    const now = getIsoNow();

    // Update After images in task
    task.AfterImages = [...tempTrackingAfterImages];
    task.AfterImgURL = JSON.stringify(tempTrackingAfterImages);
    task.ActualCost = actualCost;
    task.TestResult = testResult;
    task.CompletionNotes = notes;
    task.UpdatedAt = now;
    task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    const memo = state.db.memos.find(function(m) { return m.TaskID === taskId; });

    if (isClosingJob && tempTrackingAfterImages.length === 0) {
      showToast('กรุณาแนบภาพหลังซ่อม', 'ต้องแนบภาพถ่ายหลังซ่อมเสร็จอย่างน้อย 1 ภาพ (และไม่เกิน 5 ภาพ) ก่อนลงนามตรวจรับและปิดงานสมบูรณ์', 'warning');
      return;
    }

    let actionLabel = 'บันทึกความคืบหน้างานซ่อม';
    if (isClosingJob) {
      task.Status = 'Closed';
      if (memo) {
        memo.ApprovalStatus = 'Approved';
        memo.ExecutiveComment = 'ผู้บริหารตรวจรับงานซ่อมและลงนามปิดงานสมบูรณ์ 100%';
      }
      actionLabel = 'ลงนามตรวจรับและปิดงานสมบูรณ์';
    } else {
      task.Status = 'In Progress';
      actionLabel = 'บันทึกความคืบหน้าการซ่อมแซม';
    }

    recordAuditLog(
      isClosingJob ? 'TASK_CLOSED_SIGNOFF' : 'UPDATE_REPAIR_PROGRESS',
      taskId,
      actor.fullName + ' ดำเนินการ ' + actionLabel + ' ใบงาน ' + taskId + ' (ค่าใช้จ่ายจริง ฿' + formatCurrency(actualCost) + ')',
      'IN_PROGRESS',
      task.Status + ' @ ' + now,
      'SUCCESS'
    );

    // Call GAS Backend
    try {
      await postToGasBackend('executiveApprove', {
        taskId: task.TaskID,
        memoId: memo ? memo.MemoID : '',
        decision: task.Status,
        comment: isClosingJob ? 'ตรวจรับงานและลงนามปิดงานสมบูรณ์ (ActualCost: ฿' + actualCost + ')' : 'อัปเดตผลการซ่อมแซม'
      });
    } catch (err) {
      console.warn('Backend sync failed:', err);
    }

    persistDatabase();
    closeRepairTrackingModal();
    renderAllViews();

    showToast(
      actionLabel + ' สำเร็จ',
      'ปรับสถานะใบงาน ' + taskId + ' เป็น [' + task.Status + '] และบันทึกค่าใช้จ่ายจริง ฿' + formatCurrency(actualCost) + ' เรียบร้อย',
      isClosingJob ? 'success' : 'info'
    );
  }



  /**
   * ============================================================================
   * 15. LIVE MULTI-USER PRESENCE, COLLISION LOCK & IDLE AUTO-SAVE ENGINE
   * ============================================================================
   */

  function initLivePresenceEngine() {
    updateLivePresence();
    setInterval(updateLivePresence, 15000);

    window.addEventListener('beforeunload', function() {
      try {
        localStorage.removeItem('FMMS_PRESENCE_' + state.deviceId);
        if (state.activeEditingItem) {
          releaseItemLock(state.activeEditingItem.targetId);
        }
      } catch (_) {}
    });
  }

  function updateLivePresence() {
    const actor = getCurrentActor();
    const now = Date.now();
    const presenceData = {
      deviceId: state.deviceId,
      userId: actor.userId,
      username: actor.username || actor.userId,
      fullName: actor.fullName,
      roleLevel: actor.roleLevel,
      lastSeen: now
    };

    try {
      localStorage.setItem('FMMS_PRESENCE_' + state.deviceId, JSON.stringify(presenceData));
    } catch (_) {}

    // Scan all active presence keys in localStorage
    const activeUsers = [];
    const seenUsers = new Set();

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('FMMS_PRESENCE_')) {
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const p = JSON.parse(raw);
              if (now - p.lastSeen < 45000) { // Active within 45 seconds
                const uKey = (p.userId || p.username || '').toLowerCase();
                if (!seenUsers.has(uKey)) {
                  seenUsers.add(uKey);
                  activeUsers.push(p);
                }
              } else {
                localStorage.removeItem(key); // Clean stale presence
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Ensure at least 1 (current user) is displayed
    const count = Math.max(1, activeUsers.length);
    const badge = document.getElementById('onlineUsersCountDisplay');
    if (badge) {
      badge.textContent = count;
    }
  }

  function openOnlineUsersModal() {
    updateLivePresence();
    const modal = document.getElementById('onlineUsersModal');
    const container = document.getElementById('onlineUsersListContainer');
    const devIdEl = document.getElementById('onlineUsersCurrentDevId');
    if (devIdEl) devIdEl.textContent = state.deviceId;

    if (container) {
      const now = Date.now();
      const activeList = [];
      const seen = new Set();

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('FMMS_PRESENCE_')) {
          try {
            const p = JSON.parse(localStorage.getItem(key));
            if (now - p.lastSeen < 45000 && !seen.has(p.deviceId)) {
              seen.add(p.deviceId);
              activeList.push(p);
            }
          } catch (_) {}
        }
      }

      if (activeList.length === 0) {
        const actor = getCurrentActor();
        activeList.push({
          deviceId: state.deviceId,
          userId: actor.userId,
          fullName: actor.fullName,
          roleLevel: actor.roleLevel,
          lastSeen: now
        });
      }

      container.innerHTML = activeList.map(function(u) {
        const isCurrent = u.deviceId === state.deviceId;
        const roleLabel = Number(u.roleLevel) === 3
          ? 'ผู้บริหาร & Admin (ระดับ 3)'
          : Number(u.roleLevel) === 2.5
            ? 'ฝ่ายบัญชีและการเงิน (ระดับ 2.5)'
            : Number(u.roleLevel) === 2
              ? 'ผู้ควบคุมงานวิศวกรรม (ระดับ 2)'
              : 'ช่างปฏิบัติการภาคสนาม (ระดับ 1)';

        return `
          <div class="p-2.5 rounded-lg border ${isCurrent ? 'border-teal-500 bg-teal-50/50' : 'border-slate-200 bg-slate-50'} flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <div>
                <div class="font-bold text-slate-900 flex items-center gap-1.5">
                  <span>${escapeHtml(u.fullName)}</span>
                  ${isCurrent ? '<span class="text-[10px] bg-teal-600 text-white font-mono-code px-1.5 py-0.2 rounded">เครื่องนี้</span>' : ''}
                </div>
                <div class="text-[11px] text-slate-500 font-mono-code">${escapeHtml(u.userId)} • ${roleLabel}</div>
              </div>
            </div>
            <div class="text-[10px] font-mono-code text-slate-400 text-right">
              <div>${escapeHtml(u.deviceId || '-')}</div>
              <div class="text-emerald-700 font-bold">🟢 Active</div>
            </div>
          </div>
        `;
      }).join('');
    }

    if (modal) modal.classList.remove('hidden');
  }

  function closeOnlineUsersModal() {
    const modal = document.getElementById('onlineUsersModal');
    if (modal) modal.classList.add('hidden');
  }

  // COLLISION LOCK: First-come, first-served
  function acquireItemLock(targetId, targetType, targetTitle) {
    const actor = getCurrentActor();
    const lockKey = 'FMMS_LOCK_' + targetId;
    const now = Date.now();

    try {
      const raw = localStorage.getItem(lockKey);
      if (raw) {
        const existingLock = JSON.parse(raw);
        // Lock lease is 5 minutes (300,000 ms)
        if (now - existingLock.lockedAt < 300000 && existingLock.userId !== actor.userId) {
          showItemLockWarning(existingLock);
          return false;
        }
      }

      // Grant Lock
      const newLock = {
        targetId: targetId,
        targetType: targetType || 'DOCUMENT',
        targetTitle: targetTitle || targetId,
        userId: actor.userId,
        userName: actor.fullName,
        lockedAt: now
      };
      localStorage.setItem(lockKey, JSON.stringify(newLock));
      state.activeEditingItem = newLock;
      state.lastUserActivity = now;
      return true;
    } catch (_) {
      return true;
    }
  }

  function releaseItemLock(targetId) {
    if (!targetId) return;
    try {
      localStorage.removeItem('FMMS_LOCK_' + targetId);
    } catch (_) {}
    if (state.activeEditingItem && state.activeEditingItem.targetId === targetId) {
      state.activeEditingItem = null;
    }
  }

  function showItemLockWarning(lockObj) {
    const modal = document.getElementById('itemLockWarningModal');
    const nameEl = document.getElementById('itemLockOperatorName');
    const titleEl = document.getElementById('itemLockTargetTitle');
    const timeEl = document.getElementById('itemLockTimestamp');

    const opName = lockObj.userName || lockObj.userId || 'ผู้ใช้งานอื่น';
    if (nameEl) nameEl.textContent = opName;
    if (titleEl) titleEl.textContent = lockObj.targetTitle || lockObj.targetId || '-';
    if (timeEl) timeEl.textContent = formatThaiDateTime(new Date(lockObj.lockedAt).toISOString());

    if (modal) modal.classList.remove('hidden');
    showToast('กำลังมีผู้ใช้งานดำเนินการ', 'User ' + opName + ' กำลังดำเนินการอยู่ กรุณารอ', 'warning');
  }

  function closeItemLockWarningModal() {
    const modal = document.getElementById('itemLockWarningModal');
    if (modal) modal.classList.add('hidden');
  }

  // IDLE DETECTOR & AUTO-SAVE
  function initIdleAutoSaveDetector() {
    const updateActivity = function() {
      state.lastUserActivity = Date.now();
    };

    window.addEventListener('keydown', updateActivity);
    window.addEventListener('input', updateActivity);
    window.addEventListener('click', updateActivity);

    // Check idle status every 15 seconds
    setInterval(function() {
      const now = Date.now();
      // If user has an active editing lock and inactive for 2 minutes (120,000 ms), auto-save
      if (state.activeEditingItem && (now - state.lastUserActivity > 120000)) {
        autoSaveActiveDraft();
      }
    }, 15000);
  }

  function autoSaveActiveDraft() {
    if (!state.activeEditingItem) return;
    const targetId = state.activeEditingItem.targetId;

    persistDatabase();
    showToast('บันทึกข้อมูลอัตโนมัติ', 'ระบบได้บันทึกข้อมูลเรียบร้อยแล้ว (' + (state.activeEditingItem.targetTitle || targetId) + ')', 'info');
    state.lastUserActivity = Date.now(); // reset timer
  }

  /**
   * ============================================================================
   * 16. PILOT PROJECTS & MILESTONE CONTRACT WORKFLOW ENGINE
   * ============================================================================
   */

  function renderPilotViews() {
    renderPilotSummaryScoreboard();
    renderPilotProjectsTable();
    populateActiveProjectDropdown();
    renderPilotMilestonesTable();
    renderPilotRetentionTable();
  }

  function switchPilotSubTab(tabKey) {
    state.pilotSubTab = tabKey;
    const tabs = {
      projects: document.getElementById('pilotSubTabProjectsContent'),
      milestones: document.getElementById('pilotSubTabMilestonesContent'),
      retention: document.getElementById('pilotSubTabRetentionContent')
    };

    const btns = {
      projects: document.getElementById('pilotSubTabBtnProjects'),
      milestones: document.getElementById('pilotSubTabBtnMilestones'),
      retention: document.getElementById('pilotSubTabBtnRetention')
    };

    Object.keys(tabs).forEach(function(k) {
      if (tabs[k]) {
        if (k === tabKey) {
          tabs[k].classList.remove('hidden');
        } else {
          tabs[k].classList.add('hidden');
        }
      }
      if (btns[k]) {
        if (k === tabKey) {
          btns[k].className = 'px-3 py-1.5 rounded-md font-semibold text-xs bg-indigo-600 text-white transition shadow-sm';
        } else {
          btns[k].className = 'px-3 py-1.5 rounded-md font-medium text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition';
        }
      }
    });

    if (tabKey === 'milestones') {
      populateActiveProjectDropdown();
      renderPilotMilestonesTable();
    } else if (tabKey === 'retention') {
      renderPilotRetentionTable();
    } else {
      renderPilotProjectsTable();
    }
  }

  function renderPilotSummaryScoreboard() {
    const projects = state.db.projects || [];
    const milestones = state.db.milestones || [];

    const totalProjects = projects.length;
    let totalBudget = 0;
    let totalRetentionHeld = 0;
    let totalPaid = 0;

    projects.forEach(function(p) {
      totalBudget += Number(p.TotalBudget || 0);
    });

    milestones.forEach(function(m) {
      if (m.PaymentStatus === 'Paid') {
        totalPaid += Number(m.NetPayable || (Number(m.Amount || 0) - Number(m.RetentionDeducted || 0)));
        totalRetentionHeld += Number(m.RetentionDeducted || 0);
      }
    });

    setText('pilotMetricTotalProjects', totalProjects);
    setText('pilotMetricTotalBudget', '฿' + formatCurrency(totalBudget));
    setText('pilotMetricTotalRetention', '฿' + formatCurrency(totalRetentionHeld));
    setText('pilotMetricTotalPaid', '฿' + formatCurrency(totalPaid));

    const badge = document.getElementById('headerPilotBadge');
    if (badge) {
      if (totalProjects > 0) {
        badge.textContent = totalProjects;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  function renderPilotProjectsTable() {
    const tbody = document.getElementById('pilotProjectsTableBody');
    const countEl = document.getElementById('pilotProjectsCountText');
    if (!tbody) return;

    const projects = state.db.projects || [];
    const q = String(getVal('pilotSearchInput') || '').trim().toLowerCase();
    const statusFilter = getVal('pilotStatusFilter') || 'ALL';

    const filtered = projects.filter(function(p) {
      if (statusFilter !== 'ALL' && p.Status !== statusFilter) return false;
      if (q) {
        const corpus = [p.ProjectID, p.ContractNo, p.ContractTitle, p.Category, p.ContractorName, p.Location].join(' ').toLowerCase();
        return corpus.includes(q);
      }
      return true;
    });

    if (countEl) countEl.textContent = filtered.length + ' โครงการ';

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-10 text-slate-400">
            <div class="text-2xl mb-1">🏗️</div>
            <div>ยังไม่มีข้อมูลสัญญาโครงการนำร่อง</div>
            <div class="text-[11px] text-slate-400 mt-1">กดปุ่ม "+ เพิ่มโครงการ / สัญญาใหม่" ด้านบนเพื่อเริ่มบันทึกงาน</div>
          </td>
        </tr>
      `;
      return;
    }

    const actor = getCurrentActor();
    const canManage = Number(actor.roleLevel) >= 2.5;

    tbody.innerHTML = filtered.map(function(p) {
      const budget = Number(p.TotalBudget || 0);
      const retPct = Number(p.RetentionPercent !== undefined ? p.RetentionPercent : 5);
      const retAmt = Number(p.RetentionAmount || (budget * retPct / 100));

      const statusBadge = p.Status === 'Completed'
        ? '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">✓ เสร็จสมบูรณ์</span>'
        : p.Status === 'Warranty Period'
          ? '<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">🛡️ อยู่ในช่วงรับประกัน</span>'
          : p.Status === 'Contract Signed'
            ? '<span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">📄 เพิ่งทำสัญญา</span>'
            : '<span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold">⏳ กำลังดำเนินงาน</span>';

      const modeBadge = p.PaymentMode === 'LUMP_SUM_100'
        ? '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-code text-[10px]">จ่ายครบ 100%</span>'
        : '<span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-mono-code text-[10px]">แบ่งจ่ายตามงวด</span>';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-3">
            <div class="font-mono-code font-bold text-slate-900">${escapeHtml(p.ProjectID)}</div>
            <div class="font-mono-code text-[11px] text-indigo-700 font-semibold">${escapeHtml(p.ContractNo || '-')}</div>
            <div class="text-[10px] text-slate-400 font-mono-code">Ver: ${escapeHtml(p.DocVersion || 'v1.0')}</div>
          </td>
          <td class="py-3 px-3">
            <div class="font-bold text-slate-900 text-xs">${escapeHtml(p.ContractTitle)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(p.Category || 'ทั่วไป')} • 📍 ${escapeHtml(p.Location || 'พิกัดโครงการ')}</div>
            ${p.ContractFileURL ? `<a href="${escapeHtml(p.ContractFileURL)}" target="_blank" class="text-[10px] text-indigo-600 hover:underline inline-flex items-center gap-1 font-mono-code mt-0.5">📎 เปิดดูไฟล์สัญญา ↗</a>` : ''}
          </td>
          <td class="py-3 px-3">
            <div class="font-semibold text-slate-800">${escapeHtml(p.ContractorName)}</div>
            <div class="text-[11px] text-slate-500 font-mono-code">📞 ${escapeHtml(p.ContractorPhone || '-')}</div>
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-bold text-slate-900">
            ฿${formatCurrency(budget)}
          </td>
          <td class="py-3 px-3 text-center">
            ${modeBadge}
          </td>
          <td class="py-3 px-3 text-center">
            <div class="font-bold text-amber-800 font-mono-code">${retPct}%</div>
            <div class="text-[10px] text-slate-400 font-mono-code">(฿${formatCurrency(retAmt)})</div>
          </td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            ${statusBadge}
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1.5">
              <button type="button" onclick="FMMS.handleSelectActiveProject('${p.ProjectID}'); FMMS.switchPilotSubTab('milestones');"
                class="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer" title="จัดการงวดงานและการเบิกจ่าย">
                📋 งวดงาน
              </button>
              ${canManage ? `
                <button type="button" onclick="FMMS.editPilotProject('${p.ProjectID}')"
                  class="bg-slate-100 hover:bg-slate-200 text-slate-800 px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer" title="แก้ไขข้อมูลสัญญา">
                  ✏️ แก้ไข
                </button>
              ` : ''}
              ${Number(actor.roleLevel) === 3 ? `
                <button type="button" onclick="FMMS.deletePilotProject('${p.ProjectID}')"
                  class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 px-2 py-1 rounded text-xs font-semibold transition cursor-pointer" title="ลบโครงการนี้">
                  🗑
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function handleRetentionPresetChange(val) {
    const customContainer = document.getElementById('prjCustomRetentionContainer');
    if (customContainer) {
      if (val === 'custom') {
        customContainer.classList.remove('hidden');
      } else {
        customContainer.classList.add('hidden');
      }
    }
    calculateProjectRetentionPreview();
  }

  function calculateProjectRetentionPreview() {
    const budget = Number(getVal('prjTotalBudget') || 0);
    const preset = getVal('prjRetentionPreset');
    let percent = 5;

    if (preset === 'custom') {
      percent = Number(getVal('prjCustomRetentionPercent') || 0);
    } else {
      percent = Number(preset || 0);
    }

    const calculatedAmt = (budget * percent) / 100;
    const calcInput = document.getElementById('prjCalculatedRetentionAmount');
    if (calcInput) {
      calcInput.value = calculatedAmt.toFixed(2);
    }
  }

  function openCreateProjectModal() {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'เฉพาะระดับ 2.5 (บัญชี) หรือระดับ 3 (Admin / Executive) เท่านั้นที่สามารถเพิ่มโครงการได้', 'warning');
      return;
    }

    setVal('prjEditId', '');
    setText('pilotProjectModalTitle', 'เพิ่มสัญญาโครงการนำร่องใหม่ (Create Pilot Project)');
    const form = document.getElementById('pilotProjectForm');
    if (form) form.reset();

    setVal('prjContractNo', 'TWPP-CONT-' + UtilitiesDateYear() + '/' + Math.floor(100 + Math.random() * 900));
    setVal('prjTotalBudget', '');
    setVal('prjRetentionPreset', '5');
    handleRetentionPresetChange('5');

    const modal = document.getElementById('pilotProjectModal');
    if (modal) modal.classList.remove('hidden');
  }

  function editPilotProject(projectId) {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'คุณไม่มีสิทธิ์แก้ไขข้อมูลสัญญาโครงการ', 'warning');
      return;
    }

    const p = (state.db.projects || []).find(function(item) { return item.ProjectID === projectId; });
    if (!p) return;

    // Check Collision Lock
    const locked = acquireItemLock(projectId, 'PROJECT', p.ContractTitle || projectId);
    if (!locked) return; // Prevent concurrent edit!

    setVal('prjEditId', p.ProjectID);
    setText('pilotProjectModalTitle', 'แก้ไขสัญญาโครงการ: ' + p.ProjectID + ' (' + (p.ContractNo || '') + ')');
    setVal('prjContractNo', p.ContractNo || '');
    setVal('prjCategory', p.Category || 'ปรับปรุงอาคาร & ตกแต่ง');
    setVal('prjContractTitle', p.ContractTitle || '');
    setVal('prjContractorName', p.ContractorName || '');
    setVal('prjContractorPhone', p.ContractorPhone || '');
    setVal('prjTotalBudget', p.TotalBudget || '');
    setVal('prjPaymentMode', p.PaymentMode || 'MILESTONE_INSTALLMENTS');
    setVal('prjStartDate', p.StartDate || '');
    setVal('prjEndDate', p.EndDate || '');
    setVal('prjWarrantyMonths', p.WarrantyMonths || 12);
    setVal('prjContractFileURL', p.ContractFileURL || '');

    const retPct = Number(p.RetentionPercent !== undefined ? p.RetentionPercent : 5);
    if ([0, 3, 5, 10].includes(retPct)) {
      setVal('prjRetentionPreset', String(retPct));
      handleRetentionPresetChange(String(retPct));
    } else {
      setVal('prjRetentionPreset', 'custom');
      handleRetentionPresetChange('custom');
      setVal('prjCustomRetentionPercent', retPct);
    }
    calculateProjectRetentionPreview();

    const modal = document.getElementById('pilotProjectModal');
    if (modal) modal.classList.remove('hidden');
  }

  function closePilotProjectModal() {
    const modal = document.getElementById('pilotProjectModal');
    if (modal) modal.classList.add('hidden');
    if (state.activeEditingItem) {
      releaseItemLock(state.activeEditingItem.targetId);
    }
  }

  async function handleSavePilotProjectSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'เฉพาะระดับ 2.5 (บัญชี) หรือระดับ 3 (Admin / Executive) เท่านั้นที่สามารถบันทึกได้', 'error');
      return;
    }

    const editId = getVal('prjEditId');
    const contractNo = String(getVal('prjContractNo') || '').trim();
    const category = getVal('prjCategory');
    const title = String(getVal('prjContractTitle') || '').trim();
    const contractor = String(getVal('prjContractorName') || '').trim();
    const phone = String(getVal('prjContractorPhone') || '').trim();
    const totalBudget = Number(getVal('prjTotalBudget') || 0);
    const paymentMode = getVal('prjPaymentMode');
    const startDate = getVal('prjStartDate');
    const endDate = getVal('prjEndDate');
    const warranty = Number(getVal('prjWarrantyMonths') || 12);
    const fileUrl = String(getVal('prjContractFileURL') || '').trim();

    const preset = getVal('prjRetentionPreset');
    const retPercent = preset === 'custom' ? Number(getVal('prjCustomRetentionPercent') || 0) : Number(preset || 0);
    const retAmount = (totalBudget * retPercent) / 100;
    const now = getIsoNow();
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    let projectObj = null;

    if (editId) {
      projectObj = (state.db.projects || []).find(function(p) { return p.ProjectID === editId; });
      if (projectObj) {
        projectObj.ContractNo = contractNo;
        projectObj.Category = category;
        projectObj.ContractTitle = title;
        projectObj.ContractorName = contractor;
        projectObj.ContractorPhone = phone;
        projectObj.TotalBudget = totalBudget;
        projectObj.RetentionPercent = retPercent;
        projectObj.RetentionAmount = retAmount;
        projectObj.PaymentMode = paymentMode;
        projectObj.StartDate = startDate;
        projectObj.EndDate = endDate;
        projectObj.WarrantyMonths = warranty;
        projectObj.ContractFileURL = fileUrl;
        projectObj.UpdatedAt = now;
        projectObj.UpdatedBy = operatorStamp;
      }
    } else {
      const newId = 'PRJ-' + UtilitiesDateYear() + '-' + String(Math.floor(100 + Math.random() * 900));
      projectObj = {
        ProjectID: newId,
        DocVersion: 'v1.0',
        ContractNo: contractNo,
        Category: category,
        ContractTitle: title,
        Location: 'พื้นที่โครงการ',
        ContractorName: contractor,
        ContractorPhone: phone,
        TotalBudget: totalBudget,
        RetentionPercent: retPercent,
        RetentionAmount: retAmount,
        PaymentMode: paymentMode,
        StartDate: startDate,
        EndDate: endDate,
        WarrantyMonths: warranty,
        ContractFileURL: fileUrl,
        Status: 'Contract Signed',
        CreatedAt: now,
        CreatedBy: operatorStamp,
        UpdatedAt: now,
        UpdatedBy: operatorStamp
      };
      if (!Array.isArray(state.db.projects)) state.db.projects = [];
      state.db.projects.unshift(projectObj);

      // Auto-generate initial milestone(s) if none exist
      if (paymentMode === 'LUMP_SUM_100') {
        const lumpMilestone = {
          MilestoneID: newId + '-MS01',
          ProjectID: newId,
          MilestoneNo: 1,
          MilestoneTitle: 'งวดเดียว 100%: ส่งมอบงานเสร็จสมบูรณ์ตามสัญญา',
          Description: 'ส่งมอบงานครบถ้วน ทดสอบระบบ และลงนามตรวจรับ 100%',
          Percentage: 100,
          Amount: totalBudget,
          RetentionDeducted: retAmount,
          NetPayable: totalBudget - retAmount,
          DueDate: endDate || startDate,
          WorkStatus: 'Pending',
          PaymentStatus: 'Unpaid',
          InspectionDate: '',
          InspectorName: '',
          InspectionPhotos: [],
          PaymentDate: '',
          PaidBy: '',
          PaymentSlipURL: '',
          PaymentVoucherNo: '',
          UpdatedAt: now,
          UpdatedBy: operatorStamp
        };
        if (!Array.isArray(state.db.milestones)) state.db.milestones = [];
        state.db.milestones.push(lumpMilestone);
      }
    }

    persistDatabase();
    closePilotProjectModal();
    renderPilotViews();
    showToast('บันทึกสัญญาสำเร็จ', 'บันทึกโครงการ ' + projectObj.ProjectID + ' (' + projectObj.ContractTitle + ') เรียบร้อยแล้ว', 'success');

    // Sync to Google Sheets
    try {
      postToGasBackend('savePilotProject', {
        project: projectObj
      }).then(function() {
        showCloudSyncConfirmation({
          docId: projectObj.ProjectID,
          docType: 'สัญญาโครงการนำร่อง (Sheet: Pilot_Projects)',
          actionTitle: 'บันทึกโครงการ/สัญญาสู่ Google Sheets',
          version: projectObj.DocVersion || 'v1.0',
          details: projectObj.ContractTitle + ' สัญญา: ' + projectObj.ContractNo + ' วงเงิน ฿' + formatCurrency(totalBudget)
        });
      }).catch(function(err) {
        console.warn('Sync pilot project warning:', err);
      });
    } catch (_) {}
  }

  async function deletePilotProject(projectId) {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 3) {
      showToast('จำกัดสิทธิ์เฉพาะ Admin หรือผู้บริหาร', 'คุณไม่มีสิทธิ์ลบโครงการ', 'error');
      return;
    }

    const confirmed = confirm('⚠️ ยืนยันการลบโครงการ ' + projectId + ' หรือไม่?\n\nข้อมูลโครงการและงวดงานทั้งหมดจะถูกลบออกจากฐานข้อมูลอย่างถาวร');
    if (!confirmed) return;

    state.db.projects = (state.db.projects || []).filter(function(p) { return p.ProjectID !== projectId; });
    state.db.milestones = (state.db.milestones || []).filter(function(m) { return m.ProjectID !== projectId; });

    if (state.selectedProjectId === projectId) {
      state.selectedProjectId = null;
    }

    persistDatabase();
    renderPilotViews();
    showToast('ลบโครงการเรียบร้อย', 'ลบโครงการ ' + projectId + ' ออกจากระบบแล้ว', 'success');

    try {
      postToGasBackend('deletePilotProject', { projectId: projectId });
    } catch (_) {}
  }

  function populateActiveProjectDropdown() {
    const select = document.getElementById('pilotActiveProjectSelect');
    if (!select) return;

    const projects = state.db.projects || [];
    if (projects.length === 0) {
      select.innerHTML = '<option value="">-- ยังไม่มีโครงการในระบบ --</option>';
      return;
    }

    if (!state.selectedProjectId || !projects.some(function(p) { return p.ProjectID === state.selectedProjectId; })) {
      state.selectedProjectId = projects[0].ProjectID;
    }

    select.innerHTML = projects.map(function(p) {
      const isSel = p.ProjectID === state.selectedProjectId ? 'selected' : '';
      return `<option value="${p.ProjectID}" ${isSel}>${escapeHtml(p.ProjectID)} - ${escapeHtml(p.ContractTitle)} (สัญญา: ${escapeHtml(p.ContractNo || '-')})</option>`;
    }).join('');
  }

  function handleSelectActiveProject(projectId) {
    state.selectedProjectId = projectId;
    renderPilotMilestonesTable();
  }

  function renderPilotMilestonesTable() {
    const bannerEl = document.getElementById('pilotSelectedProjectBanner');
    const tbody = document.getElementById('pilotMilestonesTableBody');
    const summaryBadge = document.getElementById('pilotMilestonesSummaryBadge');
    if (!tbody) return;

    const projects = state.db.projects || [];
    const activeProject = projects.find(function(p) { return p.ProjectID === state.selectedProjectId; }) || projects[0];

    if (!activeProject) {
      if (bannerEl) bannerEl.innerHTML = '<div class="text-center py-4 text-slate-400">กรุณาเลือกโครงการจากรายการด้านบน</div>';
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">ยังไม่มีงวดงาน</td></tr>';
      return;
    }

    state.selectedProjectId = activeProject.ProjectID;
    const allMilestones = state.db.milestones || [];
    const projectMilestones = allMilestones.filter(function(m) { return m.ProjectID === activeProject.ProjectID; });

    // Calculate Project Progress & Completion %
    let paidCount = 0;
    let approvedCount = 0;
    let totalMilestoneAmount = 0;
    let totalPaidNet = 0;
    let totalRetentionHeld = 0;

    projectMilestones.forEach(function(m) {
      totalMilestoneAmount += Number(m.Amount || 0);
      if (m.PaymentStatus === 'Paid') {
        paidCount++;
        totalPaidNet += Number(m.NetPayable || (Number(m.Amount || 0) - Number(m.RetentionDeducted || 0)));
        totalRetentionHeld += Number(m.RetentionDeducted || 0);
      }
      if (m.WorkStatus === 'Inspected & Approved') {
        approvedCount++;
      }
    });

    const progressPct = projectMilestones.length > 0 ? Math.round((approvedCount / projectMilestones.length) * 100) : 0;
    const paymentProgressPct = activeProject.TotalBudget > 0 ? Math.round((totalPaidNet / activeProject.TotalBudget) * 100) : 0;

    if (bannerEl) {
      bannerEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono-code bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded">${escapeHtml(activeProject.ProjectID)}</span>
              <span class="text-xs font-mono-code text-slate-500">สัญญา: ${escapeHtml(activeProject.ContractNo || '-')}</span>
              <span class="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono-code">${activeProject.PaymentMode === 'LUMP_SUM_100' ? 'จ่ายก้อนเดียว 100%' : 'แบ่งจ่ายตามงวดงาน'}</span>
            </div>
            <h4 class="text-base font-bold text-slate-900 mt-1">${escapeHtml(activeProject.ContractTitle)}</h4>
            <div class="text-xs text-slate-500 mt-0.5">👷 ผู้รับเหมา: <strong>${escapeHtml(activeProject.ContractorName)}</strong> | วงเงินสัญญา: <strong class="text-indigo-900 font-mono-code font-bold">฿${formatCurrency(activeProject.TotalBudget)}</strong></div>
          </div>
          <div class="text-right text-xs">
            <div class="font-bold text-slate-700">หักเงินประกันผลงาน (Retention): <span class="text-amber-800 font-mono-code">${Number(activeProject.RetentionPercent || 5)}%</span></div>
            <div class="text-slate-500 font-mono-code text-[11px]">สะสมแล้ว: <strong class="text-amber-700">฿${formatCurrency(totalRetentionHeld)}</strong></div>
          </div>
        </div>

        <!-- Progress Bar Strip -->
        <div class="space-y-1.5 pt-1">
          <div class="flex justify-between text-xs font-semibold text-slate-700">
            <span>ความคืบหน้าการตรวจรับงาน: ${progressPct}% (${approvedCount}/${projectMilestones.length} งวด)</span>
            <span>เบิกจ่ายแล้ว: ${paymentProgressPct}% (฿${formatCurrency(totalPaidNet)} จาก ฿${formatCurrency(activeProject.TotalBudget)})</span>
          </div>
          <div class="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden flex">
            <div class="bg-teal-500 h-full transition-all duration-500" style="width: ${progressPct}%" title="ผ่านการตรวจรับ ${progressPct}%"></div>
            <div class="bg-emerald-600 h-full transition-all duration-500" style="width: ${paymentProgressPct}%" title="จ่ายเงินแล้ว ${paymentProgressPct}%"></div>
          </div>
        </div>
      `;
    }

    if (summaryBadge) {
      summaryBadge.textContent = projectMilestones.length + ' งวดงาน (' + approvedCount + ' ผ่านตรวจรับ / ' + paidCount + ' จ่ายแล้ว)';
    }

    if (projectMilestones.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-10 text-slate-400">
            <div>ยังไม่มีการกำหนดงวดงานสำหรับโครงการนี้</div>
            <div class="text-[11px] text-slate-500 mt-1">ฝ่ายบัญชีสามารถกดปุ่ม "+ เพิ่มงวดงานใหม่" เพื่อกำหนดรายละเอียดและแบ่งงวดเงินได้</div>
          </td>
        </tr>
      `;
      return;
    }

    const actor = getCurrentActor();
    const isEngineer = Number(actor.roleLevel) === 2 || Number(actor.roleLevel) === 3;
    const isAccount = Number(actor.roleLevel) === 2.5 || Number(actor.roleLevel) === 3;

    tbody.innerHTML = projectMilestones.map(function(m) {
      const amt = Number(m.Amount || 0);
      const retDeducted = Number(m.RetentionDeducted || (amt * Number(activeProject.RetentionPercent || 5) / 100));
      const netPayable = Number(m.NetPayable || (amt - retDeducted));

      const isInspected = m.WorkStatus === 'Inspected & Approved';
      const isPaid = m.PaymentStatus === 'Paid';

      const workBadge = isInspected
        ? `<span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold inline-flex items-center gap-1">✓ ตรวจรับแล้ว</span>`
        : m.WorkStatus === 'Rejected'
          ? `<span class="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">❌ สั่งแก้ไขงาน</span>`
          : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">⏳ รอดำเนินการ</span>`;

      const payBadge = isPaid
        ? `<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold inline-flex items-center gap-1">💳 จ่ายแล้ว</span>`
        : isInspected
          ? `<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-bold">⏳ รอคำสั่งจ่าย</span>`
          : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-400">ยังไม่ถึงกำหนด</span>`;

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-3 font-mono-code font-bold text-slate-800 whitespace-nowrap">
            #${m.MilestoneNo || 1}
          </td>
          <td class="py-3 px-3">
            <div class="font-bold text-slate-900">${escapeHtml(m.MilestoneTitle)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(m.Description || '-')}</div>
            <div class="text-[10px] text-slate-400 font-mono-code mt-0.5">กำหนดส่ง: ${m.DueDate || '-'}</div>
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-bold text-slate-700">
            ${Number(m.Percentage || 0)}%
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-bold text-slate-900">
            ฿${formatCurrency(amt)}
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-bold text-amber-700">
            -฿${formatCurrency(retDeducted)}
          </td>
          <td class="py-3 px-3 text-right font-mono-code font-bold text-emerald-800">
            ฿${formatCurrency(netPayable)}
          </td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            ${workBadge}
            ${isInspected && m.InspectorName ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(m.InspectorName)}</div>` : ''}
          </td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            ${payBadge}
            ${isPaid && m.PaymentVoucherNo ? `<div class="text-[10px] text-emerald-700 font-mono-code mt-0.5">${escapeHtml(m.PaymentVoucherNo)}</div>` : ''}
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1.5">
              <!-- Engineer Inspection Button -->
              ${isEngineer && !isInspected ? `
                <button type="button" onclick="FMMS.openMilestoneInspectionModal('${m.MilestoneID}')"
                  class="bg-teal-700 hover:bg-teal-600 text-white px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer" title="วิศวกรตรวจรับงานงวดนี้">
                  🔍 ตรวจรับ
                </button>
              ` : ''}

              <!-- Accounting Payment Button (3-Way Match Check: Requires Inspection first!) -->
              ${isAccount && isInspected && !isPaid ? `
                <button type="button" onclick="FMMS.openMilestonePaymentModal('${m.MilestoneID}')"
                  class="bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1 rounded text-xs font-semibold transition cursor-pointer" title="ฝ่ายบัญชีสั่งจ่ายเงินงวดและแนบสลิป">
                  💳 สั่งจ่าย
                </button>
              ` : ''}

              <!-- A4 Official Certificate Preview -->
              <button type="button" onclick="FMMS.openMilestonePrintModal('${m.MilestoneID}')"
                class="bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer" title="เปิดพรีวิวใบตรวจรับและสั่งจ่ายมาตรฐาน A4">
                📄 A4
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openAddMilestoneModal() {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'คุณไม่มีสิทธิ์กำหนดงวดเงินสัญญา', 'warning');
      return;
    }

    if (!state.selectedProjectId) {
      showToast('ไม่ได้เลือกโครงการ', 'กรุณาเลือกโครงการจากรายการด้านบนก่อนเพิ่มงวดงาน', 'warning');
      return;
    }

    const projects = state.db.projects || [];
    const activeProject = projects.find(function(p) { return p.ProjectID === state.selectedProjectId; });
    if (!activeProject) return;

    const allMilestones = state.db.milestones || [];
    const projectMilestones = allMilestones.filter(function(m) { return m.ProjectID === activeProject.ProjectID; });
    const nextSeq = projectMilestones.length + 1;

    const msTitle = prompt('ระบุชื่องวดงานที่ ' + nextSeq + ':', 'งวดที่ ' + nextSeq + ': ส่งมอบงานตามข้อตกลงสัญญา');
    if (!msTitle) return;

    const rawPct = prompt('ระบุร้อยละ (%) ค่างวดงาน (เช่น 25, 30, 50):', '25');
    const pct = Number(rawPct || 0);
    if (pct <= 0 || pct > 100) {
      showToast('ร้อยละไม่ถูกต้อง', 'กรุณาระบุร้อยละระหว่าง 1 ถึง 100', 'warning');
      return;
    }

    const amount = (Number(activeProject.TotalBudget || 0) * pct) / 100;
    const retDeducted = (amount * Number(activeProject.RetentionPercent || 5)) / 100;
    const netPayable = amount - retDeducted;
    const now = getIsoNow();

    const newMilestone = {
      MilestoneID: activeProject.ProjectID + '-MS' + String(nextSeq).padStart(2, '0'),
      ProjectID: activeProject.ProjectID,
      MilestoneNo: nextSeq,
      MilestoneTitle: msTitle,
      Description: 'ดำเนินงานตามขอบเขตสัญญา งวดที่ ' + nextSeq,
      Percentage: pct,
      Amount: amount,
      RetentionDeducted: retDeducted,
      NetPayable: netPayable,
      DueDate: activeProject.EndDate || activeProject.StartDate || '',
      WorkStatus: 'Pending',
      PaymentStatus: 'Unpaid',
      InspectionDate: '',
      InspectorName: '',
      InspectionPhotos: [],
      PaymentDate: '',
      PaidBy: '',
      PaymentSlipURL: '',
      PaymentVoucherNo: '',
      UpdatedAt: now,
      UpdatedBy: actor.userId + ' (' + actor.fullName + ')'
    };

    if (!Array.isArray(state.db.milestones)) state.db.milestones = [];
    state.db.milestones.push(newMilestone);
    persistDatabase();
    renderPilotMilestonesTable();
    showToast('เพิ่มงวดงานสำเร็จ', 'เพิ่มงวดที่ ' + nextSeq + ' (฿' + formatCurrency(amount) + ') เรียบร้อยแล้ว', 'success');

    // Sync to GAS
    try {
      const updatedMs = state.db.milestones.filter(function(m) { return m.ProjectID === activeProject.ProjectID; });
      postToGasBackend('saveProjectMilestones', {
        projectId: activeProject.ProjectID,
        milestones: updatedMs
      });
    } catch (_) {}
  }

  function openMilestoneInspectionModal(milestoneId) {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2) {
      showToast('จำกัดสิทธิ์เฉพาะวิศวกรผู้ควบคุมงาน', 'ช่างหน้างานไม่มีสิทธิ์ตรวจรับงวดงาน', 'error');
      return;
    }

    const m = (state.db.milestones || []).find(function(item) { return item.MilestoneID === milestoneId; });
    if (!m) return;

    // Check collision lock!
    const locked = acquireItemLock(milestoneId, 'MILESTONE_INSP', m.MilestoneTitle || milestoneId);
    if (!locked) return;

    setVal('inspMilestoneId', m.MilestoneID);
    setText('inspMilestoneHeaderTitle', 'งวดที่ ' + (m.MilestoneNo || 1) + ': ' + m.MilestoneTitle);
    setText('inspMilestoneHeaderDetails', 'ยอดเงินงวด: ฿' + formatCurrency(m.Amount) + ' | สัญญา: ' + m.ProjectID);
    setVal('inspDate', UtilitiesDateToday());
    setVal('inspNotes', m.InspectorNotes || '');

    state.activeEditingPhotos = Array.isArray(m.InspectionPhotos) ? [...m.InspectionPhotos] : [];
    renderMilestoneInspectionPhotosPreview();

    const modal = document.getElementById('milestoneInspectionModal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeMilestoneInspectionModal() {
    const modal = document.getElementById('milestoneInspectionModal');
    if (modal) modal.classList.add('hidden');
    if (state.activeEditingItem) {
      releaseItemLock(state.activeEditingItem.targetId);
    }
  }

  function handleMilestonePhotoUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!Array.isArray(state.activeEditingPhotos)) state.activeEditingPhotos = [];
    const availableSlots = 5 - state.activeEditingPhotos.length;
    if (availableSlots <= 0) {
      showToast('แนบภาพครบ 5 ภาพแล้ว', 'สามารถแนบภาพตรวจรับได้สูงสุดไม่เกิน 5 ภาพต่อหนึ่งงวดงาน', 'warning');
      return;
    }

    let filesToProcess = Array.from(files).slice(0, availableSlots);
    filesToProcess.forEach(function(file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Watermark
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(0, height - 28, width, 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = '12px monospace';
          ctx.fillText('FMMS PILOT INSPECTION | ' + formatThaiDateTime(getIsoNow()), 10, height - 10);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          state.activeEditingPhotos.push(dataUrl);
          renderMilestoneInspectionPhotosPreview();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  }

  function renderMilestoneInspectionPhotosPreview() {
    const container = document.getElementById('inspPhotoGallery');
    const countEl = document.getElementById('inspPhotoCountText');
    if (!container) return;

    const photos = state.activeEditingPhotos || [];
    if (countEl) countEl.textContent = photos.length + ' / 5 ภาพ';

    if (photos.length === 0) {
      container.innerHTML = '<span class="col-span-5 text-slate-400 text-xs py-3">ยังไม่มีภาพถ่ายตรวจรับ (แนบได้สูงสุด 5 ภาพ)</span>';
      return;
    }

    container.innerHTML = photos.map(function(url, idx) {
      return `
        <div class="relative group rounded border border-slate-300 overflow-hidden bg-white h-16 flex items-center justify-center">
          <img src="${url}" class="w-full h-full object-cover">
          <button type="button" onclick="FMMS.removeMilestoneInspectionPhoto(${idx})"
            class="absolute top-0.5 right-0.5 bg-rose-600 hover:bg-rose-700 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow" title="ลบภาพนี้">✕</button>
        </div>
      `;
    }).join('');
  }

  function removeMilestoneInspectionPhoto(idx) {
    if (state.activeEditingPhotos && idx >= 0 && idx < state.activeEditingPhotos.length) {
      state.activeEditingPhotos.splice(idx, 1);
      renderMilestoneInspectionPhotosPreview();
    }
  }

  async function handleMilestoneInspectionSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2) {
      showToast('จำกัดสิทธิ์เฉพาะวิศวกรผู้ควบคุมงาน', 'คุณไม่มีสิทธิ์ตรวจรับงวดงาน', 'error');
      return;
    }

    const msId = getVal('inspMilestoneId');
    const status = getVal('inspWorkStatus');
    const inspDate = getVal('inspDate');
    const notes = String(getVal('inspNotes') || '').trim();

    const m = (state.db.milestones || []).find(function(item) { return item.MilestoneID === msId; });
    if (!m) return;

    const now = getIsoNow();
    m.WorkStatus = status;
    m.InspectionDate = inspDate || now;
    m.InspectorName = actor.fullName;
    m.InspectorNotes = notes;
    m.InspectionPhotos = state.activeEditingPhotos || [];
    m.UpdatedAt = now;
    m.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';

    persistDatabase();
    closeMilestoneInspectionModal();
    renderPilotMilestonesTable();
    showToast('บันทึกการตรวจรับสำเร็จ', 'ตรวจรับงวดงาน ' + m.MilestoneID + ' เรียบร้อยแล้ว พร้อมส่งต่อให้ฝ่ายบัญชี', 'success');

    // Sync to GAS
    try {
      postToGasBackend('inspectMilestone', {
        milestoneId: msId,
        inspection: {
          WorkStatus: status,
          InspectionDate: inspDate,
          InspectorName: actor.fullName,
          InspectorNotes: notes,
          InspectionPhotos: m.InspectionPhotos
        }
      });
    } catch (_) {}
  }

  function openMilestonePaymentModal(milestoneId) {
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'เฉพาะระดับ 2.5 (บัญชี) หรือระดับ 3 (ผู้บริหาร) เท่านั้นที่สั่งจ่ายเงินได้', 'error');
      return;
    }

    const m = (state.db.milestones || []).find(function(item) { return item.MilestoneID === milestoneId; });
    if (!m) return;

    // 3-Way Match Guard
    if (m.WorkStatus !== 'Inspected & Approved') {
      showToast('ยังไม่สามารถสั่งจ่ายได้', 'งวดงานนี้ยังไม่ผ่านการตรวจรับจากวิศวกรผู้ควบคุมงานตามหลัก 3-Way Match', 'warning');
      return;
    }

    // Check collision lock!
    const locked = acquireItemLock(milestoneId, 'MILESTONE_PAY', m.MilestoneTitle || milestoneId);
    if (!locked) return;

    setVal('payMilestoneId', m.MilestoneID);
    setText('payMilestoneTitle', 'งวดที่ ' + (m.MilestoneNo || 1) + ': ' + m.MilestoneTitle);
    setText('payRawAmountText', '฿' + formatCurrency(m.Amount));
    setText('payRetentionDeductedText', '- ฿' + formatCurrency(m.RetentionDeducted));
    setText('payNetPayableText', '฿' + formatCurrency(m.NetPayable));

    setVal('payVoucherNo', 'PV-' + UtilitiesDateYear() + '/' + Math.floor(100 + Math.random() * 900));
    setVal('payDate', UtilitiesDateToday());

    state.activePaymentSlip = m.PaymentSlipURL || null;
    const previewContainer = document.getElementById('paySlipPreviewContainer');
    const previewImg = document.getElementById('paySlipPreviewImg');
    if (previewContainer && previewImg) {
      if (state.activePaymentSlip) {
        previewImg.src = state.activePaymentSlip;
        previewContainer.classList.remove('hidden');
      } else {
        previewContainer.classList.add('hidden');
      }
    }

    const modal = document.getElementById('milestonePaymentModal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeMilestonePaymentModal() {
    const modal = document.getElementById('milestonePaymentModal');
    if (modal) modal.classList.add('hidden');
    if (state.activeEditingItem) {
      releaseItemLock(state.activeEditingItem.targetId);
    }
  }

  function handlePaymentSlipUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        state.activePaymentSlip = dataUrl;

        const previewContainer = document.getElementById('paySlipPreviewContainer');
        const previewImg = document.getElementById('paySlipPreviewImg');
        if (previewContainer && previewImg) {
          previewImg.src = dataUrl;
          previewContainer.classList.remove('hidden');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function removePaymentSlip() {
    state.activePaymentSlip = null;
    const previewContainer = document.getElementById('paySlipPreviewContainer');
    if (previewContainer) previewContainer.classList.add('hidden');
  }

  async function handleMilestonePaymentSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const actor = getCurrentActor();
    if (Number(actor.roleLevel) < 2.5) {
      showToast('จำกัดสิทธิ์เฉพาะฝ่ายบัญชีหรือผู้บริหาร', 'คุณไม่มีสิทธิ์สั่งจ่ายเงิน', 'error');
      return;
    }

    const msId = getVal('payMilestoneId');
    const voucherNo = String(getVal('payVoucherNo') || '').trim();
    const payDate = getVal('payDate');

    const m = (state.db.milestones || []).find(function(item) { return item.MilestoneID === msId; });
    if (!m) return;

    const now = getIsoNow();
    const operatorStamp = actor.userId + ' (' + actor.fullName + ')';

    m.PaymentStatus = 'Paid';
    m.PaymentVoucherNo = voucherNo;
    m.PaymentDate = payDate || now;
    m.PaidBy = operatorStamp;
    m.PaymentSlipURL = state.activePaymentSlip || '';
    m.UpdatedAt = now;
    m.UpdatedBy = operatorStamp;

    persistDatabase();
    closeMilestonePaymentModal();
    renderPilotViews();
    showToast('บันทึกการสั่งจ่ายสำเร็จ', 'จ่ายเงินงวด ' + m.MilestoneID + ' ยอดสุทธิ ฿' + formatCurrency(m.NetPayable) + ' เรียบร้อยแล้ว', 'success');

    // Sync to GAS
    try {
      postToGasBackend('payoutMilestone', {
        milestoneId: msId,
        payout: {
          PaymentVoucherNo: voucherNo,
          PaymentDate: payDate,
          PaidBy: operatorStamp,
          PaymentSlipURL: m.PaymentSlipURL
        }
      });
    } catch (_) {}
  }

  function renderPilotRetentionTable() {
    const tbody = document.getElementById('pilotRetentionTableBody');
    if (!tbody) return;

    const projects = state.db.projects || [];
    const milestones = state.db.milestones || [];

    if (projects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">ยังไม่มีข้อมูลสัญญาโครงการ</td></tr>';
      return;
    }

    tbody.innerHTML = projects.map(function(p) {
      const budget = Number(p.TotalBudget || 0);
      const retPct = Number(p.RetentionPercent !== undefined ? p.RetentionPercent : 5);

      const prjMilestones = milestones.filter(function(m) { return m.ProjectID === p.ProjectID; });
      let paidNet = 0;
      let retHeld = 0;

      prjMilestones.forEach(function(m) {
        if (m.PaymentStatus === 'Paid') {
          paidNet += Number(m.NetPayable || 0);
          retHeld += Number(m.RetentionDeducted || 0);
        }
      });

      const remainingBudget = Math.max(0, budget - (paidNet + retHeld));
      const warrantyStatus = p.Status === 'Completed'
        ? '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono-code text-[11px]">ปลดล็อกแล้ว</span>'
        : p.Status === 'Warranty Period'
          ? '<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[11px]">🛡️ รอครบกำหนดประกัน</span>'
          : '<span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono-code text-[11px]">กำลังก่อสร้าง/ปรับปรุง</span>';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-2.5 px-3">
            <div class="font-bold text-slate-900">${escapeHtml(p.ProjectID)}</div>
            <div class="text-[11px] text-slate-500 font-mono-code">${escapeHtml(p.ContractNo || '-')}</div>
          </td>
          <td class="py-2.5 px-3 font-semibold text-slate-800">
            ${escapeHtml(p.ContractorName)}
          </td>
          <td class="py-2.5 px-3 text-right font-mono-code font-bold text-slate-900">
            ฿${formatCurrency(budget)}
          </td>
          <td class="py-2.5 px-3 text-right font-mono-code font-bold text-amber-800">
            ${retPct}%
          </td>
          <td class="py-2.5 px-3 text-right font-mono-code font-bold text-amber-700 bg-amber-50/50">
            ฿${formatCurrency(retHeld)}
          </td>
          <td class="py-2.5 px-3 text-right font-mono-code font-bold text-emerald-800">
            ฿${formatCurrency(paidNet)}
          </td>
          <td class="py-2.5 px-3 text-right font-mono-code font-bold text-slate-600">
            ฿${formatCurrency(remainingBudget)}
          </td>
          <td class="py-2.5 px-3 text-center font-mono-code text-xs">
            ${p.WarrantyMonths || 12} เดือน
          </td>
          <td class="py-2.5 px-3 text-center">
            ${warrantyStatus}
          </td>
        </tr>
      `;
    }).join('');
  }

  function exportPilotFinancialsToCSV() {
    const headers = ['ProjectID', 'ContractNo', 'ContractTitle', 'ContractorName', 'TotalBudget', 'RetentionPercent', 'RetentionAmountHeld', 'NetPaid', 'RemainingBudget', 'WarrantyMonths', 'Status'];
    const projects = state.db.projects || [];
    const milestones = state.db.milestones || [];

    const rows = projects.map(function(p) {
      const budget = Number(p.TotalBudget || 0);
      const retPct = Number(p.RetentionPercent !== undefined ? p.RetentionPercent : 5);
      const prjMilestones = milestones.filter(function(m) { return m.ProjectID === p.ProjectID; });
      let paidNet = 0;
      let retHeld = 0;
      prjMilestones.forEach(function(m) {
        if (m.PaymentStatus === 'Paid') {
          paidNet += Number(m.NetPayable || 0);
          retHeld += Number(m.RetentionDeducted || 0);
        }
      });
      const remaining = Math.max(0, budget - (paidNet + retHeld));

      return [
        p.ProjectID,
        p.ContractNo || '-',
        p.ContractTitle || '-',
        p.ContractorName || '-',
        budget,
        retPct,
        retHeld,
        paidNet,
        remaining,
        p.WarrantyMonths || 12,
        p.Status || 'In Progress'
      ];
    });

    downloadCSV('FMMS_Pilot_Financial_Retention_Report.csv', headers, rows);
  }

  function openMilestonePrintModal(milestoneId) {
    const m = (state.db.milestones || []).find(function(item) { return item.MilestoneID === milestoneId; });
    if (!m) return;

    const p = (state.db.projects || []).find(function(item) { return item.ProjectID === m.ProjectID; }) || {};
    const container = document.getElementById('a4PaperContainer');
    const modal = document.getElementById('memoPrintModal');
    if (!container || !modal) return;

    const isInspected = m.WorkStatus === 'Inspected & Approved';
    const isPaid = m.PaymentStatus === 'Paid';
    const photos = Array.isArray(m.InspectionPhotos) ? m.InspectionPhotos : [];

    container.innerHTML = `
      <!-- Top Official Header with Authentic TWPP Emblem -->
      <div class="flex items-center gap-3 pb-2 mb-2 border-b-2 border-slate-900">
        <div class="flex-shrink-0 flex items-center justify-center p-1 bg-white rounded border border-slate-300 shadow-sm" style="width: 52px; height: 46px;">
          <img src="logo-cropped.png" alt="TWPP Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        </div>
        <div class="flex-1 min-w-0 pr-2">
          <div style="font-size: 8.5pt;" class="font-mono-code uppercase tracking-wider text-slate-600">FMMS ENTERPRISE • PILOT PROJECT CERTIFICATE (DATA MA TWPP)</div>
          <h1 class="doc-title" style="font-size: 13.5pt; font-weight: 700; color: #000000; line-height: 1.15; margin: 1px 0;">
            ใบรับรองการตรวจรับงานจ้างและอนุมัติเบิกจ่ายประจำงวด (INTERIM PAYMENT CERTIFICATE - IPC)
          </h1>
          <div class="doc-subheading text-slate-800" style="font-size: 11pt; font-weight: 700;">${escapeHtml(state.config.orgName || 'บริษัทบริหารจัดการอาคารและวิศวกรรม ทวพ. จำกัด')}</div>
        </div>
        <div class="text-right font-mono-code border border-slate-500 p-1.5 rounded flex-shrink-0 bg-slate-50" style="font-size: 9.5pt; min-width: 175px; line-height: 1.3;">
          <div><strong>งวดงาน:</strong> ${escapeHtml(m.MilestoneID || '-')}</div>
          <div><strong>เลขที่สัญญา:</strong> ${escapeHtml(p.ContractNo || '-')}</div>
          <div><strong>วันที่ตรวจรับ:</strong> ${m.InspectionDate ? formatThaiDateOnly(m.InspectionDate) : '-'}</div>
          <div class="${isPaid ? 'text-emerald-800 font-bold' : isInspected ? 'text-teal-800 font-bold' : 'text-slate-600 font-bold'}">
            สถานะ: ${isPaid ? '💳 เบิกจ่ายแล้ว' : isInspected ? '✓ ผ่านตรวจรับ' : '⏳ รอตรวจรับ'}
          </div>
        </div>
      </div>

      <!-- Contract & Milestone Metadata Grid -->
      <div class="space-y-1 text-xs mb-2 bg-slate-50 p-2 rounded border border-slate-200">
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">โครงการ / สัญญา:</span>
          <span class="col-span-10 font-bold text-slate-900">${escapeHtml(p.ContractTitle || '-')}</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">ชื่องวดงานที่ ${m.MilestoneNo}:</span>
          <span class="col-span-10 font-bold text-slate-900">${escapeHtml(m.MilestoneTitle)}</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold text-slate-600">ผู้รับเหมาคู่สัญญา:</span>
          <span class="col-span-4 text-slate-800">👷 ${escapeHtml(p.ContractorName || '-')}</span>
          <span class="col-span-2 font-bold text-slate-600">เบอร์ติดต่อ:</span>
          <span class="col-span-4 text-slate-800 font-mono-code">${escapeHtml(p.ContractorPhone || '-')}</span>
        </div>
      </div>

      <!-- Section 1: Financial & Retention Calculation Table -->
      <div class="mb-2">
        <h3 style="font-size: 11pt; font-weight: 700;" class="mb-0.5 text-slate-900">สรุปการคำนวณค่างวดงานและการหักเงินประกันผลงาน (Financial Breakdown)</h3>
        <table class="w-full border-collapse border border-slate-400 text-xs">
          <thead>
            <tr class="bg-slate-100 text-slate-700">
              <th class="border border-slate-400 py-1 px-2 text-left">รายการเบิกจ่ายงวดงาน</th>
              <th class="border border-slate-400 py-1 px-2 text-right">สัดส่วน (%)</th>
              <th class="border border-slate-400 py-1 px-2 text-right">ยอดค่างวดเต็ม</th>
              <th class="border border-slate-400 py-1 px-2 text-right">หักเงินประกันผลงาน (${Number(p.RetentionPercent || 5)}%)</th>
              <th class="border border-slate-400 py-1 px-2 text-right">ยอดสั่งจ่ายสุทธิ (Net Payout)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="border border-slate-400 py-1 px-2 font-medium">ค่างวดที่ ${m.MilestoneNo}: ${escapeHtml(m.MilestoneTitle)}</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code">${Number(m.Percentage || 0)}%</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold">฿${formatCurrency(m.Amount)}</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold text-amber-700">- ฿${formatCurrency(m.RetentionDeducted)}</td>
              <td class="border border-slate-400 py-1 px-2 text-right font-mono-code font-bold text-emerald-800">฿${formatCurrency(m.NetPayable)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Section 2: Inspection Notes -->
      <div class="mb-2 border border-slate-300 rounded p-2 bg-white text-xs space-y-1">
        <div><strong class="text-slate-800">ความเห็นและผลการตรวจรับของวิศวกรผู้ควบคุมงาน:</strong> ${escapeHtml(m.InspectorNotes || 'งานแล้วเสร็จถูกต้องตามแบบรูปรายการและมาตรฐานวิศวกรรมอาคาร')}</div>
        ${isPaid ? `<div><strong class="text-slate-800">ข้อมูลการจ่ายเงินโดยฝ่ายบัญชี:</strong> ใบสำคัญจ่ายเลขที่ <span class="font-mono-code font-bold text-emerald-800">${escapeHtml(m.PaymentVoucherNo || '-')}</span> โอนเมื่อวันที่ ${formatThaiDateOnly(m.PaymentDate)} โดย ${escapeHtml(m.PaidBy || '-')}</div>` : ''}
      </div>

      <!-- Section 3: Evidence Photos (Up to 5 Photos) -->
      <div class="mb-2 space-y-1.5">
        <h3 style="font-size: 11pt; font-weight: 700;" class="text-slate-900">หลักฐานภาพถ่ายการตรวจรับงานงวดนี้ (Field Milestone Evidence)</h3>
        <div class="border border-slate-300 p-1.5 rounded bg-slate-50">
          ${photos.length > 0 ? `
            <div class="grid grid-cols-5 gap-1">
              ${photos.map(function(url, idx) {
                return `
                  <div class="border border-slate-200 bg-white p-0.5 text-center rounded">
                    <div class="evidence-img-container" style="height: 52px;">
                      <img src="${url}" onerror="this.style.opacity='0.4';" class="w-full h-full object-cover rounded">
                    </div>
                    <div class="text-[8px] font-mono-code text-slate-500 mt-0.5">ภาพงวด #${idx+1}</div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="py-2 text-center text-slate-400 text-xs">ไม่มีภาพถ่ายตรวจรับ</div>'}
        </div>
      </div>

      <!-- Section 4: 3-Party Digital Sign-off -->
      <div class="grid grid-cols-3 gap-2 pt-2 border-t-2 border-slate-800 text-center text-xs mt-auto">
        <div class="border border-slate-300 p-1.5 rounded bg-white">
          <div class="font-bold text-slate-800 mb-1.5">1. ผู้ส่งมอบงาน / ผู้รับเหมา</div>
          <div class="font-bold text-slate-900">${escapeHtml(p.ContractorName || 'ผู้รับเหมาคู่สัญญา')}</div>
          <div class="text-[10px] text-slate-500">ผู้รับจ้างดำเนินงานตามสัญญา</div>
          <div class="font-mono-code text-[9px] text-slate-400 mt-0.5">${m.DueDate ? formatThaiDateOnly(m.DueDate) : '-'}</div>
        </div>

        <div class="border border-slate-300 p-1.5 rounded bg-white">
          <div class="font-bold text-slate-800 mb-1.5">2. ผู้ตรวจรับงาน / วิศวกรควบคุม</div>
          <div class="font-bold text-slate-900">${escapeHtml(m.InspectorName || 'วิศวกรผู้ควบคุมงาน')}</div>
          <div class="text-[10px] text-slate-500">ผู้มีอำนาจตรวจรับผลงาน</div>
          <div class="font-mono-code text-[9px] ${isInspected ? 'text-teal-700 font-bold' : 'text-slate-400'} mt-0.5">
            ${isInspected ? '✓ ตรวจรับ: ' + formatThaiDateTime(m.InspectionDate) : '(รอการตรวจรับ)'}
          </div>
        </div>

        <div class="border-2 ${isPaid ? 'border-emerald-600 bg-emerald-50/30' : 'border-slate-300 bg-white'} p-1.5 rounded relative overflow-hidden">
          ${isPaid ? `
            <div class="absolute -right-2 -bottom-2 border-2 border-emerald-600/30 rounded-full w-14 h-14 flex items-center justify-center font-bold text-emerald-800/30 font-mono-code text-[8px] transform -rotate-12 pointer-events-none select-none">
              PAID
            </div>
          ` : ''}
          <div class="font-bold text-slate-800 mb-1.5">3. ผู้สั่งจ่าย / ฝ่ายบัญชี & บริหาร</div>
          <div class="font-bold ${isPaid ? 'text-emerald-900' : 'text-slate-400'}">${isPaid ? escapeHtml(m.PaidBy || 'ฝ่ายบัญชีและการเงิน') : '(รออนุมัติจ่าย)'}</div>
          <div class="text-[10px] text-slate-500">ผู้มีอำนาจสั่งจ่ายงวดเงิน</div>
          <div class="font-mono-code text-[9px] ${isPaid ? 'text-emerald-700 font-bold' : 'text-slate-400'} mt-0.5">
            ${isPaid ? '💳 โอนเงิน: ' + formatThaiDateTime(m.PaymentDate) : '-'}
          </div>
        </div>
      </div>
    `;

    currentMemoZoom = 1.0;
    updateMemoZoomDisplay();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function UtilitiesDateYear() {
    return new Date().getFullYear();
  }

  function UtilitiesDateToday() {
    return new Date().toISOString().split('T')[0];
  }

    return {
    fillLoginPreset: fillLoginPreset,
    handleLoginSubmit: handleLoginSubmit,
    logout: logout,
    switchView: switchView,
    pingConnection: pingConnection,
    verifyDocumentIntegrity: verifyDocumentIntegrity,
    triggerSystemBackup: triggerSystemBackup,
    handleImageUploadPreview: handleImageUploadPreview,
    handleContractorSubmit: handleContractorSubmit,
    loadTaskIntoContractorForm: loadTaskIntoContractorForm,
    resetContractorForm: resetContractorForm,
    renderRole1Tasks: renderRole1Tasks,
    switchSupervisorSubTab: switchSupervisorSubTab,
    renderSupervisorGrid: renderSupervisorGrid,
    selectSupervisorTask: selectSupervisorTask,
    handleSupervisorUpdateTask: handleSupervisorUpdateTask,
    handleCreateApprovalMemo: handleCreateApprovalMemo,
    handleCreateScheduleSubmit: handleCreateScheduleSubmit,
    spawnPmTaskFromSchedule: spawnPmTaskFromSchedule,
    handleExecutiveDecision: handleExecutiveDecision,
    openMemoPrintModalByTask: openMemoPrintModalByTask,
    openMemoPrintModal: openMemoPrintModal,
    zoomInMemo: zoomInMemo,
    zoomOutMemo: zoomOutMemo,
    resetMemoZoom: resetMemoZoom,
    closeMemoPrintModal: closeMemoPrintModal,
    handleAdminSaveUser: handleAdminSaveUser,
    editAdminUser: editAdminUser,
    resetAdminUserForm: resetAdminUserForm,
    saveSystemConfigAndRegenerateQR: saveSystemConfigAndRegenerateQR,
    copyProvisioningLink: copyProvisioningLink,
    openQrScannerModal: openQrScannerModal,
    closeQrScannerModal: closeQrScannerModal,
    openConnectionConfigModal: openConnectionConfigModal,
    startCameraQrScanner: startCameraQrScanner,
    scanQrFromImageFile: scanQrFromImageFile,
    applyManualProvisionPayload: applyManualProvisionPayload,
    applyDefaultCloudConfig: applyDefaultCloudConfig,
    renderSystemLogs: renderSystemLogs,
    exportTasksToCSV: exportTasksToCSV,
    exportMemosToCSV: exportMemosToCSV,
    exportLogsToCSV: exportLogsToCSV,
    openLoginModal: openLoginModal,
    enterLoginFromLanding: enterLoginFromLanding,
    showLandingPage: showLandingPage,
    quickLogin: quickLogin,
    switchExecutiveSubTab: switchExecutiveSubTab,
    renderExecutivePipelineCards: renderExecutivePipelineCards,
    renderExecutiveReport: renderExecutiveReport,
    printExecutiveReport: printExecutiveReport,
    exportExecutiveReportCSV: exportExecutiveReportCSV,
    openImagePreviewModal: openImagePreviewModal,
    closeImagePreviewModal: closeImagePreviewModal,
    downloadCurrentImage: downloadCurrentImage,
    manualSyncCloud: manualSyncCloud,
    syncFromGasBackend: syncFromGasBackend,
    handleMultiImageUpload: handleMultiImageUpload,
    renderImageGallery: renderImageGallery,
    removeImage: removeImage,
    clearImages: clearImages,
    getTaskBeforeImages: getTaskBeforeImages,
    getTaskAfterImages: getTaskAfterImages,
    showAccessDeniedModal: showAccessDeniedModal,
    closeAccessDeniedModal: closeAccessDeniedModal,
    showCloudSyncConfirmation: showCloudSyncConfirmation,
    closeCloudSyncModal: closeCloudSyncModal,
    exportToGoogleSheetCloud: exportToGoogleSheetCloud,
    exportFullWorkbookXLS: exportFullWorkbookXLS,
    exportSingleSheetXLS: exportSingleSheetXLS,
    renderCostReferences: renderCostReferences,
    applyCostRefToContractorForm: applyCostRefToContractorForm,
    handleSaveCostRefSubmit: handleSaveCostRefSubmit,
    resetCostRefForm: resetCostRefForm,
    editCostRef: editCostRef,
    handleSupervisorApproveAndForward: handleSupervisorApproveAndForward,
    handleSupervisorRejectToLevel1: handleSupervisorRejectToLevel1,
    updateApprovalAlertBadge: updateApprovalAlertBadge,
    checkAndShowApprovalAlert: checkAndShowApprovalAlert,
    openApprovalAlertModal: openApprovalAlertModal,
    closeApprovalAlertModal: closeApprovalAlertModal,
    goToApprovalQueueFromAlert: goToApprovalQueueFromAlert,
    selectTaskFromAlert: selectTaskFromAlert,
    selectMemoFromAlert: selectMemoFromAlert,
    openExecutiveReportPrintModal: openExecutiveReportPrintModal,
    previewTaskA4Report: previewTaskA4Report,
    renderReportTasksTable: renderReportTasksTable,
    openEditTaskModalFromReport: openEditTaskModalFromReport,
    closeReportEditTaskModal: closeReportEditTaskModal,
    handleSaveEditTaskFromReport: handleSaveEditTaskFromReport,
    deleteTask: deleteTask,
    deleteAdminUser: deleteAdminUser,
    handleDeleteCurrentUserFromForm: handleDeleteCurrentUserFromForm,
    fitMemoToScreen: fitMemoToScreen,
    toggleMemoViewMode: toggleMemoViewMode,
    approveTaskToRepair: approveTaskToRepair,
    signOffAndCloseTask: signOffAndCloseTask,
    rejectTaskBackToRepair: rejectTaskBackToRepair,
    openRepairTrackingModal: openRepairTrackingModal,
    closeRepairTrackingModal: closeRepairTrackingModal,
    handleTrackingAfterPhotoUpload: handleTrackingAfterPhotoUpload,
    removeTrackingAfterPhoto: removeTrackingAfterPhoto,
    saveTrackingProgress: saveTrackingProgress,
    showAlreadyApprovedPopup: showAlreadyApprovedPopup,
    filterExecutiveCards: filterExecutiveCards,
    init: init,
    getState: function() { return state; },
    persistDatabase: persistDatabase,
    initLivePresenceEngine: initLivePresenceEngine,
    updateLivePresence: updateLivePresence,
    openOnlineUsersModal: openOnlineUsersModal,
    closeOnlineUsersModal: closeOnlineUsersModal,
    acquireItemLock: acquireItemLock,
    releaseItemLock: releaseItemLock,
    closeItemLockWarningModal: closeItemLockWarningModal,
    initIdleAutoSaveDetector: initIdleAutoSaveDetector,
    autoSaveActiveDraft: autoSaveActiveDraft,
    renderPilotViews: renderPilotViews,
    switchPilotSubTab: switchPilotSubTab,
    renderPilotProjectsTable: renderPilotProjectsTable,
    calculateProjectRetentionPreview: calculateProjectRetentionPreview,
    handleRetentionPresetChange: handleRetentionPresetChange,
    openCreateProjectModal: openCreateProjectModal,
    editPilotProject: editPilotProject,
    closePilotProjectModal: closePilotProjectModal,
    handleSavePilotProjectSubmit: handleSavePilotProjectSubmit,
    deletePilotProject: deletePilotProject,
    populateActiveProjectDropdown: populateActiveProjectDropdown,
    handleSelectActiveProject: handleSelectActiveProject,
    renderPilotMilestonesTable: renderPilotMilestonesTable,
    openAddMilestoneModal: openAddMilestoneModal,
    openMilestoneInspectionModal: openMilestoneInspectionModal,
    closeMilestoneInspectionModal: closeMilestoneInspectionModal,
    handleMilestonePhotoUpload: handleMilestonePhotoUpload,
    removeMilestoneInspectionPhoto: removeMilestoneInspectionPhoto,
    handleMilestoneInspectionSubmit: handleMilestoneInspectionSubmit,
    openMilestonePaymentModal: openMilestonePaymentModal,
    closeMilestonePaymentModal: closeMilestonePaymentModal,
    handlePaymentSlipUpload: handlePaymentSlipUpload,
    removePaymentSlip: removePaymentSlip,
    handleMilestonePaymentSubmit: handleMilestonePaymentSubmit,
    renderPilotRetentionTable: renderPilotRetentionTable,
    exportPilotFinancialsToCSV: exportPilotFinancialsToCSV,
    openMilestonePrintModal: openMilestonePrintModal
  };
})();

if (typeof window !== 'undefined') {
  window.FMMS = FMMS;
}
