import { BCD_VERSION, GENERATOR_VERSION } from "../packages/generator/dist/index.js";
import { readPublicationReservation } from "../packages/publisher/dist/index.js";
import { storeFromEnvironment } from "./publication-store.mjs";

if (process.argv.length !== 2) throw new Error("Usage: prepare-publication");

// A snapshot identifier is reserved with its timestamps the first time a publication starts.
// A rerun must generate with those same timestamps, or the reservation refuses it.
const store = storeFromEnvironment();
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
  `${JSON.stringify({ expires, generated, reservation: reservation !== null, snapshotId })}\n`,
);
