import axios from "axios";
import * as cheerio from "cheerio";
import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";

let cachedClient = null;
async function getUsers() {
  if (!MONGODB_URI) throw new Error("Thiếu MONGODB_URI");
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
  }
  const db = cachedClient.db(DB_NAME);
  return db.collection(COLLECTION).find({}).toArray();
}

async function sendToAll(message) {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error("❌ BOT_TOKEN chưa được cấu hình");
    return;
  }

  const users = await getUsers();
  if (users.length === 0) {
    console.log("👥 Không có người dùng nào để gửi thông báo.");
    return;
  }

  console.log(`📢 Gửi thông báo đến ${users.length} người dùng...`);

  const promises = users.map((u) =>
    axios
      .post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: u.chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      })
      .catch((err) =>
        console.error(
          `❌ Lỗi gửi đến ${u.chatId}:`,
          err.response?.data || err.message
        )
      )
  );

  await Promise.all(promises);
  console.log("✅ Đã gửi xong thông báo!");
}

async function getEpicFreeGames() {
  const url =
    "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";
  try {
    const { data } = await axios.get(url);
    const games = data.data.Catalog.searchStore.elements || [];

    const freeNow = [];
    const comingSoon = [];
    const discounted = [];

    for (const g of games) {
      if (!g.promotions) continue;
      const offer = g.promotions.promotionalOffers?.[0]?.promotionalOffers?.[0];
      const upcoming =
        g.promotions.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0];

      const slug =
        g.productSlug ||
        g.catalogNs.mappings?.[0]?.pageSlug ||
        g.urlSlug ||
        g.id;
      const link = `https://store.epicgames.com/en-US/p/${slug}`;

      if (offer?.discountSetting?.discountPercentage === 0) {
        freeNow.push({ title: g.title, url: link });
      } else if (upcoming?.discountSetting?.discountPercentage === 0) {
        comingSoon.push({ title: g.title, url: link });
      } else if (
        g.price?.totalPrice?.discountPrice < g.price?.totalPrice?.originalPrice
      ) {
        discounted.push({
          title: g.title,
          url: link,
          discount: (
            (1 -
              g.price.totalPrice.discountPrice /
                g.price.totalPrice.originalPrice) *
            100
          ).toFixed(0),
        });
      }
    }

    return { freeNow, comingSoon, discounted };
  } catch (err) {
    console.error("❌ Lỗi Epic Games:", err.message);
    return { freeNow: [], comingSoon: [], discounted: [] };
  }
}

async function getGOGFreeGames() {
  const url = "https://www.gog.com/en/games?price=free&page=1";
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(data);
    const games = [];

    $("a[href*='/game/']").each((i, el) => {
      let href = $(el).attr("href");
      const title = $(el).text().trim();
      if (!href || !title) return;

      if (!href.startsWith("http")) href = `https://www.gog.com${href}`;
      if (!games.some((g) => g.url === href)) games.push({ title, url: href });
    });

    return games.slice(0, 10);
  } catch (err) {
    console.error("❌ Lỗi GOG:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  console.log("🔍 Đang kiểm tra game miễn phí...");

  const silent = req.query.silent === "true";

  const [{ freeNow, comingSoon, discounted }, gogGames] = await Promise.all([
    getEpicFreeGames(),
    getGOGFreeGames(),
  ]);

  let message = "🎮 <b>Game miễn phí hôm nay:</b>\n";

  if (freeNow.length > 0) {
    message += "\n🆓 <b>Epic Games Free Now:</b>\n";
    freeNow.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  } else {
    message += "\n🚫 Không có game miễn phí hiện tại.\n";
  }

  if (comingSoon.length > 0) {
    message += "\n⏳ <b>Sắp miễn phí:</b>\n";
    comingSoon.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (discounted.length > 0) {
    message += "\n💸 <b>Đang giảm giá:</b>\n";
    discounted.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a> - ${
        g.discount
      }%\n`;
    });
  }

  if (gogGames.length > 0) {
    message += "\n🆓 <b>GOG Free Now:</b>\n";
    gogGames.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (!silent) {
    await sendToAll(message);
  }

  res.status(200).json({ success: true, message });
}
