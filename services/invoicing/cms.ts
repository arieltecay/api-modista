import forge from 'node-forge';

const sameModulus = (certificate: forge.pki.Certificate, key: forge.pki.rsa.PrivateKey): boolean =>
  (certificate.publicKey as forge.pki.rsa.PublicKey).n.compareTo(key.n) === 0;

/** Signs the WSAA `loginTicketRequest` as the attached CMS (PKCS#7) that `LoginCms` expects, in base64. */
export const signLoginTicketRequest = (content: string, certificatePem: string, privateKeyPem: string): string => {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;

  if (!sameModulus(certificate, key)) throw new Error('La clave privada no corresponde al certificado');
  const now = new Date();
  if (now < certificate.validity.notBefore || now > certificate.validity.notAfter) {
    throw new Error('El certificado está fuera de vigencia');
  }

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content, 'utf8');
  p7.addCertificate(certificate);
  p7.addSigner({
    key,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now as unknown as string },
    ],
  });
  p7.sign();

  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
};
