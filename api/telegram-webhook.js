import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text?.trim();

  if (!chatId || !text) return res.status(200).send("No message content");

  try {
    if (text === "/start") {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "👋 Xin chào! Tôi sẽ thông báo khi có game miễn phí mới.\nDùng /check để xem ngay danh sách hiện tại.",
      });
      return res.status(200).send("Start command processed");
    }

    if (text === "/check") {
      console.log("✅ BASE_URL:", process.env.BASE_URL);
      const checkUrl = `${process.env.BASE_URL}/api/check-free-games`;
      console.log("✅ checkUrl:", checkUrl);

      const response = await axios.get(checkUrl);

      const gamesMessage =
        response.data?.message || "❌ Lỗi khi lấy danh sách game miễn phí.";

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: gamesMessage,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      });
      return res.status(200).send("Check command processed");
    }

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "⚙️ Lệnh không hợp lệ. Hãy dùng /check để xem game miễn phí hoặc /start để bắt đầu.",
    });
    return res.status(200).send("Unknown command handled");
  } catch (error) {
    console.error("Telegram Webhook Error:", error.message);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "❌ Lỗi khi lấy danh sách game miễn phí.",
    });
    return res.status(500).send("Internal server error");
  }
}
