// Byte comparison for the compressed-versus-identity check. Plain ES module for k6 and Node.

/** True when both buffers hold the same bytes. O(n) time, O(1) extra space. */
export const sameBytes = (left, right) => {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};
