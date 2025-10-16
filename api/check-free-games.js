import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
dotenv.config();

async function sendTelegramMessage(message) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!botToken || !chatId) {
    console.error("❌ BOT_TOKEN hoặc CHAT_ID chưa được cấu hình trong .env");
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
    console.log("✅ Đã gửi thông báo Telegram!");
  } catch (err) {
    console.error("❌ Lỗi gửi Telegram:", err.response?.data || err.message);
  }
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
    message +=
      "\n🆓 <b>Epic Games Free Now:</b>\n🚫 Không có game miễn phí hiện tại.\n";
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
  } else {
    message +=
      "\n🆓 <b>GOG Free Now:</b>\n🚫 Không có game miễn phí hiện tại.\n";
  }

  await sendTelegramMessage(message);

  res.status(200).json({ success: true, message });
}
