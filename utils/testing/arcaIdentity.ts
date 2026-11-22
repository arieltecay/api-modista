import forge from 'node-forge';

export interface TestIdentity {
  certificatePem: string;
  privateKeyPem: string;
}

const DAY = 86_400_000;

/** Self-signed RSA identity for ARCA signing tests; valid for one day around now unless dates are given. */
export const createTestIdentity = (
  validFrom: Date = new Date(Date.now() - DAY),
  validTo: Date = new Date(Date.now() + DAY)
): TestIdentity => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validTo;
  const attrs = [{ name: 'commonName', value: 'modista-test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
};
