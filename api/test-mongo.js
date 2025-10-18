import { MongoClient } from "mongodb";

export default async function handler(req, res) {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    return res.status(500).json({
      success: false,
      error:
        "❌ MONGODB_URI chưa được cấu hình trong Vercel Environment Variables",
    });
  }

  try {
    console.log("🔗 Kết nối MongoDB:", uri);
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(process.env.DB_NAME || "freebies");
    const collections = await db.listCollections().toArray();

    res.status(200).json({
      success: true,
      message: "✅ Kết nối MongoDB thành công!",
      dbName: db.databaseName,
      collections: collections.map((c) => c.name),
    });

    await client.close();
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
