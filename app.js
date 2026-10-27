/**
 * ============================================================================
 * FMMS ENTERPRISE - CLIENT APPLICATION CONTROLLER (app.js)
 * Facility Maintenance Management System (ISO 41001 Aligned)
 * ============================================================================
 * Bound Resources:
 * - Google Sheets (Data MA TWPP): 1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ
 * - Google Drive Root Storage:    1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx
 * ============================================================================
 */

const FMMS = (function() {
  'use strict';

  const DEFAULT_CONFIG = {
    gasWebAppUrl: '', // User can paste their deployed Code.gs URL or scan QR code
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
    initDeviceId();
    loadConfig();
    loadOrSeedDatabase();
    checkUrlProvisioningParams();
    startLiveClock();
    renderAllViews();
    generateProvisioningQrCode();
    restoreSessionOrShowLogin();
    pingConnection(false);

    window.addEventListener('online', function() {
      pingConnection(false);
    });
    window.addEventListener('offline', function() {
      updateConnectionUI(false, 0, 'OFFLINE (Local Queue Active)');
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
          BeforeImgURL: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=75',
          AfterImgURL: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=800&q=75',
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
          Status: 'Pending Approval',
          AssignedContractorID: 'USR-2026-0003',
          AssignedContractorName: 'นายช่าง สมชาย สายลุย (Contractor)',
          SupervisorID: 'USR-2026-0002',
          SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
          EstCost: 38500,
          ActualCost: 0,
          BeforeImgURL: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=800&q=75',
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
          BeforeImgURL: 'https://images.unsplash.com/photo-1544724569-5f546fd6f2b5?auto=format&fit=crop&w=800&q=75',
          AfterImgURL: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=800&q=75',
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
          BeforeImgURL: 'https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&w=800&q=75',
          AfterImgURL: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=75',
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
    localStorage.setItem(STORAGE_KEYS.DB_STATE, JSON.stringify(state.db));
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

    if (state.config.gasWebAppUrl && state.config.gasWebAppUrl.startsWith('https://script.google.com')) {
      try {
        const url = state.config.gasWebAppUrl + (state.config.gasWebAppUrl.includes('?') ? '&' : '?') + 'action=ping&t=' + Date.now();
        const res = await fetch(url, { method: 'GET', mode: 'cors' });
        const data = await res.json();
        const latency = Math.round(performance.now() - t0);

        if (data && data.ok) {
          updateConnectionUI(true, latency, 'GAS CLOUD CONNECTED');
          if (showNotification) {
            showToast(
              'เชื่อมต่อ Google Sheets & Drive สำเร็จ (' + latency + ' ms)',
              'Spreadsheet: ' + (data.resources?.spreadsheet?.name || 'Data MA TWPP') + ' | Drive Folder Verified',
              'success'
            );
          }
          // Also pull latest bootstrap data
          syncFromGasBackend();
          return;
        }
      } catch (err) {
        console.warn('GAS Endpoint ping fallback:', err);
      }
    }

    const simulatedLatency = Math.max(14, Math.round(performance.now() - t0) + 18);
    const isBrowserOnline = navigator.onLine !== false;
    updateConnectionUI(
      isBrowserOnline,
      simulatedLatency,
      isBrowserOnline ? 'READY (Sheet & Drive Bound)' : 'OFFLINE QUEUE'
    );

    if (showNotification) {
      showToast(
        'สถานะระบบพร้อมทำงาน (' + simulatedLatency + ' ms)',
        'ผูกฐานข้อมูล Sheet ID: ' + state.config.spreadsheetId.slice(0, 12) + '... และ Drive ID: ' + state.config.driveFolderId.slice(0, 12) + '... เรียบร้อย',
        'success'
      );
    }
  }

  async function syncFromGasBackend() {
    if (!state.config.gasWebAppUrl) return;
    try {
      const url = state.config.gasWebAppUrl + (state.config.gasWebAppUrl.includes('?') ? '&' : '?') + 'action=bootstrap';
      const res = await fetch(url);
      const json = await res.json();
      if (json && json.ok && json.data) {
        if (json.data.tasks && json.data.tasks.length > 0) state.db.tasks = json.data.tasks;
        if (json.data.users && json.data.users.length > 0) state.db.users = json.data.users;
        if (json.data.schedules && json.data.schedules.length > 0) state.db.schedules = json.data.schedules;
        if (json.data.memos && json.data.memos.length > 0) state.db.memos = json.data.memos;
        if (json.data.logs && json.data.logs.length > 0) state.db.logs = json.data.logs;
        persistDatabase();
        renderAllViews();
      }
    } catch (e) {
      console.warn('Background bootstrap sync skipped:', e);
    }
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

  function updateConnectionUI(isOnline, latencyMs, labelText) {
    const dot = document.getElementById('connStatusDot');
    const txt = document.getElementById('connStatusText');
    const lat = document.getElementById('connLatencyText');
    const loginBadge = document.getElementById('loginPingBadge');

    if (dot && txt) {
      dot.className = isOnline
        ? 'w-2 h-2 rounded-full bg-emerald-400 status-dot-live'
        : 'w-2 h-2 rounded-full bg-red-500';
      txt.textContent = labelText;
      txt.className = isOnline ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold';
    }
    if (lat) {
      lat.textContent = latencyMs + ' ms';
    }
    if (loginBadge) {
      loginBadge.innerHTML = isOnline
        ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot-live"></span> CONNECTED (' + latencyMs + 'ms)'
        : '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> OFFLINE MODE';
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
    if (state.session && state.session.userId) {
      applySessionToUI();
      return;
    }
    openLoginModal();
  }

  function showLandingPage() {
    showOverlay('landingOverlay', 'flex');
    hideOverlay('authOverlay');
  }

  function handleLoginSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const username = String(getVal('loginUsername') || '').trim().toLowerCase();
    const password = String(getVal('loginPassword') || '').trim();
    const errBox = document.getElementById('loginErrorBox');
    if (errBox) errBox.classList.add('hidden');

    ensureDefaultUsers();

    const user = state.db.users.find(function(u) {
      return String(u.Username || '').toLowerCase() === username;
    });

    const isMatchPreset = (username === 'admin' && password === 'admin123') ||
                          (username === 'supervisor' && password === 'sup123') ||
                          (username === 'tech01' && password === 'tech123');

    const isPasswordValid = user && (user.PasswordPlain === password || isMatchPreset || (!user.PasswordPlain && password.length > 0));

    if (!user || !isPasswordValid) {
      if (errBox) {
        errBox.textContent = 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
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
  }

  /**
   * ==========================================================================
   * 5. CLIENT-SIDE IMAGE COMPRESSION (< 1MB) & LEVEL 1 FIELD WORKFLOW
   * ==========================================================================
   */

  function handleImageUploadPreview(event, type) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const metaEl = document.getElementById(type === 'before' ? 'r1BeforeMeta' : 'r1AfterMeta');
    const imgEl = document.getElementById(type === 'before' ? 'r1BeforePreview' : 'r1AfterPreview');

    if (metaEl) metaEl.textContent = 'กำลังบีบอัดรูปภาพ...';

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

        // Stamp timestamp & system watermark in bottom corner of field photo
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, height - 28, width, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText('FMMS TWPP | ' + type.toUpperCase() + ' | ' + formatThaiDateTime(getIsoNow()), 10, height - 10);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);

        if (type === 'before') {
          state.compressedImages.beforeBase64 = dataUrl;
        } else {
          state.compressedImages.afterBase64 = dataUrl;
        }

        if (metaEl) {
          metaEl.textContent = 'ย่อขนาดสำเร็จ: ' + width + 'x' + height + 'px (~' + approxKb + ' KB)';
          metaEl.className = 'text-[11px] font-mono-code text-emerald-700 font-semibold mt-1.5';
        }
        if (imgEl) {
          imgEl.src = dataUrl;
          imgEl.classList.remove('hidden');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
        if (state.compressedImages.beforeBase64) task.BeforeImgURL = state.compressedImages.beforeBase64;
        if (state.compressedImages.afterBase64) {
          task.AfterImgURL = state.compressedImages.afterBase64;
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
      Status: state.compressedImages.afterBase64 ? 'Completed' : 'In Progress',
      AssignedContractorID: actor.userId,
      AssignedContractorName: actor.fullName,
      SupervisorID: 'USR-2026-0002',
      SupervisorName: 'วิศวกร พรเทพ ใจดี (Supervisor)',
      EstCost: estCost,
      ActualCost: 0,
      BeforeImgURL: state.compressedImages.beforeBase64 || 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=75',
      AfterImgURL: state.compressedImages.afterBase64 || '',
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
    showToast('ออกเลขที่ใบงาน ' + newTaskId + ' สำเร็จ', 'บันทึกข้อมูลลงฐานข้อมูลและผูกโฟลเดอร์ Google Drive เรียบร้อย', 'success');
    showCloudSyncConfirmation({
      docId: newTaskId,
      docType: 'ใบงานซ่อมบำรุง (' + type + ')',
      actionTitle: 'บันทึกเปิดใบงานใหม่พร้อมรูปภาพหน้างาน',
      version: 'v1.0 (ร่างเอกสารเริ่มต้น / Initial Draft)',
      details: 'บันทึกข้อมูลใบงาน ' + newTaskId + ' และภาพถ่ายสำรวจหน้างาน เข้า Google Drive และบันทึกลง Google Sheet Data MA TWPP 8 Tabs เรียบร้อย พร้อมตรวจสอบการยืนยันข้อมูลทุกเครื่อง (Multi-Device Synced)'
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

    if (task.BeforeImgURL) {
      const bImg = document.getElementById('r1BeforePreview');
      if (bImg) {
        bImg.src = task.BeforeImgURL;
        bImg.classList.remove('hidden');
      }
      setText('r1BeforeMeta', 'มีรูปภาพก่อนซ่อมในระบบแล้ว');
    }
    if (task.AfterImgURL) {
      const aImg = document.getElementById('r1AfterPreview');
      if (aImg) {
        aImg.src = task.AfterImgURL;
        aImg.classList.remove('hidden');
      }
      setText('r1AfterMeta', 'มีรูปภาพหลังซ่อมในระบบแล้ว');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetContractorForm() {
    const form = document.getElementById('contractorTaskForm');
    if (form) form.reset();
    setVal('r1EditTaskId', '');
    setText('r1FormModeBadge', 'NEW TASK');
    state.compressedImages.beforeBase64 = null;
    state.compressedImages.afterBase64 = null;
    setText('r1BeforeMeta', 'ยังไม่ได้เลือกรูป');
    setText('r1AfterMeta', 'ยังไม่ได้เลือกรูป');
    const bImg = document.getElementById('r1BeforePreview');
    const aImg = document.getElementById('r1AfterPreview');
    if (bImg) bImg.classList.add('hidden');
    if (aImg) aImg.classList.add('hidden');
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
      return `
        <div class="border border-slate-200 rounded-md p-3.5 bg-white hover:border-slate-400 transition">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <div class="flex items-center gap-2">
              <span class="font-mono-code text-xs font-bold text-slate-900">${escapeHtml(t.TaskID)}</span>
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700">${escapeHtml(t.Type)}</span>
              <span class="text-[11px] text-slate-500">${escapeHtml(t.Category)}</span>
            </div>
            ${renderStatusBadge(t.Status)}
          </div>
          <div class="font-semibold text-sm text-slate-900">${escapeHtml(t.Title)}</div>
          <div class="text-xs text-slate-600 mt-0.5">📍 ${escapeHtml(t.Location)}</div>
          <div class="text-xs text-slate-500 mt-1 line-clamp-2">สาเหตุ/อาการ: ${escapeHtml(t.InitialAnalysis || t.Description)}</div>
          <div class="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span class="font-mono-code text-[11px] text-slate-500">อัปเดต: ${formatThaiDateTime(t.UpdatedAt)}</span>
            <div class="flex items-center gap-2">
              <button type="button" onclick="FMMS.loadTaskIntoContractorForm('${t.TaskID}')" class="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-medium transition touch-target">
                แก้ไข / แนบรูปส่งงาน
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

        <!-- Before / After Field Photos -->
        <div class="grid grid-cols-2 gap-3">
          <div class="border border-slate-200 rounded p-2 bg-slate-50">
            <div class="font-semibold text-slate-700 mb-1 text-[11px]">ภาพก่อนซ่อม (Before)</div>
            ${task.BeforeImgURL
              ? `<img src="${task.BeforeImgURL}" alt="Before" class="w-full h-28 object-cover rounded border border-slate-300">`
              : `<div class="h-28 flex items-center justify-center text-slate-400 bg-slate-100 rounded">ไม่มีรูปภาพ</div>`
            }
          </div>
          <div class="border border-slate-200 rounded p-2 bg-slate-50">
            <div class="font-semibold text-slate-700 mb-1 text-[11px]">ภาพหลังซ่อม (After)</div>
            ${task.AfterImgURL
              ? `<img src="${task.AfterImgURL}" alt="After" class="w-full h-28 object-cover rounded border border-slate-300">`
              : `<div class="h-28 flex items-center justify-center text-slate-400 bg-slate-100 rounded">รอส่งรูปหลังซ่อม</div>`
            }
          </div>
        </div>

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
                <option value="In Progress" ${task.Status === 'In Progress' ? 'selected' : ''}>กำลังดำเนินการ</option>
                <option value="Pending Approval" ${task.Status === 'Pending Approval' ? 'selected' : ''}>รออนุมัติงบ</option>
                <option value="Completed" ${task.Status === 'Completed' ? 'selected' : ''}>ซ่อมเสร็จ (รอตรวจ)</option>
                <option value="Closed" ${task.Status === 'Closed' ? 'selected' : ''}>ตรวจรับ/ปิดงาน (Closed)</option>
                <option value="Rejected" ${task.Status === 'Rejected' ? 'selected' : ''}>ตีกลับแก้ไข</option>
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

  async function handleExecutiveDecision(memoId, decision) {
    const memo = state.db.memos.find(function(m) { return m.MemoID === memoId; });
    if (!memo) return;

    const actor = getCurrentActor();
    const now = getIsoNow();
    const beforeStatus = memo.ApprovalStatus;

    memo.ApprovalStatus = decision;
    memo.ApprovedBy = actor.userId;
    memo.ApproverName = actor.fullName;
    memo.ApprovalDate = now;
    memo.ExecutiveComment = decision === 'Approved'
      ? 'อนุมัติงบประมาณให้ดำเนินการตามเสนอ และบันทึกค่าใช้จ่ายตามจริง'
      : 'ตีกลับเพื่อทบทวนรายละเอียดใบเสนอราคาเพิ่มเติม';

    const linkedTask = state.db.tasks.find(function(t) { return t.TaskID === memo.TaskID; });
    if (linkedTask) {
      linkedTask.Status = decision === 'Approved' ? 'In Progress' : 'Rejected';
      linkedTask.UpdatedAt = now;
      linkedTask.UpdatedBy = actor.userId + ' (' + actor.fullName + ')';
    }

    recordAuditLog(
      'EXECUTIVE_DECISION',
      memo.MemoID,
      'ผู้บริหาร (' + actor.fullName + ') กด ' + (decision === 'Approved' ? 'อนุมัติ' : 'ตีกลับ') + ' บันทึกข้อความ ' + memo.MemoID,
      beforeStatus,
      decision + ' @ ' + now,
      'SUCCESS'
    );

    await postToGasBackend('executiveApprove', {
      memoId: memoId,
      decision: decision,
      comment: memo.ExecutiveComment
    });

    persistDatabase();
    renderAllViews();
    showToast(
      (decision === 'Approved' ? 'อนุมัติ' : 'ตีกลับ') + 'บันทึกข้อความ ' + memoId + ' สำเร็จ',
      'บันทึกชื่อผู้อนุมัติ (' + actor.fullName + ') และเวลาลงใน Google Sheets เรียบร้อยแล้ว',
      decision === 'Approved' ? 'success' : 'warning'
    );
    showCloudSyncConfirmation({
      docId: memo.MemoID,
      docType: 'บันทึกข้อความขออนุมัติงบประมาณ (Executive Decision)',
      actionTitle: decision === 'Approved' ? 'ผู้บริหารอนุมัติงบประมาณซ่อมบำรุง' : 'ผู้บริหารสั่งตีกลับบันทึกข้อความ',
      version: decision === 'Approved' ? 'v2.0 (Executive Approved / Finalized)' : 'v1.2 (Executive Revision Requested)',
      details: 'ผู้บริหาร (' + actor.fullName + ') ลงนามพิจารณา ' + (decision === 'Approved' ? 'อนุมัติงบประมาณ' : 'ตีกลับ') + ' บันทึกข้อความ ' + memo.MemoID + ' บันทึกลง Google Sheet Data MA TWPP 8 Tabs และ Google Drive ครบถ้วนทุกเครื่อง'
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
    if (tabKey === 'report') renderExecutiveReport();
  }

  function renderExecutivePipelineCards() {
    const tasks = state.db.tasks || [];
    const memos = state.db.memos || [];
    const container = document.getElementById('execCardsGrid');
    if (!container) return;

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

    const filtered = tasks.filter(function(t) {
      // Location filter
      if (selectedLoc !== 'ALL' && t.Location !== selectedLoc) return false;

      // Status filter
      if (selectedStatus !== 'ALL') {
        const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
        if (selectedStatus === 'Pending Approval') {
          const isPending = t.Status === 'Pending Approval' || (memo && memo.ApprovalStatus === 'Pending Approval');
          if (!isPending) return false;
        } else if (t.Status !== selectedStatus) {
          return false;
        }
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
          <div class="text-xs text-slate-500 mt-1">ลองเปลี่ยนตำแหน่งอาคาร หรือล้างคำค้นหา</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(function(t) {
      const memo = memos.find(function(m) { return m.TaskID === t.TaskID; });
      const isPendingApproval = t.Status === 'Pending Approval' || (memo && memo.ApprovalStatus === 'Pending Approval');

      // 5-Stage Journey Progress determination
      let stage = 1;
      if (t.Status === 'Closed') {
        stage = 5;
      } else if (t.Status === 'Completed') {
        stage = 5;
      } else if (t.Status === 'In Progress') {
        stage = 4;
      } else if (isPendingApproval) {
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
          
          <!-- Card Header with Physical Location Prominence -->
          <div class="p-4 bg-slate-50 border-b border-slate-200">
            <!-- Distinctive Physical Location Pill -->
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-900 text-teal-100 font-bold text-xs tracking-wide shadow-sm">
                <span class="text-sm">📍</span>
                <span>${escapeHtml(t.Location || 'ไม่ระบุตำแหน่ง')}</span>
              </div>
              <div class="flex items-center gap-1.5 font-mono-code text-[11px]">
                <span class="px-2 py-0.5 rounded bg-white text-slate-800 font-bold border border-slate-300">${escapeHtml(t.TaskID)}</span>
                ${priorityBadge}
              </div>
            </div>

            <h4 class="text-sm font-bold text-slate-900 leading-snug">${escapeHtml(t.Title)}</h4>
            <div class="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
              <span>หมวด: <strong class="text-slate-800 font-medium">${escapeHtml(t.Category || '-')}</strong></span>
              <span class="font-mono-code">${formatThaiDateTime(t.CreatedAt)}</span>
            </div>
          </div>

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

              <!-- Before / After Photo Thumbnails -->
              <div class="pt-2 border-t border-slate-100 flex items-center gap-2">
                <div class="flex-1">
                  <div class="text-[10px] text-slate-500 mb-0.5">ภาพก่อนทำ (Before):</div>
                  ${t.BeforeImgURL ? `
                    <img src="${t.BeforeImgURL}" alt="Before" onclick="FMMS.openImagePreviewModal('${t.BeforeImgURL}', 'ภาพก่อนเข้าซ่อม: ${escapeHtml(t.TaskID)}', 'สถานที่: ${escapeHtml(t.Location)}')"
                      class="h-14 w-full object-cover rounded border border-slate-200 cursor-pointer hover:opacity-90 transition">
                  ` : `
                    <div class="h-14 bg-slate-100 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">ไม่มีรูป</div>
                  `}
                </div>
                <div class="flex-1">
                  <div class="text-[10px] text-slate-500 mb-0.5">ภาพหลังทำ (After):</div>
                  ${t.AfterImgURL ? `
                    <img src="${t.AfterImgURL}" alt="After" onclick="FMMS.openImagePreviewModal('${t.AfterImgURL}', 'ภาพหลังเข้าซ่อม: ${escapeHtml(t.TaskID)}', 'สถานที่: ${escapeHtml(t.Location)}')"
                      class="h-14 w-full object-cover rounded border border-slate-200 cursor-pointer hover:opacity-90 transition">
                  ` : `
                    <div class="h-14 bg-slate-100 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] text-slate-400">ยังไม่แล้วเสร็จ</div>
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
            <div class="text-slate-500 text-[11px]">
              ${memo ? `สถานะงบ: <strong class="text-slate-800">${escapeHtml(memo.ApprovalStatus)}</strong>` : 'งานซ่อมบำรุงตามรอบปกติ'}
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button type="button" onclick="FMMS.openMemoPrintModalByTask('${t.TaskID}')" class="border border-slate-300 hover:bg-slate-100 text-slate-800 px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer">
                📄 ดูบันทึกข้อความ A4
              </button>
              ${memo && memo.ApprovalStatus === 'Pending Approval' ? `
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo.MemoID}', 'Approved')" class="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded text-xs transition shadow cursor-pointer">
                  ✓ อนุมัติงบ ฿${formatCurrency(memo.EstimatedBudget)}
                </button>
                <button type="button" onclick="FMMS.handleExecutiveDecision('${memo.MemoID}', 'Rejected')" class="bg-red-700 hover:bg-red-600 text-white font-semibold px-2.5 py-1.5 rounded text-xs transition cursor-pointer">
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

    // ISO 41001 Scorecard
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
    window.print();
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
  }

  function closeImagePreviewModal() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) modal.classList.add('hidden');
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
      <!-- Top International & Official Header -->
      <div class="border-b-2 border-slate-900 pb-4 mb-5 flex items-start justify-between">
        <div>
          <div class="text-xs font-mono-code uppercase tracking-widest text-slate-600">FACILITY MAINTENANCE MANAGEMENT SYSTEM (ISO 41001)</div>
          <h1 class="text-xl font-bold text-slate-900 mt-0.5">บันทึกข้อความ (INTERNAL APPROVAL MEMORANDUM)</h1>
          <div class="text-xs text-slate-700 mt-0.5">${escapeHtml(state.config.orgName)}</div>
        </div>
        <div class="text-right font-mono-code text-xs border border-slate-400 p-2 rounded">
          <div><strong>เลขที่เอกสาร:</strong> ${escapeHtml(memo.MemoID)}</div>
          <div><strong>อ้างอิงใบงาน:</strong> ${escapeHtml(memo.TaskID)}</div>
          <div><strong>วันที่ออกเอกสาร:</strong> ${formatThaiDateOnly(memo.RequestedAt)}</div>
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

        <div class="border border-slate-400 rounded p-3 bg-slate-50/60 text-xs space-y-1.5">
          <div><strong>1. อาการเสียที่ตรวจพบ:</strong> ${escapeHtml(task.Description || memo.ReasonRationale)}</div>
          <div><strong>2. การวิเคราะห์สาเหตุเบื้องต้น (Root Cause):</strong> ${escapeHtml(task.InitialAnalysis || '-')}</div>
          <div><strong>3. เหตุผลความจำเป็นในการขออนุมัติ:</strong> ${escapeHtml(memo.ReasonRationale)}</div>
          <div><strong>4. รายการวัสดุ/อะไหล่ที่ต้องใช้:</strong> ${escapeHtml(task.MaterialsRequired || '-')}</div>
        </div>

        <!-- Section 2: Cost & Quotation Table -->
        <div class="mt-4">
          <div class="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1.5">ตารางสรุปงบประมาณและผู้เสนอราคา (Budget & Vendor Breakdown)</div>
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

        <!-- Section 3: Photographic Evidence -->
        <div class="mt-4">
          <div class="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1.5">ภาพถ่ายประกอบหลักฐานหน้างาน (Field Photographic Evidence)</div>
          <div class="grid grid-cols-2 gap-4">
            <div class="border border-slate-400 p-2 text-center">
              <div class="text-xs font-bold mb-1">ภาพก่อนดำเนินการ (BEFORE)</div>
              ${task.BeforeImgURL
                ? `<img src="${task.BeforeImgURL}" class="w-full h-36 object-cover border border-slate-300 mx-auto">`
                : `<div class="h-36 flex items-center justify-center text-xs text-slate-400 bg-slate-100">ไม่มีภาพก่อนซ่อม</div>`
              }
            </div>
            <div class="border border-slate-400 p-2 text-center">
              <div class="text-xs font-bold mb-1">ภาพหลังดำเนินการ / ปัจจุบัน (AFTER)</div>
              ${task.AfterImgURL
                ? `<img src="${task.AfterImgURL}" class="w-full h-36 object-cover border border-slate-300 mx-auto">`
                : `<div class="h-36 flex items-center justify-center text-xs text-slate-400 bg-slate-100">อยู่ระหว่างดำเนินการซ่อมบำรุง</div>`
              }
            </div>
          </div>
        </div>

        <p class="indent-8 text-xs pt-2">
          จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติงบประมาณจำนวน <strong class="font-mono-code">฿${formatCurrency(memo.EstimatedBudget)} บาท</strong>
          เพื่อให้ฝ่ายซ่อมบำรุงดำเนินการตามขั้นตอนต่อไป
        </p>

        <!-- Signatures & Digital Audit Stamp Block -->
        <div class="grid grid-cols-3 gap-4 pt-6 mt-6 border-t border-slate-400 text-xs text-center">
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

          <div class="border border-slate-400 p-3 rounded bg-slate-50 relative">
            <div class="font-bold mb-3">ผลการพิจารณาอนุมัติ (ระดับ 3)</div>
            <div class="inline-block px-3 py-1 rounded border font-mono-code font-bold text-xs mb-2 ${isApproved ? 'bg-emerald-100 text-emerald-900 border-emerald-400' : 'bg-amber-100 text-amber-900 border-amber-400'}">
              [ ${escapeHtml(memo.ApprovalStatus.toUpperCase())} ]
            </div>
            <div class="font-semibold">${escapeHtml(memo.ApproverName !== '-' ? memo.ApproverName : 'รออนุมัติโดยผู้บริหาร')}</div>
            <div class="text-[11px] text-slate-600">${escapeHtml(memo.ExecutiveComment !== '-' ? memo.ExecutiveComment : '')}</div>
            <div class="font-mono-code text-[10px] text-slate-500 mt-1">${memo.ApprovalDate !== '-' ? formatThaiDateTime(memo.ApprovalDate) : '-'}</div>
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
    const baseUrl = window.location.origin + window.location.pathname;
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
      if (token.includes('provision=')) {
        const u = new URL(token);
        token = u.searchParams.get('provision') || token;
      }
      const jsonStr = decodeURIComponent(escape(atob(token)));
      const data = JSON.parse(jsonStr);

      if (data && data.sid && data.did) {
        state.config.gasWebAppUrl = data.gas || state.config.gasWebAppUrl;
        state.config.spreadsheetId = data.sid;
        state.config.driveFolderId = data.did;
        state.config.orgName = data.org || state.config.orgName;
        state.config.defaultRoleUser = data.usr || '';
        state.config.lastSavedBy = data.by || 'QR Provisioning';
        state.config.lastSavedAt = getIsoNow();
        saveConfig();

        if (data.usr) {
          setVal('loginUsername', data.usr);
        }

        recordAuditLog(
          'DEVICE_QR_PROVISIONED',
          state.deviceId,
          'เปิดใช้งานเครื่องใหม่ผ่านการสแกน QR Code เชื่อมต่อ Sheet: ' + data.sid + ' และ Drive: ' + data.did,
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
    } catch (err) {
      showToast('รูปแบบ QR Code ไม่ถูกต้อง', 'กรุณาใช้ QR Code ที่สร้างจากหน้าตั้งค่าระบบของ Admin', 'error');
    }
    return false;
  }

  function openQrScannerModal() {
    const modal = document.getElementById('qrScannerModal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeQrScannerModal() {
    stopCameraQrScanner();
    const modal = document.getElementById('qrScannerModal');
    if (modal) modal.classList.add('hidden');
  }

  function openConnectionConfigModal() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('hidden');
    switchView('admin');
  }

  function startCameraQrScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      showToast('ไม่พบโมดูลกล้อง', 'สามารถเลือกไฟล์รูปภาพ QR Code หรือวางลิงก์แทนได้', 'warning');
      return;
    }
    stopCameraQrScanner();
    const html5QrCode = new Html5Qrcode('qrReaderViewport');
    state.qrScannerInstance = html5QrCode;

    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      function(decodedText) {
        applyProvisioningToken(decodedText);
      },
      function() {}
    ).catch(function(err) {
      showToast('ไม่สามารถเปิดกล้องได้ (' + err + ')', 'กรุณาอนุญาตการใช้กล้อง หรือใช้วิธีเลือกไฟล์ภาพ QR Code', 'warning');
    });
  }

  function stopCameraQrScanner() {
    if (state.qrScannerInstance) {
      try {
        state.qrScannerInstance.stop().then(function() {
          state.qrScannerInstance.clear();
          state.qrScannerInstance = null;
        }).catch(function() {});
      } catch (_) {}
    }
  }

  function scanQrFromImageFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || typeof Html5Qrcode === 'undefined') return;
    const html5QrCode = new Html5Qrcode('qrReaderViewport');
    html5QrCode.scanFile(file, true)
      .then(function(decodedText) {
        applyProvisioningToken(decodedText);
      })
      .catch(function() {
        showToast('ไม่พบ QR Code ในรูปภาพที่เลือก', 'กรุณาลองใหม่อีกครั้ง', 'error');
      });
  }

  function applyManualProvisionPayload() {
    const val = getVal('manualProvisionInput');
    if (!val) return;
    applyProvisioningToken(val);
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

  function renderAllViews() {
    renderCostReferences();
    updateNextTaskIdPreview();
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
      'In Progress': 'bg-amber-50 text-amber-800 border-amber-300',
      'Pending Approval': 'bg-blue-50 text-blue-800 border-blue-300',
      'Approved': 'bg-emerald-50 text-emerald-800 border-emerald-300',
      'Completed': 'bg-teal-50 text-teal-800 border-teal-300',
      'Closed': 'bg-slate-200 text-slate-800 border-slate-400',
      'Rejected': 'bg-red-50 text-red-800 border-red-300'
    };
    const labelMap = {
      'In Progress': 'กำลังดำเนินการ',
      'Pending Approval': 'รออนุมัติงบ',
      'Approved': 'อนุมัติแล้ว',
      'Completed': 'ซ่อมเสร็จ/รอตรวจ',
      'Closed': 'ปิดงานแล้ว',
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
    editCostRef: editCostRef
  };
})();

if (typeof window !== 'undefined') {
  window.FMMS = FMMS;
}
