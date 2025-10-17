import axios from "axios";
import fs from "fs";
import path from "path";

const notifiedFilePath = path.join(process.cwd(), "api", "notified.json");

function getNotifiedUsers() {
  try {
    if (fs.existsSync(notifiedFilePath)) {
      const fileContent = fs.readFileSync(notifiedFilePath, "utf-8");
      return fileContent ? JSON.parse(fileContent) : [];
    }
    return [];
  } catch (error) {
    console.error("Lỗi khi đọc tệp notified.json:", error);
    return [];
  }
}

function saveNotifiedUsers(users) {
  try {
    fs.writeFileSync(notifiedFilePath, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error("Lỗi khi ghi tệp notified.json:", error);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
  const BASE_URL = process.env.BASE_URL;

  if (!TELEGRAM_TOKEN || !BASE_URL) {
    console.error("❌ Thiếu biến môi trường BOT_TOKEN hoặc BASE_URL");
    return res.status(500).send("Missing environment variables");
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text?.trim();

  if (!chatId || !text) return res.status(200).send("No message content");

  try {
    console.log(`📩 Nhận tin nhắn từ ${chatId}: ${text}`);

    let replyMessage = "";
    let users = getNotifiedUsers();

    if (text === "/start") {
      if (!users.includes(chatId)) {
        users.push(chatId);
        saveNotifiedUsers(users);
        replyMessage =
          "👋 Cảm ơn bạn đã đăng ký! Tôi sẽ thông báo khi có game miễn phí mới.\nDùng /check để xem ngay danh sách hiện tại hoặc /stop để hủy đăng ký.";
      } else {
        replyMessage =
          "✅ Bạn đã đăng ký rồi! Dùng /check để xem game hoặc /stop để hủy đăng ký.";
      }
    } else if (text === "/stop") {
      if (users.includes(chatId)) {
        users = users.filter((id) => id !== chatId);
        saveNotifiedUsers(users);
        replyMessage = "👋 Bạn đã hủy đăng ký nhận tin. Tạm biệt!";
      } else {
        replyMessage = "Bạn chưa đăng ký. Dùng /start để bắt đầu.";
      }
    } else if (text === "/check") {
      const checkUrl = `${process.env.BASE_URL}/api/check-free-games?silent=true`;
      console.log("🔍 Gọi API kiểm tra:", checkUrl);

      try {
        const response = await axios.get(checkUrl);
        replyMessage =
          response.data?.message || "❌ Không thể lấy danh sách game miễn phí.";
      } catch (err) {
        console.error("Lỗi khi gọi API check-free-games:", err.message);
        replyMessage = "❌ Lỗi khi lấy danh sách game miễn phí.";
      }
    } else {
      replyMessage =
        "⚙️ Lệnh không hợp lệ. Hãy dùng /check để xem game, /start để đăng ký hoặc /stop để hủy.";
    }

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: replyMessage,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });

    return res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Telegram Webhook Error:", error.message);
    return res.status(200).send("Error handled gracefully");
  }
}
