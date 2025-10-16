import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
dotenv.config();

const dataFile = path.join("/tmp", "notified.json");

function loadNotified() {
  try {
    if (fs.existsSync(dataFile)) {
      const json = fs.readFileSync(dataFile, "utf-8");
      return JSON.parse(json);
    }
    return { epic: [], gog: [] };
  } catch {
    return { epic: [], gog: [] };
  }
}

function saveNotified(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Không thể ghi file notified:", err.message);
  }
}

async function sendTelegramMessage(message) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!botToken || !chatId) {
    console.error("❌ BOT_TOKEN hoặc CHAT_ID chưa được cấu hình");
    return;
  }

  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

async function getEpicFreeGames() {
  const url =
    "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";
  try {
    const { data } = await axios.get(url);
    return (
      data?.data?.Catalog?.searchStore?.elements
        ?.filter(
          (g) =>
            g.promotions &&
            g.promotions.promotionalOffers?.length > 0 &&
            g.promotions.promotionalOffers[0].promotionalOffers[0]
              .discountSetting.discountPercentage === 0
        )
        ?.map((g) => ({
          title: g.title,
          id: g.id,
          slug: g.productSlug,
          url: `https://store.epicgames.com/en-US/p/${
            g.productSlug || g.urlSlug
          }`,
        })) || []
    );
  } catch (err) {
    console.error("❌ Lỗi Epic Games:", err.message);
    return [];
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
  console.log("🔍 Kiểm tra game miễn phí...");
  const [epicGames, gogGames] = await Promise.all([
    getEpicFreeGames(),
    getGOGFreeGames(),
  ]);

  const notified = loadNotified();
  const newEpic = epicGames.filter((g) => !notified.epic.includes(g.title));
  const newGOG = gogGames.filter((g) => !notified.gog.includes(g.title));

  let message = "🎮 <b>Game miễn phí hôm nay:</b>\n";

  if (epicGames.length > 0) {
    message += "\n🆓 <b>Epic Games Free Now:</b>\n";
    epicGames.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (gogGames.length > 0) {
    message += "\n🆓 <b>GOG Free Now:</b>\n";
    gogGames.forEach((g, i) => {
      message += `${i + 1}. <a href="${g.url}">${g.title}</a>\n`;
    });
  }

  if (newEpic.length > 0 || newGOG.length > 0) {
    let newMessage = "🆕 <b>Có game miễn phí mới!</b>\n\n";
    if (newEpic.length > 0) {
      newMessage += "🎯 Epic Games:\n";
      newEpic.forEach(
        (g) => (newMessage += `- <a href="${g.url}">${g.title}</a>\n`)
      );
    }
    if (newGOG.length > 0) {
      newMessage += "\n🎯 GOG:\n";
      newGOG.forEach(
        (g) => (newMessage += `- <a href="${g.url}">${g.title}</a>\n`)
      );
    }

    await sendTelegramMessage(newMessage);

    notified.epic.push(...newEpic.map((g) => g.title));
    notified.gog.push(...newGOG.map((g) => g.title));
    saveNotified(notified);
  }

  res.status(200).json({ success: true, epicGames, gogGames });
}
