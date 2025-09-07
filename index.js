import { chromium } from "playwright";
import fs from "fs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// 載入環境變數
dotenv.config();

// ============ 環境變數 (請在 .env 設定) ============
// WMS_USER=你的帳號
// WMS_PASS=你的密碼
// EMAIL_USER=你的 Gmail
// EMAIL_PASS=你的 Gmail App Password
// EMAIL_TO=收件人 Gmail
// ====================================================

async function fetchWmsTable(receiptNo) {
  const browser = await chromium.launch({ headless: false }); // 改為非無頭模式以便調試
  let page = await browser.newPage();

  try {
    // 1. 登入 WMS
    console.log("🔐 正在登入 WMS...");
    await page.goto("https://wms.rentrap.com/admin/receipts", { waitUntil: 'networkidle' });
    
    // 等待頁面完全載入
    await page.waitForTimeout(5000);
    
    // 檢查頁面標題和內容
    const title = await page.title();
    console.log("📄 頁面標題:", title);
    
    // 嘗試多種可能的用戶名輸入框選擇器
    const usernameSelectors = ['#username', 'input[name="username"]', 'input[type="text"]', 'input[placeholder*="用戶"]', 'input[placeholder*="帳號"]'];
    let usernameFound = false;
    
    for (const selector of usernameSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        console.log(`✅ 找到用戶名輸入框: ${selector}`);
        await page.fill(selector, process.env.WMS_USER);
        usernameFound = true;
        break;
      } catch (e) {
        console.log(`❌ 未找到選擇器: ${selector}`);
      }
    }
    
    if (!usernameFound) {
      // 截圖以便調試
      await page.screenshot({ path: 'wms-debug.png' });
      console.log("📸 已截圖 wms-debug.png 以便調試");
      throw new Error("無法找到用戶名輸入框，請檢查頁面結構");
    }
    
    // 嘗試多種可能的密碼輸入框選擇器
    const passwordSelectors = ['#password', 'input[name="password"]', 'input[type="password"]'];
    let passwordFound = false;
    
    for (const selector of passwordSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        console.log(`✅ 找到密碼輸入框: ${selector}`);
        await page.fill(selector, process.env.WMS_PASS);
        passwordFound = true;
        break;
      } catch (e) {
        console.log(`❌ 未找到選擇器: ${selector}`);
      }
    }
    
    if (!passwordFound) {
      throw new Error("無法找到密碼輸入框，請檢查頁面結構");
    }
    
    // 嘗試多種可能的提交按鈕選擇器
    const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("登入")', 'button:has-text("Login")'];
    let submitFound = false;
    
    for (const selector of submitSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 2000 });
        console.log(`✅ 找到提交按鈕: ${selector}`);
        await page.click(selector);
        submitFound = true;
        break;
      } catch (e) {
        console.log(`❌ 未找到選擇器: ${selector}`);
      }
    }
    
    if (!submitFound) {
      throw new Error("無法找到提交按鈕，請檢查頁面結構");
    }

    // 等待登入完成
    await page.waitForTimeout(5000);

    // 2. 進入進倉單列表頁
    console.log("📦 正在前往進倉單列表...");
    await page.goto("https://wms.rentrap.com/admin/receipts", { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 3. 在列表中搜尋進倉單關鍵字（例如：寶雅退貨_20250627_壞品）
    console.log(`🔍 正在搜尋進倉單關鍵字: ${receiptNo}`);
    const searchSelectors = [
      "input[placeholder*='搜尋']",
      "input[type='search']",
      "input[name*='search']",
      "input[class*='search']",
      "input[placeholder*='Search']",
    ];
    let foundSearch = false;
    for (const selector of searchSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.fill(selector, "");
        await page.fill(selector, receiptNo);
        await page.keyboard.press("Enter");
        foundSearch = true;
        break;
      } catch {}
    }
    if (!foundSearch) {
      throw new Error("找不到搜尋輸入框");
    }
    // 等待資料刷新並直接等待出現關鍵字文字（避免等待整張表）
    await page.waitForTimeout(2000);
    const resultCell = page.locator(`text=${receiptNo}`).first();
    await resultCell.waitFor({ timeout: 15000 });

    // 4. 直接取得搜尋結果該列的連結並以導航方式進入
    console.log("📋 正在開啟搜尋結果的詳細頁...");
    let href = null;
    try {
      href = await page.locator(`tr:has-text("${receiptNo}") a`).first().getAttribute('href');
    } catch {}
    if (!href) {
      try {
        href = await page.locator(`a:has-text("${receiptNo}")`).first().getAttribute('href');
      } catch {}
    }
    if (!href) {
      throw new Error("找不到進倉單連結 href");
    }
    const absoluteUrl = new URL(href, page.url()).toString();
    console.log(`🔗 進入詳細頁: ${absoluteUrl}`);
    await page.goto(absoluteUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 5. 讀取進倉單詳細頁面的表格
    console.log("📊 正在讀取進倉單詳細表格資料...");
    
    // 等待頁面完全載入
    await page.waitForTimeout(3000);
    
    // 先截圖看看詳細頁面的結構
    await page.screenshot({ path: 'receipt-detail.png', fullPage: true });
    console.log("📸 已截圖 receipt-detail.png");
    
    // 檢查頁面中所有的表格
    const detailTables = await page.$$eval('table', tables => 
      tables.map((table, index) => ({
        index: index,
        className: table.className,
        id: table.id,
        rowCount: table.querySelectorAll('tr').length,
        hasHeader: table.querySelector('thead') !== null
      }))
    );
    
    console.log("📊 進倉單詳細頁面中的所有表格:");
    detailTables.forEach(table => {
      console.log(`表格 ${table.index}: 類名: ${table.className}, ID: ${table.id}, 行數: ${table.rowCount}, 有標題: ${table.hasHeader}`);
    });
    
    // 等待並讀取 .table.table-striped 表格
    try {
      await page.waitForSelector(".table.table-striped", { timeout: 10000 });
      console.log("✅ 找到 .table.table-striped 表格");
      
      // 讀取表格資料
      const rows = await page.$$eval(".table.table-striped tr", trs =>
        trs.map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim()))
      );
      
      console.log(`✅ 成功讀取到 ${rows.length} 行資料`);
      
      // 顯示讀取到的資料以便調試
      console.log("📋 讀取到的表格資料:");
      rows.forEach((row, index) => {
        console.log(`第 ${index + 1} 行:`, row);
      });
      
      // 過濾掉標題行，只保留資料行
      const dataRows = rows.filter(row => row.length > 1 && row[0] !== '');
      console.log(`📊 過濾後的資料行數: ${dataRows.length}`);
      
      if (dataRows.length === 0) {
        throw new Error("沒有找到有效的資料行");
      }
      
      return rows;
      
    } catch (e) {
      console.log("❌ 無法找到 .table.table-striped 表格，嘗試其他選擇器...");
      
      // 嘗試其他表格選擇器
      const tableSelectors = [".table", "table"];
      
      for (const selector of tableSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 3000 });
          console.log(`✅ 找到表格: ${selector}`);
          
          const rows = await page.$$eval(`${selector} tr`, trs =>
            trs.map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim()))
          );
          
          if (rows.length > 0) {
            console.log(`✅ 使用選擇器 ${selector} 讀取到 ${rows.length} 行資料`);
            return rows;
          }
        } catch (e) {
          console.log(`❌ 選擇器 ${selector} 讀取失敗`);
        }
      }
      
      throw new Error("無法找到任何表格資料");
    }

    console.log(`✅ 成功讀取 ${rows.length} 筆資料`);
    return rows;
  } catch (error) {
    console.error("❌ 讀取 WMS 資料時發生錯誤:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

function buildCsv(receiptNo, rows) {
  const header = [
    "通路/平台*",
    "是否入庫*",
    "入庫倉庫*",
    "退貨單號/黑貓訂單*",
    "退件人*",
    "退貨單備註",
    "sku(品號)*",
    "數量*",
    "退貨原因*",
    "系統訂單編號",
    "退件人電話",
    "郵遞區號",
    "退件人地址",
    "逆物流編號"
  ];

  const values = rows
    .filter(r => r.length > 1) // 過濾掉標題列
    .map(row => [
      "實體-寶雅",
      "是",
      "藍田",
      receiptNo,
      "實體-寶雅",
      receiptNo,
      row[0], // SKU
      row[1], // 數量
      "客人個人因素",
      "", // 系統訂單編號 (選填)
      "", // 退件人電話 (選填)
      "", // 郵遞區號 (選填)
      "", // 退件人地址 (選填)
      ""  // 逆物流編號 (選填)
    ]);

  return [header, ...values].map(r => r.join(",")).join("\n");
}

async function sendEmail(receiptNo, csvContent) {
  const filePath = `wms_${receiptNo}.csv`;
  
  try {
    // 寫入 CSV 檔案
    fs.writeFileSync(filePath, csvContent);
    console.log(`📄 CSV 檔案已建立: ${filePath}`);

    // 設定 email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // 建議用 App Password
      },
    });

    // 發送 email (暫時跳過，因為認證問題)
    console.log("📧 跳過 Email 發送，CSV 檔案已建立:", filePath);
    
    // 不清理檔案，保留 CSV 供手動使用
    console.log("📄 CSV 檔案已保留:", filePath);
    
  } catch (error) {
    console.error("❌ 發送 Email 時發生錯誤:", error);
    throw error;
  }
}

async function run(receiptNo) {
  try {
    console.log(`🚀 開始處理退貨單: ${receiptNo}`);
    
    // 檢查環境變數
    if (!process.env.WMS_USER || !process.env.WMS_PASS || 
        !process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.EMAIL_TO) {
      throw new Error("❌ 請檢查 .env 檔案中的環境變數設定");
    }

    const rows = await fetchWmsTable(receiptNo);
    const csvContent = buildCsv(receiptNo, rows);
    await sendEmail(receiptNo, csvContent);
    
    console.log("🎉 處理完成！");
  } catch (error) {
    console.error("💥 處理失敗:", error.message);
    process.exit(1);
  }
}

// 主程式入口
async function main() {
  const receiptNo = process.argv[2];
  
  if (!receiptNo) {
    console.log("使用方法: node index.js <退貨單號>");
    console.log("範例: node index.js R20231201001");
    process.exit(1);
  }

  await run(receiptNo);
}

// 如果直接執行此檔案，則執行 main 函數
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default run;
