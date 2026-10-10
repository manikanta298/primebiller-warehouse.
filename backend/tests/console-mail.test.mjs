import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { config } = await import('../src/config.ts');
const { sendRegistrationEmail, sendPasswordResetEmail, smtpConfigured } = await import('../src/smtp.ts');

test('console delivery opens no sockets even with production SMTP credentials present', async (t) => {
  const previous = { ...config }, originalLog = console.log, originalEnv = process.env.NODE_ENV;
  const logs = [];
  t.mock.method(net, 'connect', () => { throw new Error('Unexpected SMTP socket'); });
  t.mock.method(tls, 'connect', () => { throw new Error('Unexpected TLS socket'); });
  Object.assign(config, { mailDeliveryMode: 'console', smtpHost: 'smtp.example.com', smtpUser: 'secret-user', smtpPassword: 'secret-password', smtpFrom: 'sender@example.com' });
  process.env.NODE_ENV = 'production';
  console.log = (...args) => logs.push(args);
  try {
    assert.equal(smtpConfigured(), true);
    await sendRegistrationEmail('test@example.com', 'Test Owner');
    await sendPasswordResetEmail('test@example.com', 'https://frontend.example.com/login?reset=test');
    assert.equal(logs.length, 2);
    assert.equal(JSON.stringify(logs).includes('secret-password'), false);
    assert.equal(JSON.stringify(logs).includes('secret-user'), false);
    await assert.rejects(sendRegistrationEmail('bad\r\naddress@example.com', 'Test'), /Invalid SMTP header/);
  } finally { Object.assign(config, previous); console.log = originalLog; if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv; }
});

test('SMTP mode without a provider fails rather than exposing emails in logs', async () => {
  const previous = { ...config };
  Object.assign(config, { mailDeliveryMode: 'smtp', smtpHost: undefined, smtpFrom: undefined });
  try {
    assert.equal(smtpConfigured(), false);
    await assert.rejects(sendPasswordResetEmail('test@example.com', 'test'), /SMTP_HOST and SMTP_FROM/);
  } finally { Object.assign(config, previous); }
});
