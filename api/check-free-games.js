import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "freebies";
const COLLECTION = "notified_users";

/* ========================= MONGO HELPERS ========================= */
async function getMongoCollection() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  return { collection: client.db(DB_NAME).collection(COLLECTION), client };
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

/* ========================= TELEGRAM SEND ========================= */
async function sendToAll(message) {
  const botToken = process.env.BOT_TOKEN;
  const users = await getAllUsers();

  const promises = users.map((chatId) =>
    axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    })
  );

  await Promise.all(promises);
}

/* ========================= EPIC GAMES ========================= */
async function getEpicGames() {
  const url =
    "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";
  const { data } = await axios.get(url);
  const games = data.data.Catalog.searchStore.elements || [];

  const result = { freeNow: [], comingSoon: [], discounted: [] };

  for (const g of games) {
    if (!g.promotions) continue;

    const offer = g.promotions.promotionalOffers?.[0]?.promotionalOffers?.[0];
    const upcoming =
      g.promotions.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0];
    const slug =
      g.productSlug || g.catalogNs.mappings?.[0]?.pageSlug || g.urlSlug || g.id;
    const link = `https://store.epicgames.com/en-US/p/${slug}`;

    if (offer?.discountSetting?.discountPercentage === 0) {
      result.freeNow.push({ title: g.title, url: link });
    } else if (upcoming?.discountSetting?.discountPercentage === 0) {
      result.comingSoon.push({ title: g.title, url: link });
    } else if (
      g.price?.totalPrice?.discountPrice < g.price?.totalPrice?.originalPrice
    ) {
      const o = g.price.totalPrice.originalPrice / 100;
      const d = g.price.totalPrice.discountPrice / 100;
      const percent = ((1 - d / o) * 100).toFixed(0);
      result.discounted.push({
        title: g.title,
        url: link,
        oldPrice: o.toFixed(2),
        newPrice: d.toFixed(2),
        discount: percent,
      });
    }
  }

  return result;
}

/* ========================= GOG ========================= */
async function getGOGGames() {
  const url = "https://www.gog.com/en/games?price=free%2Cdiscounted&page=1";
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const $ = cheerio.load(data);
  const games = [];

  $("a[href*='/game/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!href || !text) return;

    const match = text.match(/(.+?)-(\d+)%\$(\d+(?:\.\d+)?)\$(\d+(?:\.\d+)?)/);
    if (match) {
      const [, title, discount, oldPrice, newPrice] = match;
      games.push({
        title: title.trim(),
        url: href.startsWith("http") ? href : `https://www.gog.com${href}`,
        oldPrice,
        newPrice,
        discount,
      });
    } else {
      games.push({
        title: text.trim(),
        url: href.startsWith("http") ? href : `https://www.gog.com${href}`,
      });
    }
  });

  return games.slice(0, 10);
}

/* ========================= STEAM ========================= */
async function getSteamGames() {
  const { data } = await axios.get(
    "https://store.steampowered.com/api/featuredcategories/?cc=us"
  );

  const result = { freeNow: [], discounted: [] };

  // miễn phí
  if (data["specials"]?.items) {
    const trulyFree = data["specials"].items.filter((g) => g.final_price === 0);
    result.freeNow.push(
      ...trulyFree.map((g) => ({
        title: g.name,
        url: `https://store.steampowered.com/app/${g.id}`,
      }))
    );
  }

  // đang giảm giá
  if (data["specials"]?.items) {
    const sale = data["specials"].items
      .filter((g) => g.discount_percent > 0 && g.final_price > 0)
      .slice(0, 10);
    for (const g of sale) {
      result.discounted.push({
        title: g.name,
        url: `https://store.steampowered.com/app/${g.id}`,
        oldPrice: (g.original_price / 100).toFixed(2),
        newPrice: (g.final_price / 100).toFixed(2),
        discount: g.discount_percent,
      });
    }
  }

  return result;
}

/* ========================= UBISOFT ========================= */
export async function getUbisoftGames() {
  try {
    const freeNow = [];

    // ✅ 1️⃣ Lấy từ API (thường là free event / trial)
    const apiUrl = "https://store.ubisoft.com/api/free-games?locale=en-US";
    const { data } = await axios.get(apiUrl, { timeout: 10000 });
    if (data?.data?.length) {
      for (const g of data.data) {
        const title = g.attributes?.name?.trim();
        const slug = g.attributes?.slug;
        if (title && slug) {
          freeNow.push({
            title,
            url: `https://store.ubisoft.com/en-us/${slug}.html`,
          });
        }
      }
    }

    // ✅ 2️⃣ Lấy từ trang Free Games chính thức (Free Forever)
    const freeListUrl = "https://store.ubisoft.com/sea/games/free?lang=en_SG";
    const html = await axios.get(freeListUrl, { timeout: 15000 });
    const $ = cheerio.load(html.data);

    $(".product-card").each((_, el) => {
      const title = $(el).find(".product-card__title").text().trim();
      const href = $(el).find("a.product-card__link").attr("href");
      const price = $(el).find(".price-item").text().trim().toLowerCase();

      if (title && href && price.includes("free")) {
        const url = href.startsWith("http")
          ? href
          : "https://store.ubisoft.com" + href;
        freeNow.push({ title, url });
      }
    });

    // ✅ 3️⃣ Lọc trùng theo title
    const unique = [];
    const seen = new Set();
    for (const g of freeNow) {
      if (!seen.has(g.title)) {
        seen.add(g.title);
        unique.push(g);
      }
    }

    return { freeNow: unique };
  } catch (error) {
    console.error("⚠️ Ubisoft fetch error:", error.message);
    return { freeNow: [] };
  }
}

/* ========================= XBOX ========================= */
async function getXboxGames() {
  return { freeNow: [], discounted: [] };
}

/* ========================= MAIN HANDLER ========================= */
export default async function handler(req, res) {
  const silent = req.query.silent === "true";

  const [epic, gog, steam, ubisoft, xbox] = await Promise.all([
    getEpicGames(),
    getGOGGames(),
    getSteamGames(),
    getUbisoftGames(),
    getXboxGames(),
  ]);

  let msg = "🎮 <b>GAME MIỄN PHÍ HÔM NAY</b>\n\n";

  // ===== Epic =====
  msg += "🆓 <b>Epic Games — Free Now</b>\n";
  msg +=
    epic.freeNow.length > 0
      ? epic.freeNow
          .map((g) => `• <a href="${g.url}">${g.title}</a>`)
          .join("\n")
      : "🚫 Không có game miễn phí.";
  if (epic.comingSoon.length)
    msg +=
      "\n\n⏳ <b>Sắp miễn phí</b>\n" +
      epic.comingSoon
        .map((g) => `• <a href="${g.url}">${g.title}</a>`)
        .join("\n");
  if (epic.discounted.length)
    msg +=
      "\n\n💸 <b>Đang giảm giá</b>\n" +
      epic.discounted
        .map(
          (g) =>
            `• <a href="${g.url}">${g.title}</a> — ~$${g.oldPrice}~ <b>$${g.newPrice}</b> (-${g.discount}%)`
        )
        .join("\n");
  msg += "\n\n────────────────────\n";

  // ===== GOG =====
  msg += "🧩 <b>GOG — Free & Deals</b>\n";
  msg += gog.length
    ? gog
        .map((g) =>
          g.discount
            ? `• <a href="${g.url}">${g.title}</a> — ~$${g.oldPrice}~ <b>$${g.newPrice}</b> (-${g.discount}%)`
            : `• <a href="${g.url}">${g.title}</a>`
        )
        .join("\n")
    : "🚫 Không có game miễn phí hiện tại.";
  msg += "\n\n────────────────────\n";

  // ===== Steam =====
  msg += "🔥 <b>Steam — Free & Deals</b>\n";
  if (steam.freeNow.length)
    msg += steam.freeNow
      .map((g) => `• <a href="${g.url}">${g.title}</a>`)
      .join("\n");
  if (steam.discounted.length)
    msg +=
      "\n\n💸 <b>Đang giảm giá</b>\n" +
      steam.discounted
        .map(
          (g) =>
            `• <a href="${g.url}">${g.title}</a> — ~$${g.oldPrice}~ <b>$${g.newPrice}</b> (-${g.discount}%)`
        )
        .join("\n");
  if (!steam.freeNow.length && !steam.discounted.length)
    msg += "🚫 Không có game miễn phí hiện tại.";
  msg += "\n\n────────────────────\n";

  // ===== Ubisoft =====
  msg += "🎯 <b>Ubisoft — Free Now</b>\n";
  msg += ubisoft.freeNow.length
    ? ubisoft.freeNow
        .map((g) => `• <a href="${g.url}">${g.title}</a>`)
        .join("\n")
    : "🚫 Không có game miễn phí hiện tại.";
  msg += "\n\n────────────────────\n";

  // ===== Xbox =====
  msg += "🎮 <b>Xbox — Free & Deals</b>\n";
  msg += xbox.freeNow?.length
    ? xbox.freeNow.map((g) => `• <a href="${g.url}">${g.title}</a>`).join("\n")
    : "🚫 Không có game miễn phí hiện tại.";

  msg +=
    "\n\n✨ <i>Nhấn vào link để nhận game miễn phí ngay!</i>\n#FreeGames #Epic #GOG #Steam #Ubisoft #Xbox";

  if (!silent) await sendToAll(msg);
  res.status(200).json({ success: true, message: msg });
}
