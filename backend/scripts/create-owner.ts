/** One-time CLI setup; web registration uses the same atomic Owner bootstrap. */
import "dotenv/config";
import { pool } from "../src/db.js";
import { createFirstOwner } from "../src/first-owner.js";

try {
  await createFirstOwner({
    orgName: process.env["SETUP_ORG_NAME"],
    orgGstin: process.env["SETUP_ORG_GSTIN"],
    name: process.env["SETUP_OWNER_NAME"],
    email: process.env["SETUP_OWNER_EMAIL"],
    password: process.env["SETUP_OWNER_PASSWORD"],
    mobile: process.env["SETUP_OWNER_MOBILE"] ?? "",
  });
  console.log("Created the organisation and first Owner (master admin). Add your warehouses, items and users from the app.");
} finally {
  await pool.end();
}
