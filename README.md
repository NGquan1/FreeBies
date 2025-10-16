# 🎮 FreeBies Telegram Bot

Tự động quét game miễn phí từ **Epic Games** và **GOG**, rồi gửi thông báo qua Telegram mỗi ngày.

## ⚙️ Cấu hình

Tạo file `.env` (hoặc thêm vào Environment Variables trên Vercel):

```
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
CHAT_ID=YOUR_TELEGRAM_CHAT_ID
```

## 🚀 Deploy lên Vercel

1. Truy cập [https://vercel.com/new](https://vercel.com/new)
2. Kéo thả folder này lên
3. Add Environment Variables
4. Xong! Vercel sẽ tự chạy mỗi ngày.

Hoặc test thủ công:
```
https://your-app-name.vercel.app/api/check-free-games
```
