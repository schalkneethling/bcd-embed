import { createR2S3Store } from "../packages/publisher/dist/index.js";

/** Builds the R2 store from the environment the protected publish job provides. */
export const storeFromEnvironment = () => {
  const {
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_ACCOUNT_ID: accountId,
    R2_BUCKET: bucket,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  if (!accessKeyId || !accountId || !bucket || !secretAccessKey) {
    throw new Error(
      "Protected publication requires complete R2 credentials and destination configuration.",
    );
  }
  return createR2S3Store({ accessKeyId, accountId, bucket, secretAccessKey });
};
