import assert from 'node:assert/strict';
import test from 'node:test';
import forge from 'node-forge';
import { createTestIdentity } from '../../utils/testing/arcaIdentity.js';
import { signLoginTicketRequest } from './cms.js';

const DAY = 86_400_000;
const valid = createTestIdentity();
const content = '<loginTicketRequest version="1.0"><service>wsfe</service></loginTicketRequest>';

test('produces a CMS whose content, digest and signature verify against the certificate', () => {
  const cms = signLoginTicketRequest(content, valid.certificatePem, valid.privateKeyPem);
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as forge.pkcs7.PkcsSignedData & {
    rawCapture: { content: forge.asn1.Asn1; authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
  };

  const signedContent = (p7.rawCapture.content.value as forge.asn1.Asn1[])[0].value as string;
  assert.equal(forge.util.decodeUtf8(signedContent), content);

  const attributes = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, p7.rawCapture.authenticatedAttributes);
  const digest = forge.md.sha256.create();
  digest.update(forge.asn1.toDer(attributes).getBytes());
  const publicKey = forge.pki.certificateFromPem(valid.certificatePem).publicKey as forge.pki.rsa.PublicKey;
  assert.equal(publicKey.verify(digest.digest().getBytes(), p7.rawCapture.signature), true);
});

test('rejects a private key that does not match the certificate', () => {
  const other = createTestIdentity();
  assert.throws(() => signLoginTicketRequest(content, valid.certificatePem, other.privateKeyPem), /no corresponde/);
});

test('rejects an expired certificate', () => {
  const expired = createTestIdentity(new Date(Date.now() - 3 * DAY), new Date(Date.now() - DAY));
  assert.throws(() => signLoginTicketRequest(content, expired.certificatePem, expired.privateKeyPem), /vigencia/);
});
