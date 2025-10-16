import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot is running...");
  }

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).end();

  const chatId = message.chat.id;
  const text = message.text.trim().toLowerCase();

  let reply = "";
  if (text === "/start") {
    reply = "👋 Xin chào! Gõ /check để xem game miễn phí hôm nay.";
  } else if (text === "/check" || text === "/today") {
    try {
      const resp = await axios.get(
        `${process.env.VERCEL_URL}/api/check-free-games`
      );
      reply = resp.data?.message || "Không có game miễn phí nào hôm nay.";
    } catch {
      reply = "❌ Lỗi khi lấy danh sách game miễn phí.";
    }
  } else {
    reply = "❓ Lệnh không hợp lệ. Gõ /check để xem game miễn phí.";
  }

  await axios.post(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text: reply,
      parse_mode: "HTML",
    }
  );

  res.status(200).end();
}
