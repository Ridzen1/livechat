const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toPayload, readConfig, createMessageHandler } = require('../relay');

function message(overrides = {}) {
    return {
        guildId: '1', channelId: '2', channel: { name: 'livechat' },
        author: { bot: false, username: 'Alice', displayAvatarURL: () => 'https://example.com/avatar.png' },
        content: '!livechat Bonjour !', attachments: new Map(), ...overrides,
    };
}

test('forwards commanded text using the overlay wire format', () => {
    assert.deepEqual(toPayload(message(), {}), {
        type: 'play_media', url: null, text: 'Bonjour !', author: 'Alice', avatar: 'https://example.com/avatar.png',
    });
});

test('ignores other channels, bots, webhooks and direct messages', () => {
    for (const overrides of [
        { channel: { name: 'general' }, content: '!livechat https://example.com/v.mp4' },
        { author: { bot: true } }, { webhookId: '123' }, { guildId: null }, { author: null },
    ]) assert.equal(toPayload(message(overrides), {}), null);
});

test('an explicit channel ID overrides the name filter', () => {
    assert.ok(toPayload(message({ channel: { name: 'renamed' } }), { channelId: '2' }));
    assert.equal(toPayload(message(), { channelId: '3' }), null);
});

test('extracts links from sentences, newlines, angle brackets and Markdown', () => {
    for (const content of [
        'https://example.com/a.mp4', 'Regarde\nhttps://example.com/a.mp4',
        'Regarde <https://example.com/a.mp4>', '[Vidéo](https://example.com/a.mp4)',
        'Regarde (https://example.com/a.mp4).', '!livechat\t https://example.com/a.mp4',
    ]) assert.equal(toPayload(message({ content }), {}).url, 'https://example.com/a.mp4', content);
    assert.equal(toPayload(message({ content: 'Bonjour https://example.com/a.mp4 merci' }), {}).text, 'Bonjour  merci');
    assert.equal(toPayload(message({ content: 'https://example.com/a_(b)' }), {}).url, 'https://example.com/a_(b)');
});

test('plain text requires the exact command prefix and nonempty content', () => {
    assert.equal(toPayload(message({ content: '!livechat Bonjour' }), {}).text, 'Bonjour');
    assert.equal(toPayload(message({ content: '!livechat\nBonjour' }), {}).text, 'Bonjour');
    for (const content of ['Bonjour', '!livechatting', 'Bonjour !livechat', '!livechat', '!livechat   ']) {
        assert.equal(toPayload(message({ content }), {}), null, content);
    }
});

test('selects a media attachment after an unsupported file and retains the caption', () => {
    const attachments = new Map([
        ['1', { url: 'https://example.com/a.pdf', contentType: 'application/pdf' }],
        ['2', { url: 'https://example.com/a.mp4', contentType: 'video/mp4' }],
    ]);
    const result = toPayload(message({ attachments, content: 'Regarde ceci' }), {});
    assert.equal(result.url, 'https://example.com/a.mp4');
    assert.equal(result.text, 'Regarde ceci');
    assert.equal(toPayload(message({ attachments, content: '' }), {}).url, result.url);
});

test('supports attachment filename fallback and falls back to links after unsupported files', () => {
    const attachments = new Map([['1', { url: 'https://example.com/image', name: 'photo.PNG' }]]);
    assert.equal(toPayload(message({ attachments }), {}).url, 'https://example.com/image');
    attachments.set('1', { url: 'https://example.com/a.pdf', contentType: 'application/pdf' });
    assert.equal(toPayload(message({ attachments, content: 'https://example.com/a.gif' }), {}).url, 'https://example.com/a.gif');
});

test('does not pass unsafe URLs as media, preserving text messages', () => {
    for (const content of ['javascript:alert(1)', 'file:///private', 'https://user:pass@example.com/a']) {
        assert.equal(toPayload(message({ content }), {}), null);
        const result = toPayload(message({ content: `!livechat ${content}` }), {});
        assert.equal(result.url, null);
        assert.equal(result.text, content);
    }
});

test('ordinary text and unsupported attachments never reach broadcast', async () => {
    const handler = createMessageHandler({ config: {}, broadcast: () => assert.fail('must not broadcast') });
    await handler(message({ content: 'Conversation ordinaire' }));
    await handler(message({
        content: 'Un document',
        attachments: new Map([['1', { url: 'https://example.com/a.pdf', contentType: 'application/pdf' }]]),
    }));
});

test('ignores empty messages and uses server display names', () => {
    assert.equal(toPayload(message({ content: '' }), {}), null);
    assert.equal(toPayload(message({ content: '!livechat' }), {}), null);
    assert.equal(toPayload(message({ member: { displayName: 'Alice du serveur' } }), {}).author, 'Alice du serveur');
});

test('validates configuration before attempting to start', () => {
    assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
    for (const PORT of ['', '0', '-1', '65536', 'abc', '8.5']) {
        assert.throws(() => readConfig({ DISCORD_TOKEN: 'test', PORT }), /PORT/);
    }
    assert.throws(() => readConfig({ DISCORD_TOKEN: 'test', LIVECHAT_CHANNEL_ID: '#livechat' }), /CHANNEL_ID/);
    assert.deepEqual(readConfig({ DISCORD_TOKEN: ' test ' }), { token: 'test', port: 8080, channelId: null });
});

test('contains relay failures and never posts confirmation messages to Discord', async () => {
    const errors = [];
    const handler = createMessageHandler({
        config: {}, broadcast: async () => { throw new Error('offline'); },
        logger: { error: (...args) => errors.push(args) },
    });
    await handler(message({ reply: () => assert.fail('must not send a reply') }));
    assert.equal(errors.length, 1);
});
