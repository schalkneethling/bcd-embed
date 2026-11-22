// Byte comparison for the compressed-versus-identity check. Plain ES module for k6 and Node.

/**
 * True when both buffers hold the same bytes. A missing buffer (a null body on a response) never
 * matches, so a 200 without a body cannot pass. O(n) time, O(1) extra space.
 */
export const sameBytes = (left, right) => {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};
