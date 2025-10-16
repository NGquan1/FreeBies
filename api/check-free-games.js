import axios from "axios";
import * as cheerio from "cheerio";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

async function sendTelegramMessage(message) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("❌ Thiếu BOT_TOKEN hoặc CHAT_ID trong biến môi trường");
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
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
  try {
    const url =
      "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";
    const { data } = await axios.get(url);

    const games = data?.data?.Catalog?.searchStore?.elements
      ?.map((g) => {
        const slug =
          g.catalogNs?.mappings?.[0]?.pageSlug ||
          g.productSlug ||
          g.urlSlug ||
          "";
        const url = `https://store.epicgames.com/en-US/p/${slug}`;
        const offer =
          g.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
        const upcoming =
          g.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0];

        return {
          title: g.title,
          url,
          freeNow: offer?.discountSetting?.discountPercentage === 0,
          upcoming: upcoming ? true : false,
        };
      })
      .filter(Boolean);

    const freeNow = games.filter((g) => g.freeNow);
    const upcoming = games.filter((g) => g.upcoming);

    return { freeNow, upcoming };
  } catch (err) {
    console.error("❌ Lỗi Epic Games:", err.message);
    return { freeNow: [], upcoming: [] };
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
      if (!games.some((g) => g.url === href)) {
        games.push({ title, url: href });
      }
    });

    return games.slice(0, 10);
  } catch (err) {
    console.error("❌ Lỗi GOG:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  console.log("🔍 Đang quét game miễn phí...");

  const { freeNow, upcoming } = await getEpicFreeGames();
  const gog = await getGOGFreeGames();

  let message = "🎮 <b>Game miễn phí hôm nay:</b>\n";

  if (freeNow.length > 0) {
    message += "\n🆓 <b>Epic Games Free Now:</b>\n";
    freeNow.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  } else {
    message += "\n🆓 <b>Epic Games Free Now:</b>\n🚫 Không có game miễn phí hiện tại.\n";
  }

  if (upcoming.length > 0) {
    message += "\n⏳ <b>Sắp miễn phí (Epic Games):</b>\n";
    upcoming.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (gog.length > 0) {
    message += "\n🆓 <b>GOG Free Games:</b>\n";
    gog.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  } else {
    message += "\n🆓 <b>GOG Free Games:</b>\n🚫 Không có game miễn phí hiện tại.\n";
  }

  await sendTelegramMessage(message);

  return res.status(200).json({ success: true, message: "Đã gửi thông báo!" });
}
