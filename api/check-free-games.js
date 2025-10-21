import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";

/* ========================= MONGO ========================= */
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

/* ========================= SENDER ========================= */
async function sendToAll(gamesByPlatform, summaryMessage) {
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

  for (const chatId of users) {
    // Gửi tin tóm tắt
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: summaryMessage,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });

    // Gửi ảnh từng game
    for (const [platform, games] of Object.entries(gamesByPlatform)) {
      for (const g of games) {
        if (!g.image) continue;
        const caption = `<b>${platform}</b>\n<a href="${g.url}">${g.title}</a>`;
        await axios
          .post(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            chat_id: chatId,
            photo: g.image,
            caption,
            parse_mode: "HTML",
          })
          .catch((err) =>
            console.error(
              `❌ Lỗi gửi ảnh ${g.title} đến ${chatId}:`,
              err.response?.data || err.message
            )
          );
      }
    }
  }

  console.log("✅ Đã gửi xong thông báo!");
}

/* ========================= EPIC GAMES ========================= */
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
      const image = g.keyImages?.[0]?.url || null;

      if (offer?.discountSetting?.discountPercentage === 0) {
        freeNow.push({ title: g.title, url: link, image });
      } else if (upcoming?.discountSetting?.discountPercentage === 0) {
        comingSoon.push({ title: g.title, url: link, image });
      } else if (
        g.price?.totalPrice?.discountPrice < g.price?.totalPrice?.originalPrice
      ) {
        discounted.push({
          title: g.title,
          url: link,
          image,
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

/* ========================= GOG ========================= */
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
      const image = $(el).find("img").attr("src") || null;
      if (!games.some((g) => g.url === href))
        games.push({ title, url: href, image });
    });

    return games.slice(0, 10);
  } catch (err) {
    console.error("❌ Lỗi GOG:", err.message);
    return [];
  }
}

/* ========================= STEAM ========================= */
async function getSteamFreeGames() {
  try {
    const { data } = await axios.get(
      "https://store.steampowered.com/api/featuredcategories/?cc=us"
    );

    const freeGames = [];
    if (data["specials"]?.items) {
      const trulyFree = data["specials"].items.filter(
        (g) => g.final_price === 0
      );
      for (const g of trulyFree) {
        freeGames.push({
          title: g.name,
          url: `https://store.steampowered.com/app/${g.id}`,
          image: g.large_capsule_image || g.header_image || null,
        });
      }
    }

    if (data["freeweekend"]?.items) {
      for (const item of data["freeweekend"].items) {
        freeGames.push({
          title: item.name,
          url: `https://store.steampowered.com/app/${item.id}`,
          image: item.large_capsule_image || item.header_image || null,
        });
      }
    }

    return freeGames;
  } catch (err) {
    console.error("❌ Lỗi Steam:", err.message);
    return [];
  }
}

/* ========================= UBISOFT ========================= */
async function getUbisoftFreeGames() {
  try {
    const { data } = await axios.get(
      "https://store.ubisoft.com/api/free-games?locale=en-US"
    );
    if (!data?.data?.length) return [];
    return data.data.map((g) => ({
      title: g.attributes.name,
      url: `https://store.ubisoft.com/en-us/${g.attributes.slug}.html`,
      image: g.attributes.productImage || null,
    }));
  } catch (err) {
    console.error("❌ Lỗi Ubisoft:", err.message);
    return [];
  }
}

/* ========================= XBOX (placeholder) ========================= */
async function getXboxFreeGames() {
  return [];
}

/* ========================= MAIN HANDLER ========================= */
export default async function handler(req, res) {
  console.log("🔍 Đang kiểm tra game miễn phí...");

  const silent = req.query.silent === "true";

  const [
    { freeNow, comingSoon, discounted },
    gogGames,
    steamGames,
    ubisoftGames,
    xboxGames,
  ] = await Promise.all([
    getEpicFreeGames(),
    getGOGFreeGames(),
    getSteamFreeGames(),
    getUbisoftFreeGames(),
    getXboxFreeGames(),
  ]);

  let message = "🎮 <b>GAME MIỄN PHÍ HÔM NAY</b>\n\n";

  // EPIC
  if (freeNow.length > 0) {
    message += "🆓 <b>Epic Games — Free Now</b>\n";
    freeNow.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  } else
    message += "🆓 <b>Epic Games — Free Now</b>\n🚫 Không có game miễn phí.\n";

  if (comingSoon.length > 0) {
    message += "\n⏳ <b>Sắp miễn phí</b>\n";
    comingSoon.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  }

  if (discounted.length > 0) {
    message += "\n💸 <b>Đang giảm giá</b>\n";
    discounted.forEach((g) => {
      message += `• <a href="${g.url}">${g.title}</a> (-${g.discount}%)\n`;
    });
  }

  message += "\n────────────────────\n";

  // GOG
  if (gogGames.length > 0) {
    message += "🧩 <b>GOG — Free & Deals</b>\n";
    gogGames.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  } else message += "🧩 <b>GOG</b>\n🚫 Không có game miễn phí hiện tại.\n";

  message += "\n────────────────────\n";

  // STEAM
  if (steamGames.length > 0) {
    message += "🔥 <b>Steam — Free Games</b>\n";
    steamGames.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  } else message += "🔥 <b>Steam</b>\n🚫 Không có game miễn phí hiện tại.\n";

  message += "\n────────────────────\n";

  // UBISOFT
  if (ubisoftGames.length > 0) {
    message += "🎯 <b>Ubisoft — Free & Deals</b>\n";
    ubisoftGames.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  } else message += "🎯 <b>Ubisoft</b>\n🚫 Không có game miễn phí hiện tại.\n";

  message += "\n────────────────────\n";

  // XBOX
  if (xboxGames.length > 0) {
    message += "🎮 <b>Xbox — Free & Deals</b>\n";
    xboxGames.forEach(
      (g) => (message += `• <a href="${g.url}">${g.title}</a>\n`)
    );
  } else message += "🎮 <b>Xbox</b>\n🚫 Không có game miễn phí hiện tại.\n";

  message +=
    "\n\n✨ <i>Nhấn vào link để nhận game miễn phí ngay!</i>\n#FreeGames #Epic #GOG #Steam #Ubisoft #Xbox";

  const gamesByPlatform = {
    Epic: [...freeNow, ...comingSoon, ...discounted],
    GOG: gogGames,
    Steam: steamGames,
    Ubisoft: ubisoftGames,
    Xbox: xboxGames,
  };

  if (!silent) {
    await sendToAll(gamesByPlatform, message);
  }

  res.status(200).json({ success: true, message });
}
