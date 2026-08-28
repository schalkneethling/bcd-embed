import { cp, mkdir } from "node:fs/promises";

const source = new URL("../json-schema/", import.meta.url);
const destination = new URL("../dist/json-schema/", import.meta.url);

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
