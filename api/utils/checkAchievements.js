import axios from "axios";
import User from "../models/User.js";

const milestones = [
  { count: 1, name: "Welcome New Gamer" },
  { count: 5, name: "Games Hunter" },
  { count: 10, name: "Games Veteran" },
];

export async function checkAchievements(user, botToken) {
  for (const m of milestones) {
    const alreadyUnlocked = user.achievements.some((a) => a.name === m.name);
    if (user.claimedGames >= m.count && !alreadyUnlocked) {
      user.achievements.push({ name: m.name });
      await user.save();

      // Gửi thông báo Telegram
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: user.chatId,
        text: `🏆 Bạn vừa mở khóa thành tích mới: <b>${m.name}</b>!`,
        parse_mode: "HTML",
      });
    }
  }
}
