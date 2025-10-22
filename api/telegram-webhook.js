import axios from "axios";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";
const ACH_COLLECTION = "user_achievements";

let cachedClient = null;

// ========================== MongoDB Helper ==========================
async function getDb() {
  if (!MONGODB_URI) throw new Error("Thiếu biến môi trường MONGODB_URI");
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(DB_NAME);
}

async function getCollection() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

async function getAchievementsCollection() {
  const db = await getDb();
  return db.collection(ACH_COLLECTION);
}

// ========================== User Management ==========================
async function addUser(chatId) {
  const collection = await getCollection();
  await collection.updateOne(
    { chatId },
    { $set: { chatId, joinedAt: new Date() } },
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

// ========================== Achievement Logic ==========================
async function claimAchievement(chatId, achievementName) {
  const achCol = await getAchievementsCollection();
  const exists = await achCol.findOne({ chatId, name: achievementName });

  if (exists) return `🏆 Bạn đã nhận achievement "${achievementName}" rồi!`;

  await achCol.insertOne({
    chatId,
    name: achievementName,
    claimedAt: new Date(),
  });

  return `🎉 Bạn vừa nhận được achievement mới: <b>${achievementName}</b>!`;
}

async function listAchievements(chatId) {
  const achCol = await getAchievementsCollection();
  const achievements = await achCol.find({ chatId }).toArray();
  if (!achievements.length) return "😅 Bạn chưa có achievement nào.";
  return (
    "🏅 Danh sách achievement của bạn:\n" +
    achievements.map((a) => `- ${a.name}`).join("\n")
  );
}

// ========================== Telegram Handler ==========================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
  const BASE_URL = process.env.BASE_URL;
  const ADMIN_ID = process.env.ADMIN_ID; // 🧑‍💼 ID admin Telegram

  if (!TELEGRAM_TOKEN || !BASE_URL)
    return res.status(500).send("❌ Missing BOT_TOKEN or BASE_URL");

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  const chatId = req.body?.message?.chat?.id;
  const text = req.body?.message?.text?.trim();

  if (!chatId || !text) return res.status(200).send("No message content");

  try {
    console.log(`📩 Message from ${chatId}: ${text}`);
    let replyMessage = "";

    // ========================== Commands ==========================
    if (text.startsWith("/start")) {
      const exists = await isUserExists(chatId);
      if (!exists) {
        await addUser(chatId);
        replyMessage =
          "👋 Cảm ơn bạn đã đăng ký! Tôi sẽ thông báo khi có game miễn phí mới.\nDùng /check để xem ngay danh sách hiện tại hoặc /stop để hủy đăng ký.";
      } else {
        replyMessage =
          "✅ Bạn đã đăng ký rồi! Dùng /check để xem game hoặc /stop để hủy đăng ký.";
      }
    } else if (text.startsWith("/stop")) {
      const exists = await isUserExists(chatId);
      if (exists) {
        await removeUser(chatId);
        replyMessage = "👋 Bạn đã hủy đăng ký nhận tin. Tạm biệt!";
      } else {
        replyMessage = "❗Bạn chưa đăng ký. Dùng /start để bắt đầu.";
      }
    } else if (text.startsWith("/check")) {
      const checkUrl = `${BASE_URL}/api/check-free-games?silent=true`;
      console.log("🔍 Gọi API kiểm tra:", checkUrl);
      try {
        const response = await axios.get(checkUrl);
        replyMessage =
          response.data?.message || "❌ Không thể lấy danh sách game miễn phí.";
      } catch (err) {
        console.error("Lỗi khi gọi /check-free-games:", err.message);
        replyMessage = "❌ Lỗi khi lấy danh sách game miễn phí.";
      }
    } else if (text.startsWith("/claim")) {
      const parts = text.split(" ");
      const achievementName = parts.slice(1).join(" ").trim();

      if (!achievementName) {
        replyMessage =
          "🎯 Dùng cú pháp: /claim <tên-achievement>\nVD: /claim Early Supporter";
      } else {
        replyMessage = await claimAchievement(chatId, achievementName);
      }
    } else if (text.startsWith("/achievements")) {
      replyMessage = await listAchievements(chatId);
    }

    // ========================== ADMIN COMMAND ==========================
    else if (text.startsWith("/grant")) {
      if (String(chatId) !== String(ADMIN_ID)) {
        replyMessage = "🚫 Lệnh này chỉ dành cho admin.";
      } else {
        const [_, targetId, ...achNameParts] = text.split(" ");
        const achievementName = achNameParts.join(" ").trim();
        if (!targetId || !achievementName) {
          replyMessage =
            "📘 Dùng cú pháp: /grant <chatId> <tên-achievement>\nVD: /grant 123456789 Loyal Follower";
        } else {
          replyMessage = await claimAchievement(targetId, achievementName);
        }
      }
    } else {
      replyMessage =
        "⚙️ Lệnh không hợp lệ.\nHãy dùng:\n" +
        "/check - Xem game miễn phí\n" +
        "/claim <tên-achievement> - Nhận achievement\n" +
        "/achievements - Xem achievement của bạn\n" +
        "/stop - Hủy đăng ký";
    }

    // ========================== Send reply ==========================
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
