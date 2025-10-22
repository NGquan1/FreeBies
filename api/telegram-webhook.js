import axios from "axios";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";
const ADMIN_ID = process.env.ADMIN_ID;

let cachedClient = null;
async function getDb() {
  if (!MONGODB_URI) throw new Error("Thiếu MONGODB_URI");
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await cachedClient.connect();
  }
  return cachedClient.db(DB_NAME);
}
async function getCollection() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

/* ---------- helper user ops ---------- */
async function addUser(chatId, meta = {}) {
  const col = await getCollection();
  await col.updateOne(
    { chatId },
    {
      $setOnInsert: {
        chatId,
        username: meta.username || null,
        first_name: meta.first_name || null,
        last_name: meta.last_name || null,
        joinedAt: new Date(),
        claimedGames: 0,
        claimedList: [],
        achievements: [],
      },
    },
    { upsert: true }
  );
}

async function getUser(chatId) {
  const col = await getCollection();
  return await col.findOne({ chatId });
}

async function addClaim(chatId, game) {
  const col = await getCollection();
  await col.updateOne(
    { chatId },
    {
      $inc: { claimedGames: 1 },
      $push: { claimedList: { ...game, claimedAt: new Date() } },
    }
  );
}

async function userHasClaimed(chatId, url) {
  const user = await getUser(chatId);
  if (!user) return false;
  return (user.claimedList || []).some((g) => g.url === url);
}

async function addAchievementsToUser(chatId, names) {
  if (!names || names.length === 0) return;
  const col = await getCollection();
  const ops = names.map((n) => ({ name: n, unlockedAt: new Date() }));
  await col.updateOne({ chatId }, { $push: { achievements: { $each: ops } } });
}

/* ---------- achievement rules ---------- */
const MILESTONES = [
  { count: 1, name: "🎯 Người mới nhận thưởng" },
  { count: 5, name: "🔥 Thợ săn game thực thụ" },
  { count: 10, name: "👑 Game Collector" },
];

async function checkAndUnlockAchievements(user, telegramApi) {
  if (!user) return [];
  const unlockedNow = [];
  const curCount = user.claimedGames || 0;
  const owned = new Set((user.achievements || []).map((a) => a.name));

  for (const m of MILESTONES) {
    if (curCount >= m.count && !owned.has(m.name)) {
      // unlock
      unlockedNow.push(m.name);
      // send message to user
      try {
        await axios.post(`${telegramApi}/sendMessage`, {
          chat_id: user.chatId,
          text: `🏆 Chúc mừng! Bạn vừa mở khóa thành tích: <b>${m.name}</b> — (Đã claim ${curCount} game).`,
          parse_mode: "HTML",
        });
      } catch (err) {
        console.error(
          "Lỗi gửi achievement message:",
          err.response?.data || err.message
        );
      }
    }
  }

  if (unlockedNow.length > 0) {
    await addAchievementsToUser(user.chatId, unlockedNow);
  }

  return unlockedNow;
}

/* ---------- send text helper ---------- */
async function sendReply(telegramApi, chatId, text, opt = {}) {
  try {
    await axios.post(`${telegramApi}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: opt.parse_mode || "HTML",
      disable_web_page_preview: opt.disable_web_page_preview || false,
    });
  } catch (err) {
    console.error("Lỗi gửi Telegram:", err.response?.data || err.message);
  }
}

/* ---------- main handler ---------- */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
  const BASE_URL = process.env.BASE_URL
    ? process.env.BASE_URL
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

  if (!TELEGRAM_TOKEN) return res.status(500).send("Missing BOT_TOKEN");

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  const body = req.body || {};
  const message = body.message || body.edited_message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim?.();

  if (!chatId || !text) return res.status(200).send("No message content");

  try {
    // ensure user exists
    const meta = {
      username: message.from?.username,
      first_name: message.from?.first_name,
      last_name: message.from?.last_name,
    };
    await addUser(chatId, meta);

    console.log(`📩 Message from ${chatId}: ${text}`);
    let reply = "";

    // /start
    if (text === "/start") {
      reply =
        "👋 Bạn đã được đăng ký nhận thông báo. Dùng /check để xem danh sách free, /claim Tên game | URL để lưu game, /mygames để xem, /achievements để xem thành tích.";
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // /stop
    if (text === "/stop") {
      const col = await getCollection();
      await col.deleteOne({ chatId });
      reply = "👋 Bạn đã hủy đăng ký.";
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // /check => call your existing check-free-games endpoint if provided
    if (text === "/check") {
      if (!BASE_URL) {
        reply =
          "❗BASE_URL chưa được cấu hình, không thể gọi API /check-free-games.";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }

      const checkUrl = `${BASE_URL.replace(
        /\/$/,
        ""
      )}/api/check-free-games?silent=true`;

      try {
        const resp = await axios.get(checkUrl, {
          headers: {
            Authorization: `Bearer ${process.env.INTERNAL_KEY}`, // ✅ sửa lại
          },
        });

        const msg = resp.data?.message || "❌ Không lấy được danh sách.";
        await sendReply(TELEGRAM_API, chatId, msg);
      } catch (err) {
        console.error("Lỗi gọi check-free-games:", err.message);
        await sendReply(
          TELEGRAM_API,
          chatId,
          "❌ Lỗi khi lấy danh sách game miễn phí."
        );
      }

      return res.status(200).send("OK");
    }

    // /claim Tên game | URL  -> add to user's claimedList, then check milestones
    if (text.toLowerCase().startsWith("/claim")) {
      // Accept formats:
      // /claim Title | https://...
      // /claim https://... (if user forwards url only, we try to fetch title = url)
      const payload = text.replace("/claim", "").trim();
      if (!payload) {
        reply =
          "⚙️ Cú pháp: <code>/claim Tên game | URL</code>\nHoặc: <code>/claim URL</code>";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }

      let title = null;
      let url = null;

      // try split by '|'
      if (payload.includes("|")) {
        const parts = payload.split("|");
        title = parts[0].trim();
        url = parts[1].trim();
      } else {
        // if single token, assume URL (or title without url)
        // if looks like url -> set url, and title fallback to url
        const first = payload.split(/\s+/)[0];
        if (first.startsWith("http")) {
          url = first;
          title = payload; // maybe user included title too
        } else {
          // no url given
          reply =
            "⚠️ Cần URL để claim. Dùng: <code>/claim Tên game | URL</code>";
          await sendReply(TELEGRAM_API, chatId, reply);
          return res.status(200).send("OK");
        }
      }

      // normalize URL (basic)
      try {
        url = url.split(" ").shift();
      } catch (e) {}

      // check duplicate
      const already = await userHasClaimed(chatId, url);
      if (already) {
        reply = `⚠️ Bạn đã lưu game này trước đó rồi: <a href="${url}">${title}</a>`;
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }

      // push claim
      await addClaim(chatId, { title, url });

      // fetch fresh user to check achievements
      const user = await getUser(chatId);

      // check & unlock milestone achievements (if any)
      const unlocked = await checkAndUnlockAchievements(user, TELEGRAM_API);

      // reply summary
      reply = `🎁 Đã lưu: <a href="${url}">${title}</a>\n✅ Tổng đã claim: ${
        user.claimedGames || 0
      }`;
      if (unlocked.length) {
        reply += `\n🏆 Mở khóa: ${unlocked
          .map((n) => `<b>${n}</b>`)
          .join(", ")}`;
      }
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // /mygames
    if (text === "/mygames") {
      const user = await getUser(chatId);
      const list = user?.claimedList || [];
      if (!list.length) {
        reply = "📭 Bạn chưa claim game nào.";
      } else {
        // show last 20
        const html = list
          .slice(-20)
          .map((g, i) => `${i + 1}. <a href="${g.url}">${g.title}</a>`)
          .join("\n");
        reply = `<b>🎮 Danh sách game đã claim (${list.length}):</b>\n${html}`;
      }
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // /achievements
    if (text === "/achievements") {
      const user = await getUser(chatId);
      const ach = user?.achievements || [];
      if (!ach.length) {
        reply = "🏅 Bạn chưa có achievement nào.";
      } else {
        const lines = ach.map(
          (a) => `• ${a.name} — ${new Date(a.unlockedAt).toLocaleDateString()}`
        );
        reply = `<b>🏆 Thành tích của bạn</b>\n${lines.join("\n")}`;
      }
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // admin /grant <chatId> <achievement name>
    if (text.startsWith("/grant")) {
      if (!ADMIN_ID || String(chatId) !== String(ADMIN_ID)) {
        reply = "🚫 Lệnh này chỉ dành cho admin.";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }
      const parts = text.split(" ");
      if (parts.length < 3) {
        reply = "📘 Cú pháp: /grant <chatId> <tên achievement>";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }
      const targetId = parts[1];
      const name = parts.slice(2).join(" ").trim();
      // add achievement to target regardless of count (admin grant)
      const targetUser = await getUser(targetId);
      if (!targetUser) {
        reply = "❗ Người dùng không tồn tại trong DB.";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }
      const already = (targetUser.achievements || []).some(
        (a) => a.name === name
      );
      if (already) {
        reply = "⚠️ Người này đã có achievement đó rồi.";
        await sendReply(TELEGRAM_API, chatId, reply);
        return res.status(200).send("OK");
      }
      await addAchievementsToUser(targetId, [name]);
      // notify target
      try {
        await sendReply(
          TELEGRAM_API,
          targetId,
          `🎉 Bạn vừa được admin tặng achievement: <b>${name}</b>`
        );
      } catch {}
      reply = `✅ Đã tặng "${name}" cho ${targetId}`;
      await sendReply(TELEGRAM_API, chatId, reply);
      return res.status(200).send("OK");
    }

    // unknown command
    reply =
      "⚙️ Lệnh không hợp lệ.\nCác lệnh: /check /claim /mygames /achievements /start /stop";
    await sendReply(TELEGRAM_API, chatId, reply);
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Handler error:", err.response?.data || err.message || err);
    return res.status(200).send("Error handled");
  }
}
