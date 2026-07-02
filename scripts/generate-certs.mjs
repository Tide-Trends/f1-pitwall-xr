#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function main() {
  fs.mkdirSync(certDir, { recursive: true });

  const lanIp = getLanIp();
  const san = `DNS:localhost,DNS:*.local,IP:127.0.0.1,IP:${lanIp}`;

  console.log(`Generating TLS certs in ${certDir}`);
  console.log(`  LAN IP: ${lanIp}`);

  try {
    execSync('mkcert -version', { stdio: 'ignore' });
    execSync(
      `mkcert -key-file "${keyFile}" -cert-file "${certFile}" localhost 127.0.0.1 ${lanIp} "*.local"`,
      { stdio: 'inherit', cwd: certDir },
    );
    fs.writeFileSync(path.join(certDir, 'quest-url.txt'), `https://${lanIp}:5173\n`);
    console.log('Certs generated with mkcert.');
    console.log(`Quest URL: https://${lanIp}:5173`);
    return;
  } catch {
    console.log('mkcert not found — using OpenSSL self-signed cert.');
  }

  const cnf = path.join(certDir, 'openssl.cnf');
  fs.writeFileSync(
    cnf,
    `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = PitWall XR Local

[v3_req]
subjectAltName = ${san}
`,
  );

  execSync(
    `openssl req -x509 -newkey rsa:4096 -keyout "${keyFile}" -out "${certFile}" -days 825 -nodes -config "${cnf}"`,
    { stdio: 'inherit' },
  );

  fs.writeFileSync(path.join(certDir, 'quest-url.txt'), `https://${lanIp}:5173\n`);
  console.log(`Quest URL: https://${lanIp}:5173`);
  console.log('Mac URL:   https://localhost:5173');
}

main();
