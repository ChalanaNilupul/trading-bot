/**
 * Optional Telegram alerts. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable.
 * Never throws: a failed alert must not crash the bot.
 */
async function notify(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text }),
            signal: AbortSignal.timeout(8000),
        });
    } catch (error) {
        console.error("Notify failed:", error.message);
    }
}

module.exports = { notify };
