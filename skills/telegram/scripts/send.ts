const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const USER_ID = process.env.TELEGRAM_USER_ID;

if (!BOT_TOKEN || !USER_ID) {
  console.log(`Missing environment variables.

To set up Telegram messaging:

1. Get a bot token:
   - Open Telegram and message @BotFather
   - Send /newbot and follow the prompts
   - Copy the bot token you receive

2. Get your user/chat ID:
   - Send any message to your new bot
   - Run: curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   - Find your chat ID in the response under result[].message.chat.id

3. Set the env vars:
   Backoffice:env_set TELEGRAM_BOT_TOKEN=<your_token>
   Backoffice:env_set TELEGRAM_USER_ID=<your_chat_id>
`);
  process.exit(1);
}

const message = process.argv.slice(2).join(" ");
if (!message) {
  console.error("Usage: bun send.ts <message>");
  process.exit(1);
}

const res = await fetch(
  `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: USER_ID, text: message, parse_mode: "Markdown" }),
  }
);

const data = await res.json();
if (!data.ok) {
  console.error("Telegram API error:", data.description);
  process.exit(1);
}

console.log("Message sent.");
