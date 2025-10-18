import axios from "axios";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";

let cachedClient = null;
async function getCollection() {
  if (!MONGODB_URI) throw new Error("Thiếu biến môi trường MONGODB_URI");
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
  }
  const db = cachedClient.db(DB_NAME);
  return db.collection(COLLECTION);
}

async function addUser(chatId) {
  const collection = await getCollection();
  await collection.updateOne(
    { chatId },
    { $set: { chatId } },
    { upsert: true }
  );
}

async function removeUser(chatId) {
  const collection = await getCollection();
  await collection.deleteOne({ chatId });
}

async function isUserExists(chatId) {
  const collection = await getCollection();
  const user = await collection.findOne({ chatId });
  return !!user;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
  const BASE_URL = process.env.BASE_URL;
  if (!TELEGRAM_TOKEN || !BASE_URL)
    return res.status(500).send("❌ Missing BOT_TOKEN or BASE_URL");

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text?.trim();

  if (!chatId || !text) return res.status(200).send("No message content");

  try {
    console.log(`📩 Message from ${chatId}: ${text}`);
    let replyMessage = "";

    switch (text) {
      case "/start": {
        const exists = await isUserExists(chatId);
        if (!exists) {
          await addUser(chatId);
          replyMessage =
            "👋 Cảm ơn bạn đã đăng ký! Tôi sẽ thông báo khi có game miễn phí mới.\nDùng /check để xem ngay danh sách hiện tại hoặc /stop để hủy đăng ký.";
        } else {
          replyMessage =
            "✅ Bạn đã đăng ký rồi! Dùng /check để xem game hoặc /stop để hủy đăng ký.";
        }
        break;
      }

      case "/stop": {
        const exists = await isUserExists(chatId);
        if (exists) {
          await removeUser(chatId);
          replyMessage = "👋 Bạn đã hủy đăng ký nhận tin. Tạm biệt!";
        } else {
          replyMessage = "❗Bạn chưa đăng ký. Dùng /start để bắt đầu.";
        }
        break;
      }

      case "/check": {
        const checkUrl = `${BASE_URL}/api/check-free-games?silent=true`;
        console.log("🔍 Gọi API kiểm tra:", checkUrl);
        try {
          const response = await axios.get(checkUrl);
          replyMessage =
            response.data?.message ||
            "❌ Không thể lấy danh sách game miễn phí.";
        } catch (err) {
          console.error("Lỗi khi gọi /check-free-games:", err.message);
          replyMessage = "❌ Lỗi khi lấy danh sách game miễn phí.";
        }
        break;
      }

      default:
        replyMessage =
          "⚙️ Lệnh không hợp lệ.\nHãy dùng /check để xem game miễn phí, /start để đăng ký, hoặc /stop để hủy.";
    }

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: replyMessage,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });

    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Telegram Webhook Error:", error.message);
    res.status(200).send("Error handled gracefully");
  }
}
