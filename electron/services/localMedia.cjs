'use strict';
const { protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const files = new Map();
function registerPrivileges() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'local-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }]);
}
function registerFile(filePath) {
  for (const [token, existing] of files) if (existing === filePath) return token;
  const token = crypto.createHash('sha256').update(filePath + '\0' + crypto.randomBytes(16)).digest('hex').slice(0, 32);
  files.set(token, filePath);
  return token;
}
function unregisterFile(filePath) {
  for (const [token, existing] of files) if (existing === filePath) files.delete(token);
}
function mediaUrl(filePath) { return 'local-media://audio/' + registerFile(filePath); }
function handleRequests() {
  protocol.handle('local-media', (request) => {
    const token = new URL(request.url).pathname.slice(1);
    const filePath = files.get(token);
    if (!filePath) return new Response('Not registered', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers, bypassCustomProtocolHandlers: true });
  });
}
module.exports = { registerPrivileges, registerFile, unregisterFile, mediaUrl, handleRequests };
