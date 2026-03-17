import axios from 'axios';

const ADMIN_CHAT_ID = 862473;

function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

// ─── Sending messages ───

export async function sendMessage(chatId: string | number, text: string, parseMode?: 'HTML' | 'Markdown'): Promise<void> {
  try {
    const token = getBotToken();
    if (!token) return;

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }
  catch (err){
    console.error(err);
  }
}

export async function notifyAdmin(message: string): Promise<void> {
  await sendMessage(ADMIN_CHAT_ID, message, 'HTML');
}

// ─── Channel membership ───

export async function checkChannelMember(userId: string, channelUsername: string): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;

  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getChatMember`, {
      params: { chat_id: channelUsername, user_id: userId },
    });
    const status = res.data?.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch {
    return false;
  }
}

// ─── Configuration check ───

export function isConfigured(): boolean {
  return !!getBotToken();
}
