# Facility Maintenance Management System (FMMS Enterprise) - Data MA TWPP
**System Version:** `v2.5.0-ENT` | **Architecture:** 2-Tier Sequential Approval & Hierarchical RBAC

ระบบบริหารงานซ่อมบำรุงและควบคุมมาตรฐานวิศวกรรมอาคาร ออกแบบสำหรับโฮสต์บน **GitHub Pages** และเชื่อมต่อโดยตรงกับ **Google Apps Script (GAS)**, **Google Sheets (`Data MA TWPP`)** และ **Google Drive**

---

## 1. ทรัพยากรที่ผูกกับระบบ (Bound Cloud Resources)

* **Google Apps Script Web App Endpoint (API กลางเชื่อมต่อทุกอุปกรณ์):**
  * **URL:** `https://script.google.com/macros/s/AKfycbwfBDxHrVGtMuWjz1FkP0B8eL83jAp66E-JYFvB7EvQs_QjZnXnteLKUspE4dAEGpFM/exec`
  * ฝังเป็นค่าเริ่มต้นในระบบเรียบร้อยแล้ว ทุกเครื่องที่เปิดผ่าน GitHub Pages จะเชื่อมต่อและซิงค์ข้อมูลกับ Google Sheets โดยอัตโนมัติ
* **Google Sheets (`Data MA TWPP`)**
  * **Spreadsheet ID:** `1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ`
  * **URL:** [เปิด Google Sheets (Data MA TWPP)](https://docs.google.com/spreadsheets/d/1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ/edit?gid=0#gid=0)
* **Google Drive (Root Storage สำหรับเก็บภาพหน้างานและไฟล์สำรองข้อมูล)**
  * **Folder ID:** `1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx`
  * **URL:** [เปิดโฟลเดอร์ Google Drive](https://drive.google.com/drive/u/0/folders/1zOFWOfPT5L1XuLjaXlt-RQ5-zUlkoEpx)

---

## 2. ขั้นตอนการติดตั้ง Google Apps Script (`Code.gs`) ให้เชื่อมต่อกับเว็บ

1. เปิดไฟล์ Google Sheet **[Data MA TWPP](https://docs.google.com/spreadsheets/d/1o3NRnjg4Rd-Yo8OdwE9A1_G56aEUi18VY_3esqyUGjQ/edit?gid=0#gid=0)**
2. ไปที่เมนูด้านบน **Extensions (ส่วนขยาย)** > **Apps Script**
3. ลบโค้ดเดิมในไฟล์ `Code.gs` ออกทั้งหมด แล้วคัดลอกโค้ดทั้งหมดจากไฟล์ [`Code.gs`](./Code.gs) ในโปรเจกต์นี้ไปวางแทนที่ จากนั้นกด **Save (Ctrl+S)**
4. ทดสอบสร้างตารางอัตโนมัติครั้งแรก:
   * ที่แถบด้านบนของ Apps Script เลือกฟังก์ชัน `ensureDatabaseReady` แล้วกดปุ่ม **Run (เรียกใช้)**
   * ระบบจะขอสิทธิ์เข้าถึง Google Sheets และ Google Drive ให้กด **Review permissions > Allow (อนุญาต)**
   * สคริปต์จะสร้างแท็บทั้ง 6 (`Users`, `Tasks`, `Preventive_Schedules`, `Approval_Memos`, `System_Logs`, `System_Settings`) พร้อม Header สีเข้มและบัญชีผู้ใช้เริ่มต้นให้อัตโนมัติ
5. การ Deploy เป็น Web App URL:
   * กดปุ่มสีน้ำเงินมุมขวาบน **Deploy (ทำให้ใช้งานได้)** > **New deployment (การทำให้ใช้งานได้รายการใหม่)**
   * เลือกประเภท (Select type) เป็น **Web app (เว็บแอป)**
   * ตั้งค่าดังนี้:
     * **Description:** `FMMS Enterprise API v2.4`
     * **Execute as (ดำเนินการในฐานะ):** `Me (ฉัน)`
     * **Who has access (ผู้ที่มีสิทธิ์เข้าถึง):** `Anyone (ทุกคน)`
   * กด **Deploy** แล้วคัดลอก **Web App URL** (ที่ลงท้ายด้วย `/exec`)
6. นำ Web App URL มาเชื่อมต่อกับหน้าเว็บ:
   * เปิดหน้าเว็บ `index.html` เข้าสู่ระบบด้วยบัญชี **Admin (`admin` / `admin123`)**
   * ไปที่แท็บ **"ตั้งค่าระบบ / QR"**
   * วาง **Web App URL** ลงในช่อง `Google Apps Script Web App URL` แล้วกด **"บันทึกค่า & สร้าง QR Code ใหม่"**

---

## 3. การเปิดใช้งานเครื่องใหม่ด้วย QR Code (Zero-Touch Device Provisioning)

เมื่อ Admin บันทึกค่า Web App URL, Sheet ID และ Drive Folder ID แล้ว:
1. ระบบจะสร้าง **QR Code สำหรับเปิดเครื่องใหม่** ในแท็บ **"ตั้งค่าระบบ / QR"** ทันที
2. เมื่อมีมือถือ แท็บเล็ต หรือคอมพิวเตอร์เครื่องใหม่ ให้เปิดหน้าเว็บแล้วกดปุ่ม **"สแกน QR ตั้งค่าเครื่องใหม่"** ที่หน้า Login (หรือใช้กล้องมือถือสแกน QR Code จากหน้าจอเครื่อง Admin ได้เลย)
3. เครื่องใหม่จะดึงค่าการเชื่อมต่อทั้งหมดไปบันทึกและทำการ Ping ตรวจสอบกับ Google Sheet & Drive โดยอัตโนมัติ

---

## 4. กฎความปลอดภัยและมาตรฐานทั้ง 6 ข้อที่ติดตั้งในระบบ

1. **ป้องกันการซ้ำของเลขที่เอกสาร (Mutex Lock & Idempotency):**
   * ใช้ `LockService.getScriptLock()` ใน `Code.gs` ควบคู่กับ `generateUniqueDocId()` และ `IdempotencyKey` ป้องกันการออกเลขใบงาน (`CM-YYYYMM-XXXX`, `PM-YYYYMM-XXXX`, `MEMO-YYYY-XXXX`) ซ้ำกันแม้กดพร้อมกันหลายเครื่อง
2. **ระบบสำรองข้อมูลอัตโนมัติและกดสำรองทันที (Backup to Google Drive & Sheet):**
   * ปุ่ม **"สำรองข้อมูลลง Drive ทันที"** จะสั่งให้ `Code.gs` สร้างไฟล์สำเนา Google Sheet เก็บลงในโฟลเดอร์ `/FMMS_Backups/{Year-Month}/` บน Google Drive ของคุณ พร้อมดาวน์โหลดไฟล์ JSON Recovery ลงเครื่อง
3. **การตรวจสอบสถานะการเชื่อมต่อแบบเรียลไทม์ (Real-time Connection Telemetry):**
   * แถบด้านบนแสดงสถานะ `CONNECTED`, ค่าความหน่วง `LATENCY (ms)`, ลิงก์ตรงไปยัง Sheet & Drive และปุ่ม **ตรวจสอบระบบ (Ping)**
4. **การบันทึกตัวตนและเวลาผู้ดำเนินการ + ตรวจสอบความผิดพลาด (Audit Trail & Operator Stamp):**
   * ในหน้าตั้งค่าผู้ใช้ของ Admin และทุกการแก้ไขงาน จะบันทึก `CreatedBy`, `CreatedAt`, `UpdatedBy`, `UpdatedAt` พร้อม `BeforeState -> AfterState` ลงใน `System_Logs`
5. **Responsive Design ทุกขนาดหน้าจอ:**
   * รองรับทั้งหน้าจอมือถือสำหรับช่างหน้างาน (ปุ่มขนาดใหญ่ + บีบอัดภาพถ่ายอัตโนมัติ < 1MB พร้อมประทับเวลาลงบนภาพ) และหน้าจอ Desktop แบบ Split-Screen สำหรับผู้ควบคุมงานและผู้บริหาร
6. **ระบบรายงานและเอกสารมาตรฐาน (v2.5.0-ENT):**
   * มีระบบพรีวิวและสั่งพิมพ์ **"บันทึกข้อความขออนุมัติงบประมาณ" ขนาด A4 (`@media print`)** พร้อมตารางงบประมาณ รูปภาพ Before/After และช่องลงนาม 3 ระดับ รวมถึงปุ่มส่งออกรายงานเป็นไฟล์ CSV (UTF-8 BOM เปิดใน Excel ภาษาไทยไม่เพี้ยน) โดยใช้ฟอนต์ **TH Sarabun New** (12pt เนื้อหา / 14pt หัวข้อย่อย / 16pt หัวข้อใหญ่)

---

## 5. เอกสารสรุปเงื่อนไขการพัฒนาและคู่มืออ้างอิงการอัปเดต (Update Reference)

ดูรายละเอียดเงื่อนไขการพัฒนา, สิทธิ์ RBAC 3 ระดับ, โฟลว์การอนุมัติ 2 ขั้นตอน (ช่าง -> ผค.งาน -> ผู้บริหาร), สรุปประวัติปัญหาและการแก้ไขฉบับเต็มได้ที่:
* 👉 **[เอกสารสรุปเงื่อนไขการพัฒนาระบบและแนวทางแก้ไข (SYSTEM_UPDATE_REFERENCE.md)](./SYSTEM_UPDATE_REFERENCE.md)**
