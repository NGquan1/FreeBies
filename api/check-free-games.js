import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";

async function getMongoCollection() {
  if (!MONGODB_URI) throw new Error("Thiếu biến môi trường MONGODB_URI");
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  return { collection: db.collection(COLLECTION), client };
}

async function getAllUsers() {
  const { collection, client } = await getMongoCollection();
  try {
    const users = await collection.find({}).toArray();
    return users.map((u) => u.chatId);
  } finally {
    await client.close();
  }
}

async function sendToAll(message) {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error("❌ BOT_TOKEN chưa được cấu hình trong .env");
    return;
  }

  const users = await getAllUsers();
  if (!users.length) {
    console.log("👥 Không có người dùng nào để gửi thông báo.");
    return;
  }

  console.log(`📢 Gửi thông báo đến ${users.length} người dùng...`);

  const promises = users.map((chatId) =>
    axios
      .post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      })
      .catch((err) =>
        console.error(
          `❌ Lỗi gửi đến ${chatId}:`,
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

  let message = "🎮 <b>GAME MIỄN PHÍ HÔM NAY</b>\n\n";

  if (freeNow.length > 0) {
    message += "🆓 <b>Epic Games — Free Now</b>\n";
    freeNow.forEach((g) => {
      message += `• <a href="${g.url}">${g.title}</a>\n`;
    });
  } else {
    message += "🆓 <b>Epic Games — Free Now</b>\n🚫 Không có game miễn phí.\n";
  }

  if (comingSoon.length > 0) {
    message += "\n⏳ <b>Sắp miễn phí</b>\n";
    comingSoon.forEach((g) => {
      message += `• <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (discounted.length > 0) {
    message += "\n💸 <b>Đang giảm giá</b>\n";
    discounted.forEach((g) => {
      const original = g.originalPrice ? `~$${g.originalPrice}~` : "";
      const sale = g.discountPrice ? `<b>$${g.discountPrice}</b>` : "";
      message += `• <a href="${g.url}">${g.title}</a> — ${original} ${sale} (-${g.discount}%)\n`;
    });
  }

  if (gogGames.length > 0) {
    message += "\n🧩 <b>GOG — Free & Deals</b>\n";
    gogGames.forEach((g) => {
      const match = g.title.match(/(.+?)-(\d+)%\$(\d+\.\d+)\$(\d+\.\d+)/);
      if (match) {
        const [_, title, discount, oldPrice, newPrice] = match;
        message += `• <a href="${
          g.url
        }">${title.trim()}</a> — ~$${oldPrice}~ <b>$${newPrice}</b> (-${discount}%)\n`;
      } else {
        message += `• <a href="${g.url}">${g.title}</a>\n`;
      }
    });
  } else {
    message += "\n🧩 <b>GOG</b>\n🚫 Không có game miễn phí hiện tại.\n";
  }

  message +=
    "\n\n✨ <i>Nhấn vào link để nhận game miễn phí ngay!</i>\n#FreeGames #Epic #GOG";

  if (!silent) {
    await sendToAll(message);
  }

  res.status(200).json({ success: true, message });
}
