import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  username: String,
  first_name: String,
  last_name: String,
  joinedAt: { type: Date, default: Date.now },
});

export default mongoose.models.User || mongoose.model("User", userSchema);
