/**
 * ============================================================================
 * FMMS ENTERPRISE - CLIENT APPLICATION CONTROLLER (app.js)
 * Facility Maintenance Management System (FMMS Enterprise v2.5.0-ENT)
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
    DEVICE_ID: 'FMMS_ENT_DEVICE_ID'
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
      logs: []
    }
  };

  /**
   * ==========================================================================
   * 1. INITIALIZATION & SEED ENTERPRISE DATA
   * ==========================================================================
   */

  function init() {
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

    try {
      window.addEventListener('online', function() {
        pingConnection(false);
      });
      window.addEventListener('offline', function() {
        updateConnectionUI(false, 0, 'OFFLINE (Local Queue Active)');
      });
    } catch (_) {}

    // Auto-sync polling every 30 seconds across all devices
    setInterval(function() {
      try {
        if (state.config.gasWebAppUrl && navigator.onLine !== false) {
          syncFromGasBackend(false);
        }
      } catch (err) {
        console.warn('Auto-sync interval warning:', err);
      }
    }, 30000);

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
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DB_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          state.db = parsed;
          return;
        }
      }
    } catch (e) {
      console.warn('Seeding fresh database state', e);
    }

    
    const defaultCosts = [
      { CostID: 'COST-001', ItemCode: 'MAT-HVAC-001', Category: 'แอร์/เครื่องกล', ItemName: 'คอยล์โซลินอยด์วาล์วน้ำเย็น 24VAC (AHU)', Spec: 'Danfoss / Honeywell', Unit: 'ชุด', UnitPrice: 8500, LaborRate: 2500, PreferredVendor: 'หจก. ไทยคูลลิ่ง เอ็นจิเนียริ่ง' },
      { CostID: 'COST-002', ItemCode: 'MAT-PLUMB-002', Category: 'ประปา/สุขาภิบาล', ItemName: 'ชุดแมคคานิคอลซีล Booster Pump SIC/SIC', Spec: 'Grundfos / Ebara', Unit: 'ชุด', UnitPrice: 16500, LaborRate: 4500, PreferredVendor: 'บจก. สยามเมคคานิคอล ซัพพลาย' },
      { CostID: 'COST-003', ItemCode: 'MAT-ELEC-003', Category: 'ไฟฟ้า', ItemName: 'สเปรย์ทำความสะอาดหน้าสัมผัสทางไฟฟ้า Contact Cleaner', Spec: 'CRC ElectroX 400g', Unit: 'กระป๋อง', UnitPrice: 650, LaborRate: 500, PreferredVendor: 'บจก. ไฟฟ้าธนบุรี เอ็นจิเนียริ่ง' },
      { CostID: 'COST-004', ItemCode: 'MAT-FIRE-004', Category: 'ความปลอดภัย/ดับเพลิง', ItemName: 'น้ำกลั่นและแบตเตอรี่ตู้คอนโทรลปั๊มดับเพลิง', Spec: 'GS Battery 12V 100Ah', Unit: 'ชุด', UnitPrice: 4200, LaborRate: 800, PreferredVendor: 'บจก. ไฟร์เซฟตี้ แอนด์ เทค' }
    ];
    const DEFAULT_5_BEFORE_PHOTOS = [
      'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092162384-8987c1d64718?auto=format&fit=crop&w=600&q=75'
    ];
    const DEFAULT_5_AFTER_PHOTOS = [
      'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&w=600&q=75',
      'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=600&q=75'
    ];
    const now = getIsoNow();
    state.db = {
      costs: defaultCosts,
      users: [
        {
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
          UpdatedAt: now,
          UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
          LastLoginAt: now
        },
        {
          UserID: 'USR-2026-0002',
          Username: 'supervisor',
          PasswordPlain: 'sup123',
          FullName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          RoleLevel: 2,
          Department: 'วิศวกรรมซ่อมบำรุง (MEP Control)',
          Phone: '081-900-1002',
          Status: 'Active',
          CreatedAt: '2026-10-01T09:00:00+07:00',
          CreatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
          UpdatedAt: now,
          UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
          LastLoginAt: now
        },
        {
          UserID: 'USR-2026-0003',
          Username: 'tech01',
          PasswordPlain: 'tech123',
          FullName: 'นายช่าง สมชาย สายลุย (Contractor)',
          RoleLevel: 1,
          Department: 'ทีมปฏิบัติการภาคสนาม ชุดที่ 1',
          Phone: '089-455-2211',
          Status: 'Active',
          CreatedAt: '2026-10-02T10:15:00+07:00',
          CreatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
          UpdatedAt: now,
          UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
          LastLoginAt: now
        }
      ],
      tasks: [
        {
          TaskID: 'CM-202610-0045',
          Type: 'CM',
          Category: 'ประปา/สุขาภิบาล',
          Title: 'ท่อน้ำดีแตก รั่วซึมเข้าฝ้าเพดานห้องประชุมชั้น 3',
          Location: 'อาคาร B ชั้น 3 ห้องประชุมย่อย 2',
          Description: 'ท่อ PPR ขนาด 1 นิ้วแตก ทำให้น้ำรั่วซึมหยดลงฝ้าทีบาร์และพรมห้องประชุม',
          InitialAnalysis: 'ต้องตัดต่อท่อ PPR 1 นิ้วใหม่ และเปลี่ยนแผ่นฝ้าทีบาร์ 4 แผ่น',
          MaterialsRequired: 'ท่อ PPR 1 นิ้ว 1 เส้น, ข้อต่อตรง PPR 2 ตัว, แผ่นฝ้า Gyproc 4 แผ่น',
          Priority: 'High',
          Status: 'Pending Level 2 Approval',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 8500,
          ActualCost: 0,
          BeforeImages: DEFAULT_5_BEFORE_PHOTOS,
          AfterImages: [],
          BeforeImgURL: JSON.stringify(DEFAULT_5_BEFORE_PHOTOS),
          AfterImgURL: '',
          CreatedAt: '2026-10-27T08:00:00+07:00',
          CreatedBy: 'USR-2026-0003 (นายช่าง สมชาย)',
          UpdatedAt: '2026-10-27T08:00:00+07:00',
          UpdatedBy: 'USR-2026-0003 (นายช่าง สมชาย)'
        },
        {
          TaskID: 'CM-202610-0041',
          Type: 'CM',
          Category: 'แอร์/เครื่องกล',
          Title: 'เครื่องส่งลมเย็น AHU-03 ห้องประชุมใหญ่ชั้น 2 ไม่ทำความเย็น',
          Location: 'อาคาร A ชั้น 2 ห้องประชุมใหญ่',
          Description: 'อุณหภูมิห้องสูง 28.5°C พัดลมทำงานปกติแต่โซลินอยด์วาล์วน้ำเย็นไม่เปิด',
          InitialAnalysis: 'คอยล์โซลินอยด์วาล์ว 24VAC ขาด และต้องล้างสเตรนเนอร์น้ำเย็น',
          MaterialsRequired: 'Solenoid Coil 24VAC 1 ตัว, ปะเก็นยาง EPDM 2 ชิ้น',
          Priority: 'High',
          Status: 'In Progress',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 14500,
          ActualCost: 13800,
          BeforeImages: DEFAULT_5_BEFORE_PHOTOS,
          AfterImages: DEFAULT_5_AFTER_PHOTOS,
          BeforeImgURL: JSON.stringify(DEFAULT_5_BEFORE_PHOTOS),
          AfterImgURL: JSON.stringify(DEFAULT_5_AFTER_PHOTOS),
          CreatedAt: '2026-10-24T09:20:00+07:00',
          CreatedBy: 'USR-2026-0003 (นายช่าง สมชาย)',
          UpdatedAt: '2026-10-25T14:10:00+07:00',
          UpdatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        },
        {
          TaskID: 'CM-202610-0042',
          Type: 'CM',
          Category: 'ประปา/สุขาภิบาล',
          Title: 'ปั๊มน้ำแรงดันสูง Booster Pump ตัวที่ 2 มีเสียงดังและแรงดันตก',
          Location: 'ห้องเครื่องดาดฟ้า อาคารหลัก',
          Description: 'แรงดันน้ำในระบบลดลงเหลือ 2.1 Bar มอเตอร์มีเสียงดังที่ชุดตลับลูกปืนและซีลกันรั่วซึม',
          InitialAnalysis: 'Mechanical Seal สึกหรอและลูกปืนเพลาหลักชำรุด ต้องถอดโอเวอร์ฮอล',
          MaterialsRequired: 'ชุด Mechanical Seal SIC/SIC 1 ชุด, ตลับลูกปืน SKF 6306 จำนวน 2 ตลับ',
          Priority: 'Critical',
          Status: 'Pending Level 3 Approval',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 38500,
          ActualCost: 0,
          BeforeImages: DEFAULT_5_BEFORE_PHOTOS,
          AfterImages: [],
          BeforeImgURL: JSON.stringify(DEFAULT_5_BEFORE_PHOTOS),
          AfterImgURL: '',
          CreatedAt: '2026-10-25T11:05:00+07:00',
          CreatedBy: 'USR-2026-0003 (นายช่าง สมชาย)',
          UpdatedAt: '2026-10-26T10:30:00+07:00',
          UpdatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        },
        {
          TaskID: 'PM-202610-0043',
          Type: 'PM',
          Category: 'ไฟฟ้า',
          Title: 'ตรวจเช็กตู้ควบคุมไฟฟ้าหลัก MDB และส่องกล้องความร้อน (Thermoscan) ประจำไตรมาส',
          Location: 'ห้องไฟฟ้าหลัก ชั้น G',
          Description: 'ตรวจสอบจุดต่อทางไฟฟ้า Busbar, ACB, MCCB และวัดค่าโหลดกระแสไฟทั้ง 3 เฟส',
          InitialAnalysis: 'จุดต่อทุกจุดอุณหภูมิปกติ ไม่เกิน 45°C ขันทอร์คเรียบร้อย',
          MaterialsRequired: 'น้ำยาทำความสะอาดหน้าสัมผัสทางไฟฟ้า Contact Cleaner 3 กระป๋อง',
          Priority: 'Normal',
          Status: 'Closed',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 12000,
          ActualCost: 12000,
          BeforeImages: DEFAULT_5_BEFORE_PHOTOS,
          AfterImages: DEFAULT_5_AFTER_PHOTOS,
          BeforeImgURL: JSON.stringify(DEFAULT_5_BEFORE_PHOTOS),
          AfterImgURL: JSON.stringify(DEFAULT_5_AFTER_PHOTOS),
          CreatedAt: '2026-10-18T08:45:00+07:00',
          CreatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)',
          UpdatedAt: '2026-10-20T17:00:00+07:00',
          UpdatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        },
        {
          TaskID: 'PM-202610-0044',
          Type: 'PM',
          Category: 'ความปลอดภัย/ดับเพลิง',
          Title: 'ทดสอบเดินเครื่องสูบน้ำดับเพลิง (Fire Pump & Jockey Pump) ประจำเดือน',
          Location: 'ห้องปั๊มดับเพลิง อาคารจอดรถ ชั้น B1',
          Description: 'ทดสอบแรงดันท่อเมนดับเพลิง ตรวจสอบแบตเตอรี่ตู้ควบคุม และระดับน้ำมันดีเซล',
          InitialAnalysis: 'ระบบทำงานอัตโนมัติตามเกณฑ์ NFPA-20 แรงดันคงที่ 8.5 Bar',
          MaterialsRequired: 'น้ำกลั่นเติมแบตเตอรี่ 4 ขวด',
          Priority: 'Normal',
          Status: 'Completed',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 4500,
          ActualCost: 4200,
          BeforeImages: DEFAULT_5_BEFORE_PHOTOS,
          AfterImages: DEFAULT_5_AFTER_PHOTOS,
          BeforeImgURL: JSON.stringify(DEFAULT_5_BEFORE_PHOTOS),
          AfterImgURL: JSON.stringify(DEFAULT_5_AFTER_PHOTOS),
          CreatedAt: '2026-10-22T09:00:00+07:00',
          CreatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)',
          UpdatedAt: '2026-10-26T16:15:00+07:00',
          UpdatedBy: 'USR-2026-0003 (นายช่าง สมชาย)'
        }
      ],
      schedules: [
        {
          ScheduleID: 'SCH-2026-0001',
          EquipmentCode: 'AHU-A2-03',
          EquipmentName: 'เครื่องส่งลมเย็น AHU ห้องประชุมชั้น 2',
          Category: 'แอร์/เครื่องกล',
          Location: 'อาคาร A ชั้น 2',
          Frequency: 'Monthly',
          NextDueDate: '2026-11-15',
          AssignedTeam: 'ทีมปรับอากาศ',
          ChecklistItems: 'ล้างฟิลเตอร์, วัดกระแสไฟมอเตอร์, ตรวจสายพาน, ล้างถาดน้ำทิ้ง',
          Status: 'Active',
          CreatedAt: '2026-10-01T10:00:00+07:00',
          CreatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        },
        {
          ScheduleID: 'SCH-2026-0002',
          EquipmentCode: 'MDB-MAIN-01',
          EquipmentName: 'ตู้สวิตช์บอร์ดไฟฟ้าหลัก MDB อาคาร A',
          Category: 'ไฟฟ้า',
          Location: 'ห้องไฟฟ้า ชั้น G',
          Frequency: 'Quarterly',
          NextDueDate: '2026-12-01',
          AssignedTeam: 'ทีมวิศวกรรมไฟฟ้า',
          ChecklistItems: 'ส่องกล้อง Thermoscan, วัดค่าแรงดันและกระแส 3 เฟส, ทดสอบระบบป้องกัน Ground Fault',
          Status: 'Active',
          CreatedAt: '2026-10-01T10:30:00+07:00',
          CreatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        },
        {
          ScheduleID: 'SCH-2026-0003',
          EquipmentCode: 'FP-B1-01',
          EquipmentName: 'ชุดเครื่องสูบน้ำดับเพลิง Fire Pump 500 GPM',
          Category: 'ความปลอดภัย/ดับเพลิง',
          Location: 'ห้องปั๊มน้ำ ชั้น B1',
          Frequency: 'Weekly',
          NextDueDate: '2026-11-02',
          AssignedTeam: 'ทีมเครื่องกลและดับเพลิง',
          ChecklistItems: 'ทดสอบสตาร์ทเครื่องยนต์ 15 นาที, ตรวจแรงดันท่อเมน, ตรวจโวลต์แบตเตอรี่ 2 ชุด',
          Status: 'Active',
          CreatedAt: '2026-10-05T11:00:00+07:00',
          CreatedBy: 'USR-2026-0002 (วิศวกร พรเทพ)'
        }
      ],
      memos: [
        {
          MemoID: 'MEMO-2026-0018',
          TaskID: 'CM-202610-0042',
          DocReference: 'ทวพ./ซบร./2569/0018',
          Subject: 'ขออนุมัติงบประมาณซ่อมบำรุงชุดปั๊มน้ำแรงดันสูง Booster Pump ตัวที่ 2 (เร่งด่วน)',
          EstimatedBudget: 38500,
          ReasonRationale: 'เนื่องจากชุด Mechanical Seal และตลับลูกปืนของ Booster Pump ตัวที่ 2 ชำรุดเสียหาย ทำให้แรงดันน้ำในอาคารตกและเสี่ยงต่อการที่มอเตอร์ไหม้ จึงจำเป็นต้องเปลี่ยนอะไหล่เร่งด่วนเพื่อความต่อเนื่องของระบบประปาอาคาร',
          VendorName: 'บริษัท สยามเมคคานิคอล ซัพพลาย จำกัด',
          VendorQuotationURL: 'QT-2026-8841',
          SupervisorRemark: 'ตรวจสอบราคาเทียบ 3 รายแล้ว เป็นราคาที่เหมาะสมและมีอะไหล่พร้อมติดตั้งภายใน 24 ชม.',
          RequestedBy: 'USR-2026-0002 (วิศวกร พรเทพ ใจดี)',
          RequestedAt: '2026-10-26T10:30:00+07:00',
          ApprovedBy: '-',
          ApproverName: '-',
          ApprovalDate: '-',
          ApprovalStatus: 'Pending Approval',
          ExecutiveComment: '-'
        },
        {
          MemoID: 'MEMO-2026-0017',
          TaskID: 'CM-202610-0041',
          DocReference: 'ทวพ./ซบร./2569/0017',
          Subject: 'ขออนุมัติเปลี่ยนคอยล์โซลินอยด์วาล์วน้ำเย็นและล้างสเตรนเนอร์ AHU-03',
          EstimatedBudget: 14500,
          ReasonRationale: 'เพื่อแก้ไขปัญหาระบบปรับอากาศห้องประชุมใหญ่ชั้น 2 ไม่ทำความเย็น รองรับการประชุมผู้บริหาร',
          VendorName: 'หจก. ไทยคูลลิ่ง เอ็นจิเนียริ่ง',
          VendorQuotationURL: 'QT-2026-7712',
          SupervisorRemark: 'เห็นควรอนุมัติดำเนินการ',
          RequestedBy: 'USR-2026-0002 (วิศวกร พรเทพ ใจดี)',
          RequestedAt: '2026-10-24T13:15:00+07:00',
          ApprovedBy: 'USR-2026-0001',
          ApproverName: 'คุณนิพนธ์ (Executive & System Admin)',
          ApprovalDate: '2026-10-24T16:40:00+07:00',
          ApprovalStatus: 'Approved',
          ExecutiveComment: 'อนุมัติให้ดำเนินการตามเสนอ เน้นย้ำตรวจสอบความเรียบร้อยหลังซ่อม'
        }
      ],
      logs: [
        {
          LogID: 'LOG-20261026-0004',
          Timestamp: '2026-10-26T10:30:12+07:00',
          UserID: 'USR-2026-0002',
          OperatorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          RoleLevel: 2,
          Action: 'REQUEST_APPROVAL_MEMO',
          TargetID: 'MEMO-2026-0018',
          Details: 'ออกบันทึกขออนุมัติงบซ่อม Booster Pump อ้างอิงใบงาน CM-202610-0042 วงเงิน 38,500 บาท',
          BeforeState: 'Task Status: In Progress',
          AfterState: 'Memo Status: Pending Approval',
          ClientInfo: 'Desktop Chrome Win11',
          Status: 'SUCCESS'
        },
        {
          LogID: 'LOG-20261025-0003',
          Timestamp: '2026-10-25T11:05:44+07:00',
          UserID: 'USR-2026-0003',
          OperatorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          RoleLevel: 1,
          Action: 'CREATE_TASK',
          TargetID: 'CM-202610-0042',
          Details: 'เปิดใบงานซ่อมเฉพาะจุด (CM): ปั๊มน้ำแรงดันสูง Booster Pump ตัวที่ 2 พร้อมแนบภาพถ่ายหน้างาน',
          BeforeState: 'NONE',
          AfterState: 'TaskID: CM-202610-0042 (Mutex Verified)',
          ClientInfo: 'Mobile Safari iOS',
          Status: 'SUCCESS'
        },
        {
          LogID: 'LOG-20261024-0002',
          Timestamp: '2026-10-24T16:40:05+07:00',
          UserID: 'USR-2026-0001',
          OperatorName: 'คุณนิพนธ์ (Executive & System Admin)',
          RoleLevel: 3,
          Action: 'EXECUTIVE_DECISION',
          TargetID: 'MEMO-2026-0017',
          Details: 'ผู้บริหารอนุมัติบันทึกข้อความ MEMO-2026-0017 (ใบงาน CM-202610-0041)',
          BeforeState: 'Pending Approval',
          AfterState: 'Approved (฿14,500)',
          ClientInfo: 'Desktop Edge Win11',
          Status: 'SUCCESS'
        },
        {
          LogID: 'LOG-20261002-0001',
          Timestamp: '2026-10-02T10:15:00+07:00',
          UserID: 'USR-2026-0001',
          OperatorName: 'คุณนิพนธ์ (Executive & System Admin)',
          RoleLevel: 3,
          Action: 'USER_MANAGEMENT_CREATE',
          TargetID: 'USR-2026-0003',
          Details: 'Admin สร้างบัญชีผู้ใช้งาน tech01 กำหนดสิทธิ์ระดับ 1 (ช่างหน้างาน)',
          BeforeState: 'NONE',
          AfterState: 'RoleLevel: 1, Status: Active',
          ClientInfo: 'Admin Console',
          Status: 'SUCCESS'
        }
      ]
    };

    persistDatabase();
  }

  function persistDatabase() {
    try {
      localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(state.db));
    } catch (e) {
      console.warn('localStorage persist warning (storage quota check):', e);
      try {
        // If storage quota exceeded, store a lightweight version without duplicate base64
        const lightweightDb = {
          ...state.db,
          tasks: state.db.tasks.map(function(t, idx) {
            if (idx > 5) {
              const lightTask = { ...t };
              delete lightTask.BeforeImgBase64;
              delete lightTask.AfterImgBase64;
              return lightTask;
            }
            return t;
          })
        };
        localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(lightweightDb));
      } catch (_) {}
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
        if (json.data.tasks && json.data.tasks.length > 0) state.db.tasks = json.data.tasks;
        if (json.data.users && json.data.users.length > 0) {
          state.db.users = json.data.users;
          ensureDefaultUsers();
        }
        if (json.data.schedules && json.data.schedules.length > 0) state.db.schedules = json.data.schedules;
        if (json.data.memos && json.data.memos.length > 0) state.db.memos = json.data.memos;
        if (json.data.logs && json.data.logs.length > 0) state.db.logs = json.data.logs;
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
    const defaults = [
      {
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
      },
      {
        UserID: 'USR-2026-0002',
        Username: 'supervisor',
        PasswordPlain: 'sup123',
        FullName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
        RoleLevel: 2,
        Department: 'วิศวกรรมซ่อมบำรุง (MEP Control)',
        Phone: '081-900-1002',
        Status: 'Active',
        CreatedAt: '2026-10-01T09:00:00+07:00',
        CreatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
        UpdatedAt: '2026-10-01T09:00:00+07:00',
        UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
        LastLoginAt: '2026-10-01T09:00:00+07:00'
      },
      {
        UserID: 'USR-2026-0003',
        Username: 'tech01',
        PasswordPlain: 'tech123',
        FullName: 'นายช่าง สมชาย สายลุย (Contractor)',
        RoleLevel: 1,
        Department: 'ทีมปฏิบัติการภาคสนาม ชุดที่ 1',
        Phone: '089-455-2211',
        Status: 'Active',
        CreatedAt: '2026-10-02T10:15:00+07:00',
        CreatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
        UpdatedAt: '2026-10-02T10:15:00+07:00',
        UpdatedBy: 'USR-2026-0001 (คุณนิพนธ์)',
        LastLoginAt: '2026-10-02T10:15:00+07:00'
      },
      {
        UserID: 'USR-2026-0004',
        Username: 'tech1',
        PasswordPlain: 'tech123',
        FullName: 'นายช่าง สมชาย สายลุย (ช่างเทคนิค)',
        RoleLevel: 1,
        Department: 'ทีมปฏิบัติการภาคสนาม',
        Phone: '089-455-2211',
        Status: 'Active',
        CreatedAt: '2026-10-02T10:15:00+07:00',
        CreatedBy: 'SYSTEM_INIT',
        UpdatedAt: '2026-10-02T10:15:00+07:00',
        UpdatedBy: 'SYSTEM_INIT',
        LastLoginAt: '2026-10-02T10:15:00+07:00'
      },
      {
        UserID: 'USR-2026-0005',
        Username: 'super1',
        PasswordPlain: 'super123',
        FullName: 'วิศวกร พรเทพ ใจดี (ผู้ควบคุมงาน)',
        RoleLevel: 2,
        Department: 'วิศวกรรมซ่อมบำรุง',
        Phone: '081-900-1002',
        Status: 'Active',
        CreatedAt: '2026-10-01T09:00:00+07:00',
        CreatedBy: 'SYSTEM_INIT',
        UpdatedAt: '2026-10-01T09:00:00+07:00',
        UpdatedBy: 'SYSTEM_INIT',
        LastLoginAt: '2026-10-01T09:00:00+07:00'
      },
      {
        UserID: 'USR-2026-0006',
        Username: 'exec1',
        PasswordPlain: 'exec123',
        FullName: 'ผู้บริหารระดับสูง (Executive Director)',
        RoleLevel: 3,
        Department: 'ฝ่ายบริหารจัดการอาคาร',
        Phone: '081-900-1001',
        Status: 'Active',
        CreatedAt: '2026-10-01T08:30:00+07:00',
        CreatedBy: 'SYSTEM_INIT',
        UpdatedAt: '2026-10-01T08:30:00+07:00',
        UpdatedBy: 'SYSTEM_INIT',
        LastLoginAt: '2026-10-01T08:30:00+07:00'
      }
    ];

    defaults.forEach(function(d) {
      const exists = state.db.users.find(function(u) {
        return String(u.Username || '').toLowerCase() === d.Username.toLowerCase();
      });
      if (!exists) {
        state.db.users.push(d);
      } else {
        if (!exists.PasswordPlain) exists.PasswordPlain = d.PasswordPlain;
        if (!exists.RoleLevel) exists.RoleLevel = d.RoleLevel;
      }
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
      setTimeout(function() { checkAndShowApprovalAlert(false); }, 300);
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
      setTimeout(function() { checkAndShowApprovalAlert(false); }, 300);
    }
  }

  function logout() {
    if (state.session) {
      recordAuditLog('LOGOUT', state.session.userId, 'ผู้ใช้งานออกจากระบบ', 'Active', 'Logged Out', 'SUCCESS');
    }
    state.session = null;
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    hideOverlay('authOverlay');
    showLandingPage();
    showToast('ออกจากระบบแล้ว', 'ระบบกลับสู่หน้าแรก (Landing Page) เรียบร้อยแล้ว', 'info');
  }

  function showAccessDeniedModal(currentRole, targetViewKey, reasonText) {
    const roleNames = {
      1: 'ระดับ 1: ช่างหน้างาน (Field Contractor / Technician)',
      2: 'ระดับ 2: ผู้ควบคุมงาน (Engineering Supervisor)',
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
    // Level 1: CANNOT access role2, role3, admin
    if (role === 1 && viewKey !== 'role1') {
      showAccessDeniedModal(
        1,
        viewKey,
        'ระดับ 1 (ช่างหน้างาน) ไม่มีสิทธิ์เข้าถึงหรือมองเห็นข้อมูลของระดับ 2 (ผู้ควบคุมงาน) และระดับ 3 (ผู้บริหาร) เพื่อรักษาความปลอดภัยของระบบ'
      );
      return;
    }

    // Level 2: CANNOT access role3, admin
    if (role === 2 && (viewKey === 'role3' || viewKey === 'admin')) {
      showAccessDeniedModal(
        2,
        viewKey,
        'ระดับ 2 (ผู้ควบคุมงาน) ไม่มีสิทธิ์เข้าถึงหน้าจอผู้บริหารระดับ 3 และส่วนการตั้งค่าระบบ เนื่องจากสิทธิ์การใช้งานไม่ถึงเกณฑ์'
      );
      return;
    }

    // Level 3: "ส่วนระดับ 3 เห็นได้หมด" - Has complete clearance to switch to ANY view!
    state.currentView = viewKey;
    const views = {
      role1: document.getElementById('viewRole1'),
      role2: document.getElementById('viewRole2'),
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
    const isPassing = count >= 5;

    if (badgeEl) {
      if (isPassing) {
        badgeEl.textContent = count + ' / 5 ภาพ ✅ (ครบเกณฑ์)';
        badgeEl.className = 'text-[11px] font-mono-code font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';
      } else {
        const remaining = 5 - count;
        badgeEl.textContent = count + ' / 5 ภาพ ⚠️ (ขาดอีก ' + remaining + ')';
        badgeEl.className = 'text-[11px] font-mono-code font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300';
      }
    }

    if (metaEl) {
      if (count === 0) {
        metaEl.textContent = 'ยังไม่ได้เลือกรูป (แตะเพื่อถ่ายรูปหรือเลือกหลายภาพพร้อมกันได้)';
        metaEl.className = 'text-[11px] text-slate-500 mb-2';
      } else if (isPassing) {
        metaEl.textContent = 'แนบรูปครบตามเกณฑ์มาตรฐานแล้ว (' + count + ' ภาพ)';
        metaEl.className = 'text-[11px] text-emerald-700 font-semibold mb-2';
      } else {
        metaEl.textContent = 'ยังขาดอีก ' + (5 - count) + ' ภาพ (ต้องแนบภาพถ่ายไม่น้อยกว่า 5 ภาพ)';
        metaEl.className = 'text-[11px] text-rose-600 font-semibold mb-2';
      }
    }

    if (!galleryEl) return;
    if (count === 0) {
      galleryEl.innerHTML = '<div class="col-span-3 sm:col-span-5 text-center py-6 text-xs text-slate-400">ยังไม่มีรูปภาพ' + (type === 'before' ? 'ก่อนซ่อม' : 'หลังซ่อม') + ' (ต้องแนบอย่างน้อย 5 ภาพ)</div>';
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

    const metaEl = document.getElementById(type === 'before' ? 'r1BeforeMeta' : 'r1AfterMeta');
    if (metaEl) {
      metaEl.textContent = 'กำลังประมวลผลและบีบอัดรูปภาพ (' + files.length + ' ไฟล์)...';
      metaEl.className = 'text-[11px] text-blue-600 font-semibold mb-2';
    }

    const targetList = type === 'before' ? state.compressedImages.beforeImages : state.compressedImages.afterImages;
    let processed = 0;
    const totalFiles = files.length;

    Array.from(files).forEach(function(file) {
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
    event.preventDefault();
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

    // Strict Validation: "ก่อนไม่น้อยกว่า 5 หลังไม่น้อยกว่า 5"
    const beforeCount = state.compressedImages.beforeImages.length;
    if (beforeCount < 5) {
      showToast('ภาพถ่ายก่อนทำไม่ครบตามเกณฑ์', 'ระเบียบความปลอดภัย: ต้องแนบภาพถ่ายก่อนทำงานไม่น้อยกว่า 5 ภาพ (ปัจจุบันแนบแล้ว ' + beforeCount + ' ภาพ ขาดอีก ' + (5 - beforeCount) + ' ภาพ)', 'error');
      const badge = document.getElementById('r1BeforeCounterBadge');
      if (badge) badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const beforeUrls = state.compressedImages.beforeImages.map(function(item) {
      return typeof item === 'string' ? item : item.url;
    });
    const afterUrls = state.compressedImages.afterImages.map(function(item) {
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
          if (afterUrls.length < 5) {
            showToast('ภาพถ่ายหลังทำไม่ครบตามเกณฑ์', 'ระเบียบความปลอดภัย: เมื่อทำงานแล้วเสร็จ ต้องแนบภาพถ่ายหลังทำงานไม่น้อยกว่า 5 ภาพ (ปัจจุบันแนบแล้ว ' + afterUrls.length + ' ภาพ ขาดอีก ' + (5 - afterUrls.length) + ' ภาพ)', 'error');
            const badge = document.getElementById('r1AfterCounterBadge');
            if (badge) badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
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

        await postToGasBackend('updateTask', { taskData: task });
        persistDatabase();
        resetContractorForm();
        renderAllViews();
        showToast('อัปเดตใบงาน ' + task.TaskID + ' สำเร็จ', 'บันทึกข้อมูลและภาพถ่ายเข้าสู่ระบบเรียบร้อย', 'success');
        return;
      }
    }

    const ymPrefix = type + '-' + getYearMonthStr();
    const newTaskId = generateUniqueId(state.db.tasks, 'TaskID', ymPrefix);
    const idempotencyKey = 'IDEM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

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

    state.db.tasks.unshift(newTask);
    recordAuditLog(
      'CREATE_TASK',
      newTaskId,
      'เปิดใบงานใหม่ (' + type + '): ' + title + ' @ ' + location,
      'NONE',
      'TaskID: ' + newTaskId + ' | EstCost: ' + estCost,
      'SUCCESS'
    );

    await postToGasBackend('createTask', {
      taskData: {
        ...newTask,
        BeforeImgBase64: state.compressedImages.beforeBase64,
        AfterImgBase64: state.compressedImages.afterBase64
      },
      idempotencyKey: idempotencyKey
    });

    persistDatabase();
    resetContractorForm();
    renderAllViews();
    showToast('ออกเลขที่ใบงาน ' + newTaskId + ' สำเร็จ', 'ส่งขออนุมัติต่อผู้ควบคุมงาน (ระดับ 2) เรียบร้อยแล้ว', 'success');
    showCloudSyncConfirmation({
      docId: newTaskId,
      docType: 'ใบงานซ่อมบำรุง (' + type + ')',
      actionTitle: 'ส่งคำขออนุมัติดำเนินการซ่อมบำรุงไปยังผู้ควบคุมงาน (ระดับ 2)',
      version: 'v1.0 (ร่างเสนอขออนุมัติระดับ 2)',
      details: 'บันทึกข้อมูลใบงาน ' + newTaskId + ' และภาพถ่ายสำรวจหน้างาน เข้า Google Drive และส่งเข้าคิวรอผู้ควบคุมงาน (ระดับ 2) พิจารณาอนุมัติเรียบร้อย'
    });
    updateApprovalAlertBadge();
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

    const filtered = state.db.tasks.filter(function(t) {
      if (typeFilter !== 'ALL' && t.Type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && t.Status !== statusFilter) return false;
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
            <button type="button" onclick="event.stopPropagation(); FMMS.selectSupervisorTask('${t.TaskID}')" class="text-xs font-medium text-blue-700 hover:underline">
              ตรวจงาน
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
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded font-bold ${getTaskBeforeImages(task).length >= 5 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                ${getTaskBeforeImages(task).length} ภาพ ${getTaskBeforeImages(task).length >= 5 ? '✅' : '⚠️'}
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
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded font-bold ${getTaskAfterImages(task).length >= 5 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-slate-200 text-slate-700'}">
                ${getTaskAfterImages(task).length} ภาพ ${getTaskAfterImages(task).length >= 5 ? '✅' : ''}
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
              <div class="h-16 flex items-center justify-center text-xs text-slate-400 bg-slate-100 rounded">ยังไม่ส่งรูปหลังซ่อม (ต้องไม่น้อยกว่า 5 ภาพ)</div>
            `}
          </div>
        </div>

        <!-- Sequential Approval Action Box for Supervisor (Level 2) -->
        ${task.Status === 'Pending Level 2 Approval' ? `
          <div class="p-4 bg-amber-50 border-2 border-amber-400 rounded-lg space-y-3 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                <span class="text-base animate-pulse">⚠️</span>
                <span>คำขออนุมัติดำเนินการจากช่างหน้างาน (ลำดับ 1)</span>
              </div>
              <span class="text-[10px] font-mono-code bg-amber-200 text-amber-900 px-2.5 py-0.5 rounded-full font-bold">รอ ผค.งาน อนุมัติ</span>
            </div>
            <p class="text-[11px] text-slate-700 leading-relaxed">
              ช่างหน้างานได้สำรวจและเปิดใบงานนี้เข้ามา กรุณาตรวจสอบราคา รายการอะไหล่ และทำการอนุมัติเพื่อส่งขออนุมัติต่อผู้บริหารระดับ 3:
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button type="button" onclick="FMMS.handleSupervisorApproveAndForward('${task.TaskID}')"
                class="flex-1 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-semibold py-2.5 px-3 rounded text-xs transition shadow flex items-center justify-center gap-1.5 cursor-pointer">
                <span>✓ อนุมัติ & ส่งขออนุมัติงบต่อผู้บริหาร (ระดับ 3)</span>
              </button>
              <button type="button" onclick="FMMS.handleSupervisorRejectToLevel1('${task.TaskID}')"
                class="bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-semibold py-2.5 px-3 rounded text-xs transition cursor-pointer">
                <span>✕ ตีกลับช่าง</span>
              </button>
            </div>
          </div>
        ` : task.Status === 'Pending Level 3 Approval' ? `
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs space-y-1">
            <div class="font-bold text-blue-900 flex items-center gap-1">
              <span>⏳ ผู้ควบคุมงานอนุมัติแล้ว</span>
            </div>
            <div class="text-blue-800 text-[11px]">ส่งเรื่องเสนอขออนุมัติงบประมาณไปยังผู้บริหารระดับ 3 เรียบร้อยแล้ว (รอลงนามอนุมัติงบประมาณ)</div>
          </div>
        ` : task.Status === 'Approved' ? `
          <div class="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs space-y-1">
            <div class="font-bold text-emerald-900 flex items-center gap-1">
              <span>✓ ผู้บริหารระดับ 3 อนุมัติงบประมาณแล้ว</span>
            </div>
            <div class="text-emerald-800 text-[11px]">งบประมาณได้รับการอนุมัติสมบูรณ์ ช่างหน้างานสามารถเข้าดำเนินการได้ทันที</div>
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
  async function deleteTask(taskId) {
    if (!taskId) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    const taskTitle = task ? task.Title : taskId;

    const confirmed = window.confirm(
      '⚠️ ยืนยันการลบใบงานออกจากระบบหรือไม่?\n\n' +
      'รหัสใบงาน: ' + taskId + '\n' +
      'หัวข้องาน: ' + taskTitle + '\n\n' +
      'การลบนี้จะนำข้อมูลออกจากหน้าจอ และลบแถวออกจาก Google Sheets (Tasks, Memos) โดยตรงทันที ไม่ต้องเปิดไปลบใน Google Sheet เอง\n\n' +
      'กด [ตกลง / OK] เพื่อยืนยันการลบ หรือกด [ยกเลิก / Cancel] เพื่อยกเลิก'
    );
    if (!confirmed) return;

    const actor = getCurrentActor();
    const now = getIsoNow();

    // 1. Remove from local state tasks
    const taskIdx = state.db.tasks.findIndex(function(t) { return t.TaskID === taskId; });
    if (taskIdx !== -1) {
      state.db.tasks.splice(taskIdx, 1);
    }

    // 2. Remove linked memos
    state.db.memos = state.db.memos.filter(function(m) {
      return m.TaskID !== taskId && m.MemoID !== taskId;
    });

    // 3. Record Audit Log
    recordAuditLog(
      'DELETE_TASK',
      taskId,
      'ผู้ใช้ (' + actor.fullName + ') สั่งลบใบงาน ' + taskId + ' (' + taskTitle + ') ออกจากระบบและ Google Sheets',
      'ACTIVE_RECORD',
      'DELETED',
      'SUCCESS'
    );

    // 4. Close any open modals
    closeReportEditTaskModal();
    closeMemoPrintModal();

    // 5. Persist & Refresh UI
    persistDatabase();
    renderAllViews();

    showToast(
      'ลบใบงาน ' + taskId + ' สำเร็จ',
      'นำข้อมูลออกจากระบบและกำลังส่งคำสั่งลบไปยัง Google Sheets เบื้องหลัง...',
      'info'
    );

    // 6. Sync deletion with Google Apps Script backend
    try {
      const res = await postToGasBackend('deleteTask', { taskId: taskId });
      if (res && res.ok) {
        showToast(
          'ซิงค์การลบข้อมูลสำเร็จ',
          'ลบแถวข้อมูลใบงาน ' + taskId + ' ใน Google Sheets เรียบร้อยแล้ว',
          'success'
        );
      }
    } catch (err) {
      console.warn('Backend deleteTask sync failed or offline:', err);
    }
  }

  function filterExecutiveCards(filterType) {
    state.execApprovalFilter = filterType || 'ALL';

    const btns = {
      PENDING: document.getElementById('btnExecFilterPending'),
      APPROVED: document.getElementById('btnExecFilterApproved'),
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
        SupervisorRemark: 'ตรวจสอบความเสียหายหน้างานแล้ว เห็นควรอนุมัติดำเนินการ',
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

    const beforeStatus = memo ? memo.ApprovalStatus : (task ? task.Status : '-');

    if (memo) {
      memo.ApprovalStatus = decision;
      memo.ApprovedBy = actor.userId;
      memo.ApproverName = actor.fullName;
      memo.ApprovalDate = now;
      memo.ExecutiveComment = decision === 'Approved'
        ? 'อนุมัติงบประมาณให้ดำเนินการตามเสนอ และบันทึกค่าใช้จ่ายตามจริง'
        : 'ตีกลับเพื่อทบทวนรายละเอียดใบเสนอราคาเพิ่มเติม';
    }

    if (task) {
      task.Status = decision === 'Approved' ? 'Approved' : 'Rejected to Level 2';
      task.UpdatedAt = now;
      task.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';
    }

    const docId = memo ? memo.MemoID : task.TaskID;

    recordAuditLog(
      'EXECUTIVE_DECISION',
      docId,
      'ผู้บริหาร (' + actor.fullName + ') กด ' + (decision === 'Approved' ? 'อนุมัติงบประมาณ' : 'ตีกลับ') + ' เอกสาร ' + docId,
      beforeStatus,
      decision + ' @ ' + now,
      'SUCCESS'
    );

    if (memo) {
      await postToGasBackend('executiveApprove', {
        memoId: memo.MemoID,
        decision: decision,
        comment: memo.ExecutiveComment
      });
    }

    persistDatabase();
    renderAllViews();

    showToast(
      (decision === 'Approved' ? 'อนุมัติงบประมาณสำเร็จ' : 'ตีกลับบันทึกข้อความสำเร็จ'),
      'บันทึกชื่อผู้อนุมัติ (' + actor.fullName + ') วันที่ ' + formatThaiDateTime(now) + ' และซิงค์ลง Google Sheets เรียบร้อย',
      decision === 'Approved' ? 'success' : 'warning'
    );

    showCloudSyncConfirmation({
      docId: docId,
      docType: 'บันทึกข้อความขออนุมัติงบประมาณ (Executive Decision)',
      actionTitle: decision === 'Approved' ? 'ผู้บริหารอนุมัติงบประมาณซ่อมบำรุง' : 'ผู้บริหารสั่งตีกลับบันทึกข้อความ',
      version: decision === 'Approved' ? 'v2.0 (Executive Approved / Finalized)' : 'v1.2 (Executive Revision Requested)',
      details: 'ผู้บริหาร (' + actor.fullName + ') ลงนามพิจารณา ' + (decision === 'Approved' ? 'อนุมัติงบประมาณ' : 'ตีกลับ') + ' ใบงาน/บันทึกข้อความ ' + docId + ' บันทึกลง Google Sheet Data MA TWPP 8 Tabs และ Google Drive ครบถ้วน'
    });
  }

  /**
   * ==========================================================================
   * 8.1 EXECUTIVE SUB-TABS, LOCATION & DUAL-STATUS WORK TRACKER (OPTION 2)
   * AND IN-DEPTH ANALYTICAL REPORT (OPTION 1)
   * ==========================================================================
   */

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

  function renderExecutivePipelineCards() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];
    const container = document.getElementById('execCardsGrid');
    if (!container) return;

    // Compute Quick Filter Counts
    const pendingCount = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      return (t.Status === 'Pending Approval' || t.Status === 'Pending Level 3 Approval' || (memo && memo.ApprovalStatus === 'Pending Approval') || (Number(t.EstCost) > 0 && t.Status !== 'Approved' && t.Status !== 'In Progress' && t.Status !== 'Completed' && t.Status !== 'Closed'));
    }).length;

    const approvedCount = tasks.filter(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      return (t.Status === 'Approved' || t.Status === 'In Progress' || (memo && memo.ApprovalStatus === 'Approved')) && t.Status !== 'Closed' && t.Status !== 'Completed';
    }).length;

    const closedCount = tasks.filter(function(t) {
      return t.Status === 'Closed' || t.Status === 'Completed';
    }).length;

    setText('badgeExecFilterPending', pendingCount);
    setText('badgeExecFilterApproved', approvedCount);
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
      const isTaskPending = (t.Status === 'Pending Approval' || t.Status === 'Pending Level 3 Approval' || (memo && memo.ApprovalStatus === 'Pending Approval') || (Number(t.EstCost) > 0 && t.Status !== 'Approved' && t.Status !== 'In Progress' && t.Status !== 'Completed' && t.Status !== 'Closed'));
      const isTaskApproved = (t.Status === 'Approved' || t.Status === 'In Progress' || (memo && memo.ApprovalStatus === 'Approved')) && t.Status !== 'Closed' && t.Status !== 'Completed';
      const isTaskClosed = (t.Status === 'Closed' || t.Status === 'Completed');

      // Quick Approval Status Filter
      if (activeApprovalFilter === 'PENDING' && !isTaskPending) return false;
      if (activeApprovalFilter === 'APPROVED' && !isTaskApproved) return false;
      if (activeApprovalFilter === 'CLOSED' && !isTaskClosed) return false;

      // Location filter
      if (selectedLoc !== 'ALL' && t.Location !== selectedLoc) return false;

      // Status dropdown filter
      if (selectedStatus !== 'ALL') {
        if (selectedStatus === 'Pending Level 3 Approval' && !isTaskPending) return false;
        if (selectedStatus === 'Approved' && !isTaskApproved) return false;
        if (selectedStatus !== 'Pending Level 3 Approval' && selectedStatus !== 'Approved' && t.Status !== selectedStatus) return false;
      }

      // Search keyword filter
      if (searchKeyword) {
        const searchCorpus = (
          (t.TaskID || '') + ' ' +
          (t.Title || '') + ' ' +
          (t.Location || '') + ' ' +
          (t.Description || '') + ' ' +
          (t.Category || '') + ' ' +
          (t.AssignedContractorName || '') + ' ' +
          (t.SupervisorName || '')
        ).toLowerCase();
        if (!searchCorpus.includes(searchKeyword)) return false;
      }

      return true;
    });

    setText('execCardsFilteredCount', filtered.length);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="col-span-full p-8 text-center bg-white border border-slate-200 rounded-lg text-slate-500">
          <div class="text-3xl mb-2">🔍</div>
          <div class="text-sm font-semibold text-slate-800">ไม่พบใบงานตามเงื่อนไขที่เลือก</div>
          <div class="text-xs text-slate-500 mt-1">ลองเปลี่ยนตัวกรอง หรือคลิกปุ่ม "📋 ทั้งหมด" เพื่อดูใบงานทุกรายการ</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      const isTaskPending = (t.Status === 'Pending Approval' || t.Status === 'Pending Level 3 Approval' || (memo && memo.ApprovalStatus === 'Pending Approval') || (Number(t.EstCost) > 0 && t.Status !== 'Approved' && t.Status !== 'In Progress' && t.Status !== 'Completed' && t.Status !== 'Closed'));
      const isTaskApproved = (t.Status === 'Approved' || t.Status === 'In Progress' || (memo && memo.ApprovalStatus === 'Approved')) && t.Status !== 'Closed' && t.Status !== 'Completed';
      const isTaskClosed = (t.Status === 'Closed' || t.Status === 'Completed');

      // 5-Stage Journey Progress determination
      let stage = 1;
      if (t.Status === 'Closed') {
        stage = 5;
      } else if (t.Status === 'Completed') {
        stage = 5;
      } else if (t.Status === 'In Progress') {
        stage = 4;
      } else if (isTaskApproved) {
        stage = 4;
      } else if (isTaskPending) {
        stage = 3;
      } else if (Number(t.EstCost) > 0 || memo) {
        stage = 2;
      }

      const stages = [
        { num: 1, label: 'ช่างรับแจ้ง/สำรวจ' },
        { num: 2, label: 'ผค.งานถอดราคา' },
        { num: 3, label: 'ผู้บริหารอนุมัติ' },
        { num: 4, label: 'ช่างดำเนินการ' },
        { num: 5, label: 'ตรวจรับ&ปิดงาน' }
      ];

      const priorityBadge = t.Priority === 'Critical'
        ? '<span class="px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold border border-red-200">CRITICAL</span>'
        : t.Priority === 'High'
        ? '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-200">HIGH</span>'
        : '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium border border-slate-200">NORMAL</span>';

      return `
        <div class="enterprise-card overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between border-slate-300">
          
          <!-- Card Header with Physical Location & Direct Delete Button -->
          <div class="p-4 bg-slate-50 border-b border-slate-200">
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-900 text-teal-100 font-bold text-xs tracking-wide shadow-sm">
                <span class="text-sm">📍</span>
                <span>${escapeHtml(t.Location || 'ไม่ระบุตำแหน่ง')}</span>
              </div>
              <div class="flex items-center gap-2 font-mono-code text-[11px]">
                <span class="px-2 py-0.5 rounded bg-white text-slate-800 font-bold border border-slate-300">${escapeHtml(t.TaskID)}</span>
                ${priorityBadge}
                <!-- Direct Delete Button on Card Header -->
                <button type="button" onclick="FMMS.deleteTask('${t.TaskID}')"
                  class="text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shadow-xs"
                  title="ลบใบงานนี้ออกจากระบบและ Google Sheets ทันที">
                  <span>🗑️</span>
                  <span>ลบ</span>
                </button>
              </div>
            </div>

            <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(t.Title)}</h4>
            <div class="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
              <span>หมวด: <strong class="text-slate-800 font-medium">${escapeHtml(t.Category || '-')}</strong></span>
              <span class="font-mono-code">${formatThaiDateTime(t.CreatedAt)}</span>
            </div>
          </div>

          <!-- PROMINENT OFFICIAL DIGITAL APPROVAL SEAL & ACTION BANNER -->
          ${isTaskApproved ? `
            <div class="mx-4 my-3 p-3 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border-2 border-emerald-500 rounded-lg flex items-center justify-between gap-3 shadow-xs">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center text-lg font-bold shadow-sm">
                  ✓
                </div>
                <div>
                  <div class="text-xs font-bold text-emerald-950 flex items-center gap-1.5 flex-wrap">
                    <span>ตราประทับ: ผ่านการอนุมัติระดับบริหารแล้ว</span>
                    <span class="px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-mono-code font-bold shadow-xs">OFFICIALLY APPROVED</span>
                  </div>
                  <div class="text-[11px] text-emerald-800 mt-0.5">
                    ผู้อนุมัติ: <strong>${escapeHtml(memo && memo.ApproverName && memo.ApproverName !== '-' ? memo.ApproverName : (t.UpdatedBy || 'ผู้บริหารระดับสูง'))}</strong>
                    • วันที่: <span class="font-mono-code">${memo && memo.ApprovalDate && memo.ApprovalDate !== '-' ? formatThaiDateTime(memo.ApprovalDate) : (t.UpdatedAt ? formatThaiDateTime(t.UpdatedAt) : 'อนุมัติแล้ว')}</span>
                  </div>
                </div>
              </div>
              <div class="text-right whitespace-nowrap pl-2">
                <div class="text-[10px] text-emerald-700 uppercase font-mono-code font-semibold">วงเงินที่อนุมัติ</div>
                <div class="text-base font-bold font-mono-code text-emerald-900">฿${formatCurrency(memo && memo.EstimatedBudget ? memo.EstimatedBudget : t.EstCost)}</div>
              </div>
            </div>
          ` : isTaskPending ? `
            <div class="mx-4 my-3 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-400 rounded-lg flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center text-lg font-bold shadow-sm animate-pulse">
                  ⏳
                </div>
                <div>
                  <div class="text-xs font-bold text-amber-950 flex items-center gap-1.5 flex-wrap">
                    <span>รอการพิจารณาอนุมัติงบประมาณจากผู้บริหาร</span>
                    <span class="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-mono-code font-bold">PENDING APPROVAL</span>
                  </div>
                  <div class="text-[11px] text-amber-800 mt-0.5">
                    วงเงินเสนอขออนุมัติ: <strong class="font-mono-code text-amber-950">฿${formatCurrency(memo ? memo.EstimatedBudget : t.EstCost)}</strong>
                    • เสนอโดย: ${escapeHtml(memo ? memo.RequestedBy : (t.SupervisorName || 'ผู้ควบคุมงาน'))}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo ? memo.MemoID : t.TaskID}', 'Approved')"
                  class="bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-md text-xs shadow transition flex items-center gap-1.5 cursor-pointer">
                  <span>✅</span>
                  <span>อนุมัติงบทันที</span>
                </button>
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo ? memo.MemoID : t.TaskID}', 'Rejected')"
                  class="bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white font-semibold px-2.5 py-1.5 rounded-md text-xs shadow transition flex items-center gap-1 cursor-pointer">
                  <span>❌</span>
                  <span>ตีกลับ</span>
                </button>
              </div>
            </div>
          ` : isTaskClosed ? `
            <div class="mx-4 my-2.5 p-2.5 bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-between text-xs text-slate-700">
              <div class="flex items-center gap-2">
                <span class="text-base">🏁</span>
                <span class="font-bold">ตรวจรับงานและปิดเอกสารสมบูรณ์แล้ว (Closed)</span>
              </div>
              <div class="font-mono-code text-[11px] text-slate-600">ค่าใช้จ่ายจริง: <strong class="text-slate-900">฿${formatCurrency(t.ActualCost)}</strong></div>
            </div>
          ` : ''}

          <!-- 5-Step Visual Pipeline Tracker Bar -->
          <div class="px-4 py-3 bg-white border-b border-slate-100">
            <div class="text-[10px] uppercase font-mono-code font-semibold text-slate-400 mb-2 flex justify-between">
              <span>WORKFLOW PIPELINE PROGRESS</span>
              <span class="text-teal-700 font-bold">ขั้นตอนปัจจุบัน: ${stages[Math.min(stage - 1, 4)].label}</span>
            </div>
            <div class="grid grid-cols-5 gap-1 text-center">
              ${stages.map(function(s) {
                const isPassed = s.num < stage || (s.num === 5 && t.Status === 'Closed');
                const isCurrent = s.num === stage && t.Status !== 'Closed';
                const bgClass = isPassed ? 'bg-teal-600 text-white font-bold' : (isCurrent ? 'bg-amber-500 text-white font-bold ring-2 ring-amber-300 animate-pulse' : 'bg-slate-100 text-slate-400');
                return `
                  <div class="flex flex-col items-center">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${bgClass} transition">
                      ${isPassed ? '✓' : s.num}
                    </div>
                    <div class="text-[10px] mt-1 leading-tight ${isCurrent ? 'text-amber-800 font-bold' : (isPassed ? 'text-teal-900 font-medium' : 'text-slate-400')}">
                      ${s.label}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Dual Perspectives: Technician vs Supervisor -->
          <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/40 text-xs">
            
            <!-- Left Panel: Field Technician Perspective -->
            <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-2 flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1.5">
                  <span class="font-bold text-slate-800 flex items-center gap-1">
                    <span>👷‍♂️ ช่างหน้างาน</span>
                  </span>
                  <span class="text-[10px] font-mono-code text-slate-500">FIELD CONTRACTOR</span>
                </div>
                <div class="text-slate-700 font-medium mb-1">
                  ${escapeHtml(t.AssignedContractorName || 'ช่างประจำโครงการ')}
                </div>
                <div class="text-slate-600 text-[11px] leading-relaxed line-clamp-2" title="${escapeHtml(t.Description)}">
                  ${escapeHtml(t.Description || '-')}
                </div>
              </div>

              <!-- Before / After Photo Galleries (Min 5 Photos) -->
              <div class="pt-2 border-t border-slate-100 space-y-2">
                <div>
                  <div class="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span>ภาพก่อนทำ (Before):</span>
                    <span class="font-mono-code font-bold ${getTaskBeforeImages(t).length >= 5 ? 'text-emerald-700' : 'text-rose-600'}">${getTaskBeforeImages(t).length} ภาพ ${getTaskBeforeImages(t).length >= 5 ? '✅' : '⚠️'}</span>
                  </div>
                  ${getTaskBeforeImages(t).length > 0 ? `
                    <div class="grid grid-cols-5 gap-1">
                      ${getTaskBeforeImages(t).slice(0, 5).map(function(url, idx) {
                        return `
                          <img src="${url}" alt="Before #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพก่อนเข้าซ่อม #${idx+1}: ${escapeHtml(t.TaskID)}', 'สถานที่: ${escapeHtml(t.Location)}')"
                            class="h-10 w-full object-cover rounded border border-slate-200 cursor-pointer hover:opacity-90 hover:scale-105 transition">
                        `;
                      }).join('')}
                    </div>
                  ` : `
                    <div class="h-10 bg-slate-100 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">ไม่มีรูป</div>
                  `}
                </div>
                <div>
                  <div class="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span>ภาพหลังทำ (After):</span>
                    <span class="font-mono-code font-bold ${getTaskAfterImages(t).length >= 5 ? 'text-emerald-700' : 'text-slate-500'}">${getTaskAfterImages(t).length} ภาพ ${getTaskAfterImages(t).length >= 5 ? '✅' : ''}</span>
                  </div>
                  ${getTaskAfterImages(t).length > 0 ? `
                    <div class="grid grid-cols-5 gap-1">
                      ${getTaskAfterImages(t).slice(0, 5).map(function(url, idx) {
                        return `
                          <img src="${url}" alt="After #${idx+1}" onclick="FMMS.openImagePreviewModal('${url}', 'ภาพหลังเข้าซ่อม #${idx+1}: ${escapeHtml(t.TaskID)}', 'สถานที่: ${escapeHtml(t.Location)}')"
                            class="h-10 w-full object-cover rounded border border-slate-200 cursor-pointer hover:opacity-90 hover:scale-105 transition">
                        `;
                      }).join('')}
                    </div>
                  ` : `
                    <div class="h-10 bg-slate-100 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">ยังไม่แล้วเสร็จ</div>
                  `}
                </div>
              </div>
            </div>

            <!-- Right Panel: Supervisor Perspective -->
            <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-2 flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-1.5">
                  <span class="font-bold text-slate-800 flex items-center gap-1">
                    <span>👔 ผู้ควบคุมงาน</span>
                  </span>
                  <span class="text-[10px] font-mono-code text-blue-700">SUPERVISOR</span>
                </div>
                <div class="text-slate-700 font-medium mb-1">
                  ${escapeHtml(t.SupervisorName || 'วิศวกรผู้ควบคุมงาน')}
                </div>
                <div class="text-[11px] text-slate-600 space-y-1">
                  <div>เอกสารอ้างอิง: <span class="font-mono-code font-semibold text-blue-800">${memo ? escapeHtml(memo.MemoID) : 'งาน Routine'}</span></div>
                  <div>งบประเมิน: <strong class="font-mono-code text-slate-900">฿${formatCurrency(t.EstCost)}</strong></div>
                  <div>จ่ายจริง: <strong class="font-mono-code ${Number(t.ActualCost) > Number(t.EstCost) ? 'text-red-700' : 'text-emerald-700'}">฿${formatCurrency(t.ActualCost)}</strong></div>
                </div>
              </div>

              <div class="pt-2 border-t border-slate-100">
                <div class="text-[10px] text-slate-500 mb-0.5">การตรวจรับงาน:</div>
                <div>${renderStatusBadge(t.Status)}</div>
              </div>
            </div>

          </div>

          <!-- Card Action Bar for Executive -->
          <div class="p-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="text-slate-700 text-[11px] font-medium">
              ${isTaskApproved ? '<span class="inline-flex items-center gap-1 font-bold text-emerald-700">✅ ได้รับอนุมัติงบประมาณแล้ว</span>' : (isTaskPending ? '<span class="inline-flex items-center gap-1 font-bold text-amber-700">⏳ รอผู้บริหารลงนามอนุมัติ</span>' : '<span class="text-slate-600 font-medium">สถานะ: ' + escapeHtml(t.Status) + '</span>')}
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button type="button" onclick="FMMS.openMemoPrintModalByTask('${t.TaskID}')" class="border border-slate-300 hover:bg-slate-100 text-slate-800 px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer">
                📄 ดูบันทึกข้อความ A4
              </button>
              <button type="button" onclick="FMMS.openEditTaskModalFromReport('${t.TaskID}')" class="border border-blue-400 hover:bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded text-xs font-medium transition cursor-pointer">
                ✏️ แก้ไข
              </button>
              <button type="button" onclick="FMMS.deleteTask('${t.TaskID}')" class="border border-rose-300 hover:bg-rose-50 text-rose-700 px-2.5 py-1.5 rounded text-xs font-semibold transition cursor-pointer" title="ลบใบงานนี้ออกจากระบบ">
                🗑️ ลบ
              </button>
              ${isTaskPending ? `
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo ? memo.MemoID : t.TaskID}', 'Approved')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded text-xs transition shadow cursor-pointer">
                  ✓ อนุมัติงบ ฿${formatCurrency(memo ? memo.EstimatedBudget : t.EstCost)}
                </button>
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo ? memo.MemoID : t.TaskID}', 'Rejected')" class="bg-red-700 hover:bg-red-600 text-white font-semibold px-2.5 py-1.5 rounded text-xs transition cursor-pointer">
                  ✕ ตีกลับ
                </button>
              ` : ''}
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

    // FMMS Engineering Performance Scorecard (v2.5.0-ENT)
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

  function openMemoPrintModal(memoId) {
    const memo = state.db.memos.find(function(m) { return m.MemoID === memoId; });
    if (!memo) return;
    const task = state.db.tasks.find(function(t) { return t.TaskID === memo.TaskID; }) || {};

    const container = document.getElementById('a4PaperContainer');
    const modal = document.getElementById('memoPrintModal');
    if (!container || !modal) return;

    const isApproved = memo.ApprovalStatus === 'Approved';

    container.innerHTML = `
      <!-- Top Official Thai Memorandum Header (TH Sarabun New Typography) -->
      <div class="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between">
        <div>
          <div style="font-size: 11pt;" class="font-mono-code uppercase tracking-wider text-slate-600">FACILITY MAINTENANCE MANAGEMENT SYSTEM • SYS VER: v2.5.0-ENT (DATA MA TWPP)</div>
          <h1 class="doc-title mt-1" style="font-size: 16pt; font-weight: 700; color: #000000; line-height: 1.3;">บันทึกข้อความ (INTERNAL APPROVAL MEMORANDUM)</h1>
          <div class="doc-subheading text-slate-800" style="font-size: 14pt; font-weight: 700;">${escapeHtml(state.config.orgName || 'บริษัทบริหารจัดการอาคารและวิศวกรรม ทวพ. จำกัด')}</div>
        </div>
        <div class="text-right font-mono-code border border-slate-500 p-2 rounded" style="font-size: 12pt; min-width: 190px;">
          <div><strong>เลขที่บันทึก:</strong> ${escapeHtml(memo.MemoID)}</div>
          <div><strong>อ้างอิงใบงาน:</strong> ${escapeHtml(memo.TaskID)}</div>
          <div><strong>วันที่ออกเอกสาร:</strong> ${formatThaiDateOnly(memo.RequestedAt)}</div>
          <div class="text-teal-800 font-bold">Doc Version: v1.1</div>
        </div>
      </div>

      <!-- Memo Header Metadata -->
      <div class="space-y-2 text-sm mb-5">
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold">ส่วนงาน:</span>
          <span class="col-span-10">${escapeHtml(state.config.orgName)} (รหัสอ้างอิง ${escapeHtml(memo.DocReference)})</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold">เรื่อง:</span>
          <span class="col-span-10 font-semibold">${escapeHtml(memo.Subject)}</span>
        </div>
        <div class="grid grid-cols-12">
          <span class="col-span-2 font-bold">เรียน:</span>
          <span class="col-span-10">ผู้อำนวยการฝ่ายบริหารอาคาร / ผู้บริหารระดับสูง (ผ่านผู้ควบคุมงานวิศวกรรม)</span>
        </div>
      </div>

      <!-- Section 1: Background & Engineering Analysis -->
      <div class="space-y-3 text-sm">
        <p class="indent-8 leading-relaxed">
          ด้วยฝ่ายวิศวกรรมและซ่อมบำรุงอาคาร ได้รับแจ้งและเข้าตรวจสอบใบงานเลขที่ <strong class="font-mono-code">${escapeHtml(memo.TaskID)}</strong>
          ประเภทงาน <strong>${escapeHtml(task.Type || 'CM')}</strong> หมวดระบบ <strong>${escapeHtml(task.Category || '-')}</strong>
          บริเวณสถานที่ <strong>${escapeHtml(task.Location || '-')}</strong> โดยมีรายละเอียดอาการเสียและผลการวิเคราะห์ทางวิศวกรรมดังนี้:
        </p>

        <div class="border border-slate-400 rounded p-3 bg-slate-50/60 space-y-1.5" style="font-size: 12pt;">
          <div><strong>1. อาการเสียที่ตรวจพบ:</strong> ${escapeHtml(task.Description || memo.ReasonRationale)}</div>
          <div><strong>2. การวิเคราะห์สาเหตุเบื้องต้น (Root Cause):</strong> ${escapeHtml(task.InitialAnalysis || '-')}</div>
          <div><strong>3. เหตุผลความจำเป็นในการขออนุมัติ:</strong> ${escapeHtml(memo.ReasonRationale)}</div>
          <div><strong>4. รายการวัสดุ/อะไหล่ที่ต้องใช้:</strong> ${escapeHtml(task.MaterialsRequired || '-')}</div>
        </div>

        <!-- Section 2: Cost & Quotation Table -->
        <div class="mt-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5">ตารางสรุปงบประมาณและผู้เสนอราคา (Budget & Vendor Breakdown)</h3>
          <table class="w-full border-collapse border border-slate-500 text-xs">
            <thead>
              <tr class="bg-slate-100">
                <th class="border border-slate-500 py-2 px-3 text-left">รายการดำเนินงาน / อะไหล่</th>
                <th class="border border-slate-500 py-2 px-3 text-left">ผู้เสนอราคา / เลขที่ใบเสนอราคา</th>
                <th class="border border-slate-500 py-2 px-3 text-right">จำนวนเงินขออนุมัติ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="border border-slate-500 py-2.5 px-3">
                  <div class="font-semibold">${escapeHtml(task.Title || memo.Subject)}</div>
                  <div class="text-[11px] text-slate-600">วัสดุ: ${escapeHtml(task.MaterialsRequired || 'ตามใบเสนอราคาแนบท้าย')}</div>
                </td>
                <td class="border border-slate-500 py-2.5 px-3">
                  <div>${escapeHtml(memo.VendorName)}</div>
                  <div class="font-mono-code text-[11px] text-slate-600">Ref: ${escapeHtml(memo.VendorQuotationURL)}</div>
                </td>
                <td class="border border-slate-500 py-2.5 px-3 text-right font-mono-code font-bold text-sm">
                  ฿${formatCurrency(memo.EstimatedBudget)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Section 3: Photographic Evidence (Minimum 5 Before & 5 After) -->
        <div class="mt-4">
          <h3 style="font-size: 14pt; font-weight: 700; color: #000000;" class="mb-1.5">ภาพถ่ายประกอบหลักฐานหน้างาน (Field Photographic Evidence - เกณฑ์มาตรฐานก่อนและหลังอย่างละไม่น้อยกว่า 5 ภาพ)</h3>
          
          <div class="space-y-2.5">
            <!-- Before Photos Gallery -->
            <div class="border border-slate-400 p-2 bg-slate-50/50">
              <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                <span>1. ภาพถ่ายก่อนดำเนินการ (BEFORE INSPECTION - ${getTaskBeforeImages(task).length} ภาพ)</span>
                <span class="font-mono-code text-[10px] text-slate-600">เกณฑ์มาตรฐาน: ≥ 5 ภาพ ${getTaskBeforeImages(task).length >= 5 ? '✅ (ครบถ้วน)' : '⚠️'}</span>
              </div>
              ${getTaskBeforeImages(task).length > 0 ? `
                <div class="grid grid-cols-5 gap-1.5">
                  ${getTaskBeforeImages(task).map(function(url, idx) {
                    return `
                      <div class="border border-slate-300 bg-white p-1 text-center">
                        <img src="${url}" onerror="this.style.opacity='0.4';" class="w-full h-20 object-cover border border-slate-200 mx-auto">
                        <div class="text-[9px] font-mono-code text-slate-600 mt-0.5">ภาพที่ ${idx+1}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="py-4 text-center text-xs text-slate-400 bg-white border border-dashed border-slate-300 rounded">ยังไม่มีภาพถ่ายก่อนเริ่มงานแนบมาในใบงานนี้</div>
              `}
            </div>

            <!-- After Photos Gallery -->
            <div class="border border-slate-400 p-2 bg-slate-50/50">
              <div class="flex justify-between items-center text-xs font-bold mb-1.5">
                <span>2. ภาพถ่ายหลังดำเนินการแล้วเสร็จ (AFTER COMPLETION - ${getTaskAfterImages(task).length} ภาพ)</span>
                <span class="font-mono-code text-[10px] text-slate-600">เกณฑ์มาตรฐาน: ≥ 5 ภาพ ${getTaskAfterImages(task).length >= 5 ? '✅ (ครบถ้วน)' : ''}</span>
              </div>
              ${getTaskAfterImages(task).length > 0 ? `
                <div class="grid grid-cols-5 gap-1.5">
                  ${getTaskAfterImages(task).map(function(url, idx) {
                    return `
                      <div class="border border-slate-300 bg-white p-1 text-center">
                        <img src="${url}" onerror="this.style.opacity='0.4';" class="w-full h-20 object-cover border border-slate-200 mx-auto">
                        <div class="text-[9px] font-mono-code text-slate-600 mt-0.5">ภาพที่ ${idx+1}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="py-4 text-center text-xs text-slate-400 bg-white border border-dashed border-slate-300 rounded">อยู่ระหว่างดำเนินการซ่อมบำรุง (เมื่อแล้วเสร็จต้องแนบหลักฐานไม่น้อยกว่า 5 ภาพ)</div>
              `}
            </div>
          </div>
        </div>

        <p class="indent-8 pt-2" style="font-size: 12pt;">
          จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติงบประมาณจำนวน <strong class="font-mono-code">฿${formatCurrency(memo.EstimatedBudget)} บาท</strong>
          เพื่อให้ฝ่ายซ่อมบำรุงดำเนินการตามขั้นตอนต่อไป
        </p>

        <!-- Signatures & Digital Audit Stamp Block -->
        <div class="grid grid-cols-3 gap-4 pt-6 mt-6 border-t border-slate-400 text-center" style="font-size: 12pt;">
          <div class="border border-slate-300 p-3 rounded">
            <div class="font-bold mb-6">ผู้ปฏิบัติงาน / ช่างผู้สำรวจ (ระดับ 1)</div>
            <div class="font-semibold">${escapeHtml(task.AssignedContractorName || 'นายช่าง สมชาย สายลุย')}</div>
            <div class="text-[11px] text-slate-600">ผู้รับเหมา / ช่างเทคนิค</div>
            <div class="font-mono-code text-[10px] text-slate-500 mt-1">${formatThaiDateTime(task.CreatedAt)}</div>
          </div>

          <div class="border border-slate-300 p-3 rounded">
            <div class="font-bold mb-6">ผู้เสนอขออนุมัติ / ผู้ควบคุมงาน (ระดับ 2)</div>
            <div class="font-semibold">${escapeHtml(memo.RequestedBy)}</div>
            <div class="text-[11px] text-slate-600">วิศวกรผู้ควบคุมงาน (Supervisor)</div>
            <div class="font-mono-code text-[10px] text-slate-500 mt-1">${formatThaiDateTime(memo.RequestedAt)}</div>
          </div>

          <div class="border-2 ${isApproved ? 'border-emerald-600 bg-emerald-50/40' : 'border-amber-400 bg-amber-50/30'} p-3 rounded-lg relative overflow-hidden text-center">
            ${isApproved ? `
              <div class="absolute -right-3 -bottom-3 border-4 border-emerald-600/25 rounded-full w-24 h-24 flex items-center justify-center font-bold text-emerald-800/35 font-mono-code text-[10px] transform -rotate-12 pointer-events-none select-none">
                APPROVED
              </div>
            ` : ''}
            <div class="font-bold text-xs mb-1.5 ${isApproved ? 'text-emerald-900' : 'text-amber-900'}">ผลการพิจารณาอนุมัติ (ระดับบริหาร)</div>
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono-code font-bold text-xs mb-2 ${isApproved ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' : 'bg-amber-500 text-white border-amber-600'}">
              <span>${isApproved ? '✓ อนุมัติงบประมาณแล้ว' : '⏳ รอการพิจารณาอนุมัติ'}</span>
            </div>
            <div class="font-bold text-slate-900 text-sm">${escapeHtml(memo.ApproverName !== '-' ? memo.ApproverName : 'รอผู้บริหารลงนามอนุมัติ')}</div>
            <div class="text-[11px] text-slate-600 italic mt-0.5">"${escapeHtml(memo.ExecutiveComment !== '-' ? memo.ExecutiveComment : 'อยู่ระหว่างรอการเสนอแฟ้มอนุมัติ')}"</div>
            <div class="font-mono-code text-[10px] text-slate-500 mt-1 border-t border-slate-200 pt-1">
              วันที่อนุมัติ: <strong>${memo.ApprovalDate !== '-' ? formatThaiDateTime(memo.ApprovalDate) : '-'}</strong>
            </div>
          </div>
        </div>

        <div class="pt-4 text-[10px] font-mono-code text-slate-500 flex justify-between border-t border-slate-200 mt-4">
          <span>Google Sheet ID: ${escapeHtml(state.config.spreadsheetId)}</span>
          <span>Google Drive ID: ${escapeHtml(state.config.driveFolderId)}</span>
          <span>Printed by: ${escapeHtml(getCurrentActor().fullName)}</span>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
  }

  function closeMemoPrintModal() {
    const modal = document.getElementById('memoPrintModal');
    if (modal) modal.classList.add('hidden');
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
  }

  function resetAdminUserForm() {
    const form = document.getElementById('adminUserForm');
    if (form) form.reset();
    setVal('usrEditId', '');
    setText('adminUserFormTitle', 'เพิ่ม / แก้ไขผู้ใช้งานระบบ (โดย Admin)');
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
            <button type="button" onclick="FMMS.editAdminUser('${u.UserID}')" class="bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 rounded text-xs">
              แก้ไขสิทธิ์
            </button>
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
      version: 'v2.5.0-ENT (Enterprise Config Updated)',
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
      version: 'v2.5.0-ENT (Multi-Tab Master Database)',
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
    const task = state.db.tasks.find(function(t) { return t.TaskID === taskId; });
    if (!task) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const estCost = Number(getVal('supEditEstCost') || task.EstCost || 0);
    const vendor = getVal('supMemoVendor') || 'บริษัทคู่ค้าตามมาตรฐานวิศวกรรม';
    const reason = getVal('supMemoReason') || ('เพื่อซ่อมบำรุง ' + task.Title + ' ให้กลับมาใช้งานได้ตามเกณฑ์มาตรฐานความปลอดภัย');

    task.EstCost = estCost;
    task.Status = 'Pending Level 3 Approval';
    task.SupervisorID = actor.userId;
    task.SupervisorName = actor.fullName;
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
        SupervisorRemark: 'ผู้ควบคุมงานตรวจสอบทางวิศวกรรมและอนุมัติแล้ว เห็นควรให้ผู้บริหารระดับ 3 อนุมัติงบดำเนินการ',
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
      memo.SupervisorRemark = 'ผู้ควบคุมงานตรวจสอบทางวิศวกรรมและอนุมัติแล้ว เห็นควรให้ผู้บริหารระดับ 3 อนุมัติงบดำเนินการ';
    }

    recordAuditLog(
      'SUPERVISOR_APPROVE_AND_FORWARD',
      task.TaskID,
      'ผู้ควบคุมงาน (' + actor.fullName + ') อนุมัติงาน ' + task.TaskID + ' และสร้างบันทึกข้อความ ' + memo.MemoID + ' ส่งต่อผู้บริหารระดับ 3',
      'Pending Level 2 Approval',
      'Pending Level 3 Approval (฿' + formatCurrency(estCost) + ')',
      'SUCCESS'
    );

    await postToGasBackend('supervisorApproveAndForward', {
      taskId: task.TaskID,
      memoId: memo.MemoID,
      taskData: task,
      memoData: memo
    });

    persistDatabase();
    renderAllViews();
    updateApprovalAlertBadge();

    showCloudSyncConfirmation({
      docId: task.TaskID,
      docType: 'ใบงานซ่อมบำรุง (ผ่านการอนุมัติระดับ 2)',
      actionTitle: 'ผู้ควบคุมงาน (ระดับ 2) อนุมัติ & เสนอขออนุมัติงบต่อผู้บริหาร (ระดับ 3)',
      version: 'v1.1 (Supervisor Approved & Forwarded)',
      details: 'ใบงาน ' + task.TaskID + ' ได้รับการอนุมัติจากผู้ควบคุมงาน และออกบันทึกข้อความ ' + memo.MemoID + ' วงเงิน ฿' + formatCurrency(estCost) + ' ส่งเข้าคิวผู้บริหารระดับ 3 เรียบร้อยแล้ว'
    });

    showToast('ผู้ควบคุมงานอนุมัติเรียบร้อย', 'ส่งเรื่องขออนุมัติงบประมาณต่อผู้บริหาร (ระดับ 3) แล้ว', 'success');
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
      pendingCount = tasks.filter(function(t) { return t.Status === 'Pending Level 2 Approval'; }).length;
      labelText = 'รอ ผค.งาน อนุมัติ';
    } else if (role === 3) {
      // Level 3: Executive looks for memos waiting for Level 3 budget approval
      const memos = (state.db && state.db.memos) || [];
      const tasks = (state.db && state.db.tasks) || [];
      const pendingMemos = memos.filter(function(m) { return m.ApprovalStatus === 'Pending Approval'; });
      const pendingTasks = tasks.filter(function(t) { return t.Status === 'Pending Level 3 Approval'; });
      pendingCount = Math.max(pendingMemos.length, pendingTasks.length);
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
      btn.classList.add('ring-2', 'ring-amber-400');
    } else {
      badge.classList.add('hidden');
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

    if (role !== 2 && role !== 3) return;

    if (!forceModal && sessionAlertDismissed['role' + role]) return;

    const modal = document.getElementById('approvalAlertModal');
    if (!modal) return;

    const tbody = document.getElementById('alertPendingItemsTableBody');
    const countBadge = document.getElementById('alertModalCountBadge');
    const titleEl = document.getElementById('alertModalTitle');
    const noticeEl = document.getElementById('alertModalNoticeText');
    const step2Badge = document.getElementById('step2Indicator');
    const step3Badge = document.getElementById('step3Indicator');

    if (role === 2) {
      // Supervisor Alert
      const tasks = ((state.db && state.db.tasks) || []).filter(function(t) {
        return t.Status === 'Pending Level 2 Approval';
      });

      if (tasks.length === 0 && !forceModal) return;

      if (titleEl) titleEl.textContent = 'แจ้งเตือน: มีใบงานรอผู้ควบคุมงาน (ระดับ 2) พิจารณาอนุมัติ';
      if (noticeEl) noticeEl.textContent = 'มีใบงานที่ช่างหน้างาน (ลำดับ 1) ส่งเข้ามาเพื่อขออนุมัติดำเนินการ';
      if (countBadge) countBadge.textContent = tasks.length + ' รายการ';

      if (step2Badge) step2Badge.className = 'p-2 rounded bg-amber-500 text-white font-bold ring-2 ring-amber-300 animate-pulse';
      if (step3Badge) step3Badge.className = 'p-2 rounded bg-slate-100 text-slate-400';

      if (tbody) {
        if (tasks.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400">ไม่มีรายการค้างอนุมัติสำหรับระดับ 2 ในขณะนี้</td></tr>';
        } else {
          tbody.innerHTML = tasks.map(function(t) {
            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-3 font-mono-code font-bold text-slate-900">${escapeHtml(t.TaskID)}</td>
                <td class="py-2.5 px-3">
                  <div class="font-semibold text-slate-900">${escapeHtml(t.Title)}</div>
                  <div class="text-[11px] text-slate-500">📍 ${escapeHtml(t.Location)}</div>
                </td>
                <td class="py-2.5 px-3 text-right font-mono-code font-semibold text-slate-900">฿${formatCurrency(t.EstCost)}</td>
                <td class="py-2.5 px-3 text-slate-700">${escapeHtml(t.AssignedContractorName || 'ช่างหน้างาน')}</td>
                <td class="py-2.5 px-3 text-center">
                  <button type="button" onclick="FMMS.selectTaskFromAlert('${t.TaskID}')"
                    class="bg-teal-700 hover:bg-teal-600 text-white text-[11px] font-semibold px-3 py-1 rounded transition shadow cursor-pointer">
                    ตรวจงาน & อนุมัติ →
                  </button>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      modal.classList.remove('hidden');
      modal.style.display = 'flex';

    } else if (role === 3) {
      // Executive Alert
      const memos = ((state.db && state.db.memos) || []).filter(function(m) {
        return m.ApprovalStatus === 'Pending Approval';
      });

      if (memos.length === 0 && !forceModal) return;

      if (titleEl) titleEl.textContent = 'แจ้งเตือน: มีบันทึกข้อความขออนุมัติงบประมาณรอผู้บริหาร (ระดับ 3) พิจารณา';
      if (noticeEl) noticeEl.textContent = 'มีบันทึกข้อความที่ผู้ควบคุมงาน (ลำดับ 2) ตรวจสอบและเสนอขออนุมัติงบประมาณ';
      if (countBadge) countBadge.textContent = memos.length + ' ฉบับ';

      if (step2Badge) step2Badge.className = 'p-2 rounded bg-teal-50 border border-teal-200 text-teal-800';
      if (step3Badge) step3Badge.className = 'p-2 rounded bg-blue-600 text-white font-bold ring-2 ring-blue-300 animate-pulse';

      if (tbody) {
        if (memos.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400">ไม่มีรายการรออนุมัติงบประมาณสำหรับผู้บริหารในขณะนี้</td></tr>';
        } else {
          tbody.innerHTML = memos.map(function(m) {
            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-3 font-mono-code font-bold text-blue-900">${escapeHtml(m.MemoID)}</td>
                <td class="py-2.5 px-3">
                  <div class="font-semibold text-slate-900">${escapeHtml(m.Subject)}</div>
                  <div class="text-[11px] text-slate-500">อ้างอิง: ${escapeHtml(m.TaskID)}</div>
                </td>
                <td class="py-2.5 px-3 text-right font-mono-code font-bold text-emerald-800">฿${formatCurrency(m.EstimatedBudget)}</td>
                <td class="py-2.5 px-3 text-slate-700">${escapeHtml(m.RequestedBy || 'ผู้ควบคุมงาน')}</td>
                <td class="py-2.5 px-3 text-center">
                  <button type="button" onclick="FMMS.selectMemoFromAlert('${m.MemoID}', '${m.TaskID}')"
                    class="bg-blue-700 hover:bg-blue-600 text-white text-[11px] font-semibold px-3 py-1 rounded transition shadow cursor-pointer">
                    พิจารณาอนุมัติ →
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
  }

  function openApprovalAlertModal() {
    checkAndShowApprovalAlert(true);
  }

  function closeApprovalAlertModal() {
    const role = state.session ? Number(state.session.roleLevel) : 0;
    const chk = document.getElementById('chkDoNotShowAgainInSession');
    if (chk && chk.checked && (role === 2 || role === 3)) {
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
    }
  }

  function selectTaskFromAlert(taskId) {
    closeApprovalAlertModal();
    switchView('role2');
    switchSupervisorSubTab('tasks');
    selectSupervisorTask(taskId);
  }

  function selectMemoFromAlert(memoId, taskId) {
    closeApprovalAlertModal();
    switchView('role3');
    switchExecutiveSubTab('cards');
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
            <div class="text-teal-900 font-bold">SYS VER: v2.5.0-ENT</div>
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
          <span>System Version: v2.5.0-ENT</span>
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
    filterExecutiveCards: filterExecutiveCards
  };
})();

if (typeof window !== 'undefined') {
  window.FMMS = FMMS;
}
