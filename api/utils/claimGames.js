import axios from "axios";
import User from "../models/User.js";
import { checkAchievements } from "./checkAchievements.js";

export async function claimGame(chatId, title, url, botToken) {
  try {
    const user = await User.findOne({ chatId });
    if (!user) return;

    if (user.claimedList.some((g) => g.url === url)) {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: `⚠️ Bạn đã nhận game <b>${title}</b> rồi.`,
        parse_mode: "HTML",
      });
      return;
    }

    user.claimedGames += 1;
    user.claimedList.push({ title, url });
    await user.save();

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: `🎁 Bạn vừa nhận game <b>${title}</b>!\n👉 ${url}`,
      parse_mode: "HTML",
    });

    await checkAchievements(user, botToken);
  } catch (err) {
    console.error("❌ claimGame error:", err.message);
  }
}
