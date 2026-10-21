import { mkdir } from "node:fs/promises";

import { BCD_VERSION, GENERATOR_VERSION } from "../packages/generator/dist/index.js";
import {
  createR2S3Store,
  readPublicationReservation,
  restorePublishedBaseline,
} from "../packages/publisher/dist/index.js";

const outputRoot = process.argv[2];
if (outputRoot === undefined || process.argv.length !== 3) {
  throw new Error("Usage: prepare-publication <empty-baseline-directory>");
}
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
await mkdir(outputRoot, { recursive: true });
const store = createR2S3Store({ accessKeyId, accountId, bucket, secretAccessKey });
const baseline = await restorePublishedBaseline({ outputRoot, store });
const snapshotId = `bcd-${BCD_VERSION}-gen-${GENERATOR_VERSION}`;
const reservation = await readPublicationReservation(store, snapshotId);
const generated = reservation?.generated ?? process.env.PUBLICATION_GENERATED;
const expires = reservation?.expires ?? process.env.PUBLICATION_EXPIRES;
if (!generated || !expires) {
  throw new Error(
    "Publication requires the exact reviewed generation window or a durable reservation.",
  );
}
process.stdout.write(
  `${JSON.stringify({ baseline, expires, generated, reservation: reservation !== null, snapshotId })}\n`,
);
