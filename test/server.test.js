const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createRelayServer } = require('../server');
const { createMessageHandler } = require('../relay');

async function setup(t, options = {}) {
    const relay = createRelayServer({ logger: { error() {} }, ...options });
    t.after(() => relay.close());
    const address = await relay.listen(0, '127.0.0.1');
    return { relay, url: `ws://127.0.0.1:${address.port}`, port: address.port };
}

async function connect(t, url, options) {
    const ws = new WebSocket(url, options);
    t.after(() => ws.terminate());
    await once(ws, 'open');
    return ws;
}

test('health reflects Discord readiness and includes UTF-8', async t => {
    let ready = false;
    const { port } = await setup(t, { isReady: () => ready });
    let response = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /charset=utf-8/);
    await response.text();
    ready = true;
    response = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /réveillé/);
});

test('relays a Discord message to multiple real WebSocket clients', { timeout: 5000 }, async t => {
    const { relay, url } = await setup(t);
    const clients = await Promise.all([connect(t, url), connect(t, url)]);
    const received = clients.map(ws => once(ws, 'message'));
    const handler = createMessageHandler({ config: {}, broadcast: relay.broadcast });
    await handler({
        guildId: '1', channelId: '2', channel: { name: 'livechat' }, content: '!livechat Bonjour !',
        author: { username: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' }, attachments: new Map(),
    });
    for (const [data] of await Promise.all(received)) {
        assert.deepEqual(JSON.parse(data), {
            type: 'play_media', url: null, text: 'Bonjour !', author: 'Alice', avatar: 'https://example.com/a.png',
        });
    }
    const closed = once(clients[0], 'close');
    clients[0].close();
    await closed;
    const next = once(clients[1], 'message');
    relay.broadcast({ type: 'play_media', text: 'Encore' });
    assert.equal(JSON.parse((await next)[0]).text, 'Encore');
});

test('heartbeat disconnects an unresponsive connection', { timeout: 5000 }, async t => {
    const { url } = await setup(t, { heartbeatMs: 40 });
    const ws = await connect(t, url, { autoPong: false });
    await once(ws, 'close');
});

test('heartbeat keeps responsive connections open and shutdown closes them', { timeout: 5000 }, async t => {
    const { relay, url } = await setup(t, { heartbeatMs: 40 });
    const ws = await connect(t, url);
    await once(ws, 'ping');
    await once(ws, 'ping');
    assert.equal(ws.readyState, WebSocket.OPEN);
    const closed = once(ws, 'close');
    await relay.close();
    await closed;
    await relay.close();
});

test('bounds outgoing queues and accepts the existing overlay JSON pings', { timeout: 5000 }, async t => {
    const { relay, url } = await setup(t, { maxBufferedBytes: 64 });
    const ws = await connect(t, url);
    ws.send(JSON.stringify({ type: 'ping' }));
    const received = once(ws, 'message');
    relay.broadcast({ type: 'play_media', text: 'ok' });
    assert.equal(JSON.parse((await received)[0]).text, 'ok');
    const closed = once(ws, 'close');
    relay.broadcast({ text: 'x'.repeat(100) });
    await closed;
});

test('oversized incoming frames disconnect only the offending client', { timeout: 5000 }, async t => {
    const { relay, url } = await setup(t);
    const ws = await connect(t, url);
    const closed = once(ws, 'close');
    ws.send('x'.repeat(17000));
    const [code] = await closed;
    assert.equal(code, 1009);
    const healthy = await connect(t, url);
    const received = once(healthy, 'message');
    relay.broadcast({ text: 'ok' });
    assert.equal(JSON.parse((await received)[0]).text, 'ok');
});

test('reports an occupied port and can close after a failed listen', async t => {
    const { port } = await setup(t);
    const second = createRelayServer({ logger: { error() {} } });
    t.after(() => second.close());
    await assert.rejects(second.listen(port, '127.0.0.1'), { code: 'EADDRINUSE' });
    await second.close();
});
