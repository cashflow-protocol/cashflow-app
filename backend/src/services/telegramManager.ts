import axios from 'axios';

const ADMIN_IDS = [862473];
const ADMIN_CHAT_ID = ADMIN_IDS[0];

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

export async function notifyAdminWithPhoto(
  photoUrl: string,
  caption: string,
  inlineKeyboard?: { text: string; callback_data: string }[][],
): Promise<void> {
  try {
    const token = getBotToken();
    if (!token) return;

    await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
      chat_id: ADMIN_CHAT_ID,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
      ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    });
  } catch (err) {
    console.error('Admin photo notification failed:', err);
  }
}

// ─── Callback queries & message editing ───

export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  try {
    const token = getBotToken();
    if (!token) return;

    await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (err) {
    console.error('answerCallbackQuery failed:', err);
  }
}

export async function editMessageCaption(chatId: string | number, messageId: number, caption: string): Promise<void> {
  try {
    const token = getBotToken();
    if (!token) return;

    await axios.post(`https://api.telegram.org/bot${token}/editMessageCaption`, {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('editMessageCaption failed:', err);
  }
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

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}
