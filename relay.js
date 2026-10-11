function readConfig(env) {
    const token = env.DISCORD_TOKEN?.trim();
    if (!token) throw new Error('DISCORD_TOKEN est requis.');
    const rawPort = env.PORT ?? '8080';
    if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
        throw new Error('PORT doit être un entier entre 1 et 65535.');
    }
    const channelId = env.LIVECHAT_CHANNEL_ID?.trim() || null;
    if (channelId && !/^\d+$/.test(channelId)) {
        throw new Error('LIVECHAT_CHANNEL_ID doit être un identifiant Discord numérique.');
    }
    return { token, port: Number(rawPort), channelId };
}

function safeUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            ? url.href : null;
    } catch {
        return null;
    }
}

function extractLink(text) {
    // Discord's <url> syntax, Markdown links and links embedded in a sentence.
    const pattern = /\[[^\]]*\]\((https?:\/\/[^\s]+)\)|<?https?:\/\/[^\s<>]+>?/gi;
    for (const match of text.matchAll(pattern)) {
        let value = match[1] || match[0].replace(/^<|>$/g, '');
        if (!match[1] && !match[0].startsWith('<')) {
            value = value.replace(/[.,!?;:]+$/, '');
            while (value.endsWith(')') && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) {
                value = value.slice(0, -1);
            }
        }
        const url = safeUrl(value);
        if (url) return { url, start: match.index, end: match.index + match[0].length };
    }
    return null;
}

function toPayload(message, config) {
    if (!message.guildId || message.author?.bot || message.webhookId || !message.author) return null;
    const matchesChannel = config.channelId
        ? message.channelId === config.channelId
        : message.channel?.name === 'livechat';
    if (!matchesChannel) return null;

    const content = message.content || '';
    const hasCommand = /^!livechat(?:\s+|$)/.test(content);
    let text = content.replace(/^!livechat(?:\s+|$)/, '').trim();
    let url = null;
    for (const attachment of message.attachments?.values() || []) {
        const media = /^(image|video)\//i.test(attachment.contentType || '')
            || ((!attachment.contentType || attachment.contentType === 'application/octet-stream')
                && /\.(png|jpe?g|gif|webp|avif|bmp|mp4|webm|mov|ogg)$/i.test(attachment.name || ''));
        if (media && safeUrl(attachment.url)) {
            url = safeUrl(attachment.url);
            break;
        }
    }
    if (!url) {
        const link = extractLink(text);
        if (link) {
            url = link.url;
            text = `${text.slice(0, link.start)}${text.slice(link.end)}`.trim();
        }
    }
    // Media is automatic; plain text requires an explicit command.
    if (!url && (!hasCommand || !text)) return null;
    return {
        type: 'play_media', url, text,
        author: message.member?.displayName || message.author.globalName || message.author.username,
        avatar: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
    };
}

function createMessageHandler({ config, broadcast, logger = console }) {
    return async message => {
        try {
            const payload = toPayload(message, config);
            if (payload) await broadcast(payload);
        } catch (error) {
            logger.error('Impossible de relayer le message :', error.message);
        }
    };
}

module.exports = { readConfig, toPayload, createMessageHandler };
