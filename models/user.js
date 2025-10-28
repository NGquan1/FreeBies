import mongoose from "mongoose";

const claimedGameSchema = new mongoose.Schema({
  title: String,
  url: String,
  claimedAt: { type: Date, default: Date.now },
});

const achievementSchema = new mongoose.Schema({
  name: String,
  unlockedAt: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  username: String,
  first_name: String,
  last_name: String,
  joinedAt: { type: Date, default: Date.now },

  claimedGames: { type: Number, default: 0 },
  claimedList: [claimedGameSchema],

  achievements: [achievementSchema],
});

export default mongoose.models.User || mongoose.model("User", userSchema);
