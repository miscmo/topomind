const fs = require('fs');
const { app, net, protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, bypassCSP: true, supportFetchAPI: true, secure: true, stream: true } }
]);
app.whenReady().then(async () => {
  protocol.handle('local-file', async (req) => {
    try {
      const res = await net.fetch('file:///D:/non_existent_file.jpg');
      fs.writeFileSync('out.txt', 'fetch resolved, status: ' + res.status + '\n');
      return res;
    } catch(e) {
      fs.writeFileSync('out.txt', 'fetch rejected: ' + e.message + '\n');
      return new Response('Not found', { status: 404 });
    }
  });

  try {
    const res = await net.fetch('local-file:///test');
    fs.appendFileSync('out.txt', 'local-file resolved, status: ' + res.status + '\n');
  } catch(e) {
    fs.appendFileSync('out.txt', 'local-file rejected: ' + e.message + '\n');
  }
  app.quit();
});