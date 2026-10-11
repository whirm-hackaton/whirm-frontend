function base64Url(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function validateWalletAssertion(
  credential: Credential | null,
  challenge: BufferSource,
  passkey: { credentialId: string; rpId: string; origin: string },
) {
  const invalid = () => new Error('The selected passkey does not match this wallet or its domain. Open the same Bitwarden vault and try again.')
  if (!credential || credential.type !== 'public-key' || credential.id !== passkey.credentialId
    || !('rawId' in credential) || !(credential.rawId instanceof ArrayBuffer)
    || base64Url(credential.rawId) !== passkey.credentialId
    || !('response' in credential) || typeof credential.response !== 'object' || credential.response === null
    || !('clientDataJSON' in credential.response) || !(credential.response.clientDataJSON instanceof ArrayBuffer)
    || !('authenticatorData' in credential.response) || !(credential.response.authenticatorData instanceof ArrayBuffer)) throw invalid()

  let clientData: unknown
  try { clientData = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON)) }
  catch { throw invalid() }
  const expectedChallenge = new Uint8Array(challenge instanceof ArrayBuffer
    ? challenge : challenge.buffer, challenge instanceof ArrayBuffer ? 0 : challenge.byteOffset,
    challenge.byteLength)
  if (typeof clientData !== 'object' || clientData === null
    || !('type' in clientData) || clientData.type !== 'webauthn.get'
    || !('challenge' in clientData) || clientData.challenge !== base64Url(expectedChallenge.slice().buffer)
    || !('origin' in clientData) || clientData.origin !== passkey.origin
    || ('crossOrigin' in clientData && clientData.crossOrigin !== false)) throw invalid()

  const authenticatorData = new Uint8Array(credential.response.authenticatorData)
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passkey.rpId)))
  if (authenticatorData.length < 37 || (authenticatorData[32]! & 5) !== 5
    || ((authenticatorData[32]! & 16) !== 0 && (authenticatorData[32]! & 8) === 0)
    || !rpIdHash.every((byte, index) => authenticatorData[index] === byte)) throw invalid()
}
