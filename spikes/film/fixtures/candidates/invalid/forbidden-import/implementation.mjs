import { readFileSync } from "node:fs";

export default () => ({ layers: [], audio: [], hosts: readFileSync("/etc/hosts", "utf8") });
