import axios from "axios";

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

    if (text === "/start") {
      replyMessage =
        "👋 Xin chào! Tôi sẽ thông báo khi có game miễn phí mới.\nDùng /check để xem ngay danh sách hiện tại.";
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
        "⚙️ Lệnh không hợp lệ. Hãy dùng /check để xem game miễn phí hoặc /start để bắt đầu.";
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
